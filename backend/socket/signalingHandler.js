const User = require('../models/User');

// Maintain a registry of connected users mapping userId to socketId
const usersMap = new Map();

const setupSignaling = (io) => {
  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // 1. REGISTER: Map user ID to Socket ID when frontend emits 'register'
    socket.on('register', async (userId) => {
      usersMap.set(userId, socket.id);
      socket.userId = userId;
      console.log(`User ${userId} registered with socket ${socket.id}`);

      // Optional: Set user status online in DB
      try {
        await User.findByIdAndUpdate(userId, { status: 'online' });
        // Broadcast to everyone that the user list updated
        io.emit('user-status-changed', { userId, status: 'online' });
      } catch (err) {
        console.error('Error updating user status', err);
      }
    });

    // 2. INVITE/OFFER: Caller sends an offer to Callee
    socket.on('offer', (data) => {
      const { targetUserId, callerId, sdp, callerProfile } = data;
      const targetSocketId = usersMap.get(targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('offer', {
          callerId,
          sdp,
          callerProfile
        });
      }
    });

    // 3. COMPLETE REJECT: Callee rejects the call
    socket.on('reject', (data) => {
        const { targetUserId } = data; // the caller
        const targetSocketId = usersMap.get(targetUserId);
        if (targetSocketId) {
            io.to(targetSocketId).emit('call-rejected');
        }
    });

    // 4. ACCEPT/ANSWER: Callee accepts and sends an answer back to Caller
    socket.on('answer', (data) => {
      const { targetUserId, sdp } = data; // targetUserId here is the original Caller
      const targetSocketId = usersMap.get(targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('answer', {
          sdp
        });
      }
    });

    // 5. ICE-CANDIDATES: Exchange network routing information peer-to-peer
    socket.on('ice-candidate', (data) => {
      const { targetUserId, candidate } = data;
      const targetSocketId = usersMap.get(targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('ice-candidate', {
          candidate
        });
      }
    });

    // 6. END-CALL / BYE: Either party hangs up
    socket.on('end-call', (data) => {
      const { targetUserId } = data;
      const targetSocketId = usersMap.get(targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call-ended');
      }
    });

    // 7. DISCONNECT
    socket.on('disconnect', async () => {
      console.log(`Socket disconnected: ${socket.id}`);
      if (socket.userId) {
        usersMap.delete(socket.userId);
        try {
          await User.findByIdAndUpdate(socket.userId, { status: 'offline' });
          io.emit('user-status-changed', { userId: socket.userId, status: 'offline' });
        } catch (err) {
          console.error('Error setting offline status', err);
        }
      }
    });
  });
};

module.exports = setupSignaling;
