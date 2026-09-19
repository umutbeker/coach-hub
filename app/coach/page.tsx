'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { USERS } from '../../lib/users';
import { TEAM_NAME } from '../../lib/team';
import { champImg } from '../../lib/champions';
import Nav from '../components/Nav';
import Icon from '../components/Icon';

// Riot is rate limited and /api/data walks the roster one player at a time,
// so the roster loads progressively rather than all at once.
const SMART_CACHE_LIMIT = 60 * 60 * 1000;
const WEEKLY_TARGET = 7;
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

const RANK_COLOR: Record<string, string> = {
  IRON: '#5C6577', BRONZE: '#CD7F32', SILVER: '#9AA3B2', GOLD: '#F5C542',
  PLATINUM: '#2DD4BF', EMERALD: '#34D399', DIAMOND: '#60A5FA',
  MASTER: 'var(--rank-master)', GRANDMASTER: 'var(--rank-grandmaster)',
  CHALLENGER: 'var(--rank-challenger)', UNRANKED: '#5C6577',
};

const isWin = (r: string) => r === 'W' || r === 'Galibiyet';

function initials(name?: string) {
  if (!name) return '?';
  const p = (name ?? '').trim().split(/\s+/);
  return (p.length > 1 ? p[0][0] + p[1][0] : (name ?? '').slice(0, 2)).toUpperCase();
}

// d < 0 means the match has been played. Printing the raw negative made a
// finished game read as an upcoming one.
function dayLabel(d: number | null) {
  if (d === null) return { color: 'var(--text-3)', label: 'TBD' };
  if (d < 0) return { color: 'var(--text-3)', label: `${-d} days ago · played` };
  if (d === 0) return { color: 'var(--loss)', label: 'Today' };
  if (d === 1) return { color: 'var(--warn)', label: 'Tomorrow' };
  if (d <= 3) return { color: 'var(--warn)', label: `${d} days` };
  return { color: 'var(--text-2)', label: `${d} days` };
}

