import React, { useEffect, useRef, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  receiveIncomingCall,
  acceptCall,
  endCall,
  resetCallState,
} from "../features/callSlice";
import { socket } from "../socket";

// ================= TURN/STUN CONFIG =================
const RTC_CONFIG = {
  iceServers: [
    {
      urls: [
        "stun:187.77.9.39:3478",
        "turn:187.77.9.39:3478"
      ],
      username: "myuser",
      credential: "mypassword",
    },
  ],
};

const CallModal = () => {
  const dispatch = useDispatch();
  const { user } = useSelector((state) => state.auth);
  const { isCalling, incomingCall, callStatus } = useSelector(
    (state) => state.call
  );

  // ================= Refs =================
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);

  const pendingCandidatesRef = useRef([]);
  const remoteDescSetRef = useRef(false);
  const targetUserIdRef = useRef(null);

  const localAudioRef = useRef(null);
  const remoteAudioRef = useRef(null);

  // ================= ICE helper =================
  const addIceCandidateSafe = async (candidate) => {
    try {
      await pcRef.current.addIceCandidate(candidate);
      console.log("[ICE] candidate added");
    } catch (e) {
      console.warn("[ICE] failed:", e);
    }
  };

  const flushCandidates = async () => {
    const pc = pcRef.current;
    if (!pc) return;

    console.log("[ICE] flushing:", pendingCandidatesRef.current.length);

    while (pendingCandidatesRef.current.length) {
      const c = pendingCandidatesRef.current.shift();
      await addIceCandidateSafe(c);
    }
  };

  // ================= Cleanup =================
  const cleanupCall = useCallback(() => {
    console.log("[Call] cleanup");

    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }

    pendingCandidatesRef.current = [];
    remoteDescSetRef.current = false;
    targetUserIdRef.current = null;

    if (localAudioRef.current) localAudioRef.current.srcObject = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;

    dispatch(endCall());
    dispatch(resetCallState());
  }, [dispatch]);

  // ================= Remote Audio =================
  const onTrack = (event) => {
    console.log("[ontrack]", event.track.kind);

    const stream = event.streams?.[0] || new MediaStream([event.track]);

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = stream;
      remoteAudioRef.current.play().catch(() => {});
    }

    remoteStreamRef.current = stream;
  };

  // ================= INIT WEBRTC =================
  const initWebRTC = useCallback(async (targetUserId) => {
    remoteDescSetRef.current = false;
    pendingCandidatesRef.current = [];

    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;

    // ===== ICE debug =====
    pc.oniceconnectionstatechange = () => {
      console.log("[ICE]", pc.iceConnectionState);

      if (
        pc.iceConnectionState === "connected" ||
        pc.iceConnectionState === "completed"
      ) {
        console.log("[ICE] CONNECTED ✅");
      }

      if (pc.iceConnectionState === "failed") {
        console.warn("[ICE] FAILED ❌");
        cleanupCall();
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("[PC]", pc.connectionState);
    };

    // ===== ICE outgoing =====
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("ice-candidate", {
          targetUserId,
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = onTrack;

    // ===== mic =====
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });

    localStreamRef.current = stream;
    if (localAudioRef.current) {
      localAudioRef.current.srcObject = stream;
    }

    // IMPORTANT FIX: use addTrack (NOT transceiver)
    stream.getAudioTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });

    console.log("[WebRTC] ready");
  }, [cleanupCall]);

  // ================= SOCKET EVENTS =================
  useEffect(() => {
    if (!socket) return;

    socket.on("offer", (data) => {
      dispatch(receiveIncomingCall(data));
    });

    socket.on("answer", async (data) => {
      const pc = pcRef.current;
      if (!pc) return;

      await pc.setRemoteDescription(
        new RTCSessionDescription(data.sdp)
      );

      remoteDescSetRef.current = true;
      await flushCandidates();
    });

    socket.on("ice-candidate", async (data) => {
      const pc = pcRef.current;
      const candidate = new RTCIceCandidate(data.candidate);

      if (!pc || !pc.remoteDescription) {
        pendingCandidatesRef.current.push(candidate);
        return;
      }

      await addIceCandidateSafe(candidate);
    });

    socket.on("call-ended", cleanupCall);
    socket.on("call-reject", cleanupCall);

    return () => {
      socket.off("offer");
      socket.off("answer");
      socket.off("ice-candidate");
      socket.off("call-ended");
      socket.off("call-reject");
    };
  }, [dispatch, cleanupCall]);

  // ================= INITIATE CALL =================
  useEffect(() => {
    const handler = async (e) => {
      const targetUser = e.detail.targetUser;

      await initWebRTC(targetUser._id);
      targetUserIdRef.current = targetUser._id;

      const pc = pcRef.current;

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit("offer", {
        targetUserId: targetUser._id,
        callerId: user._id,
        sdp: offer,
      });
    };

    window.addEventListener("initiate-call", handler);
    return () => window.removeEventListener("initiate-call", handler);
  }, [initWebRTC, user]);

  // ================= ACCEPT CALL =================
  const handleAccept = async () => {
    const callerId = incomingCall.callerId;

    await initWebRTC(callerId);

    const pc = pcRef.current;

    await pc.setRemoteDescription(
      new RTCSessionDescription(incomingCall.sdp)
    );

    remoteDescSetRef.current = true;

    await flushCandidates();

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit("answer", {
      targetUserId: callerId,
      sdp: answer,
    });

    dispatch(acceptCall());
  };

  // ================= REJECT =================
  const handleReject = () => {
    socket.emit("call-reject", {
      targetUserId: incomingCall.callerId,
    });

    cleanupCall();
  };

  // ================= HANGUP =================
  const handleHangup = () => {
    const targetUserId =
      targetUserIdRef.current || incomingCall?.callerId;

    socket.emit("end-call", { targetUserId });

    cleanupCall();
  };

  // ================= UI =================
  if (!isCalling && !incomingCall) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center">
      <div className="bg-white p-6 rounded-xl w-96 text-center">

        <h2 className="text-xl font-bold mb-4">
          {incomingCall ? "Incoming Call" : "Calling..."}
        </h2>

        <div className="flex justify-center gap-4">
          {incomingCall && (
            <>
              <button onClick={handleAccept}>Accept</button>
              <button onClick={handleReject}>Reject</button>
            </>
          )}
          <button onClick={handleHangup}>Hangup</button>
        </div>

        <audio ref={localAudioRef} muted autoPlay />
        <audio ref={remoteAudioRef} autoPlay />
      </div>
    </div>
  );
};

export default CallModal;