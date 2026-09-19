'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { champImg } from '../../lib/champions';
import { ROLES, ROLE_LABEL, type ScrimGame } from '../../lib/hub';
import Nav, { SectionTabs } from '../components/Nav';
import Icon from '../components/Icon';
import { useUser } from '../components/useUser';

type Block = { blockId: string; date: string; opponent: string; patch: string; games: ScrimGame[]; wins: number; losses: number };

const pct = (w: number, n: number) => (n ? Math.round((w / n) * 100) : 0);
const fmtDate = (d: string) => {
  const x = new Date(d + 'T00:00:00');
  return isNaN(x.getTime()) ? d : x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

function Champs({ names, ban }: { names: string[]; ban?: boolean }) {
  const list = names.filter(Boolean);
  if (!list.length) return <span className="t3" style={{ fontSize: 13 }}>—</span>;
  return (
    <div className="row">
      {list.map((c, i) => (
        <img key={c + i} src={champImg(c)} alt={c} title={c} className={ban ? 'champ ban' : 'champ'}
          onError={e => { (e.target as HTMLImageElement).src = '/logo.png'; }} />
      ))}
    </div>
  );
}

export default function ScrimsPage() {
  const router = useRouter();
  const { user, ready } = useUser();
  const [games, setGames] = useState<ScrimGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [patch, setPatch] = useState('All');
  const [opp, setOpp] = useState('All');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/scrims').then(r => r.json())
      .then(d => setGames(d.games ?? []))
      .catch(() => setGames([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const patches = useMemo(() => ['All', ...[...new Set(games.map(g => g.patch).filter(Boolean))].sort().reverse()], [games]);
  const opps = useMemo(() => ['All', ...[...new Set(games.map(g => g.opponent))].sort()], [games]);
  const shown = useMemo(
    () => games.filter(g => (patch === 'All' || g.patch === patch) && (opp === 'All' || g.opponent === opp)),
    [games, patch, opp],
  );

  const stats = useMemo(() => {
    const w = shown.filter(g => g.result === 'W').length;
    const blue = shown.filter(g => g.side === 'blue'), red = shown.filter(g => g.side === 'red');
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const byOpp: Record<string, { n: number; w: number }> = {};
    const byChamp: Record<string, { n: number; w: number; role: string }> = {};
    shown.forEach(g => {
      byOpp[g.opponent] ??= { n: 0, w: 0 }; byOpp[g.opponent].n++; if (g.result === 'W') byOpp[g.opponent].w++;
      ROLES.forEach(r => {
        const c = g.ourPicks?.[r]; if (!c) return;
        byChamp[c] ??= { n: 0, w: 0, role: r }; byChamp[c].n++; if (g.result === 'W') byChamp[c].w++;
      });
    });
    return {
      n: shown.length, w, l: shown.length - w,
      blueWr: pct(blue.filter(g => g.result === 'W').length, blue.length), blueN: blue.length,
      redWr: pct(red.filter(g => g.result === 'W').length, red.length), redN: red.length,
      week: shown.filter(g => g.date >= weekAgo).length,
      byOpp: Object.entries(byOpp).map(([name, v]) => ({ name, ...v, wr: pct(v.w, v.n) })).sort((a, b) => b.n - a.n),
      byChamp: Object.entries(byChamp).map(([name, v]) => ({ name, ...v, wr: pct(v.w, v.n) })).sort((a, b) => b.n - a.n || b.wr - a.wr).slice(0, 8),
    };
  }, [shown]);

  const blocks = useMemo<Block[]>(() => {
    const m = new Map<string, Block>();
    shown.forEach(g => {
      const b = m.get(g.blockId) ?? { blockId: g.blockId, date: g.date, opponent: g.opponent, patch: g.patch, games: [], wins: 0, losses: 0 };
      b.games.push(g); if (g.result === 'W') b.wins++; else b.losses++;
      m.set(g.blockId, b);
    });
    return [...m.values()]
      .map(b => ({ ...b, games: b.games.sort((a, c) => a.gameNo - c.gameNo) }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [shown]);

  const del = async (id: string) => {
    if (!confirm('Delete this scrim game?')) return;
    await fetch(`/api/scrims?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    load();
  };

  if (!ready || !user) return <div className="hub" />;

  return (
    <div className="hub">
      <Nav active="games" user={user} />
      <div className="page">
        <SectionTabs items={[{ label: 'Scrims', href: '/scrims', on: true }, { label: 'Official matches', href: '/matches', on: false }]} />
        <div className="page-head">
          <div>
            <div className="h" style={{ fontSize: 24 }}>Scrims</div>
            <div className="t2" style={{ marginTop: 4 }}>Practice games, kept separate from official matches</div>
          </div>
          <button className="btn primary" onClick={() => router.push('/scrims/new')}><Icon name="plus" />Log scrim</button>
        </div>

        {games.length ? (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="t3" style={{ fontSize: 13 }}>Patch</span>
              {patches.map(p => <button key={p} className={patch === p ? 'chip on' : 'chip'} onClick={() => setPatch(p)}>{p}</button>)}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="t3" style={{ fontSize: 13 }}>Opponent</span>
              <select className="input" style={{ height: 36, width: 220 }} value={opp} onChange={e => setOpp(e.target.value)}>
                {opps.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
        ) : null}

        {loading ? <div className="empty">Loading…</div> : !games.length ? (
          <div className="card empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div className="h" style={{ fontSize: 20, color: 'var(--text)' }}>No scrims logged yet</div>
            <div style={{ maxWidth: 460 }}>Log a scrim block after practice — picks, bans and the result take about a minute a game. Records, side win rates and champion stats build up from here.</div>
            <button className="btn primary" onClick={() => router.push('/scrims/new')}><Icon name="plus" />Log your first scrim</button>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <div className="card stat"><div className="sec sm">Record</div><div className="mono" style={{ fontSize: 26, fontWeight: 600 }}>{stats.w}<span className="t3">–</span>{stats.l}</div><div className="t3" style={{ fontSize: 13 }}>{pct(stats.w, stats.n)}% win rate · {stats.n} games</div></div>
              <div className="card stat"><div className="sec sm">Blue side</div><div className="mono" style={{ fontSize: 26, fontWeight: 600, color: 'var(--blue-side)' }}>{stats.blueWr}%</div><div className="t3" style={{ fontSize: 13 }}>{stats.blueN} games</div></div>
              <div className="card stat"><div className="sec sm">Red side</div><div className="mono" style={{ fontSize: 26, fontWeight: 600, color: 'var(--red-side)' }}>{stats.redWr}%</div><div className="t3" style={{ fontSize: 13 }}>{stats.redN} games</div></div>
              <div className="card stat"><div className="sec sm">Last 7 days</div><div className="mono" style={{ fontSize: 26, fontWeight: 600 }}>{stats.week}</div><div className="t3" style={{ fontSize: 13 }}>games played</div></div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(280px, 1fr)', gap: 12, alignItems: 'start' }} className="two">
              <div className="card">
                <div style={{ padding: '18px 20px 10px' }}><div className="h" style={{ fontSize: 20 }}>Our most played</div></div>
                {stats.byChamp.map(c => (
                  <div key={c.name} className="trow" style={{ gridTemplateColumns: '40px 1fr 70px 60px 60px', padding: '8px 20px' }}>
                    <img src={champImg(c.name)} className="champ" alt="" onError={e => { (e.target as HTMLImageElement).src = '/logo.png'; }} />
                    <span style={{ fontWeight: 500 }}>{c.name}</span>
                    <span className="t3" style={{ fontSize: 13 }}>{ROLE_LABEL[c.role as keyof typeof ROLE_LABEL]}</span>
                    <span className="mono">{c.n}</span>
                    <span className="mono" style={{ color: c.wr >= 55 ? 'var(--win)' : c.wr < 45 ? 'var(--loss)' : undefined }}>{c.wr}%</span>
                  </div>
                ))}
              </div>
              <div className="card">
                <div style={{ padding: '18px 20px 10px' }}><div className="h" style={{ fontSize: 20 }}>By opponent</div></div>
                {stats.byOpp.map(o => (
                  <div key={o.name} className="trow" style={{ gridTemplateColumns: '1fr 70px 70px 60px', padding: '10px 20px' }}>
                    <span style={{ fontWeight: 500 }}>{o.name}</span>
                    <span className="mono t2">{o.w}–{o.n - o.w}</span>
                    <span className="t3" style={{ fontSize: 13 }}>{o.n} games</span>
                    <span className="mono" style={{ color: o.wr >= 55 ? 'var(--win)' : o.wr < 45 ? 'var(--loss)' : undefined }}>{o.wr}%</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {blocks.map(b => {
                const isOpen = open === b.blockId;
                return (
                  <div key={b.blockId} className={isOpen ? 'card hl' : 'card'}>
                    <button className="brow" onClick={() => setOpen(isOpen ? null : b.blockId)}>
                      <span className="t3" style={{ fontSize: 13 }}>{fmtDate(b.date)}</span>
                      <span className="h" style={{ fontSize: 20 }}>{b.opponent}</span>
                      <span className="mono h" style={{ fontSize: 24 }}>
                        <span style={{ color: 'var(--win)' }}>{b.wins}</span><span className="t3"> – </span><span style={{ color: 'var(--loss)' }}>{b.losses}</span>
                      </span>
                      <span className="t3" style={{ fontSize: 13 }}>{b.games.length} games · patch {b.patch || '—'}</span>
                      <span className={isOpen ? 'ic t2' : 'ic t3'} style={{ justifySelf: 'end' }}><Icon name={isOpen ? 'chevron-up' : 'chevron-down'} /></span>
                    </button>

                    {isOpen ? (
                      <div style={{ borderTop: '1px solid var(--border)', background: '#121519' }}>
                        {b.games.map(g => (
                          <div key={g.id} style={{ borderBottom: '1px solid var(--border)', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                              <span className="tag neutral">Game {g.gameNo}</span>
                              <span className={g.result === 'W' ? 'tag win' : 'tag loss'}>{g.result === 'W' ? 'Win' : 'Loss'}</span>
                              <span className={g.side === 'blue' ? 'tag blue' : 'tag red'}>{g.side === 'blue' ? 'Blue side' : 'Red side'}</span>
                              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                                {g.vodId ? <button className="btn sm" onClick={() => router.push(`/review/${g.vodId}`)}><Icon name="video" />Review VOD</button> : null}
                                <button className="btn ghost sm" onClick={() => del(g.id)} aria-label="Delete game"><Icon name="trash" /></button>
                              </div>
                            </div>
                            <div className="gdraft">
                              <span className="t3" style={{ fontSize: 12 }}>Our picks</span>
                              <div className="row">
                                {ROLES.map(r => g.ourPicks?.[r] ? (
                                  <img key={r} src={champImg(g.ourPicks[r])} className="champ" alt={g.ourPicks[r]} title={`${ROLE_LABEL[r]} · ${g.ourPicks[r]}`}
                                    onError={e => { (e.target as HTMLImageElement).src = '/logo.png'; }} />
                                ) : <span key={r} className="slot" style={{ width: 36, height: 36, cursor: 'default' }} />)}
                              </div>
                              <span className="t3" style={{ fontSize: 12 }}>Their picks</span><Champs names={g.theirPicks} />
                              <span className="t3" style={{ fontSize: 12 }}>Our bans</span><Champs names={g.ourBans} ban />
                              <span className="t3" style={{ fontSize: 12 }}>Their bans</span><Champs names={g.theirBans} ban />
                            </div>
                            {g.notes ? <div className="t2" style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{g.notes}</div> : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <style>{`
        .hub .brow{display:grid;grid-template-columns:90px minmax(0,1fr) 110px 200px 32px;gap:16px;align-items:center;padding:16px 20px;width:100%;background:none;border:none;text-align:left;cursor:pointer;}
        .hub .brow:hover{background:#12151B;}
        .hub .gdraft{display:grid;grid-template-columns:90px 1fr;gap:8px 12px;align-items:center;}
        @media(max-width:900px){
          .hub .two{grid-template-columns:1fr !important;}
          .hub .brow{grid-template-columns:1fr auto 32px;}
          .hub .brow > span:first-child, .hub .brow > span:nth-child(4){display:none;}
        }
      `}</style>
    </div>
  );
}
