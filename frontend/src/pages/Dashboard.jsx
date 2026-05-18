import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useGetUsersQuery } from '../store/api';
import { logout } from '../features/authSlice';
import { startCalling } from '../features/callSlice';
import { io } from 'socket.io-client';

// Global socket variable so we can access it elsewhere (or pass it via context/redux)
export let socket;

const Dashboard = () => {
  const { user, token } = useSelector((state) => state.auth);
  const { data: users, refetch } = useGetUsersQuery();
  const dispatch = useDispatch();

  useEffect(() => {
    socket = io('http://localhost:6050');

    socket.on('connect', () => {
      console.log('Connected to socket server');
      // Register this user with the socket server
      socket.emit('register', user._id);
    });

    socket.on('user-status-changed', () => {
      refetch(); // Refetch users to see who is online
    });

    return () => {
      socket.disconnect();
    };
  }, [user, refetch]);

  const handleLogout = () => {
    dispatch(logout());
  };

  const initiateCall = (targetUser) => {
    dispatch(startCalling());
    // Trigger an event to CallModal or dispatch WebRTC logic here
    // In our architecture, the CallModal component will listen to redux and socket events
    const event = new CustomEvent('initiate-call', { detail: { targetUser } });
    window.dispatchEvent(event);
  };

  return (
    <div className="min-h-screen bg-base-300">
      <div className="navbar bg-base-100 shadow-xl px-8">
        <div className="flex-1">
          <a className="text-xl font-bold italic tracking-wide text-indigo-400">MERN Voice</a>
        </div>
        <div className="flex-none gap-4 items-center">
          <span className="text-sm font-semibold opacity-70">Welcome, {user.username}</span>
          <button onClick={handleLogout} className="btn btn-sm btn-error btn-outline">Logout</button>
        </div>
      </div>

      <div className="container mx-auto p-8 mt-8">
        <div className="card glass shadow-2xl bg-base-100 mb-8 border border-white/5">
          <div className="card-body">
            <h2 className="card-title text-2xl font-bold mb-4">Contacts</h2>
            <div className="overflow-x-auto">
              <table className="table w-full">
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {users?.map((u) => (
                    <tr key={u._id} className="hover:bg-white/5 transition-colors">
                      <td className="font-bold">{u.username}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className={`w-3 h-3 rounded-full ${u.status === 'online' ? 'bg-success shadow-[0_0_8px_rgba(54,211,153,0.8)]' : 'bg-neutral'}`}></span>
                          <span className="capitalize text-sm opacity-70">{u.status}</span>
                        </div>
                      </td>
                      <td>
                        <button 
                          onClick={() => initiateCall(u)}
                          className={`btn btn-sm btn-primary shadow-lg ${u.status !== 'online' ? 'btn-disabled opacity-50' : 'hover:scale-105 transition-transform'}`}
                          disabled={u.status !== 'online'}
                        >
                          Voice Call
                        </button>
                      </td>
                    </tr>
                  ))}
                  {(!users || users.length === 0) && (
                    <tr>
                      <td colSpan="3" className="text-center py-4 opacity-50">No other users found. Register another account in a new incognito window to test.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