export default function CoachDashboard() {
  const router = useRouter();
  const [coach, setCoach] = useState<any>(null);
  const [teamStats, setTeamStats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPlayerName, setLoadingPlayerName] = useState('');
  const [tab, setTab] = useState<'roster' | 'fixture'>('roster');
  const [fixture, setFixture] = useState<any>(null);
  const [fixtureLoading, setFixtureLoading] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<any>(null);
  const [manualOpp, setManualOpp] = useState('');
  const [savedOpp, setSavedOpp] = useState<string | null>(null);
  const [scoutData, setScoutData] = useState<any>(null);
  const [scoutLoading, setScoutLoading] = useState(false);

  const fetchTeamData = async () => {
    setLoading(true);
    const players = USERS.filter(u => u.role === 'player');
    const loaded: any[] = [];
    for (const player of players) {
      const key = `coach_riot_${player.name}`;
      const timeStr = localStorage.getItem(`${key}_time`);
      const cachedStr = localStorage.getItem(key);
      const fresh = cachedStr && timeStr && Date.now() - Number(timeStr) < SMART_CACHE_LIMIT;
      try {
        if (fresh) {
          loaded.push({ ...player, stats: JSON.parse(cachedStr!) });
          setTeamStats([...loaded]);
          await delay(120);
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

  const fetchFixture = async () => {
    const key = 'fixture_cache';
    const cached = localStorage.getItem(key), t = localStorage.getItem(`${key}_time`);
    if (cached && t && Date.now() - Number(t) < 30 * 60 * 1000) { setFixture(JSON.parse(cached)); return; }
    setFixtureLoading(true);
    try {
      const res = await fetch('/api/fixture'); const data = await res.json();
      if (!data.error) { setFixture(data); localStorage.setItem(key, JSON.stringify(data)); localStorage.setItem(`${key}_time`, String(Date.now())); }
    } catch { /* leave the empty state */ }
    setFixtureLoading(false);
  };

  const fetchScout = async (opponent: string, matchId: string, force = false) => {
    const cacheKey = `scout_${matchId}`;
    if (!force) {
      const cached = localStorage.getItem(cacheKey);
      if (cached) { setScoutData(JSON.parse(cached)); return; }
    }
    setScoutLoading(true);
    try {
      // Opponent names differ between providers; patch the ones we know.
      const MAP: Record<string, string> = { BIG: 'Berlin International Gaming', 'The Otter Side': 'Otter Side' };
      const lpTeam = MAP[opponent] ?? opponent;
      const byTeam = (t: string) => new URLSearchParams({
        action: 'cargoquery', tables: 'ScoreboardPlayers',
        fields: 'Champion,PlayerWin,DateTime_UTC,Tournament,Team,Name',
        where: `Team="${t}"`, order_by: 'DateTime_UTC DESC', limit: '75', format: 'json', origin: '*',
      });
      let res = await fetch(`https://lol.fandom.com/api.php?${byTeam(lpTeam)}`);
      let data = await res.json();
      if (!data.cargoquery?.length) {
        const first = lpTeam.split(' ')[0];
        const loose = new URLSearchParams({
          action: 'cargoquery', tables: 'ScoreboardPlayers',
          fields: 'Champion,PlayerWin,DateTime_UTC,Tournament,Team,Name',
          where: `Team LIKE "%${first}%"`, order_by: 'DateTime_UTC DESC', limit: '75', format: 'json', origin: '*',
        });
        res = await fetch(`https://lol.fandom.com/api.php?${loose}`); data = await res.json();
      }
      if (!data.cargoquery?.length) {
        setScoutData({ error: `No Leaguepedia data found for "${opponent}".`, opponent });
        setScoutLoading(false); return;
      }
      const pm: Record<string, any> = {};
      data.cargoquery.forEach((item: any) => {
        const m = item.title, name = m.Name || '?';
        if (!pm[name]) pm[name] = { name, champs: {}, games: 0, wins: 0 };
        pm[name].games++; if (m.PlayerWin === 'Yes') pm[name].wins++;
        if (m.Champion) {
          if (!pm[name].champs[m.Champion]) pm[name].champs[m.Champion] = { games: 0, wins: 0 };
          pm[name].champs[m.Champion].games++;
          if (m.PlayerWin === 'Yes') pm[name].champs[m.Champion].wins++;
        }
      });
      const players = Object.values(pm).map((p: any) => ({
        name: p.name, games: p.games, winRate: Math.round((p.wins / p.games) * 100),
        topChamps: Object.entries(p.champs)
          .map(([c, s]: any) => ({ name: c, games: s.games, winRate: Math.round((s.wins / s.games) * 100) }))
          .sort((a, b) => b.games - a.games).slice(0, 5),
      })).sort((a, b) => b.games - a.games);

      let recentMatches: any[] = [];
      try {
        const mp = new URLSearchParams({
          action: 'cargoquery', tables: 'ScoreboardPlayers=SP,PicksAndBansS7=PB',
          fields: ['SP.PlayerWin', 'SP.DateTime_UTC', 'SP.Tournament', 'SP.Team', 'SP.TeamVs', 'SP.Side', 'SP.GameId', 'PB.Team1Ban1', 'PB.Team1Ban2', 'PB.Team1Ban3', 'PB.Team1Ban4', 'PB.Team1Ban5', 'PB.Team2Ban1', 'PB.Team2Ban2', 'PB.Team2Ban3', 'PB.Team2Ban4', 'PB.Team2Ban5', 'PB.Team1Pick1', 'PB.Team1Pick2', 'PB.Team1Pick3', 'PB.Team1Pick4', 'PB.Team1Pick5', 'PB.Team2Pick1', 'PB.Team2Pick2', 'PB.Team2Pick3', 'PB.Team2Pick4', 'PB.Team2Pick5'].join(','),
          join_on: 'SP.GameId=PB.GameId', where: `SP.Team="${lpTeam}"`,
          order_by: 'SP.DateTime_UTC DESC', limit: '50', format: 'json', origin: '*',
        });
        const mr = await fetch(`https://lol.fandom.com/api.php?${mp}`); const md = await mr.json();
        if (md.cargoquery?.length > 0) {
          const gm: Record<string, any> = {};
          md.cargoquery.forEach((item: any) => {
            const m = item.title;
            const rd = (m['DateTime UTC'] ?? m['DateTime_UTC'] ?? '').split(' ')[0];
            const gid = m.GameId || `${m.TeamVs}_${rd}`;
            if (!gm[gid]) {
              const isBlue = m.Side === '1' || m.Side?.toLowerCase() === 'blue';
              gm[gid] = {
                id: gid, date: rd, tournament: m.Tournament || '', opponent: m.TeamVs || '?',
                result: m.PlayerWin === 'Yes' ? 'W' : 'L', teamIsBlue: isBlue,
                blueBans: [m.Team1Ban1, m.Team1Ban2, m.Team1Ban3, m.Team1Ban4, m.Team1Ban5].filter(Boolean),
                redBans: [m.Team2Ban1, m.Team2Ban2, m.Team2Ban3, m.Team2Ban4, m.Team2Ban5].filter(Boolean),
                bluePicks: [m.Team1Pick1, m.Team1Pick2, m.Team1Pick3, m.Team1Pick4, m.Team1Pick5].filter(Boolean),
                redPicks: [m.Team2Pick1, m.Team2Pick2, m.Team2Pick3, m.Team2Pick4, m.Team2Pick5].filter(Boolean),
              };
            }
          });
          recentMatches = Object.values(gm).sort((a: any, b: any) => b.date.localeCompare(a.date)).slice(0, 5);
        }
      } catch { /* drafts are optional */ }

      const result = { opponent, players, recentMatches, fetchedAt: Date.now() };
      localStorage.setItem(cacheKey, JSON.stringify(result));
      setScoutData(result);
    } catch {
      setScoutData({ error: 'Could not reach Leaguepedia. Try again in a moment.', opponent });
    }
    setScoutLoading(false);
  };

  // The opponent goes through the draft pipeline so it lands in Redis and
  // reaches the draft room over Pusher like any other change.
  const saveOpponent = async (name: string | null) => {
    setSavedOpp(name);
    try {
      await fetch('/api/draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'SET_OPPONENT', payload: { opponent: name ?? '' }, userName: coach?.name }),
      });
    } catch { /* the local view still updates */ }
  };
  const submitManualOpp = async () => {
    const name = manualOpp.trim(); if (!name) return;
    await saveOpponent(name); setManualOpp('');
    const m = { id: `manual_${name}`, opponent: name };
    setSelectedMatch(m); setScoutData(null); fetchScout(name, m.id);
  };
  const clearManualOpp = async () => {
    if (selectedMatch?.id === `manual_${savedOpp}`) { setSelectedMatch(null); setScoutData(null); }
    await saveOpponent(null);
  };

  const handleMatchClick = (match: any) => {
    if (selectedMatch?.id === match.id) { setSelectedMatch(null); setScoutData(null); return; }
    setSelectedMatch(match); setScoutData(null); fetchScout(match.opponent, match.id);
  };
  const openPlayer = (p: any) => {
    sessionStorage.setItem('viewingPlayer', JSON.stringify(p));
    router.push('/player');
  };

  useEffect(() => {
    const u = localStorage.getItem('currentUser');
    if (!u) { router.push('/'); return; }
    const p = JSON.parse(u);
    if (p.role !== 'coach') { router.push('/player'); return; }
    setCoach(p);
    fetchTeamData();
    fetchFixture();
    fetch('/api/draft').then(r => r.json()).then(d => { if (d?.opponent) setSavedOpp(d.opponent); }).catch(() => {});
    // Scout caches are large and go stale; drop anything older than a week.
    Object.keys(localStorage).filter(k => k.startsWith('scout_')).forEach(key => {
      try {
        const d = JSON.parse(localStorage.getItem(key) || '{}');
        if (d.fetchedAt && Date.now() - d.fetchedAt > 8 * 24 * 60 * 60 * 1000) localStorage.removeItem(key);
      } catch { localStorage.removeItem(key); }
    });
  }, [router]);

  const summary = useMemo(() => {
    const withStats = teamStats.filter(p => p.stats && !p.stats.error && p.stats.tier);
    const weekly = withStats.reduce((a, p) => a + (p.stats.weeklyGames || 0), 0);
    const under = withStats.filter(p => (p.stats.weeklyGames || 0) < WEEKLY_TARGET);
    const recent = withStats.map(p => parseInt(p.stats.recentWinRate)).filter(n => !isNaN(n));
    const tiers = withStats.map(p => (p.stats.tier || '').toUpperCase());
    const count = (t: string) => tiers.filter(x => x === t).length;
    const tierLine = ['CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND']
      .filter(t => count(t) > 0)
      .map(t => `${count(t)} ${t[0] + t.slice(1).toLowerCase()}`)
      .join(' · ');
    return {
      loaded: withStats.length,
      form: recent.length ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : null,
      weekly, under, tierLine,
      topTier: tiers.sort((a, b) => count(b) - count(a))[0] ?? 'UNRANKED',
    };
  }, [teamStats]);

  const nextMatch = useMemo(() => {
    const all = (fixture?.tournaments ?? []).flatMap((t: any) => t.matches);
    const upcoming = all.filter((m: any) => m.daysLeft !== null && m.daysLeft >= 0)
      .sort((a: any, b: any) => (a.daysLeft ?? 99) - (b.daysLeft ?? 99));
    return upcoming[0] ?? null;
  }, [fixture]);

  const teamPool = useMemo(() => {
    const pool: Record<string, { games: number; wins: number; players: Set<string> }> = {};
    teamStats.forEach(p => {
      (p.stats?.recentMatches ?? []).forEach((m: any) => {
        if (!m.champion) return;
        if (!pool[m.champion]) pool[m.champion] = { games: 0, wins: 0, players: new Set() };
        pool[m.champion].games++;
        pool[m.champion].players.add(p.name);
        if (isWin(m.result)) pool[m.champion].wins++;
      });
    });
    return Object.entries(pool)
      .map(([name, v]) => ({ name, games: v.games, winRate: Math.round((v.wins / v.games) * 100), players: [...v.players] }))
      .sort((a, b) => b.games - a.games).slice(0, 6);
  }, [teamStats]);

  const attention = useMemo(() => {
    const out: { icon: 'warning' | 'trend' | 'calendar'; color: string; title: string; body: string }[] = [];
    summary.under.forEach(p => out.push({
      icon: 'warning', color: 'var(--warn)',
      title: `${p.name} · ${p.stats.weeklyGames} games this week`,
      body: `Under the ${WEEKLY_TARGET}-game floor. Last 20 at ${p.stats.recentWinRate}.`,
    }));
    const best = [...teamStats].filter(p => p.stats?.recentWinRate)
      .sort((a, b) => parseInt(b.stats.recentWinRate) - parseInt(a.stats.recentWinRate))[0];
    if (best && parseInt(best.stats.recentWinRate) >= 60) out.push({
      icon: 'trend', color: 'var(--win)',
      title: `${best.name} · ${best.stats.recentWinRate} last 20`,
      body: `Best form on the roster, ${best.stats.weeklyGames} games this week.`,
    });
    if (!nextMatch) out.push({
      icon: 'calendar', color: 'var(--text-2)',
      title: 'No upcoming match listed',
      body: 'Nothing scheduled on PandaScore yet. Set the opponent by hand to start scouting.',
    });
    return out;
  }, [summary, teamStats, nextMatch]);

  if (!coach) {
    return <div className="hub" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span className="t3">Loading…</span>
    </div>;
  }

  const manualBlock = savedOpp ? [{
    id: 'manual', name: 'Manual opponent', serie: '', league: '',
    matches: [{ id: `manual_${savedOpp}`, opponent: savedOpp, date: 'No date', time: '—', daysLeft: null, matchType: '—', isPast: false, isLive: false }],
  }] : [];
  const tournaments = [...manualBlock, ...((fixture && !fixture.error && fixture.tournaments) || [])];

  return (
    <div className="hub">
      <Nav active="coach" user={coach} />

      <div className="page">
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <div className="h" style={{ fontSize: 32 }}>Coach panel</div>
            <div className="t2" style={{ marginTop: 4 }}>{TEAM_NAME} Esports · solo queue form and opponent preparation</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {loadingPlayerName ? <span className="t3" style={{ fontSize: 13 }}>Syncing {loadingPlayerName}…</span> : null}
            <button className="btn" onClick={() => fetchTeamData()} disabled={loading}>
              <Icon name="refresh" />
              Refresh
            </button>
          </div>
        </div>

        <div className="tabs">
          <button className={tab === 'roster' ? 'tab on' : 'tab'} onClick={() => setTab('roster')}>Roster</button>
          <button className={tab === 'fixture' ? 'tab on' : 'tab'} onClick={() => setTab('fixture')}>Schedule &amp; scouting</button>
        </div>

        {tab === 'roster' ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              <div className="card stat">
                <div className="sec sm">Team form · last 20 each</div>
                <div className="mono" style={{ fontSize: 32, fontWeight: 600 }}>{summary.form !== null ? `${summary.form}%` : '—'}</div>
                <div className="t3" style={{ fontSize: 13 }}>across {summary.loaded} players</div>
              </div>
              <div className="card stat">
                <div className="sec sm">Games this week</div>
                <div className="mono" style={{ fontSize: 32, fontWeight: 600 }}>{summary.weekly}</div>
                <div style={{ fontSize: 13, color: summary.under.length ? 'var(--warn)' : 'var(--text-3)' }}>
                  {summary.under.length ? `${summary.under.length} under target` : 'everyone on target'}
                </div>
              </div>
              <div className="card stat">
                <div className="sec sm">Average rank</div>
                <div className="h" style={{ fontSize: 28, color: RANK_COLOR[summary.topTier] ?? 'var(--text)' }}>
                  {summary.topTier ? summary.topTier[0] + summary.topTier.slice(1).toLowerCase() : '—'}
                </div>
                <div className="t3" style={{ fontSize: 13 }}>{summary.tierLine || '—'}</div>
              </div>
              <div className="card stat hl">
                <div className="sec sm">Next match</div>
                <div className="h" style={{ fontSize: 24 }}>{nextMatch ? nextMatch.opponent : 'Not scheduled yet'}</div>
                <div style={{ fontSize: 13 }}>
                  {nextMatch
                    ? <span className="t3">{nextMatch.date} · {dayLabel(nextMatch.daysLeft).label}</span>
                    : <button className="btn ghost sm" style={{ padding: 0, height: 'auto', color: 'var(--accent)' }} onClick={() => setTab('fixture')}>Set opponent to scout →</button>}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                <div className="h" style={{ fontSize: 24 }}>Roster</div>
                <div className="t3" style={{ fontSize: 13 }}>Click a player for the full breakdown</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
                {teamStats.map(p => {
                  const s = p.stats;
                  const weekly = s?.weeklyGames ?? 0;
                  const low = weekly < WEEKLY_TARGET;
                  const tier = (s?.tier || 'UNRANKED').toUpperCase();
                  const recentWr = parseInt(s?.recentWinRate);
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
                            <div className="mono" style={{ fontSize: 28, fontWeight: 600 }}>
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
                            {(s.championStats ?? []).slice(0, 3).map((c: any) => (
                              <img key={c.name} src={champImg(c.name)} className="champ" alt={c.name} title={`${c.name} · ${c.winRate}`} onError={(e: any) => { e.target.src = '/logo.png'; }} />
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

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 3fr) minmax(280px, 2fr)', gap: 16, alignItems: 'start' }}>
              <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                  <div className="h" style={{ fontSize: 24 }}>Team champion pool</div>
                  <div className="t3" style={{ fontSize: 13 }}>solo queue · last 20 per player</div>
                </div>
                {teamPool.length ? (
                  <>
                    <div className="thead" style={{ gridTemplateColumns: '44px 1fr 70px 130px 180px', padding: '0 4px 4px' }}>
                      <span /><span>Champion</span><span>Games</span><span>Played by</span><span>Win rate</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {teamPool.map(c => (
                        <div key={c.name} style={{ display: 'grid', gridTemplateColumns: '44px 1fr 70px 130px 180px', gap: 12, alignItems: 'center', padding: '0 4px' }}>
                          <img src={champImg(c.name)} className="champ" alt={c.name} onError={(e: any) => { e.target.src = '/logo.png'; }} />
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
                  </>
                ) : <div className="t3" style={{ fontSize: 13 }}>Waiting for solo queue data.</div>}
              </div>

              <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="h" style={{ fontSize: 24 }}>Attention</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {attention.map((a, i) => (
                    <div key={i} className="sunk" style={{ flexDirection: 'row', gap: 12, padding: '14px 16px' }}>
                      <span style={{ color: a.color, display: 'inline-flex', flex: 'none' }}><Icon name={a.icon} /></span>
                      <div>
                        <div style={{ fontWeight: 500 }}>{a.title}</div>
                        <div className="t2" style={{ fontSize: 13 }}>{a.body}</div>
                      </div>
                    </div>
                  ))}
                  {!attention.length ? <div className="t3" style={{ fontSize: 13 }}>Nothing needs attention right now.</div> : null}
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="card" style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 200 }}>
                <div style={{ fontWeight: 500 }}>Scout an opponent</div>
                <div className="t3" style={{ fontSize: 13 }}>Team name as written on Leaguepedia</div>
              </div>
              <div style={{ flex: 1, minWidth: 220, position: 'relative', display: 'flex', alignItems: 'center' }}>
                <span className="t3" style={{ position: 'absolute', left: 14, display: 'inline-flex', pointerEvents: 'none' }}><Icon name="search" /></span>
                <input
                  className="input"
                  style={{ paddingLeft: 42 }}
                  placeholder="e.g. Anubis Gaming"
                  value={manualOpp}
                  onChange={e => setManualOpp(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submitManualOpp(); }}
                />
              </div>
              <button className="btn primary" onClick={submitManualOpp}>Analyze</button>
              {savedOpp ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 8, borderLeft: '1px solid var(--border)' }}>
                  <span className="t3" style={{ fontSize: 13 }}>Current</span>
                  <button className="tag accent" style={{ height: 30, padding: '0 10px', fontSize: 13, gap: 8, border: 'none', cursor: 'pointer' }} onClick={clearManualOpp}>
                    {savedOpp}
                    <Icon name="x" size={14} />
                  </button>
                </div>
              ) : null}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 440px) minmax(320px, 1fr)', gap: 16, alignItems: 'start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {fixtureLoading ? <div className="card" style={{ padding: 20 }}><span className="t3">Loading schedule…</span></div> : null}
                {tournaments.length === 0 && !fixtureLoading ? (
                  <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontWeight: 500 }}>Nothing scheduled</div>
                    <div className="t2" style={{ fontSize: 13 }}>
                      No upcoming match is listed on PandaScore. Scouting does not wait for it — type an opponent above.
                    </div>
                  </div>
                ) : null}
                {tournaments.map((t: any) => (
                  <div key={t.id} className="card">
                    <div style={{ padding: '18px 16px 12px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                      <div className="h" style={{ fontSize: 20 }}>{t.name}</div>
                      <div className="t3" style={{ fontSize: 13 }}>{t.serie || t.league}</div>
                    </div>
                    {t.matches.map((m: any) => {
                      const d = dayLabel(m.daysLeft);
                      const sel = selectedMatch?.id === m.id;
                      return (
                        <button key={m.id} onClick={() => handleMatchClick(m)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', width: '100%',
                            borderTop: '1px solid var(--border)', background: sel ? '#12151B' : 'none',
                            border: 'none', borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'var(--border)',
                            textAlign: 'left', cursor: 'pointer',
                          }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontWeight: 500 }}>{m.opponent}</div>
                            <div className="t3" style={{ fontSize: 13 }}>{m.date}{m.matchType !== '—' ? ` · ${m.matchType}` : ''}</div>
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 500, color: d.color, textAlign: 'right' }}>{d.label}</span>
                          <span className={sel ? 'ic t2' : 'ic t3'}><Icon name={sel ? 'chevron-up' : 'chevron-down'} /></span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>

              <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
                {!selectedMatch ? (
                  <div style={{ padding: 40, textAlign: 'center' }} className="t3">
                    Pick a match on the left, or type an opponent above, to see their players and drafts.
                  </div>
                ) : (
                  <>
                    <div style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                      <div>
                        <div className="h" style={{ fontSize: 24 }}>{selectedMatch.opponent}</div>
                        <div className="t3" style={{ fontSize: 13 }}>
                          {scoutData?.players?.length ? `${scoutData.players[0].games} games on record` : 'Leaguepedia'}
                        </div>
                      </div>
                      <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => fetchScout(selectedMatch.opponent, selectedMatch.id, true)}>
                        <Icon name="refresh" />Refresh
                      </button>
                      <button className="btn primary" style={{ height: 40, fontSize: 14 }} onClick={() => router.push('/draft')}>Open in draft</button>
                    </div>

                    {scoutLoading ? (
                      <div style={{ padding: 40, textAlign: 'center' }} className="t3">Fetching…</div>
                    ) : scoutData?.error ? (
                      <div style={{ padding: 40, textAlign: 'center' }} className="t3">{scoutData.error}</div>
                    ) : scoutData?.players?.length ? (
                      <>
                        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                          <div className="sec">Players · recent games</div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                            {scoutData.players.slice(0, 5).map((pl: any) => (
                              <div key={pl.name} className="sunk" style={{ gap: 10 }}>
                                <div>
                                  <div style={{ fontWeight: 500 }}>{pl.name}</div>
                                  <div className="t3" style={{ fontSize: 12 }}>{pl.games} games</div>
                                </div>
                                <div className="mono" style={{ fontSize: 20, fontWeight: 600, color: pl.winRate >= 55 ? 'var(--win)' : pl.winRate < 45 ? 'var(--loss)' : 'var(--text)' }}>{pl.winRate}%</div>
                                <div className="row">
                                  {pl.topChamps.slice(0, 3).map((ch: any) => (
                                    <img key={ch.name} src={champImg(ch.name)} className="champ sm" alt={ch.name} title={`${ch.name} · ${ch.games} games · ${ch.winRate}%`} onError={(e: any) => { e.target.src = '/logo.png'; }} />
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {scoutData.recentMatches?.length ? (
                          <div style={{ padding: '8px 24px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div className="sec">Last {scoutData.recentMatches.length} games · drafts</div>
                            {scoutData.recentMatches.map((gm: any) => (
                              <div key={gm.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-ctl)', overflow: 'hidden' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--surface-2)', flexWrap: 'wrap' }}>
                                  <span className={gm.result === 'W' ? 'tag win' : 'tag loss'}>{gm.result === 'W' ? 'Win' : 'Loss'}</span>
                                  <span style={{ fontWeight: 500 }}>vs {gm.opponent}</span>
                                  <span className="t3" style={{ fontSize: 13 }}>{gm.tournament} · {gm.date}</span>
                                </div>
                                {(['blue', 'red'] as const).map(side => {
                                  const isTheirs = (side === 'blue') === gm.teamIsBlue;
                                  return (
                                    <div key={side} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
                                      <span className={side === 'blue' ? 'tag blue' : 'tag red'} style={{ width: 44, justifyContent: 'center' }}>{side === 'blue' ? 'Blue' : 'Red'}</span>
                                      <span style={{ fontWeight: 500, minWidth: 130 }}>{isTheirs ? selectedMatch.opponent : gm.opponent}</span>
                                      <span className="t3" style={{ fontSize: 12 }}>Bans</span>
                                      <div className="row">
                                        {(side === 'blue' ? gm.blueBans : gm.redBans).map((c: string, i: number) => (
                                          <img key={i} src={champImg(c)} className="champ ban" alt={c} title={c} onError={(e: any) => { e.target.src = '/logo.png'; }} />
                                        ))}
                                      </div>
                                      <span className="t3" style={{ fontSize: 12, marginLeft: 8 }}>Picks</span>
                                      <div className="row">
                                        {(side === 'blue' ? gm.bluePicks : gm.redPicks).map((c: string, i: number) => (
                                          <img key={i} src={champImg(c)} className="champ" alt={c} title={c} onError={(e: any) => { e.target.src = '/logo.png'; }} />
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <div style={{ padding: 40, textAlign: 'center' }} className="t3">No data.</div>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <style>{`
        .hub .pcard{padding:20px;display:flex;flex-direction:column;gap:16px;text-align:left;cursor:pointer;align-items:stretch;}
        .hub .pcard:hover{border-color:var(--border-strong);background:#191D25;}
        .hub .pcard.warn{border-color:rgba(251,191,36,0.4);}
        .hub .thead{display:grid;gap:12px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-3);}
        .hub .sunk{padding:14px 16px;border-radius:var(--r-ctl);background:var(--surface-sunken);border:1px solid var(--border);display:flex;flex-direction:column;gap:4px;}
        @media(max-width:1000px){
          .hub .page > div[style*="grid-template-columns: minmax"]{grid-template-columns:1fr !important;}
        }
      `}</style>
    </div>
  );
}
