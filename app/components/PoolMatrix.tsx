'use client';

import { useEffect, useMemo, useState } from 'react';
import { USERS } from '../../lib/users';
import { champImg } from '../../lib/champions';
import { ROLE_LABEL, type PoolMatrix as Matrix, type PoolTier, type Role, type ScrimGame } from '../../lib/hub';
import ChampionPicker from './ChampionPicker';
import Icon from './Icon';

const PLAYERS = USERS.filter(u => u.role === 'player');
const TIER: Record<PoolTier, { label: string; color: string; bg: string }> = {
  ready: { label: 'Ready', color: 'var(--win)', bg: 'rgba(52,211,153,0.14)' },
  practice: { label: 'Practice', color: 'var(--warn)', bg: 'rgba(251,191,36,0.14)' },
  no: { label: 'No', color: 'var(--loss)', bg: 'rgba(248,113,113,0.14)' },
};
const RANK: Record<string, number> = { ready: 0, practice: 1, none: 2, no: 3 };

type Tally = { n: number; w: number };
const wr = (t?: Tally) => (t && t.n ? Math.round((t.w / t.n) * 100) : null);

function Evidence({ label, t }: { label: string; t?: Tally }) {
  const p = wr(t);
  return (
    <span style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
      {label} {t?.n ? (
        <span className="mono" style={{ color: p! >= 55 ? 'var(--win)' : p! < 45 ? 'var(--loss)' : 'var(--text-2)' }}>{t.n}·{p}%</span>
      ) : <span className="mono">—</span>}
    </span>
  );
}

/**
 * Player × champion comfort, set by the coach, shown next to the evidence:
 * scrim record (from the scrim tracker, credited by role) and official record
 * (from Leaguepedia). The tier is the coach's call; the numbers are there so
 * it can be argued with.
 */
export default function PoolMatrix() {
  const [matrix, setMatrix] = useState<Matrix>({});
  const [scrims, setScrims] = useState<ScrimGame[]>([]);
  const [official, setOfficial] = useState<Record<string, Record<string, Tally>>>({});
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/pool').then(r => r.json()).then(d => setMatrix(d.matrix ?? {})),
      fetch('/api/scrims').then(r => r.json()).then(d => setScrims(d.games ?? [])),
      // Official games per player, from the Leaguepedia data the daily sync
      // already stored — no Leaguepedia call from here.
      Promise.all(PLAYERS.map(p => fetch(`/api/data?type=lp&player=${encodeURIComponent(p.name)}`).then(r => r.json()).catch(() => null)))
        .then(res => {
          const out: Record<string, Record<string, Tally>> = {};
          res.forEach((d, i) => {
            const t: Record<string, Tally> = {};
            (d?.data?.cargoquery ?? []).forEach((row: { title: { Champion?: string; PlayerWin?: string } }) => {
              const c = row.title.Champion; if (!c) return;
              t[c] ??= { n: 0, w: 0 }; t[c].n++; if (row.title.PlayerWin === 'Yes') t[c].w++;
            });
            out[PLAYERS[i].name] = t;
          });
          setOfficial(out);
        }),
    ]).finally(() => setLoading(false));
  }, []);

  const scrimBy = useMemo(() => {
    const out: Record<string, Record<string, Tally>> = {};
    PLAYERS.forEach(p => {
      const t: Record<string, Tally> = {};
      scrims.forEach(g => {
        const c = g.ourPicks?.[p.lane as Role]; if (!c) return;
        t[c] ??= { n: 0, w: 0 }; t[c].n++; if (g.result === 'W') t[c].w++;
      });
      out[p.name] = t;
    });
    return out;
  }, [scrims]);

  const setTier = async (player: string, champion: string, tier: PoolTier | null) => {
    setMatrix(m => {
      const next = { ...(m[player] ?? {}) };
      if (tier) next[champion] = tier; else delete next[champion];
      return { ...m, [player]: next };
    });
    await fetch('/api/pool', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player, champion, tier }),
    }).catch(() => {});
  };

  if (loading) return <div className="empty">Loading pools…</div>;

  return (
    <>
      <div className="t2" style={{ fontSize: 14 }}>
        Tiers are yours to set. Next to each champion: <b>Scrim</b> and <b>Official</b> record (games · win rate).
        Champions a player has played but you haven’t rated appear unrated at the bottom.
      </div>
      <div className="pm">
        {PLAYERS.map(p => {
          const rated = matrix[p.name] ?? {};
          const names = new Set([...Object.keys(rated), ...Object.keys(scrimBy[p.name] ?? {}), ...Object.keys(official[p.name] ?? {})]);
          const rows = [...names].map(c => {
            const s = scrimBy[p.name]?.[c], o = official[p.name]?.[c];
            return { c, tier: rated[c] as PoolTier | undefined, s, o, games: (s?.n ?? 0) + (o?.n ?? 0) };
          }).sort((a, b) => RANK[a.tier ?? 'none'] - RANK[b.tier ?? 'none'] || b.games - a.games || a.c.localeCompare(b.c));
          const counts = { ready: 0, practice: 0 };
          rows.forEach(r => { if (r.tier === 'ready') counts.ready++; if (r.tier === 'practice') counts.practice++; });

          return (
            <div key={p.name} className="card" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="h" style={{ fontSize: 20 }}>{p.name}</div>
                  <div className="t3" style={{ fontSize: 13 }}>{ROLE_LABEL[p.lane as Role] ?? p.lane} · {counts.ready} ready · {counts.practice} practice</div>
                </div>
                <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setAdding(p.name)} aria-label={`Add champion for ${p.name}`}><Icon name="plus" /></button>
              </div>
              {!rows.length ? <div className="t3" style={{ padding: 16, fontSize: 13 }}>No champions yet. Add one, or log scrims.</div> : null}
              {rows.map(r => (
                <div key={r.c} style={{ display: 'grid', gridTemplateColumns: '36px 1fr', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border)', alignItems: 'center', opacity: r.tier === 'no' ? 0.55 : 1 }}>
                  <img src={champImg(r.c)} className="champ" alt="" onError={e => { (e.target as HTMLImageElement).src = '/logo.png'; }} />
                  <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.c}</span>
                      <select value={r.tier ?? ''} aria-label={`${r.c} tier`}
                        onChange={e => setTier(p.name, r.c, (e.target.value || null) as PoolTier | null)}
                        style={{
                          height: 26, borderRadius: 6, border: 'none', padding: '0 6px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                          background: r.tier ? TIER[r.tier].bg : 'var(--surface-2)', color: r.tier ? TIER[r.tier].color : 'var(--text-3)',
                        }}>
                        <option value="">Unrated</option>
                        <option value="ready">Ready</option>
                        <option value="practice">Practice</option>
                        <option value="no">No</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', gap: 12 }}>
                      <Evidence label="Scrim" t={r.s} />
                      <Evidence label="Official" t={r.o} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {adding ? (
        <ChampionPicker
          title={`Add champion · ${adding}`}
          used={Object.keys(matrix[adding] ?? {})}
          onPick={name => { setTier(adding, name, 'practice'); setAdding(null); }}
          onClose={() => setAdding(null)}
        />
      ) : null}

      <style>{`
        .hub .pm{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;align-items:start;}
        @media(max-width:1400px){.hub .pm{grid-template-columns:repeat(3,minmax(0,1fr));}}
        @media(max-width:900px){.hub .pm{grid-template-columns:1fr;}}
      `}</style>
    </>
  );
}
