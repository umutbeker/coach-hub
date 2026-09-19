'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';

export type HubUser = {
  username: string;
  name: string;
  role: 'player' | 'coach';
  lane?: string | null;
  riotId?: string | null;
  image?: string;
};

function read(): string | null {
  try { return localStorage.getItem('currentUser'); } catch { return null; }
}
function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}
const noop = () => () => {};

/**
 * The signed-in user from localStorage, readable during render without a
 * hydration mismatch (server snapshot is null) and without the setState-in-
 * effect pattern. `ready` is false during server render and the first client
 * pass; pages redirect only once it is true.
 *
 * Auth here is client-side only — see CLAUDE.md "Auth".
 */
export function useUser({ require = true }: { require?: boolean } = {}) {
  const router = useRouter();
  const raw = useSyncExternalStore(subscribe, read, () => null);
  const ready = useSyncExternalStore(noop, () => true, () => false);

  const user = useMemo<HubUser | null>(() => {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }, [raw]);

  useEffect(() => {
    if (require && ready && !user) router.push('/');
  }, [require, ready, user, router]);

  return { user, ready, isCoach: user?.role === 'coach' };
}
