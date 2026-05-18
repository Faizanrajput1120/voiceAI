import { configureStore } from '@reduxjs/toolkit';
import { api } from './api';
import authReducer from '../features/authSlice';
import callReducer from '../features/callSlice';

export const store = configureStore({
  reducer: {
    [api.reducerPath]: api.reducer,
    auth: authReducer,
    call: callReducer, // We'll build this next
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Ignore warnings about streams in store
        ignoredActions: ['call/setRemoteStream', 'call/setLocalStream'],
        ignoredPaths: ['call.remoteStream', 'call.localStream']
      }
    }).concat(api.middleware),
});
