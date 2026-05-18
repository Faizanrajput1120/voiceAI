import { io } from 'socket.io-client';

// Initialize the socket globally so it is immediately available to all components.
// We configure it to not automatically connect until the user is authenticated in the Dashboard.
export const socket = io('https://api.talkify.app', {
  autoConnect: false
});
