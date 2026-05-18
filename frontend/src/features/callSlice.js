import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  isCalling: false,
  incomingCall: null, // { callerId, callerProfile, sdp }
  remoteStream: null,
  localStream: null,
  callStatus: 'idle', // 'idle' | 'ringing' | 'connected' | 'ended'
};

const callSlice = createSlice({
  name: 'call',
  initialState,
  reducers: {
    startCalling: (state) => {
      state.isCalling = true;
      state.callStatus = 'ringing';
    },
    receiveIncomingCall: (state, action) => {
      state.incomingCall = action.payload;
      state.callStatus = 'ringing';
    },
    acceptCall: (state) => {
      state.callStatus = 'connected';
    },
    endCall: (state) => {
      state.isCalling = false;
      state.incomingCall = null;
      state.remoteStream = null;
      state.localStream = null;
      state.callStatus = 'ended';
    },
    resetCallState: (state) => {
      state.isCalling = false;
      state.incomingCall = null;
      state.remoteStream = null;
      state.localStream = null;
      state.callStatus = 'idle';
    },
    setLocalStream: (state, action) => {
      state.localStream = action.payload;
    },
    setRemoteStream: (state, action) => {
      state.remoteStream = action.payload;
    },
  },
});

export const {
  startCalling,
  receiveIncomingCall,
  acceptCall,
  endCall,
  resetCallState,
  setLocalStream,
  setRemoteStream,
} = callSlice.actions;

export default callSlice.reducer;
