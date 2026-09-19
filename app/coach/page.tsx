'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { USERS } from '../../lib/users';
import { TEAM_NAME } from '../../lib/team';
import { champImg } from '../../lib/champions';
import type { EventType } from '../../lib/hub';
import Nav from '../components/Nav';
import Icon from '../components/Icon';
import HubCard, { Big, Line, Muted } from '../components/HubCard';
import PoolMatrix from '../components/PoolMatrix';
import { useUser } from '../components/useUser';

// Riot is rate limited and /api/data walks the roster one player at a time,
// so the roster loads progressively rather than all at once.
const SMART_CACHE_LIMIT = 60 * 60 * 1000;
const WEEKLY_TARGET = 7;
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const PLAYERS = USERS.filter(u => u.role === 'player');

const RANK_COLOR: Record<string, string> = {
  IRON: '#5C6577', BRONZE: '#CD7F32', SILVER: '#9AA3B2', GOLD: '#F5C542',
  PLATINUM: '#2DD4BF', EMERALD: '#34D399', DIAMOND: '#60A5FA',
  MASTER: 'var(--rank-master)', GRANDMASTER: 'var(--rank-grandmaster)',
  CHALLENGER: 'var(--rank-challenger)', UNRANKED: '#5C6577',
};
const TYPE_TAG: Record<EventType, string> = { scrim: 'tag accent', official: 'tag blue', review: 'tag win', other: 'tag neutral' };

