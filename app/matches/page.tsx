'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TEAM_NAME, TEAM_LP_NAME } from '../../lib/team';
import { champImg } from '../../lib/champions';
import Nav from '../components/Nav';
import Icon from '../components/Icon';

const LP_CACHE_KEY = 'matches_lp_v4';
const LP_CACHE_DURATION = 60 * 60 * 1000;

function isFresh(key: string, duration: number) { const t = localStorage.getItem(`${key}_time`); return t ? Date.now() - Number(t) < duration : false; }
function saveCache(key: string, data: unknown) { localStorage.setItem(key, JSON.stringify(data)); localStorage.setItem(`${key}_time`, String(Date.now())); }
function loadCache(key: string) { const d = localStorage.getItem(key); return d ? JSON.parse(d) : null; }
function dayDiff(a: string, b: string) { return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / (1000 * 60 * 60 * 24); }

type Game = {
  id: string; date: string; tournament: string; opponent: string;
  blueTeam: string; redTeam: string; s2gBlue: boolean; result: 'W' | 'L';
  blueBans: string[]; redBans: string[]; bluePicks: string[]; redPicks: string[];
};
type Series = {
  id: string; date: string; tournament: string; opponent: string;
  wins: number; losses: number; result: 'W' | 'L'; games: Game[];
};

function parseCargoData(data: any): Series[] {
  const gameMap: Record<string, any> = {};
  data.cargoquery.forEach((item: any) => {
    const m = item.title; const rawDate = (m['DateTime UTC'] ?? m['DateTime_UTC'] ?? '').split(' ')[0];
    const isUs = m.Team === TEAM_LP_NAME; const opponent = isUs ? m.TeamVs : m.Team;
    const gid = m.GameId || `${opponent}_${rawDate}`;
    if (!gameMap[gid]) {
      const bluePlayer = m.Side === '1' || m.Side?.toLowerCase() === 'blue';
      const s2gBlue = isUs ? bluePlayer : !bluePlayer;
      gameMap[gid] = {
        id: gid, date: rawDate, tournament: m.Tournament || 'Arabian League', opponent,
        blueTeam: s2gBlue ? TEAM_NAME : opponent, redTeam: s2gBlue ? opponent : TEAM_NAME, s2gBlue,
        result: isUs ? (m.PlayerWin === 'Yes' ? 'W' : 'L') : (m.PlayerWin === 'Yes' ? 'L' : 'W'),
        blueBans: [m.Team1Ban1, m.Team1Ban2, m.Team1Ban3, m.Team1Ban4, m.Team1Ban5].filter(Boolean),
        redBans: [m.Team2Ban1, m.Team2Ban2, m.Team2Ban3, m.Team2Ban4, m.Team2Ban5].filter(Boolean),
        bluePicks: [m.Team1Pick1, m.Team1Pick2, m.Team1Pick3, m.Team1Pick4, m.Team1Pick5].filter(Boolean),
        redPicks: [m.Team2Pick1, m.Team2Pick2, m.Team2Pick3, m.Team2Pick4, m.Team2Pick5].filter(Boolean),
      };
    }
  });
  const games = Object.values(gameMap).sort((a: any, b: any) => b.date.localeCompare(a.date));
  const seriesArr: any[] = [];
  games.forEach((g: any) => {
    const ex = seriesArr.find(s => s.opponent === g.opponent && s.tournament === g.tournament && dayDiff(s.date, g.date) <= 3);
    if (ex) { ex.games.push(g); if (g.result === 'W') ex.wins++; else ex.losses++; ex.result = ex.wins > ex.losses ? 'W' : 'L'; }
    else seriesArr.push({ id: `s_${g.opponent}_${g.date}`, date: g.date, tournament: g.tournament, opponent: g.opponent, wins: g.result === 'W' ? 1 : 0, losses: g.result === 'L' ? 1 : 0, result: g.result, games: [g] });
  });
  seriesArr.forEach((s: any) => s.games.sort((a: any, b: any) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)));
  return seriesArr;
}

