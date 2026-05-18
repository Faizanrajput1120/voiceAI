import { createSlice } from '@reduxjs/toolkit';
import { api } from '../store/api';

const initialState = {
  user: JSON.parse(localStorage.getItem('user')) || null,
  token: localStorage.getItem('token') || null,
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    logout: (state) => {
      state.user = null;
      state.token = null;
      localStorage.removeItem('user');
      localStorage.removeItem('token');
    },
  },
  extraReducers: (builder) => {
    builder.addMatcher(
      api.endpoints.login.matchFulfilled,
      (state, { payload }) => {
        state.user = payload;
        state.token = payload.token;
        localStorage.setItem('user', JSON.stringify(payload));
        localStorage.setItem('token', payload.token);
      }
    );
    builder.addMatcher(
      api.endpoints.register.matchFulfilled,
      (state, { payload }) => {
        state.user = payload;
        state.token = payload.token;
        localStorage.setItem('user', JSON.stringify(payload));
        localStorage.setItem('token', payload.token);
      }
    );
  },
});

export const { logout } = authSlice.actions;
export default authSlice.reducer;
