import React, { useState } from 'react';
import { useLoginMutation } from '../store/api';
import { Link, useNavigate } from 'react-router-dom';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [login, { isLoading, error }] = useLoginMutation();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await login({ email, password }).unwrap();
      navigate('/');
    } catch (err) {
      console.error('Failed to log in', err);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-gradient-to-br from-indigo-900 via-purple-900 to-black">
      <div className="card w-96 glass shadow-2xl backdrop-blur-xl bg-opacity-30 border border-white/10">
        <div className="card-body text-center">
          <h2 className="text-3xl font-bold mb-6 text-white tracking-widest uppercase">MERN Voice</h2>
          {error && <p className="text-error mb-4">{error.data?.message || 'Login failed'}</p>}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
              Start Calling
            </button>
          </form>
          <div className="mt-4 text-sm text-white/70">
            Don't have an account? <Link to="/register" className="text-indigo-300 font-bold hover:text-indigo-200">Register</Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
