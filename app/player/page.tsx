'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TEAM_LP_NAME } from '../../lib/team';
import { champImg } from '../../lib/champions';
import Nav from '../components/Nav';
import Icon from '../components/Icon';

const CACHE = { riot: 60 * 60 * 1000, pro: 30 * 60 * 1000, lp: 6 * 60 * 60 * 1000 };

const RANK_COLOR: Record<string, string> = {
  IRON: '#5C6577', BRONZE: '#CD7F32', SILVER: '#9AA3B2', GOLD: '#F5C542',
  PLATINUM: '#2DD4BF', EMERALD: '#34D399', DIAMOND: '#60A5FA',
  MASTER: 'var(--rank-master)', GRANDMASTER: 'var(--rank-grandmaster)',
  CHALLENGER: 'var(--rank-challenger)', UNRANKED: '#5C6577',
};

function isFresh(key: string, dur: number) { const t = localStorage.getItem(`${key}_time`); return t ? Date.now() - Number(t) < dur : false; }
function saveCache(key: string, data: unknown) { localStorage.setItem(key, JSON.stringify(data)); localStorage.setItem(`${key}_time`, String(Date.now())); }
function loadCache(key: string) { const d = localStorage.getItem(key); return d ? JSON.parse(d) : null; }

// Records synced before the locale-free change still carry Turkish strings.
const isWin = (r: string) => r === 'W' || r === 'Galibiyet';
const matchDate = (m: any) => {
  if (m.playedAt) {
    const d = new Date(m.playedAt);
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  return m.time ?? '—';
};
const matchLength = (m: any) => (m.durationMin ? `${m.durationMin}m` : (m.duration ?? '—'));

function initials(name?: string) {
  if (!name) return '?';
  const p = name.trim().split(/\s+/);
  return (p.length > 1 ? p[0][0] + p[1][0] : name.slice(0, 2)).toUpperCase();
}

function Stat({ label, value, sub, color }: { label: string; value: React.ReactNode; sub?: string; color?: string }) {
  return (
    <div className="card stat">
      <div className="sec sm">{label}</div>
      <div className="mono" style={{ fontSize: 22, fontWeight: 600, color }}>{value}</div>
      {sub ? <div className="t3" style={{ fontSize: 13 }}>{sub}</div> : null}
    </div>
  );
}

function WrBar({ pct }: { pct: number }) {
  const color = pct >= 60 ? 'var(--win)' : pct >= 50 ? 'var(--win)' : pct >= 45 ? 'var(--text-2)' : 'var(--loss)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="bar" style={{ flex: 1 }}><span style={{ width: `${pct}%`, background: color }} /></div>
      <span className="mono" style={{ width: 40, textAlign: 'right', fontSize: 13 }}>{pct}%</span>
    </div>
  );
}

