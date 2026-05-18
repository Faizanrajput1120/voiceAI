import React, { useEffect, useRef, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  receiveIncomingCall,
  acceptCall,
  endCall,
  resetCallState,
} from '../features/callSlice';
import { socket } from '../socket';

// ─── ICE / TURN Configuration ─────────────────────────────────────────────────
// To test if TURN is working: change iceTransportPolicy to 'relay'
// If audio works with 'relay' but not 'all', your TURN server is fine but NAT is blocking direct paths
const RTC_CONFIG = {
  iceTransportPolicy: 'all',
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: [
        'turn:187.77.9.39:3478?transport=udp',
        'turn:187.77.9.39:3478?transport=tcp',
      ],
      username: 'myuser',
      credential: 'mypassword',
    },
  ],
};

const CallModal = () => {
  const dispatch = useDispatch();
  const { user } = useSelector((state) => state.auth);
  const { isCalling, incomingCall, callStatus } = useSelector((state) => state.call);

  // ─── ALL WebRTC state inside refs — NEVER touched by bundler/minifier ────────
  const pcRef                    = useRef(null);   // RTCPeerConnection
  const localStreamRef           = useRef(null);   // local MediaStream
  const pendingCandidatesRef     = useRef([]);      // buffered ICE candidates
  const remoteDescSetRef         = useRef(false);  // flag: remote desc applied?
  const targetUserIdRef          = useRef(null);   // who we're calling

  // ─── Audio element refs ────────────────────────────────────────────────────
  const localAudioRef  = useRef(null);
  const remoteAudioRef = useRef(null);

  // ─── Flush buffered ICE candidates ────────────────────────────────────────
  const flushPendingCandidates = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) return;
    while (pendingCandidatesRef.current.length > 0) {
      const candidate = pendingCandidatesRef.current.shift();
      try {
        await pc.addIceCandidate(candidate);
        console.log('[ICE] Flushed buffered candidate.');
      } catch (e) {
        console.error('[ICE] Failed to flush candidate:', e);
      }
    }
  }, []);

  // ─── Full cleanup ─────────────────────────────────────────────────────────
  const cleanupCall = useCallback(() => {
    console.log('[Call] Cleaning up call state.');

    if (pcRef.current) {
      pcRef.current.onicecandidate       = null;
      pcRef.current.ontrack              = null;
      pcRef.current.oniceconnectionstatechange = null;
      pcRef.current.onconnectionstatechange    = null;
      pcRef.current.close();
      pcRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }

    pendingCandidatesRef.current = [];
    remoteDescSetRef.current     = false;
    targetUserIdRef.current      = null;

    if (localAudioRef.current)  localAudioRef.current.srcObject  = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;

    dispatch(endCall());
    dispatch(resetCallState());
  }, [dispatch]);

  // ─── Attach remote audio — called from ontrack ────────────────────────────
  const attachRemoteAudio = useCallback((event) => {
    console.log('[ontrack] kind:', event.track.kind, '| streams:', event.streams.length);

    const el = remoteAudioRef.current;
    if (!el) {
      console.warn('[ontrack] remoteAudioRef not ready yet.');
      return;
    }

    const stream = (event.streams && event.streams[0])
      ? event.streams[0]
      : new MediaStream([event.track]);

    // Only reassign if it's a different stream
    if (!el.srcObject || el.srcObject.id !== stream.id) {
      el.srcObject = stream;
      console.log('[Audio] Assigned remote stream:', stream.id);
    }

    // Ensure audio is not muted and volume is up
    el.muted  = false;
    el.volume = 1.0;

    // playsInline is critical for iOS Safari
    el.setAttribute('playsinline', '');

    el.play().catch((err) => {
      console.warn('[Audio] Autoplay blocked by browser:', err.message);
      // Browser blocked autoplay — user needs to interact first.
      // The audio will play on next user interaction automatically.
    });
  }, []);

  // ─── Create RTCPeerConnection and acquire microphone ─────────────────────
  const initWebRTC = useCallback(async (targetUserId) => {
    // Reset state for fresh connection
    remoteDescSetRef.current     = false;
    pendingCandidatesRef.current = [];

    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;

    // ── Connection state diagnostics ────────────────────────────────────────
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      console.log('[ICE] Connection state:', state);
      if (state === 'failed' || state === 'disconnected') {
        console.warn('[ICE] Failed/disconnected — ending call.');
        cleanupCall();
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[PC] Connection state:', pc.connectionState);
    };

    pc.onsignalingstatechange = () => {
      console.log('[PC] Signaling state:', pc.signalingState);
    };

    // ── Send ICE candidates to remote peer ──────────────────────────────────
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[ICE] Sending:', event.candidate.type, event.candidate.protocol);
        socket.emit('ice-candidate', {
          targetUserId,
          candidate: event.candidate,
        });
      } else {
        console.log('[ICE] Gathering complete.');
      }
    };

    // ── Handle incoming remote audio track ──────────────────────────────────
    pc.ontrack = attachRemoteAudio;

    // ── Acquire microphone ──────────────────────────────────────────────────
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
        },
        video: false,
      });
    } catch (err) {
      console.error('[Mic] getUserMedia failed:', err.name, err.message);
      alert(
        err.name === 'NotAllowedError'
          ? 'Microphone permission denied. Please allow mic access and try again.'
          : 'Could not access microphone: ' + err.message
      );
      cleanupCall();
      throw err; // Abort — do not create offer/answer without a stream
    }

    localStreamRef.current = stream;

    if (localAudioRef.current) {
      localAudioRef.current.srcObject = stream;
    }

    // ── KEY FIX: addTransceiver with direction:'sendrecv' ───────────────────
    // This is what guarantees BOTH sides send and receive audio.
    // Using addTrack() alone can result in one side being sendonly.
    stream.getAudioTracks().forEach((track) => {
      const transceiver = pc.addTransceiver(track, {
        direction: 'sendrecv',
        streams: [stream],
      });
      console.log('[PC] Transceiver added. Direction:', transceiver.direction);
    });

    console.log('[WebRTC] Initialized for target:', targetUserId);
  }, [attachRemoteAudio, cleanupCall]);

  // ─── Socket event handlers ────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    // ── Incoming call offer ─────────────────────────────────────────────────
    const onOffer = (data) => {
      console.log('[Socket] offer received from:', data.callerId);
      dispatch(receiveIncomingCall(data));
    };

    // ── Answer received (caller side) ───────────────────────────────────────
    const onAnswer = async (data) => {
      const pc = pcRef.current;
      if (!pc) {
        console.warn('[Socket] answer received but no peerConnection exists.');
        return;
      }
      console.log('[Socket] answer received.');
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        remoteDescSetRef.current = true;
        console.log('[SDP] Remote description (answer) set.');
        await flushPendingCandidates();
        dispatch(acceptCall());
      } catch (e) {
        console.error('[SDP] setRemoteDescription (answer) failed:', e);
      }
    };

    // ── ICE candidate from remote ───────────────────────────────────────────
    const onIceCandidate = async (data) => {
      if (!data || !data.candidate) return;
      const candidate = new RTCIceCandidate(data.candidate);

      const pc = pcRef.current;
      if (!pc || !remoteDescSetRef.current) {
        console.log('[ICE] Buffering candidate — remote desc not set yet.');
        pendingCandidatesRef.current.push(candidate);
        return;
      }
      try {
        await pc.addIceCandidate(candidate);
        console.log('[ICE] Candidate added.');
      } catch (e) {
        console.error('[ICE] addIceCandidate failed:', e);
      }
    };

    // ── Remote ended the call ───────────────────────────────────────────────
    const onCallEnded = () => {
      console.log('[Socket] call-ended received.');
      cleanupCall();
    };

    // ── Remote rejected the call ────────────────────────────────────────────
    const onCallRejected = () => {
      console.log('[Socket] call-rejected received.');
      cleanupCall();
      alert('Call was rejected.');
    };

    socket.on('offer',        onOffer);
    socket.on('answer',       onAnswer);
    socket.on('ice-candidate', onIceCandidate);
    socket.on('call-ended',   onCallEnded);
    socket.on('call-rejected', onCallRejected);

    return () => {
      socket.off('offer',        onOffer);
      socket.off('answer',       onAnswer);
      socket.off('ice-candidate', onIceCandidate);
      socket.off('call-ended',   onCallEnded);
      socket.off('call-rejected', onCallRejected);
    };
  }, [dispatch, cleanupCall, flushPendingCandidates]);

  // ─── Listen for initiate-call custom events ───────────────────────────────
  useEffect(() => {
    const onInitiateCall = async (e) => {
      const { targetUser } = e.detail;
      try {
        await initWebRTC(targetUser._id);
        targetUserIdRef.current = targetUser._id;

        const pc     = pcRef.current;
        const offer  = await pc.createOffer();
        await pc.setLocalDescription(offer);

        console.log('[SDP] Offer set as local description.');
        console.log('[SDP] Offer SDP (check for a=sendrecv):\n', offer.sdp);

        socket.emit('offer', {
          targetUserId:  targetUser._id,
          callerId:      user._id,
          sdp:           offer,
          callerProfile: user,
        });
      } catch (err) {
        console.error('[Call] startCall failed:', err);
      }
    };

    window.addEventListener('initiate-call', onInitiateCall);
    return () => window.removeEventListener('initiate-call', onInitiateCall);
  }, [initWebRTC, user]);

  // ─── Cleanup on unmount ───────────────────────────────────────────────────
  useEffect(() => {
    return () => cleanupCall();
  }, [cleanupCall]);

  // ─── Accept incoming call ─────────────────────────────────────────────────
  const handleAcceptCall = useCallback(async () => {
    if (!incomingCall) return;

    const callerId = incomingCall.callerId;
    targetUserIdRef.current = callerId;

    try {
      await initWebRTC(callerId);

      const pc = pcRef.current;

      await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.sdp));
      remoteDescSetRef.current = true;
      console.log('[SDP] Remote description (offer) set.');
      console.log('[SDP] Offer SDP (check for a=sendrecv):\n', incomingCall.sdp.sdp);

      await flushPendingCandidates();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      console.log('[SDP] Answer set as local description.');
      console.log('[SDP] Answer SDP (check for a=sendrecv):\n', answer.sdp);

      socket.emit('answer', {
        targetUserId: callerId,
        sdp: answer,
      });

      dispatch(acceptCall());
    } catch (err) {
      console.error('[Call] handleAcceptCall failed:', err);
      cleanupCall();
    }
  }, [incomingCall, initWebRTC, flushPendingCandidates, cleanupCall, dispatch]);

  // ─── Reject incoming call ─────────────────────────────────────────────────
  const handleRejectCall = useCallback(() => {
    if (incomingCall) {
      socket.emit('call-reject', { targetUserId: incomingCall.callerId });
    }
    cleanupCall();
  }, [incomingCall, cleanupCall]);

  // ─── Hang up ──────────────────────────────────────────────────────────────
  const handleHangup = useCallback(() => {
    const targetUserId = targetUserIdRef.current ?? incomingCall?.callerId ?? null;
    if (targetUserId && socket) {
      socket.emit('end-call', { targetUserId });
    }
    cleanupCall();
  }, [incomingCall, cleanupCall]);

  // ─── Derived display values ───────────────────────────────────────────────
  const displayName = incomingCall?.callerProfile?.username ?? 'Calling...';

  // ─── Don't render when idle ───────────────────────────────────────────────
  if (!isCalling && !incomingCall && callStatus === 'idle') return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="card w-96 glass shadow-2xl bg-indigo-900/40 border border-white/20">
        <div className="card-body text-center flex flex-col items-center">

          {/* ── Avatar ── */}
          <div className={`avatar mb-6 relative ${callStatus === 'ringing' ? 'animate-pulse' : ''}`}>
            <div className="w-24 rounded-full ring ring-primary ring-offset-base-100 ring-offset-2 overflow-hidden shadow-[0_0_20px_rgba(99,102,241,0.6)]">
              <img
                src={`https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=random`}
                alt="caller avatar"
              />
            </div>
            {callStatus === 'ringing' && (
              <div className="absolute inset-0 rounded-full border-4 border-primary animate-ping opacity-50" />
            )}
          </div>

          {/* ── Status ── */}
          <h3 className="text-2xl font-bold text-white mb-2">
            {incomingCall && callStatus === 'ringing' && `Incoming Call from ${displayName}`}
            {isCalling    && callStatus === 'ringing' && 'Calling...'}
            {callStatus === 'connected'               && 'Call Connected'}
          </h3>
          <p className="text-white/60 text-sm mb-8">
            {callStatus === 'connected'
              ? 'Secure WebRTC Peer Connection'
              : 'Signaling via Socket.io'}
          </p>

          {/* ── Buttons ── */}
          <div className="flex gap-6 w-full justify-center mt-4">
            {callStatus === 'ringing' && incomingCall && (
              <>
                <button
                  onClick={handleAcceptCall}
                  className="btn btn-success btn-circle btn-lg text-white shadow-[0_0_15px_rgba(54,211,153,0.6)] hover:scale-110"
                >
                  Accept
                </button>
                <button
                  onClick={handleRejectCall}
                  className="btn btn-error btn-circle btn-lg text-white shadow-[0_0_15px_rgba(248,114,114,0.6)] hover:scale-110"
                >
                  Reject
                </button>
              </>
            )}
            <button
              onClick={handleHangup}
              className="btn btn-error btn-circle btn-lg text-white shadow-[0_0_15px_rgba(248,114,114,0.6)] hover:scale-110"
            >
              Hangup
            </button>
          </div>
        </div>

        {/* ── Audio elements — hidden but functional ── */}
        <audio ref={localAudioRef}  autoPlay muted      playsInline />
        <audio ref={remoteAudioRef} autoPlay playsInline />
      </div>
    </div>
  );
};

export default CallModal;