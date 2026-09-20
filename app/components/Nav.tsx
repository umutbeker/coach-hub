'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TEAM_NAME } from '../../lib/team';
import Icon, { type IconName } from './Icon';

// Eight destinations. Related pages share one entry and switch with
// SectionTabs underneath: Games = Scrims + Official, Review = VODs + Feedback.
// Their URLs stayed the same so links in notes and the calendar still work.
export type NavKey = 'home' | 'calendar' | 'games' | 'review' | 'prep' | 'draft' | 'tournaments' | 'pro';

type User = { name?: string; role?: string; image?: string } | null;

const LINKS: { key: NavKey; label: string; icon: IconName; href: (coach: boolean) => string }[] = [
  { key: 'home', label: 'Home', icon: 'grid', href: c => (c ? '/coach' : '/player') },
  { key: 'calendar', label: 'Calendar', icon: 'calendar', href: () => '/calendar' },
  { key: 'games', label: 'Games', icon: 'target', href: () => '/scrims' },
  // A player's first stop in Review is the feedback about them.
  { key: 'review', label: 'Review', icon: 'video', href: c => (c ? '/review' : '/feedback') },
  { key: 'prep', label: 'Prep', icon: 'book', href: () => '/prep' },
  { key: 'draft', label: 'Draft', icon: 'clipboard', href: () => '/draft' },
  { key: 'tournaments', label: 'Tournaments', icon: 'trophy', href: () => '/tournaments' },
  { key: 'pro', label: 'Pro', icon: 'play', href: () => '/pro' },
];

// "New" badges: when a section was last opened is kept per viewer in the
// browser; the server only counts what is newer (a few Redis reads, so it is
// fetched on every page rather than cached).
const SEEN = (user: string, k: string) => `seen_${k}_${user}`;

function readSeen(user: string, k: 'review' | 'games') {
  try {
    const v = Number(localStorage.getItem(SEEN(user, k)));
    if (v) return v;
    // First visit: start counting from now instead of showing everything.
    localStorage.setItem(SEEN(user, k), String(Date.now()));
  } catch { /* storage unavailable */ }
  return Date.now();
}

function initials(name?: string) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

/**
 * Top bar for every signed-in screen; a bottom tab bar on phones.
 * `user` is null on the public page: wordmark and a way in, no links.
 */
export default function Nav({ active, user }: { active: NavKey | null; user: User }) {
  const router = useRouter();
  const isCoach = user?.role === 'coach';
  const [badges, setBadges] = useState<{ review: number; games: number }>({ review: 0, games: 0 });

  useEffect(() => {
    if (!user?.name) return;
    const name = user.name;
    // Opening a section clears its badge.
    if (active === 'review' || active === 'games') {
      try { localStorage.setItem(SEEN(name, active), String(Date.now())); } catch { /* ignore */ }
    }
    const q = new URLSearchParams({
      me: name,
      review: String(readSeen(name, 'review')),
      games: String(readSeen(name, 'games')),
      ...(isCoach ? { coach: '1' } : { player: name }),
    });
    let live = true;
    fetch(`/api/badges?${q}`).then(r => r.json()).then(b => {
      if (!live) return;
      setBadges({ review: b.review ?? 0, games: b.games ?? 0 });
    }).catch(() => {});
    return () => { live = false; };
  }, [user?.name, isCoach, active]);

  const signOut = () => {
    try {
      localStorage.removeItem('currentUser');
      sessionStorage.removeItem('viewingPlayer');
    } catch { /* storage can be unavailable; navigating away is the point */ }
    router.push('/');
  };

  const badgeFor = (k: NavKey) => (k === 'review' ? badges.review : k === 'games' ? badges.games : 0);

  return (
    <nav className="nav">
      <button className="nl brand" style={{ padding: '0 8px', gap: 10 }}
        onClick={() => router.push(user ? (isCoach ? '/coach' : '/player') : '/')}>
        <Icon name="mark" size={24} />
        <span className="h" style={{ fontSize: 17, letterSpacing: '0.06em', color: 'var(--text)' }}>{TEAM_NAME.toUpperCase()}</span>
        <span className="t3 hide-sm" style={{ fontSize: 12, letterSpacing: '0.14em', fontWeight: 500 }}>HUB</span>
      </button>

      {user ? (
        <div className="nav-links">
          {LINKS.map(l => {
            const n = badgeFor(l.key);
            return (
              <button key={l.key} className={active === l.key ? 'nl on' : 'nl'} onClick={() => router.push(l.href(isCoach))}>
                <span className="nl-ic"><Icon name={l.icon} />{n ? <span className="dot-sm" /> : null}</span>
                <span className="nl-label">{l.label}</span>
                {n ? <span className="badge">{n > 99 ? '99+' : n}</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        {user ? (
          <>
            <span className="avatar">
              {user.image && user.image !== '/logo.png' ? <img src={user.image} alt="" /> : initials(user.name)}
            </span>
            <span className="hide-sm" style={{ fontWeight: 500 }}>{user.name}</span>
            <button className="btn ghost sm" onClick={signOut} aria-label="Sign out">
              <Icon name="signout" />
              <span className="hide-sm">Sign out</span>
            </button>
          </>
        ) : (
          <button className="btn ghost sm" onClick={() => router.push('/')}>Sign in</button>
        )}
      </div>
    </nav>
  );
}

/** Second-level tabs for sections that span two pages (Games, Review). */
export function SectionTabs({ items }: { items: { label: string; href: string; on: boolean; count?: number }[] }) {
  const router = useRouter();
  return (
    <div className="tabs">
      {items.map(i => (
        <button key={i.href} className={i.on ? 'tab on' : 'tab'} onClick={() => { if (!i.on) router.push(i.href); }}>
          {i.label}
          {i.count ? <span className="t3" style={{ fontWeight: 400, marginLeft: 6 }}>{i.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
