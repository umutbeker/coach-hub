'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { USERS } from '../lib/users';

export default function LoginPage() {
  const router = useRouter();
  const [loginRole, setLoginRole] = useState<'player' | 'coach' | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const user = USERS.find(u => u.username === username && u.password === password && u.role === loginRole);
    if (user) {
      localStorage.setItem('currentUser', JSON.stringify(user));
      if (user.role === 'coach') {
        router.push('/coach');
      } else {
        router.push('/player');
      }
    } else {
      setError('Wrong credentials, try again!');
    }
  };

  const resetForm = () => {
    setLoginRole(null);
    setUsername('');
    setPassword('');
    setError('');
  };

  return (
    <div className="min-h-screen bg-[#090510] flex flex-col items-center justify-center p-4 font-sans relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#7B32A8]/15 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="w-full max-w-md bg-[#120A20]/80 backdrop-blur-md border border-[#2A164A] rounded-2xl p-8 shadow-2xl relative z-10">

        <div className="flex flex-col items-center text-center mb-8">
          <img
            src="/logo.png"
            alt="Ozarox Esports Logo"
            className="w-32 h-auto mb-6 drop-shadow-[0_0_20px_rgba(232,72,138,0.4)]"
          />
          <h1 className="text-4xl font-black tracking-wider mb-2 uppercase flex flex-col gap-1">
            <span className="text-[#F0B92D] text-sm tracking-[0.3em] font-bold">BETA VERSION</span>
            <span className="text-white">Ozarox<span className="text-[#E8488A]">HUB</span></span>
          </h1>
        </div>

        {!loginRole && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <button
              onClick={() => setLoginRole('player')}
              className="w-full bg-[#1A0E2E] hover:bg-[#23133D] text-[#D4C5ED] font-semibold py-3.5 px-4 rounded-xl transition-all duration-200 border border-[#351D5C] hover:border-[#E8488A]/50 flex items-center justify-center gap-2"
            >
              Player Login
            </button>
            <button
              onClick={() => setLoginRole('coach')}
              className="w-full bg-gradient-to-r from-[#C22E7A] to-[#E8488A] hover:from-[#D6358A] hover:to-[#F4579B] text-white font-bold py-3.5 px-4 rounded-xl transition-all duration-200 shadow-[0_0_20px_rgba(232,72,138,0.25)] hover:shadow-[0_0_30px_rgba(232,72,138,0.45)] flex items-center justify-center gap-2"
            >
              Coach Login
            </button>
          </div>
        )}

        {loginRole && (
          <form onSubmit={handleLogin} className="space-y-4 animate-in fade-in zoom-in-95 duration-300">
            <div className="text-center mb-6">
              <span className={`text-sm font-bold tracking-widest uppercase px-3 py-1 rounded-full ${loginRole === 'coach' ? 'bg-[#E8488A]/20 text-[#E8488A] border border-[#E8488A]/30' : 'bg-[#7B32A8]/20 text-[#D4C5ED] border border-[#7B32A8]/30'}`}>
                {loginRole === 'coach' ? 'Coach Authorization' : 'Player Authorization'}
              </span>
            </div>

            {error && (
              <p className="text-[#E8488A] text-sm text-center font-semibold bg-[#E8488A]/10 py-2 rounded-lg border border-[#E8488A]/20">
                {error}
              </p>
            )}

            <input
              type="text"
              placeholder="Kullanıcı Adı"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-[#090510] text-[#D4C5ED] border border-[#2A164A] rounded-xl px-4 py-3.5 focus:outline-none focus:border-[#E8488A] transition-colors"
              autoFocus
            />

            <input
              type="password"
              placeholder="Şifre"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[#090510] text-[#D4C5ED] border border-[#2A164A] rounded-xl px-4 py-3.5 focus:outline-none focus:border-[#E8488A] transition-colors"
            />

            <button
              type="submit"
              className={`w-full font-bold py-3.5 px-4 mt-2 rounded-xl transition-all duration-200 ${loginRole === 'coach' ? 'bg-gradient-to-r from-[#C22E7A] to-[#E8488A] text-white shadow-[0_0_20px_rgba(232,72,138,0.25)] hover:shadow-[0_0_30px_rgba(232,72,138,0.45)]' : 'bg-[#1A0E2E] hover:bg-[#23133D] text-[#D4C5ED] border border-[#351D5C] hover:border-[#E8488A]/50'}`}
            >
              Login
            </button>

            <button
              type="button"
              onClick={resetForm}
              className="w-full text-[#6A5A8A] hover:text-[#D4C5ED] text-sm font-medium py-2 transition-colors"
            >
              ← Go back
            </button>
          </form>
        )}
      </div>
    </div>
  );
}