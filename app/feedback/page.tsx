'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { USERS } from '../../lib/users';
import { NOTE_CATEGORIES, fmtTime, type NoteCategory, type VodNote, type VodSource } from '../../lib/hub';
import Nav, { SectionTabs } from '../components/Nav';
import Icon from '../components/Icon';
import { useUser } from '../components/useUser';

type FeedNote = VodNote & { vod: { id: string; title: string; date: string; source: VodSource } | null };

const PLAYERS = USERS.filter(u => u.role === 'player').map(u => u.name);
const CAT_LABEL: Record<NoteCategory, string> = {
  laning: 'Laning', vision: 'Vision', teamfight: 'Teamfight', macro: 'Macro',
  draft: 'Draft', mechanics: 'Mechanics', comms: 'Comms', other: 'Other',
};

export default function FeedbackPage() {
  const router = useRouter();
  const { user, ready, isCoach } = useUser();
  // Coaches pick whose feedback to read; a player always sees their own.
  const [picked, setPicked] = useState<string | null>(null);
  const who = isCoach ? (picked ?? PLAYERS[0]) : user?.name;

  const [notes, setNotes] = useState<FeedNote[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [cat, setCat] = useState<NoteCategory | 'all'>('all');

  useEffect(() => {
    if (!who) return;
    let live = true;
    fetch(`/api/notes?player=${encodeURIComponent(who)}`).then(r => r.json())
      .then(d => { if (live) { setNotes(d.notes ?? []); setLoadedFor(who); } })
      .catch(() => { if (live) { setNotes([]); setLoadedFor(who); } });
    return () => { live = false; };
  }, [who]);

  const loading = loadedFor !== who;
  const shown = useMemo(() => notes.filter(n => cat === 'all' || n.category === cat), [notes, cat]);
  const breakdown = useMemo(() => {
    const c: Partial<Record<NoteCategory, number>> = {};
    notes.forEach(n => { c[n.category] = (c[n.category] ?? 0) + 1; });
    return NOTE_CATEGORIES.map(k => ({ k, n: c[k] ?? 0 })).filter(x => x.n).sort((a, b) => b.n - a.n);
  }, [notes]);

  if (!ready || !user) return <div className="hub" />;

  return (
    <div className="hub">
      <Nav active="review" user={user} />
      <div className="page">
        <SectionTabs items={[{ label: 'VODs', href: '/review', on: false }, { label: 'Feedback', href: '/feedback', on: true }]} />
        <div className="page-head">
          <div>
            <div className="h" style={{ fontSize: 32 }}>{isCoach ? 'Player feedback' : 'My feedback'}</div>
            <div className="t2" style={{ marginTop: 4 }}>
              Every VOD note tagged {isCoach ? 'with a player' : 'with you'} — click one to watch that moment
            </div>
          </div>
          {isCoach ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {PLAYERS.map(p => <button key={p} className={who === p ? 'chip on' : 'chip'} onClick={() => setPicked(p)}>{p}</button>)}
            </div>
          ) : null}
        </div>

        {loading ? <div className="empty">Loading…</div> : !notes.length ? (
          <div className="card empty">
            No notes about {isCoach ? who : 'you'} yet. They appear here when a VOD note is tagged {isCoach ? `with ${who}` : 'with your name'}.
          </div>
        ) : (
          <div className="fb">
            <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14, alignSelf: 'start' }}>
              <div>
                <div className="sec sm">Notes</div>
                <div className="mono" style={{ fontSize: 32, fontWeight: 600 }}>{notes.length}</div>
                <div className="t3" style={{ fontSize: 13 }}>across {new Set(notes.map(n => n.vodId)).size} VODs</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="sec sm">By area</div>
                {breakdown.map(b => (
                  <button key={b.k} onClick={() => setCat(cat === b.k ? 'all' : b.k)}
                    style={{ display: 'flex', flexDirection: 'column', gap: 5, background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', color: 'inherit', opacity: cat === 'all' || cat === b.k ? 1 : 0.45 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                      <span style={{ fontWeight: 500 }}>{CAT_LABEL[b.k]}</span>
                      <span className="mono t2">{b.n} · {Math.round((b.n / notes.length) * 100)}%</span>
                    </div>
                    <div className="bar"><span style={{ width: `${(b.n / notes.length) * 100}%`, background: 'var(--accent)' }} /></div>
                  </button>
                ))}
                {cat !== 'all' ? <button className="btn ghost sm" style={{ alignSelf: 'flex-start', paddingLeft: 0 }} onClick={() => setCat('all')}>Show all areas</button> : null}
              </div>
            </div>

            <div className="card">
              {shown.map(n => (
                <button key={n.id} className="fnote" onClick={() => router.push(`/review/${n.vodId}?t=${n.t}`)}>
                  <span className="mono" style={{ color: 'var(--accent)', fontWeight: 600 }}>{fmtTime(n.t)}</span>
                  <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{n.text}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span className="tag neutral">{CAT_LABEL[n.category]}</span>
                      {n.vod ? <span className="t2" style={{ fontSize: 13 }}>{n.vod.title}</span> : <span className="t3" style={{ fontSize: 13 }}>VOD removed</span>}
                      <span className="t3" style={{ fontSize: 13 }}>· {n.author}</span>
                      {n.vod?.date ? <span className="t3" style={{ fontSize: 13 }}>· {n.vod.date}</span> : null}
                    </div>
                  </div>
                  <span className="t3" style={{ display: 'inline-flex' }}><Icon name="play" size={16} /></span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <style>{`
        .hub .fb{display:grid;grid-template-columns:280px minmax(0,1fr);gap:16px;}
        .hub .fnote{display:grid;grid-template-columns:70px 1fr 24px;gap:14px;align-items:start;padding:14px 20px;width:100%;background:none;border:none;border-bottom:1px solid var(--border);text-align:left;cursor:pointer;color:var(--text);font-size:15px;}
        .hub .fnote:hover{background:#12151B;}
        @media(max-width:900px){.hub .fb{grid-template-columns:1fr;}}
      `}</style>
    </div>
  );
}
