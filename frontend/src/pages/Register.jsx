import React, { useState } from 'react';
import { useRegisterMutation } from '../store/api';
import { Link, useNavigate } from 'react-router-dom';

const Register = () => {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [registerUser, { isLoading, error }] = useRegisterMutation();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await registerUser({ username, email, password }).unwrap();
      navigate('/');
    } catch (err) {
      console.error('Failed to register', err);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-gradient-to-br from-indigo-900 via-purple-900 to-black">
      <div className="card w-96 glass shadow-2xl backdrop-blur-xl bg-opacity-30 border border-white/10 mt-[-5vh]">
        <div className="card-body text-center">
          <h2 className="text-3xl font-bold mb-6 text-white tracking-widest uppercase">Register</h2>
          {error && <p className="text-error mb-4">{error.data?.message || 'Registration failed'}</p>}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <input 
              type="text" 
              placeholder="Username" 
              className="input input-bordered w-full bg-white/5 text-white placeholder-white/50 border-white/20 focus:border-indigo-400 transition-colors"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            <input 
              type="email" 
              placeholder="Email address" 
              className="input input-bordered w-full bg-white/5 text-white placeholder-white/50 border-white/20 focus:border-indigo-400 transition-colors"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input 
              type="password" 
              placeholder="Password" 
              className="input input-bordered w-full bg-white/5 text-white placeholder-white/50 border-white/20 focus:border-indigo-400 transition-colors"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button 
              type="submit" 
              className={`btn btn-primary mt-4 ${isLoading ? 'loading' : ''} bg-indigo-600 hover:bg-indigo-500 border-none transition-transform active:scale-95`}
              disabled={isLoading}
            >
              Create Account
            </button>
          </form>
          <div className="mt-4 text-sm text-white/70">
            Already have an account? <Link to="/login" className="text-indigo-300 font-bold hover:text-indigo-200">Login</Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Register;