export default function PlayerDashboard() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [actualRole, setActualRole] = useState<string | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [proStats, setProStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async (parsedUser: any) => {
    setLoading(true);
    const riotKey = `riot_${parsedUser.name}`, proKey = `pro_${parsedUser.name}`, lpKey = `lp_${parsedUser.name}`;
    try {
      let riotData = null;
      if (isFresh(riotKey, CACHE.riot)) riotData = loadCache(riotKey);
      else {
        try {
          const res = await fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName: parsedUser.name }) });
          riotData = await res.json();
          if (!riotData.error) saveCache(riotKey, riotData);
        } catch { riotData = loadCache(riotKey); }
      }
      setStats(riotData);

      let proData = null;
      if (isFresh(proKey, CACHE.pro)) proData = loadCache(proKey);
      else {
        try {
          const res = await fetch('/api/pro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName: parsedUser.name }) });
          proData = await res.json(); saveCache(proKey, proData);
        } catch { proData = loadCache(proKey); }
      }

      let lpData = null;
      if (isFresh(lpKey, CACHE.lp)) lpData = loadCache(lpKey);
      else {
        try {
          const r = await fetch(`/api/data?type=lp&player=${parsedUser.name}`); const d = await r.json();
          if (d.data?.cargoquery?.length > 0) { lpData = d.data; saveCache(lpKey, lpData); } else throw new Error('empty');
        } catch {
          try {
            const q = new URLSearchParams({
              action: 'cargoquery', tables: 'ScoreboardPlayers',
              fields: 'Champion,Kills,Deaths,Assists,PlayerWin,DateTime_UTC,Tournament,Team,TeamVs,CS,Gold,Side',
              where: `Name='${parsedUser.lpName ?? parsedUser.name}' AND Team='${TEAM_LP_NAME}'`,
              order_by: 'DateTime_UTC DESC', limit: '50', format: 'json', origin: '*',
            });
            const res = await fetch(`https://lol.fandom.com/api.php?${q}`); lpData = await res.json();
            if (lpData.cargoquery?.length > 0) saveCache(lpKey, lpData);
          } catch { lpData = loadCache(lpKey); }
        }
      }

      if (lpData?.cargoquery?.length > 0) {
        const rows = lpData.cargoquery.map((x: any) => x.title);
        let tK = 0, tD = 0, tA = 0, tW = 0, tCS = 0, csG = 0;
        const champs: Record<string, any> = {};
        const recent: any[] = [];
        rows.forEach((m: any) => {
          const k = Number(m.Kills) || 0, d = Number(m.Deaths) || 0, a = Number(m.Assists) || 0;
          const win = m.PlayerWin === 'Yes', cs = Number(m.CS) || 0;
          tK += k; tD += d; tA += a; if (win) tW++;
          if (cs > 0) { tCS += cs; csG++; }
          const c = m.Champion || '—';
          if (!champs[c]) champs[c] = { name: c, games: 0, wins: 0, k: 0, d: 0, a: 0 };
          champs[c].games++; champs[c].k += k; champs[c].d += d; champs[c].a += a; if (win) champs[c].wins++;
          recent.push({
            champion: c, win, kda: `${k}/${d}/${a}`,
            opponent: m.TeamVs || '—', tournament: m.Tournament || '',
            date: (m['DateTime UTC'] ?? m.DateTime_UTC ?? '').split(' ')[0],
          });
        });
        setProStats({
          ...proData,
          totalProGames: rows.length,
          overallKda: ((tK + tA) / (tD || 1)).toFixed(2),
          avgLine: `${(tK / rows.length).toFixed(1)} / ${(tD / rows.length).toFixed(1)} / ${(tA / rows.length).toFixed(1)}`,
          overallWinRate: Math.round((tW / rows.length) * 100),
          wins: tW, losses: rows.length - tW,
          avgProCsPerGame: csG > 0 ? Math.round(tCS / csG) : 0,
          proChampionStats: Object.values(champs)
            .map((c: any) => ({ name: c.name, games: c.games, winRate: Math.round((c.wins / c.games) * 100), kda: ((c.k + c.a) / (c.d || 1)).toFixed(2) }))
            .sort((a: any, b: any) => b.games - a.games),
          recentPro: recent.slice(0, 6),
        });
      } else {
        setProStats(proData);
      }
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  useEffect(() => {
    const u = localStorage.getItem('currentUser');
    if (!u) { router.push('/'); return; }
    const parsed = JSON.parse(u);
    setActualRole(parsed.role);
    // A coach clicking into a player views that player's dashboard.
    const viewing = sessionStorage.getItem('viewingPlayer');
    const target = viewing ? JSON.parse(viewing) : parsed;
    setUser(target);
    fetchData(target);
  }, [router]);

  const form = useMemo(() => {
    const rm: any[] = stats?.recentMatches ?? [];
    if (!rm.length) return null;
    const wins = rm.filter(m => isWin(m.result)).length;
    const k = rm.reduce((a, m) => a + (m.kills || 0), 0);
    const d = rm.reduce((a, m) => a + (m.deaths || 0), 0);
    const a2 = rm.reduce((a, m) => a + (m.assists || 0), 0);
    const cs = rm.reduce((a, m) => a + Number(m.csPerMin || 0), 0);
    return {
      games: rm.length, wins, losses: rm.length - wins,
      wr: Math.round((wins / rm.length) * 100),
      kda: ((k + a2) / (d || 1)).toFixed(1),
      csMin: (cs / rm.length).toFixed(1),
      // Oldest first so the row reads left-to-right in time order.
      bars: [...rm].reverse(),
    };
  }, [stats]);

  if (!user) {
    return <div className="hub" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span className="t3">Loading…</span>
    </div>;
  }

  const tier = (stats?.tier || 'UNRANKED').toUpperCase();
  const rankColor = RANK_COLOR[tier] ?? 'var(--text-2)';
  const viewingOther = actualRole === 'coach';

  return (
    <div className="hub">
      <Nav active="home" user={{ name: user.name, role: actualRole ?? user.role, image: user.image }} />

      <div className="page">
        {viewingOther ? (
          <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }}
            onClick={() => { sessionStorage.removeItem('viewingPlayer'); router.push('/coach'); }}>
            <Icon name="arrow-left" />
            Back to coach panel
          </button>
        ) : null}

        <div className="card" style={{ padding: '20px 22px', display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
          <span className="avatar" style={{ width: 88, height: 88, fontSize: 30 }}>
            {user.image && user.image !== '/logo.png' ? <img src={user.image} alt="" /> : initials(user.name)}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div className="h" style={{ fontSize: 40 }}>{user.name}</div>
              {user.lane ? <span className="tag neutral" style={{ height: 26, fontSize: 13, textTransform: 'capitalize' }}>{user.lane}</span> : null}
            </div>
            <div className="t2 mono" style={{ fontSize: 14 }}>{user.riotId ?? '—'}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
              {stats?.streak?.count ? (
                <span className={stats.streak.type === 'W' ? 'tag win' : 'tag loss'}>
                  {stats.streak.count} {stats.streak.type === 'W' ? 'win' : 'loss'} streak
                </span>
              ) : null}
              {stats?._updatedAt ? (
                <span className="tag neutral">Synced {new Date(stats._updatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              ) : null}
            </div>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 40, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div className="sec sm">Solo queue</div>
              <div className="h" style={{ fontSize: 28, color: rankColor }}>{stats?.rank ?? '—'}</div>
              <div className="mono" style={{ fontSize: 26, fontWeight: 600 }}>
                {stats?.lp ?? 0} <span className="t3" style={{ fontSize: 15, fontWeight: 500 }}>LP</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div className="sec sm">Season</div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 600 }}>
                {stats?.wins ?? 0}<span className="t3">–</span>{stats?.losses ?? 0}
              </div>
              <div className="t2" style={{ fontSize: 14 }}>{stats?.overallWinRate ?? '—'} win rate</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div className="sec sm">This week</div>
              <div className="mono" style={{ fontSize: 22, fontWeight: 600 }}>
                {stats?.weeklyGames ?? 0} <span className="t3" style={{ fontSize: 15, fontWeight: 500 }}>games</span>
              </div>
              <div className="t2" style={{ fontSize: 14 }}>
                {stats?.weeklyWins ?? 0}–{(stats?.weeklyGames ?? 0) - (stats?.weeklyWins ?? 0)} · {stats?.weeklyWinRate ?? '—'}
              </div>
            </div>
          </div>
        </div>

        {loading ? <div className="t3" style={{ textAlign: 'center', padding: 40 }}>Loading solo queue data…</div> : null}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 2fr) minmax(320px, 3fr)', gap: 16 }}>
          <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
              <div className="h" style={{ fontSize: 20 }}>Form</div>
              <div className="t3" style={{ fontSize: 13 }}>last {form?.games ?? 0} ranked · newest right</div>
            </div>
            <div style={{ display: 'flex', gap: 5, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              {(form?.bars ?? []).map((m: any, i: number) => (
                <span key={i} title={`${m.champion} · ${m.kda}`}
                  style={{ width: 14, height: 28, borderRadius: 3, background: isWin(m.result) ? 'var(--win)' : 'var(--loss)' }} />
              ))}
              {!form ? <span className="t3" style={{ fontSize: 13 }}>No games synced yet.</span> : null}
            </div>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div><div className="mono" style={{ fontSize: 24, fontWeight: 600 }}>{form?.wr ?? 0}%</div><div className="t3" style={{ fontSize: 13 }}>{form?.wins ?? 0} W · {form?.losses ?? 0} L</div></div>
              <div><div className="mono" style={{ fontSize: 24, fontWeight: 600 }}>{form?.kda ?? '—'}</div><div className="t3" style={{ fontSize: 13 }}>KDA</div></div>
              <div><div className="mono" style={{ fontSize: 24, fontWeight: 600 }}>{form?.csMin ?? '—'}</div><div className="t3" style={{ fontSize: 13 }}>CS / min</div></div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <Stat label="Gold @15" sub="vs lane opponent"
              value={(stats?.avgGoldDiff15 ?? 0) > 0 ? `+${stats.avgGoldDiff15}` : (stats?.avgGoldDiff15 ?? 0)}
              color={(stats?.avgGoldDiff15 ?? 0) >= 0 ? 'var(--win)' : 'var(--loss)'} />
            <Stat label="CS @15" sub="vs lane opponent"
              value={Number(stats?.avgCsDiff15 ?? 0) > 0 ? `+${stats.avgCsDiff15}` : (stats?.avgCsDiff15 ?? '0')}
              color={Number(stats?.avgCsDiff15 ?? 0) >= 0 ? 'var(--win)' : 'var(--loss)'} />
            <Stat label="Wards / game" value={stats?.avgWardsPlaced ?? '—'}
              sub={`${stats?.avgControlWards ?? 0} control · ${stats?.avgWardsKilled ?? 0} cleared`} />
            <Stat label="Dragons / game" value={stats?.avgDragons ?? '—'} sub="team objective" />
            <Stat label="Barons / game" value={stats?.avgBarons ?? '—'} sub="team objective" />
            <Stat label="Multi kills"
              value={<>{stats?.multiKills?.doubles ?? 0} <span className="t3" style={{ fontSize: 14, fontWeight: 500 }}>· {stats?.multiKills?.triples ?? 0} · {stats?.multiKills?.quadras ?? 0} · {stats?.multiKills?.pentas ?? 0}</span></>}
              sub="double · triple · quadra · penta" />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 2fr) minmax(340px, 3fr)', gap: 12, alignItems: 'start' }}>
          <div className="card">
            <div style={{ padding: '14px 18px 10px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div className="h" style={{ fontSize: 20 }}>Champion pool</div>
              <div className="t3" style={{ fontSize: 13 }}>last 20</div>
            </div>
            <div className="thead" style={{ gridTemplateColumns: '44px 1fr 60px 60px 110px', padding: '0 24px 8px' }}>
              <span /><span>Champion</span><span>Games</span><span>KDA</span><span>Win rate</span>
            </div>
            {(stats?.championStats ?? []).slice(0, 6).map((c: any) => (
              <div key={c.name} className="trow" style={{ gridTemplateColumns: '44px 1fr 60px 60px 110px', padding: '10px 24px' }}>
                <img src={champImg(c.name)} className="champ" alt={c.name} onError={(e: any) => { e.target.src = '/logo.png'; }} />
                <span style={{ fontWeight: 500 }}>{c.name}</span>
                <span className="mono">{c.games}</span>
                <span className="mono">{c.kda}</span>
                <WrBar pct={parseInt(c.winRate)} />
              </div>
            ))}
            {!stats?.championStats?.length ? <div className="t3" style={{ padding: '0 24px 20px', fontSize: 13 }}>No games synced yet.</div> : null}
          </div>

          <div className="card">
            <div style={{ padding: '14px 18px 10px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div className="h" style={{ fontSize: 20 }}>Recent games</div>
              <div className="t3" style={{ fontSize: 13 }}>ranked solo</div>
            </div>
            <div className="thead" style={{ gridTemplateColumns: '44px 1fr 80px 70px 60px 90px' }}>
              <span /><span>Champion</span><span>KDA</span><span>CS/min</span><span>Length</span><span>When</span>
            </div>
            {(stats?.recentMatches ?? []).slice(0, 7).map((m: any, i: number) => (
              <div key={m.id ?? i} className="trow" style={{ gridTemplateColumns: '44px 1fr 80px 70px 60px 90px' }}>
                <img src={champImg(m.champion)} className="champ" alt={m.champion} onError={(e: any) => { e.target.src = '/logo.png'; }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span style={{ fontWeight: 500 }}>{m.champion}</span>
                  <span className={isWin(m.result) ? 'tag win' : 'tag loss'}>{isWin(m.result) ? 'Win' : 'Loss'}</span>
                </div>
                <span className="mono">{m.kills}/{m.deaths}/{m.assists}</span>
                <span className="mono">{m.csPerMin}</span>
                <span className="mono t2">{matchLength(m)}</span>
                <span className="t3" style={{ fontSize: 13 }}>{matchDate(m)}</span>
              </div>
            ))}
            {!stats?.recentMatches?.length ? <div className="t3" style={{ padding: '0 16px 20px', fontSize: 13 }}>No games synced yet.</div> : null}
          </div>
        </div>

        <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div className="h" style={{ fontSize: 20 }}>Pro stage</div>
              <div className="t2" style={{ fontSize: 13 }}>Official games · from Leaguepedia</div>
            </div>
            <div className="t3" style={{ fontSize: 13 }}>{proStats?.totalProGames ?? 0} games on record</div>
          </div>

          {proStats?.totalProGames ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
                <div className="sunk"><div className="sec sm">Win rate</div><div className="mono" style={{ fontSize: 22, fontWeight: 600 }}>{proStats.overallWinRate}%</div><div className="t3" style={{ fontSize: 13 }}>{proStats.wins}–{proStats.losses}</div></div>
                <div className="sunk"><div className="sec sm">KDA</div><div className="mono" style={{ fontSize: 22, fontWeight: 600 }}>{proStats.overallKda}</div><div className="t3" style={{ fontSize: 13 }}>{proStats.avgLine}</div></div>
                <div className="sunk"><div className="sec sm">CS / game</div><div className="mono" style={{ fontSize: 22, fontWeight: 600 }}>{proStats.avgProCsPerGame}</div><div className="t3" style={{ fontSize: 13 }}>across {proStats.totalProGames} games</div></div>
                <div className="sunk" style={{ gap: 10 }}>
                  <div className="sec sm">Most played on stage</div>
                  <div className="row">
                    {(proStats.proChampionStats ?? []).slice(0, 5).map((c: any) => (
                      <img key={c.name} src={champImg(c.name)} className="champ" alt={c.name} title={`${c.name} · ${c.games} games · ${c.winRate}%`} onError={(e: any) => { e.target.src = '/logo.png'; }} />
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <div className="thead" style={{ gridTemplateColumns: '44px 1fr 1fr 90px 90px' }}>
                  <span /><span>Champion</span><span>Opponent</span><span>KDA</span><span>Date</span>
                </div>
                {(proStats.recentPro ?? []).map((m: any, i: number) => (
                  <div key={i} className="trow" style={{ gridTemplateColumns: '44px 1fr 1fr 90px 90px' }}>
                    <img src={champImg(m.champion)} className="champ" alt={m.champion} onError={(e: any) => { e.target.src = '/logo.png'; }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <span style={{ fontWeight: 500 }}>{m.champion}</span>
                      <span className={m.win ? 'tag win' : 'tag loss'}>{m.win ? 'Win' : 'Loss'}</span>
                    </div>
                    <span className="t2" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.opponent}{m.tournament ? ` · ${m.tournament}` : ''}</span>
                    <span className="mono">{m.kda}</span>
                    <span className="t3" style={{ fontSize: 13 }}>{m.date}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="t3" style={{ fontSize: 13 }}>No official games on record for this player yet.</div>
          )}
        </div>
      </div>

      <style>{`
        .hub .thead{display:grid;gap:12px;padding:0 16px 8px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-3);}
        .hub .trow{display:grid;gap:12px;align-items:center;padding:10px 16px;border-top:1px solid var(--border);}
        .hub .sunk{padding:16px 18px;border-radius:var(--r-ctl);background:var(--surface-sunken);border:1px solid var(--border);display:flex;flex-direction:column;gap:4px;}
        @media(max-width:1100px){
          .hub .page > div[style*="grid-template-columns: minmax"]{grid-template-columns:1fr !important;}
        }
      `}</style>
    </div>
  );
}