const isWin = (r: string) => r === 'W' || r === 'Galibiyet';
const pct = (w: number, n: number) => (n ? Math.round((w / n) * 100) : 0);
const shortDate = (d: string) => {
  const x = new Date(d.length > 10 ? d.replace(' ', 'T') + 'Z' : d + 'T00:00:00');
  return isNaN(x.getTime()) ? d : x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
function initials(name?: string) {
  if (!name) return '?';
  const p = name.trim().split(/\s+/);
  return (p.length > 1 ? p[0][0] + p[1][0] : name.slice(0, 2)).toUpperCase();
}

type Overview = {
  scrims: { total: number; w: number; week: { n: number; w: number }; lastBlock: { date: string; opponent: string; w: number; l: number } | null };
  review: { vods: number; notesWeek: number; latestVod: { id: string; title: string; date: string } | null };
  feedback: { byPlayer: Record<string, number>; total14: number };
  calendar: { next: { id: string; type: EventType; title: string; date: string; time: string; opponent?: string }[] };
  prep: { opponent: string | null; hasPlan: boolean; report: { builtAt: number | null; hasBrief: boolean } | null; plans: number };
  official: { date: string; opponent: string; w: number; l: number } | null;
  pro: Record<'lec' | 'lck', { date: string; teamA: string; teamB: string; scoreA: number; scoreB: number; count: number } | null>;
  draft: { opponent: string | null; picks: number; updatedBy: string | null; updatedAt: number | null } | null;
};
// The slice of /api/data's solo queue payload the roster cards read.
type SoloStats = {
  error?: boolean; tier?: string; rank?: string; lp?: number;
  overallWinRate?: string; recentWinRate?: string; weeklyGames?: number;
  championStats?: { name: string; winRate: string }[];
  recentMatches?: { champion?: string; result: string }[];
};
type RosterEntry = (typeof PLAYERS)[number] & { stats: SoloStats | null };

type NextOfficial = { opponent: string; date: string; scheduledAt: string; league: string } | null;

export default function CoachDashboard() {
  const router = useRouter();
  const { user: coach, ready } = useUser();
  const [tab, setTab] = useState<'overview' | 'pool'>('overview');
  const [teamStats, setTeamStats] = useState<RosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPlayerName, setLoadingPlayerName] = useState('');
  const [ov, setOv] = useState<Overview | null>(null);
  const [nextOfficial, setNextOfficial] = useState<NextOfficial>(null);

  const fetchTeamData = async () => {
    setLoading(true);
    const loaded: RosterEntry[] = [];
    for (const player of PLAYERS) {
      const key = `coach_riot_${player.name}`;
      const timeStr = localStorage.getItem(`${key}_time`);
      const cachedStr = localStorage.getItem(key);
      const fresh = cachedStr && timeStr && Date.now() - Number(timeStr) < SMART_CACHE_LIMIT;
      try {
        if (fresh) {
          loaded.push({ ...player, stats: JSON.parse(cachedStr!) });
          setTeamStats([...loaded]);
          await delay(80);
        } else {
          setLoadingPlayerName(player.name);
          const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName: player.name }) });
          const data = await res.json();
          if (!data.error) { localStorage.setItem(key, JSON.stringify(data)); localStorage.setItem(`${key}_time`, String(Date.now())); }
          loaded.push({ ...player, stats: data });
          setTeamStats([...loaded]);
          await delay(6000);
        }
      } catch {
        loaded.push({ ...player, stats: { error: true } });
        setTeamStats([...loaded]);
      }
    }
    setLoading(false); setLoadingPlayerName('');
  };

  useEffect(() => {
    if (!ready) return;
    if (coach && coach.role !== 'coach') { router.push('/player'); return; }
    if (!coach) return;
    fetchTeamData();
    fetch('/api/overview').then(r => r.json()).then(setOv).catch(() => {});
    fetch('/api/fixture').then(r => r.json()).then(d => {
      const up = (d.tournaments ?? []).flatMap((t: { league: string; matches: { opponent: string; date: string; scheduledAt: string; isPast: boolean }[] }) =>
        t.matches.filter(m => !m.isPast && m.scheduledAt).map(m => ({ opponent: m.opponent, date: m.date, scheduledAt: m.scheduledAt, league: t.league })))
        .sort((a: { scheduledAt: string }, b: { scheduledAt: string }) => a.scheduledAt.localeCompare(b.scheduledAt));
      setNextOfficial(up[0] ?? null);
    }).catch(() => {});
    // Runs once per signed-in coach; fetchTeamData is intentionally not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, coach?.username]);

  const soloq = useMemo(() => {
    const withStats = teamStats.filter((p): p is RosterEntry & { stats: SoloStats } => !!p.stats && !p.stats.error && !!p.stats.tier);
    const recent = withStats.map(p => parseInt(p.stats.recentWinRate ?? '')).filter(n => !isNaN(n));
    return {
      form: recent.length ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : null,
      weekly: withStats.reduce((a, p) => a + (p.stats.weeklyGames || 0), 0),
      under: withStats.filter(p => (p.stats.weeklyGames || 0) < WEEKLY_TARGET).length,
    };
  }, [teamStats]);

  const teamPool = useMemo(() => {
    const pool: Record<string, { games: number; wins: number; players: Set<string> }> = {};
    teamStats.forEach(p => {
      (p.stats?.recentMatches ?? []).forEach((m: { champion?: string; result: string }) => {
        if (!m.champion) return;
        pool[m.champion] ??= { games: 0, wins: 0, players: new Set() };
        pool[m.champion].games++; pool[m.champion].players.add(p.name);
        if (isWin(m.result)) pool[m.champion].wins++;
      });
    });
    return Object.entries(pool)
      .map(([name, v]) => ({ name, games: v.games, winRate: pct(v.wins, v.games), players: [...v.players] }))
      .sort((a, b) => b.games - a.games).slice(0, 8);
  }, [teamStats]);

  const openPlayer = (p: unknown) => {
    sessionStorage.setItem('viewingPlayer', JSON.stringify(p));
    router.push('/player');
  };

  if (!ready || !coach) return <div className="hub" />;

  // Next event across the calendar and the official fixture.
  const upNext = [
    ...(ov?.calendar.next ?? []).map(e => ({ key: e.id, type: e.type, title: e.title, when: `${shortDate(e.date)} · ${e.time}`, sort: `${e.date} ${e.time}` })),
    ...(nextOfficial ? [{
      key: 'official', type: 'official' as EventType, title: `vs ${nextOfficial.opponent}`,
      when: new Date(nextOfficial.scheduledAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
      sort: nextOfficial.scheduledAt.replace('T', ' '),
    }] : []),
  ].sort((a, b) => a.sort.localeCompare(b.sort)).slice(0, 3);

  const maxNotes = Math.max(1, ...PLAYERS.map(p => ov?.feedback.byPlayer[p.name] ?? 0));
  const prepHref = ov?.prep.opponent ? `/prep?opponent=${encodeURIComponent(ov.prep.opponent)}` : '/prep';

  return (
    <div className="hub">
      <Nav active="home" user={coach} />

      <div className="page">
        <div className="page-head">
          <div>
            <div className="h" style={{ fontSize: 24 }}>Coach panel</div>
            <div className="t2" style={{ marginTop: 4 }}>{TEAM_NAME} Esports · everything at a glance</div>
          </div>
        </div>

        <div className="tabs">
          <button className={tab === 'overview' ? 'tab on' : 'tab'} onClick={() => setTab('overview')}>Overview</button>
          <button className={tab === 'pool' ? 'tab on' : 'tab'} onClick={() => setTab('pool')}>Champion pool</button>
        </div>

        {tab === 'pool' ? <PoolMatrix /> : (
          <>
            <div className="hubg">
              <HubCard title="Up next" icon="calendar" href="/calendar" cta="Calendar">
                {!upNext.length ? <Muted>Nothing scheduled. Add scrims and reviews to the calendar.</Muted> : upNext.map(e => (
                  <Line key={e.key}>
                    <span className={TYPE_TAG[e.type]} style={{ width: 64, justifyContent: 'center', textTransform: 'capitalize' }}>{e.type}</span>
                    <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</span>
                    <span className="t3 mono" style={{ marginLeft: 'auto', fontSize: 13, whiteSpace: 'nowrap' }}>{e.when}</span>
                  </Line>
                ))}
              </HubCard>

              <HubCard title="Scrims" icon="target" href="/scrims" cta="Scrims">
                {!ov ? <Muted>Loading…</Muted> : !ov.scrims.total ? <Muted>No scrims logged yet.</Muted> : (
                  <>
                    <div style={{ display: 'flex', gap: 28 }}>
                      <div><Big>{ov.scrims.week.n}</Big><div className="t3" style={{ fontSize: 13 }}>games · last 7 days</div></div>
                      <div><Big color={pct(ov.scrims.week.w, ov.scrims.week.n) >= 50 ? 'var(--win)' : 'var(--loss)'}>{ov.scrims.week.n ? `${pct(ov.scrims.week.w, ov.scrims.week.n)}%` : '—'}</Big><div className="t3" style={{ fontSize: 13 }}>win rate</div></div>
                    </div>
                    {ov.scrims.lastBlock ? (
                      <Line>
                        <span className="t2">Last: vs {ov.scrims.lastBlock.opponent}</span>
                        <span className="mono"><span style={{ color: 'var(--win)' }}>{ov.scrims.lastBlock.w}</span>–<span style={{ color: 'var(--loss)' }}>{ov.scrims.lastBlock.l}</span></span>
                        <span className="t3" style={{ marginLeft: 'auto', fontSize: 13 }}>{shortDate(ov.scrims.lastBlock.date)}</span>
                      </Line>
                    ) : null}
                  </>
                )}
              </HubCard>

              <HubCard title="Match prep" icon="book" href={prepHref} cta="Prep">
                {!ov ? <Muted>Loading…</Muted> : !ov.prep.opponent ? (
                  <Muted>No next opponent set. Pick one in Prep — the draft room scouts whoever is set there.</Muted>
                ) : (
                  <>
                    <div className="t3" style={{ fontSize: 13 }}>Next opponent</div>
                    <div className="h" style={{ fontSize: 22 }}>{ov.prep.opponent}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span className={ov.prep.report ? 'tag win' : 'tag warn'}>{ov.prep.report ? `Report · ${ov.prep.report.builtAt ? shortDate(new Date(ov.prep.report.builtAt).toISOString().slice(0, 10)) : 'built'}` : 'No report'}</span>
                      <span className={ov.prep.report?.hasBrief ? 'tag win' : 'tag neutral'}>{ov.prep.report?.hasBrief ? 'Brief' : 'No brief'}</span>
                      <span className={ov.prep.hasPlan ? 'tag win' : 'tag warn'}>{ov.prep.hasPlan ? 'Draft plan' : 'No draft plan'}</span>
                    </div>
                  </>
                )}
              </HubCard>

              <HubCard title="VOD review" icon="video" href={ov?.review.latestVod ? `/review/${ov.review.latestVod.id}` : '/review'} cta={ov?.review.latestVod ? 'Latest VOD' : 'Review'}>
                {!ov ? <Muted>Loading…</Muted> : !ov.review.vods ? <Muted>No VODs yet. Add a link, or attach one when logging a scrim.</Muted> : (
                  <>
                    <div style={{ display: 'flex', gap: 28 }}>
                      <div><Big>{ov.review.vods}</Big><div className="t3" style={{ fontSize: 13 }}>VODs</div></div>
                      <div><Big>{ov.review.notesWeek}</Big><div className="t3" style={{ fontSize: 13 }}>notes this week</div></div>
                    </div>
                    {ov.review.latestVod ? <Line><span className="t2" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Latest: {ov.review.latestVod.title}</span></Line> : null}
                  </>
                )}
              </HubCard>

              <HubCard title="Feedback" icon="message" href="/feedback" cta="Feedback">
                {!ov ? <Muted>Loading…</Muted> : !ov.feedback.total14 ? <Muted>No player-tagged notes in the last 14 days.</Muted> : (
                  <>
                    <div className="t3" style={{ fontSize: 13 }}>Notes per player · last 14 days</div>
                    {PLAYERS.map(p => {
                      const n = ov.feedback.byPlayer[p.name] ?? 0;
                      return (
                        <div key={p.name} style={{ display: 'grid', gridTemplateColumns: '84px 1fr 24px', gap: 10, alignItems: 'center', fontSize: 14 }}>
                          <span>{p.name}</span>
                          <div className="bar"><span style={{ width: `${(n / maxNotes) * 100}%`, background: 'var(--accent)' }} /></div>
                          <span className="mono t2" style={{ textAlign: 'right' }}>{n}</span>
                        </div>
                      );
                    })}
                  </>
                )}
              </HubCard>

              <HubCard title="Official matches" icon="list" href="/matches" cta="Matches">
                {!ov ? <Muted>Loading…</Muted> : (
                  <>
                    {ov.official ? (
                      <>
                        <div className="t3" style={{ fontSize: 13 }}>Last series · {shortDate(ov.official.date)}</div>
                        <Line>
                          <span className={ov.official.w > ov.official.l ? 'tag win' : 'tag loss'}>{ov.official.w > ov.official.l ? 'Won' : 'Lost'}</span>
                          <span style={{ fontWeight: 500 }}>vs {ov.official.opponent}</span>
                          <span className="mono" style={{ marginLeft: 'auto', fontSize: 18, fontWeight: 600 }}>{ov.official.w}–{ov.official.l}</span>
                        </Line>
                      </>
                    ) : <Muted>No official games on record.</Muted>}
                    <Line>
                      <span className="t3">Next:</span>
                      <span className="t2">{nextOfficial ? `vs ${nextOfficial.opponent} · ${nextOfficial.date}` : 'not listed on PandaScore yet'}</span>
                    </Line>
                  </>
                )}
              </HubCard>

              <HubCard title="Draft room" icon="clipboard" href="/draft" cta="Open">
                {!ov ? <Muted>Loading…</Muted> : !ov.draft ? <Muted>Empty board.</Muted> : (
                  <>
                    <Line><span className="t3">Scouting</span><span style={{ fontWeight: 500 }}>{ov.draft.opponent ?? 'no opponent set'}</span></Line>
                    <Line><span className="t3">Board</span><span className="mono">{ov.draft.picks}/10</span><span className="t3" style={{ fontSize: 13 }}>picks filled</span></Line>
                    {ov.draft.updatedBy && ov.draft.updatedAt ? (
                      <Muted>Last change by {ov.draft.updatedBy} · {new Date(ov.draft.updatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Muted>
                    ) : null}
                  </>
                )}
              </HubCard>

              <HubCard title="Pro drafts" icon="play" href="/pro" cta="Pro drafts">
                {!ov ? <Muted>Loading…</Muted> : (['lec', 'lck'] as const).map(l => {
                  const s = ov.pro[l];
                  return s ? (
                    <Line key={l}>
                      <span className="tag neutral" style={{ width: 44, justifyContent: 'center' }}>{l.toUpperCase()}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span style={{ fontWeight: s.scoreA > s.scoreB ? 600 : 400 }}>{s.teamA}</span>
                        <span className="mono t2"> {s.scoreA}–{s.scoreB} </span>
                        <span style={{ fontWeight: s.scoreB > s.scoreA ? 600 : 400 }}>{s.teamB}</span>
                      </span>
                      <span className="t3" style={{ marginLeft: 'auto', fontSize: 13, whiteSpace: 'nowrap' }}>{shortDate(s.date)}</span>
                    </Line>
                  ) : <Line key={l}><span className="tag neutral" style={{ width: 44, justifyContent: 'center' }}>{l.toUpperCase()}</span><span className="t3">no data yet</span></Line>;
                })}
              </HubCard>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
                <div className="h" style={{ fontSize: 20 }}>Roster</div>
                <span className="t3" style={{ fontSize: 13 }}>solo queue</span>
                <div style={{ display: 'flex', gap: 16, fontSize: 14, flexWrap: 'wrap' }} className="t2">
                  <span>Form <b className="mono" style={{ color: 'var(--text)' }}>{soloq.form !== null ? `${soloq.form}%` : '—'}</b></span>
                  <span><b className="mono" style={{ color: 'var(--text)' }}>{soloq.weekly}</b> games this week</span>
                  {soloq.under ? <span style={{ color: 'var(--warn)' }}>{soloq.under} under {WEEKLY_TARGET}</span> : null}
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
                  {loadingPlayerName ? <span className="t3" style={{ fontSize: 13 }}>Syncing {loadingPlayerName}…</span> : null}
                  <button className="btn sm" onClick={() => fetchTeamData()} disabled={loading}><Icon name="refresh" />Refresh</button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                {teamStats.map(p => {
                  const s = p.stats;
                  const weekly = s?.weeklyGames ?? 0;
                  const low = weekly < WEEKLY_TARGET;
                  const tier = (s?.tier || 'UNRANKED').toUpperCase();
                  const recentWr = parseInt(s?.recentWinRate ?? '');
                  return (
                    <button key={p.username} className={low ? 'card pcard warn' : 'card pcard'} onClick={() => openPlayer(p)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span className="avatar" style={{ width: 44, height: 44, fontSize: 15 }}>
                          {p.image && p.image !== '/logo.png' ? <img src={p.image} alt="" /> : initials(p.name)}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div className="h" style={{ fontSize: 20 }}>{p.name}</div>
                          <div className="t3 mono" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.riotId}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {p.lane ? <span className="tag neutral" style={{ textTransform: 'capitalize' }}>{p.lane}</span> : null}
                        {s?.tier ? <span className="tag" style={{ background: 'rgba(255,255,255,0.05)', color: RANK_COLOR[tier] }}>{s.rank}</span> : null}
                      </div>
                      {s && !s.error && s.tier ? (
                        <>
                          <div>
                            <div className="mono" style={{ fontSize: 22, fontWeight: 600 }}>
                              {s.lp} <span className="t3" style={{ fontSize: 14, fontWeight: 500 }}>LP</span>
                            </div>
                            <div className="t2" style={{ fontSize: 13 }}>
                              {s.overallWinRate} season · <span style={{ color: recentWr >= 55 ? 'var(--win)' : recentWr < 45 ? 'var(--loss)' : undefined }}>{s.recentWinRate} last 20</span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                              <span className="t2">This week</span>
                              <span className="mono" style={{ color: low ? 'var(--warn)' : undefined }}>{weekly} games{low ? ' · low' : ''}</span>
                            </div>
                            <div className="bar">
                              <span style={{ width: `${Math.min(100, (weekly / 20) * 100)}%`, background: low ? 'var(--warn)' : 'var(--win)' }} />
                            </div>
                          </div>
                          <div className="row">
                            {(s.championStats ?? []).slice(0, 3).map((c: { name: string; winRate: string }) => (
                              <img key={c.name} src={champImg(c.name)} className="champ" alt={c.name} title={`${c.name} · ${c.winRate}`} onError={e => { (e.target as HTMLImageElement).src = '/logo.png'; }} />
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className="t3" style={{ fontSize: 13 }}>{loading ? 'Waiting for sync…' : 'No data yet'}</div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {teamPool.length ? (
              <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div className="h" style={{ fontSize: 22 }}>Team champion pool</div>
                  <div className="t3" style={{ fontSize: 13 }}>solo queue · last 20 per player · pro and scrim pools are in the Champion pool tab</div>
                </div>
                <div className="thead" style={{ gridTemplateColumns: '44px 1fr 70px 1fr 180px', padding: '0 4px 4px' }}>
                  <span /><span>Champion</span><span>Games</span><span>Played by</span><span>Win rate</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {teamPool.map(c => (
                    <div key={c.name} style={{ display: 'grid', gridTemplateColumns: '44px 1fr 70px 1fr 180px', gap: 12, alignItems: 'center', padding: '0 4px' }}>
                      <img src={champImg(c.name)} className="champ" alt={c.name} onError={e => { (e.target as HTMLImageElement).src = '/logo.png'; }} />
                      <span style={{ fontWeight: 500 }}>{c.name}</span>
                      <span className="mono">{c.games}</span>
                      <span className="t2" style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.players.join(', ')}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className="bar" style={{ flex: 1 }}>
                          <span style={{ width: `${c.winRate}%`, background: c.winRate >= 55 ? 'var(--win)' : c.winRate < 45 ? 'var(--loss)' : 'var(--text-2)' }} />
                        </div>
                        <span className="mono" style={{ width: 40, textAlign: 'right' }}>{c.winRate}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      <style>{`
        .hub .pcard{padding:20px;display:flex;flex-direction:column;gap:16px;text-align:left;cursor:pointer;align-items:stretch;}
        .hub .pcard:hover{border-color:var(--border-strong);background:#191D25;}
        .hub .pcard.warn{border-color:rgba(251,191,36,0.4);}
      `}</style>
    </div>
  );
}
