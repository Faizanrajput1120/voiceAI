import React, { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { receiveIncomingCall, acceptCall, endCall, resetCallState } from '../features/callSlice';
import { socket } from '../socket';

// Global WebRTC connection objects out of Redux/React Scope
let peerConnection;
let pendingIceCandidates = []; 
let isRemoteDescriptionSet = false;
let globalLocalStream = null;

const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    {
      urls: [
        'turn:187.77.9.39:3478?transport=udp',
        'turn:187.77.9.39:3478?transport=tcp' // Extremely important fallback for deep NATs
      ],
      username: 'myuser',
      credential: 'mypassword'
    }
  ],
};

const CallModal = () => {
  const dispatch = useDispatch();
  const { user } = useSelector((state) => state.auth);
  const { isCalling, incomingCall, callStatus } = useSelector((state) => state.call);

  const localAudioRef = useRef(null);
  const remoteAudioRef = useRef(null);

  useEffect(() => {
    const handleInitiateCall = async (e) => {
      const { targetUser } = e.detail;
      await startCall(targetUser._id, targetUser);
    };
    window.addEventListener('initiate-call', handleInitiateCall);

    if (socket) {
      socket.on('offer', async (data) => {
        dispatch(receiveIncomingCall(data));
      });

      socket.on('answer', async (data) => {
        if (!peerConnection) return;
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        isRemoteDescriptionSet = true;
        
        while (pendingIceCandidates.length > 0) {
          try {
            await peerConnection.addIceCandidate(pendingIceCandidates.shift());
          } catch (e) {
            console.error('Failed to add buffered candidate on answer:', e);
          }
        }
        dispatch(acceptCall());
      });

      socket.on('ice-candidate', async (data) => {
        const candidate = new RTCIceCandidate(data.candidate);
        // Explicitly eliminate race conditions
        if (!isRemoteDescriptionSet || !peerConnection) {
          pendingIceCandidates.push(candidate);
          return;
        }
        try {
          await peerConnection.addIceCandidate(candidate);
        } catch (e) {
          console.error('Error adding received ice candidate', e);
        }
      });

      socket.on('call-ended', () => {
        cleanupCall();
      });

      socket.on('call-rejected', () => {
        cleanupCall();
        alert("Call was rejected by the user.");
      });
    }

    return () => {
      window.removeEventListener('initiate-call', handleInitiateCall);
      if (socket) {
        socket.off('offer');
        socket.off('answer');
        socket.off('ice-candidate');
        socket.off('call-ended');
        socket.off('call-rejected');
      }
    };
  }, [dispatch]);

  const initWebRTC = async (targetUserId) => {
    isRemoteDescriptionSet = false;
    pendingIceCandidates = [];
    peerConnection = new RTCPeerConnection(configuration);

    peerConnection.oniceconnectionstatechange = () => {
      console.log('ICE Connection State:', peerConnection.iceConnectionState);
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('ice-candidate', { targetUserId, candidate: event.candidate });
      }
    };

    peerConnection.ontrack = (event) => {
      if (remoteAudioRef.current) {
        // Fallback for browsers that don't package event.streams correctly
        const stream = event.streams && event.streams[0] ? event.streams[0] : new MediaStream([event.track]);
        remoteAudioRef.current.srcObject = stream;
        
        // Force explicitly play to bypass strict browser Autoplay policies (crucial for one-way audio fixes in Safari/iOS)
        remoteAudioRef.current.play().catch(e => console.error("Audio autoplay was prevented:", e));
      }
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      globalLocalStream = stream;
      if (localAudioRef.current) {
         localAudioRef.current.srcObject = stream;
      }
      stream.getTracks().forEach((track) => {
        peerConnection.addTrack(track, stream);
      });
    } catch (err) {
      console.error('Failed to get local audio stream. Check microphone permissions.', err);
    }
  };

  const startCall = async (targetUserId, targetProfile) => {
    await initWebRTC(targetUserId);

    // Hardcode audio receive requests to ensure streams are negotiated both ways!
    const offer = await peerConnection.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
    await peerConnection.setLocalDescription(offer);

    window.currentTargetUserId = targetUserId;

    socket.emit('offer', {
      targetUserId,
      callerId: user._id,
      sdp: offer,
      callerProfile: user
    });
  };

  const handleAcceptCall = async () => {
    const callerId = incomingCall.callerId;
    await initWebRTC(callerId);

    window.currentTargetUserId = callerId;

    await peerConnection.setRemoteDescription(new RTCSessionDescription(incomingCall.sdp));
    isRemoteDescriptionSet = true;

    while (pendingIceCandidates.length > 0) {
      try {
        await peerConnection.addIceCandidate(pendingIceCandidates.shift());
      } catch (e) {
        console.error('Failed to add buffered candidate on accept:', e);
      }
    }

    const answer = await peerConnection.createAnswer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
    await peerConnection.setLocalDescription(answer);

    socket.emit('answer', {
      targetUserId: callerId,
      sdp: answer
    });

    dispatch(acceptCall());
  };

  const handleRejectCall = () => {
    if (incomingCall) {
        socket.emit('reject', { targetUserId: incomingCall.callerId });
    }
    cleanupCall();
  };

  const handleHangup = () => {
    const targetUserId = window.currentTargetUserId || (incomingCall ? incomingCall.callerId : null);
    if (targetUserId && socket) {
      socket.emit('end-call', { targetUserId });
    }
    cleanupCall();
  };

  const cleanupCall = () => {
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
    pendingIceCandidates = [];
    isRemoteDescriptionSet = false;
    
    if (globalLocalStream) {
      globalLocalStream.getTracks().forEach(track => track.stop());
      globalLocalStream = null;
    }
    window.currentTargetUserId = null;
    dispatch(endCall());
    dispatch(resetCallState());
  };

  if (!isCalling && !incomingCall && callStatus === 'idle') return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 transition-opacity">
      <div className="card w-96 glass shadow-2xl bg-indigo-900/40 border border-white/20 transform hover:scale-105 transition-all duration-300">
        <div className="card-body text-center flex flex-col items-center">
          
          {/* Avatar Animation */}
          <div className={`avatar mb-6 relative ${callStatus === 'ringing' ? 'animate-pulse' : ''}`}>
            <div className="w-24 rounded-full ring ring-primary ring-offset-base-100 ring-offset-2 overflow-hidden shadow-[0_0_20px_rgba(99,102,241,0.6)]">
               <img src={`https://ui-avatars.com/api/?name=${incomingCall ? incomingCall.callerProfile.username : 'Dialing'}&background=random`} alt="avatar" />
            </div>
            {/* Pulsing ring effect for ringing state */}
            {callStatus === 'ringing' && (
              <div className="absolute inset-0 rounded-full border-4 border-primary animate-ping opacity-50"></div>
            )}
          </div>

          <h3 className="text-2xl font-bold text-white mb-2">
            {incomingCall && callStatus === 'ringing' && `Incoming Call from ${incomingCall.callerProfile.username}`}
            {isCalling && callStatus === 'ringing' && `Calling...`}
            {callStatus === 'connected' && `Call Connected`}
          </h3>
          <p className="text-white/60 text-sm mb-8">
            {callStatus === 'connected' ? 'Secure WebRTC Peer Connection' : 'Signaling via Socket.io'}
          </p>

          <div className="flex gap-6 w-full justify-center mt-4">
            {callStatus === 'ringing' && incomingCall && (
              <button 
                onClick={handleAcceptCall}
                className="btn btn-success btn-circle btn-lg text-white shadow-[0_0_15px_rgba(54,211,153,0.6)] hover:scale-110"
              >
                Accept
              </button>
            )}
            {callStatus === 'ringing' && incomingCall && (
               <button 
                  onClick={handleRejectCall}
                  className="btn btn-error btn-circle btn-lg text-white shadow-[0_0_15px_rgba(248,114,114,0.6)] hover:scale-110"
               >
                  Reject
               </button>
            )}
            <button 
              onClick={handleHangup}
              className="btn btn-error btn-circle btn-lg text-white shadow-[0_0_15px_rgba(248,114,114,0.6)] hover:scale-110"
            >
              Hangup
            </button>
          </div>
        </div>

        {/* Hidden Audio Elements */}
        <audio ref={localAudioRef} autoPlay muted />
        <audio ref={remoteAudioRef} autoPlay />
      </div>
    </div>
  );
};

export default CallModal;
