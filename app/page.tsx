'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { USERS } from '../lib/users';
import { TEAM_NAME } from '../lib/team';
import Icon from './components/Icon';

type Role = 'player' | 'coach';

export default function LoginPage() {
  const router = useRouter();
  const [role, setRole] = useState<Role>('player');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const user = USERS.find(
      u => u.username === username.trim() && u.password === password && u.role === role,
    );
    if (!user) {
      setError('Those credentials do not match a ' + role + ' account.');
      return;
    }
    localStorage.setItem('currentUser', JSON.stringify(user));
    router.push(user.role === 'coach' ? '/coach' : '/player');
  };

  const switchRole = (next: Role) => {
    setRole(next);
    setError('');
  };

  return (
    <div className="hub" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '28px 40px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="ic" style={{ width: 26, height: 26, color: 'var(--accent)' }}>
          <Icon name="mark" size={26} />
        </span>
        <span className="h" style={{ fontSize: 17, letterSpacing: '0.06em' }}>{TEAM_NAME.toUpperCase()}</span>
        <span className="t3" style={{ fontSize: 12, letterSpacing: '0.14em', fontWeight: 500 }}>HUB</span>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 20px 64px' }}>
        <div className="card" style={{ width: '100%', maxWidth: 440, padding: 36, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="h" style={{ fontSize: 32 }}>Sign in</div>
            <div className="t2">
              Team hub for {TEAM_NAME} Esports. Pick your role, then use the credentials your coach gave you.
            </div>
          </div>

          <div className="seg">
            <button type="button" className={role === 'player' ? 'on' : ''} onClick={() => switchRole('player')}>Player</button>
            <button type="button" className={role === 'coach' ? 'on' : ''} onClick={() => switchRole('coach')}>Coach</button>
          </div>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="field">
              <label className="label" htmlFor="username">Username</label>
              <input
                id="username"
                className="input"
                autoComplete="username"
                value={username}
                onChange={e => { setUsername(e.target.value); setError(''); }}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="input"
                autoComplete="current-password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
              />
            </div>

            {error ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--loss)', fontSize: 13 }}>
                <Icon name="warning" size={16} />
                {error}
              </div>
            ) : null}

            <button type="submit" className="btn primary" style={{ width: '100%' }}>
              Sign in as {role}
            </button>
          </form>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-3)', fontSize: 13 }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span>or</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          <button
            type="button"
            onClick={() => router.push('/pro')}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
              borderRadius: 'var(--r-ctl)', border: '1px solid var(--border)',
              background: 'var(--surface-sunken)', color: 'var(--text)',
              cursor: 'pointer', textAlign: 'left',
            }}
          >
            <span style={{ color: 'var(--accent)', display: 'inline-flex' }}><Icon name="play" /></span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontWeight: 500 }}>Watch LEC &amp; LCK pro drafts</span>
              <span className="t3" style={{ fontSize: 13 }}>Public — no sign-in needed</span>
            </span>
            <span className="t3" style={{ marginLeft: 'auto', display: 'inline-flex' }}><Icon name="chevron-right" /></span>
          </button>
        </div>
      </div>

      <div className="t3" style={{ fontSize: 13, textAlign: 'center', paddingBottom: 28 }}>
        Beta · Data from Riot Games, Leaguepedia and PandaScore
      </div>
    </div>
  );
}