const fmtDate = (s: string) => {
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

function Champs({ names, kind }: { names: string[]; kind: 'ban' | 'pick' }) {
  if (!names.length) return <span className="t3" style={{ fontSize: 13 }}>—</span>;
  return (
    <div className="row">
      {names.map((c, i) => (
        <img key={c + i} src={champImg(c)} alt={c} title={c}
          className={kind === 'ban' ? 'champ ban' : 'champ'}
          onError={(e) => { (e.target as HTMLImageElement).src = '/logo.png'; }} />
      ))}
    </div>
  );
}

function DraftSide({ side, team, bans, picks }: { side: 'blue' | 'red'; team: string; bans: string[]; picks: string[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
      <span className={side === 'blue' ? 'tag blue' : 'tag red'} style={{ width: 44, justifyContent: 'center' }}>
        {side === 'blue' ? 'Blue' : 'Red'}
      </span>
      <span style={{ fontWeight: 500, minWidth: 140 }}>{team}</span>
      <span className="t3" style={{ fontSize: 12 }}>Bans</span>
      <Champs names={bans} kind="ban" />
      <span className="t3" style={{ fontSize: 12, marginLeft: 8 }}>Picks</span>
      <Champs names={picks} kind="pick" />
    </div>
  );
}

export default function MatchesPage() {
  const router = useRouter();
  const [series, setSeries] = useState<Series[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('All');
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    try { const u = localStorage.getItem('currentUser'); if (u) setUser(JSON.parse(u)); } catch { /* storage unavailable */ }
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      if (isFresh(LP_CACHE_KEY, LP_CACHE_DURATION)) {
        const c = loadCache(LP_CACHE_KEY);
        if (c?.length > 0) { setSeries(c); setLoading(false); return; }
      }
      try {
        const rr = await fetch('/api/data?type=matches'); const rd = await rr.json();
        if (rd.data?.cargoquery?.length > 0) { const p = parseCargoData(rd.data); saveCache(LP_CACHE_KEY, p); setSeries(p); setLoading(false); return; }
      } catch { /* fall through to Leaguepedia */ }
      try {
        const p = new URLSearchParams({
          action: 'cargoquery', tables: 'ScoreboardPlayers=SP,PicksAndBansS7=PB',
          fields: ['SP.PlayerWin', 'SP.DateTime_UTC', 'SP.Tournament', 'SP.Team', 'SP.TeamVs', 'SP.Side', 'SP.GameId', 'PB.Team1Ban1', 'PB.Team1Ban2', 'PB.Team1Ban3', 'PB.Team1Ban4', 'PB.Team1Ban5', 'PB.Team2Ban1', 'PB.Team2Ban2', 'PB.Team2Ban3', 'PB.Team2Ban4', 'PB.Team2Ban5', 'PB.Team1Pick1', 'PB.Team1Pick2', 'PB.Team1Pick3', 'PB.Team1Pick4', 'PB.Team1Pick5', 'PB.Team2Pick1', 'PB.Team2Pick2', 'PB.Team2Pick3', 'PB.Team2Pick4', 'PB.Team2Pick5'].join(','),
          join_on: 'SP.GameId=PB.GameId',
          where: `SP.Team='${TEAM_LP_NAME}' OR SP.TeamVs='${TEAM_LP_NAME}'`,
          order_by: 'SP.DateTime_UTC DESC', limit: '500', format: 'json', origin: '*',
        });
        const res = await fetch(`https://lol.fandom.com/api.php?${p}`); const data = await res.json();
        if (!data.cargoquery?.length) throw new Error('empty');
        const parsed = parseCargoData(data); saveCache(LP_CACHE_KEY, parsed); setSeries(parsed);
      } catch { /* leave the empty state */ }
      setLoading(false);
    };
    fetchData();
  }, []);

  const tournaments = useMemo(
    () => ['All', ...Array.from(new Set(series.map(s => s.tournament))).filter(Boolean)],
    [series],
  );
  const shown = useMemo(
    () => (filter === 'All' ? series : series.filter(s => s.tournament === filter)),
    [series, filter],
  );

  const stats = useMemo(() => {
    const games = shown.flatMap(s => s.games);
    const wins = games.filter(g => g.result === 'W').length;
    const blue = games.filter(g => g.s2gBlue);
    const red = games.filter(g => !g.s2gBlue);
    const pct = (w: number, n: number) => (n > 0 ? Math.round((w / n) * 100) : 0);
    return {
      seriesW: shown.filter(s => s.result === 'W').length,
      seriesL: shown.filter(s => s.result === 'L').length,
      gamesW: wins, gamesL: games.length - wins, gameWr: pct(wins, games.length),
      blueWr: pct(blue.filter(g => g.result === 'W').length, blue.length),
      blueW: blue.filter(g => g.result === 'W').length, blueL: blue.filter(g => g.result === 'L').length,
      redWr: pct(red.filter(g => g.result === 'W').length, red.length),
      redW: red.filter(g => g.result === 'W').length, redL: red.filter(g => g.result === 'L').length,
      seriesWr: pct(shown.filter(s => s.result === 'W').length, shown.length),
    };
  }, [shown]);

  return (
    <div className="hub">
      <Nav active="matches" user={user} />

      <div className="page">
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <div className="h" style={{ fontSize: 32 }}>Match history</div>
            <div className="t2" style={{ marginTop: 4 }}>{TEAM_NAME} Esports · official games</div>
          </div>
          {tournaments.length > 1 ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {tournaments.map(t => (
                <button key={t} className={filter === t ? 'chip on' : 'chip'} onClick={() => { setFilter(t); setExpanded(null); }}>{t}</button>
              ))}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <div className="card stat">
            <div className="sec sm">Series</div>
            <div className="mono" style={{ fontSize: 32, fontWeight: 600 }}>{stats.seriesW}<span className="t3">–</span>{stats.seriesL}</div>
            <div className="t3" style={{ fontSize: 13 }}>{stats.seriesWr}% series win rate</div>
          </div>
          <div className="card stat">
            <div className="sec sm">Games</div>
            <div className="mono" style={{ fontSize: 32, fontWeight: 600 }}>{stats.gamesW}<span className="t3">–</span>{stats.gamesL}</div>
            <div className="t3" style={{ fontSize: 13 }}>{stats.gameWr}% game win rate</div>
          </div>
          <div className="card stat">
            <div className="sec sm">Blue side</div>
            <div className="mono" style={{ fontSize: 32, fontWeight: 600, color: 'var(--blue-side)' }}>{stats.blueWr}%</div>
            <div className="t3" style={{ fontSize: 13 }}>{stats.blueW}–{stats.blueL}</div>
          </div>
          <div className="card stat">
            <div className="sec sm">Red side</div>
            <div className="mono" style={{ fontSize: 32, fontWeight: 600, color: 'var(--red-side)' }}>{stats.redWr}%</div>
            <div className="t3" style={{ fontSize: 13 }}>{stats.redW}–{stats.redL}</div>
          </div>
        </div>

        {loading ? (
          <div className="t3" style={{ textAlign: 'center', padding: '50px 20px' }}>Fetching match history…</div>
        ) : shown.length === 0 ? (
          <div className="t3" style={{ textAlign: 'center', padding: '50px 20px' }}>No official games on record yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {shown.map(s => {
              const isOpen = expanded === s.id;
              return (
                <div key={s.id} className={isOpen ? 'card hl' : 'card'}>
                  <button className="srow" onClick={() => setExpanded(p => (p === s.id ? null : s.id))}>
                    <span className="t3" style={{ fontSize: 13 }}>{fmtDate(s.date)}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
                      <span className="h" style={{ fontSize: 20 }}>{TEAM_NAME}</span>
                      <span className={s.result === 'W' ? 'tag win' : 'tag loss'}>{s.result === 'W' ? 'Win' : 'Loss'}</span>
                    </div>
                    <div className="mono h" style={{ fontSize: 28, textAlign: 'center' }}>
                      {s.wins}<span className="t3"> – </span>{s.losses}
                    </div>
                    <div className="h t2" style={{ fontSize: 20 }}>{s.opponent}</div>
                    <span className="t3" style={{ fontSize: 13 }}>{s.tournament}</span>
                    <span className={isOpen ? 'ic t2' : 'ic t3'} style={{ justifySelf: 'end' }}>
                      <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} />
                    </span>
                  </button>

                  {isOpen ? (
                    <div style={{ borderTop: '1px solid var(--border)', background: '#121519' }}>
                      {s.games.map((g, i) => (
                        <div key={g.id}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderTop: i === 0 ? 'none' : '1px solid var(--border)', flexWrap: 'wrap' }}>
                            <span className="tag neutral">Game {i + 1}</span>
                            <span className={g.result === 'W' ? 'tag win' : 'tag loss'}>{g.result === 'W' ? 'Win' : 'Loss'}</span>
                            <span className="t3" style={{ fontSize: 13 }}>{TEAM_NAME} on {g.s2gBlue ? 'blue' : 'red'}</span>
                          </div>
                          <DraftSide side="blue" team={g.blueTeam} bans={g.blueBans} picks={g.bluePicks} />
                          <DraftSide side="red" team={g.redTeam} bans={g.redBans} picks={g.redPicks} />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        .hub .srow{display:grid;grid-template-columns:110px 1fr 120px 1fr 200px 40px;gap:16px;align-items:center;padding:16px 20px;width:100%;background:none;border:none;text-align:left;cursor:pointer;}
        .hub .srow:hover{background:#12151B;}
        @media(max-width:900px){
          .hub .srow{grid-template-columns:1fr auto 1fr 40px;}
          .hub .srow > span:first-child{grid-column:1/-1;}
          .hub .srow > span:nth-last-child(2){display:none;}
        }
      `}</style>
    </div>
  );
}
