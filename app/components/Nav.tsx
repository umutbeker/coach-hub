'use client';

import { useRouter } from 'next/navigation';
import { TEAM_NAME } from '../../lib/team';
import Icon, { type IconName } from './Icon';

export type NavKey = 'coach' | 'player' | 'matches' | 'draft' | 'pro';

type User = { name?: string; role?: string; image?: string } | null;

const LINKS: { key: NavKey; href: string; label: string; icon: IconName; coachOnly?: boolean }[] = [
  { key: 'coach', href: '/coach', label: 'Coach', icon: 'users', coachOnly: true },
  { key: 'player', href: '/player', label: 'My stats', icon: 'users' },
  { key: 'matches', href: '/matches', label: 'Matches', icon: 'list' },
  { key: 'draft', href: '/draft', label: 'Draft', icon: 'clipboard' },
  { key: 'pro', href: '/pro', label: 'Pro Drafts', icon: 'play' },
];

function initials(name?: string) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

/**
 * Top bar for every signed-in screen.
 *
 * `user` is null on the public page, where the nav shows the wordmark and a way
 * back but no identity and no links into the signed-in app.
 */
export default function Nav({ active, user }: { active: NavKey | null; user: User }) {
  const router = useRouter();
  const isCoach = user?.role === 'coach';

  const signOut = () => {
    try {
      localStorage.removeItem('currentUser');
      sessionStorage.removeItem('viewingPlayer');
    } catch { /* storage can be unavailable; navigating away is the point */ }
    router.push('/');
  };

  return (
    <nav className="nav">
      <button
        className="nl"
        style={{ padding: '0 8px', gap: 10 }}
        onClick={() => router.push(user ? (isCoach ? '/coach' : '/player') : '/')}
      >
        <Icon name="mark" size={24} />
        <span className="h" style={{ fontSize: 17, letterSpacing: '0.06em', color: 'var(--text)' }}>
          {TEAM_NAME.toUpperCase()}
        </span>
        <span className="t3" style={{ fontSize: 12, letterSpacing: '0.14em', fontWeight: 500 }}>HUB</span>
      </button>

      {user ? (
        <div style={{ display: 'flex', gap: 4 }}>
          {LINKS.filter(l => (l.coachOnly ? isCoach : !(l.key === 'player' && isCoach))).map(l => (
            <button
              key={l.key}
              className={active === l.key ? 'nl on' : 'nl'}
              onClick={() => router.push(l.href)}
            >
              <Icon name={l.icon} />
              {l.label}
            </button>
          ))}
        </div>
      ) : null}

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
        {user ? (
          <>
            <span className="avatar">
              {user.image && user.image !== '/logo.png'
                ? <img src={user.image} alt="" />
                : initials(user.name)}
            </span>
            <span style={{ fontWeight: 500 }}>{user.name}</span>
            <span className="t3" style={{ fontSize: 13 }}>{isCoach ? 'Head coach' : 'Player'}</span>
            <button className="btn ghost sm" onClick={signOut}>
              <Icon name="signout" />
              Sign out
            </button>
          </>
        ) : (
          <button className="btn ghost sm" onClick={() => router.push('/')}>Sign in</button>
        )}
      </div>
    </nav>
  );
}
