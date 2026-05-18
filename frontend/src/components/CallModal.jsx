import React, { useEffect, useRef, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  receiveIncomingCall,
  acceptCall,
  endCall,
  resetCallState,
} from "../features/callSlice";
import { socket } from "../socket";

// ================= TURN + STUN (PRODUCTION STYLE) =================
const RTC_CONFIG = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302"] },
    {
      urls: [
        "turn:187.77.9.39:3478?transport=udp",
        "turn:187.77.9.39:3478?transport=tcp",
      ],
      username: "myuser",
      credential: "mypassword",
    },
  ],
  iceCandidatePoolSize: 10,
};

export default function CallModal() {
  const dispatch = useDispatch();
  const { user } = useSelector((s) => s.auth);
  const { incomingCall, isCalling, callStatus } = useSelector((s) => s.call);

  // ================= CORE REFS =================
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);

  const pendingIce = useRef([]);
  const remoteDescSet = useRef(false);
  const targetId = useRef(null);

  const localAudioRef = useRef(null);
  const remoteAudioRef = useRef(null);

  // ================= CLEANUP =================
  const cleanup = useCallback(() => {
    console.log("[CALL] cleanup");

    if (pcRef.current) {
      pcRef.current.ontrack = null;
      pcRef.current.onicecandidate = null;
      pcRef.current.close();
      pcRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }

    pendingIce.current = [];
    remoteDescSet.current = false;
    targetId.current = null;

    dispatch(endCall());
    dispatch(resetCallState());
  }, [dispatch]);

  // ================= ADD ICE =================
  const addIce = async (candidate) => {
    try {
      await pcRef.current.addIceCandidate(candidate);
    } catch (e) {
      console.warn("[ICE FAIL]", e);
    }
  };

  const flushIce = async () => {
    while (pendingIce.current.length) {
      await addIce(pendingIce.current.shift());
    }
  };

  // ================= AUDIO FIX =================
  const handleTrack = (event) => {
    const stream = event.streams?.[0] || new MediaStream([event.track]);

    remoteAudioRef.current.srcObject = stream;
    remoteAudioRef.current.autoplay = true;
    remoteAudioRef.current.playsInline = true;
    remoteAudioRef.current.muted = false;
    remoteAudioRef.current.volume = 1;

    const play = () => {
      remoteAudioRef.current.play().catch(() => {});
    };

    play();
    document.addEventListener("click", play, { once: true });
  };

  // ================= INIT PEER =================
  const createPeer = useCallback(async (id) => {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;

    remoteDescSet.current = false;
    pendingIce.current = [];

    // ICE state
    pc.oniceconnectionstatechange = () => {
      console.log("[ICE]", pc.iceConnectionState);

      if (pc.iceConnectionState === "failed") {
        console.warn("[CALL FAILED]");
        cleanup();
      }
    };

    // remote track
    pc.ontrack = handleTrack;

    // send ICE
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit("ice-candidate", {
          targetUserId: id,
          candidate: e.candidate,
        });
      }
    };

    // ================= MIC =================
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    localStreamRef.current = stream;
    localAudioRef.current.srcObject = stream;

    // IMPORTANT: stable audio pipeline
    stream.getAudioTracks().forEach((track) => {
      track.enabled = true;
      pc.addTrack(track, stream);
    });

    console.log("[WEBRTC] peer ready");
  }, [cleanup]);

  // ================= SOCKET EVENTS =================
  useEffect(() => {
    if (!socket) return;

    socket.on("offer", (data) => {
      dispatch(receiveIncomingCall(data));
    });

    socket.on("answer", async (data) => {
      const pc = pcRef.current;
      if (!pc) return;

      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      remoteDescSet.current = true;

      await flushIce();
    });

    socket.on("ice-candidate", async (data) => {
      const candidate = new RTCIceCandidate(data.candidate);

      if (!pcRef.current || !pcRef.current.remoteDescription) {
        pendingIce.current.push(candidate);
        return;
      }

      await addIce(candidate);
    });

    socket.on("call-ended", cleanup);
    socket.on("call-reject", cleanup);

    return () => {
      socket.off("offer");
      socket.off("answer");
      socket.off("ice-candidate");
      socket.off("call-ended");
      socket.off("call-reject");
    };
  }, [dispatch, cleanup]);

  // ================= START CALL =================
  useEffect(() => {
    const handler = async (e) => {
      const id = e.detail.targetUser._id;

      await createPeer(id);
      targetId.current = id;

      const pc = pcRef.current;

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit("offer", {
        targetUserId: id,
        callerId: user._id,
        sdp: offer,
      });
    };

    window.addEventListener("initiate-call", handler);
    return () => window.removeEventListener("initiate-call", handler);
  }, [createPeer, user]);

  // ================= ACCEPT CALL =================
  const acceptCallHandler = async () => {
    const callerId = incomingCall.callerId;

    await createPeer(callerId);

    const pc = pcRef.current;

    await pc.setRemoteDescription(
      new RTCSessionDescription(incomingCall.sdp)
    );

    remoteDescSet.current = true;
    await flushIce();

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit("answer", {
      targetUserId: callerId,
      sdp: answer,
    });

    dispatch(acceptCall());
  };

  // ================= REJECT =================
  const rejectCallHandler = () => {
    socket.emit("call-reject", {
      targetUserId: incomingCall.callerId,
    });
    cleanup();
  };

  // ================= HANGUP =================
  const hangup = () => {
    socket.emit("end-call", {
      targetUserId: targetId.current || incomingCall?.callerId,
    });
    cleanup();
  };

  // ================= UI =================
  if (!isCalling && !incomingCall) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center">
      <div className="bg-white p-6 rounded-xl w-96 text-center">

        <h2 className="text-xl font-bold mb-4">
          {incomingCall ? "Incoming Call" : "Calling..."}
        </h2>

        {incomingCall && (
          <div className="flex gap-3 justify-center mb-4">
            <button onClick={acceptCallHandler}>Accept</button>
            <button onClick={rejectCallHandler}>Reject</button>
          </div>
        )}

        <button onClick={hangup}>Hangup</button>

        {/* AUDIO ELEMENTS */}
        <audio ref={localAudioRef} muted autoPlay />
        <audio ref={remoteAudioRef} autoPlay />
      </div>
    </div>
  );
}