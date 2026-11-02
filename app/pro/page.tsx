'use client';

// Public page — no login check, deliberately.
// Data comes from Redis via /api/pro-vods; visitors never hit Leaguepedia,
// whose rate limit is per-IP and would be exhausted by anonymous traffic.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { champImg } from '../../lib/champions';
import { TEAM_NAME } from '../../lib/team';
import Nav from '../components/Nav';
import Icon from '../components/Icon';

type Vod = { url: string; embed: string | null; kind: string; start: number | null };
type Game = {
  gameId: string; matchId: string; date: string; gameInMatch: number | null;
  blueTeam: string; redTeam: string; winner: string | null; blueWon: boolean;
  vod: Vod | null; vodDraft: Vod | null; vodHighlights: Vod | null;
  draft: { blueBans: string[]; redBans: string[]; bluePicks: string[]; redPicks: string[] };
};
type Series = {
  matchId: string; date: string; tournament: string;
  teamA: string; teamB: string; scoreA: number; scoreB: number;
  winner: string | null; gamesPlayed: number; games: Game[];
};
type Ranked = { name: string; n: number; pct?: number };
type PatchMeta = {
  patches: string[]; widened: boolean; games: number;
  picked: Ranked[]; banned: Ranked[]; firstPick: Ranked[]; lastPick: Ranked[]; presence: Ranked[];
};
type League = {
  league: string; tournament: string; updatedAt: string;
  meta?: PatchMeta | null;
  series: Series[];
};

/**
 * What the patch currently looks like in this league, built from the same
 * games the series below are, so it costs no extra Leaguepedia query.
 *
 * Per league on purpose: the regions are rarely on the same patch — Worlds was
 * on 26.20 while LEC sat on 26.17 — and averaging across them would describe a
 * meta nobody actually played.
 */
function MetaStrip({ meta }: { meta: PatchMeta }) {
  const cols: { title: string; hint: string; items: Ranked[]; ban?: boolean }[] = [
    { title: 'Most picked', hint: 'games picked', items: meta.picked },
    { title: 'Most banned', hint: 'games banned', items: meta.banned, ban: true },
    { title: 'First pick', hint: 'blue B1, taken blind', items: meta.firstPick },
    { title: 'Last pick', hint: 'red R5, sees the whole draft', items: meta.lastPick },
    { title: 'Presence', hint: 'picked or banned', items: meta.presence },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <div className="h" style={{ fontSize: 18 }}>Patch {meta.patches.join(' + ')}</div>
        <span className="t3" style={{ fontSize: 13 }}>{meta.games} games</span>
        {meta.widened ? (
          <span className="tag warn" title="The newest patch alone had too few games to read">
            widened to {meta.patches.length} patches
          </span>
        ) : null}
      </div>
      <div className="metagrid">
        {cols.map(c => (
          <div key={c.title} className="card metacol">
            <div>
              <div className="sec sm">{c.title}</div>
              <div className="t3" style={{ fontSize: 11 }}>{c.hint}</div>
            </div>
            {!c.items.length ? <span className="t3" style={{ fontSize: 12 }}>No data</span> : c.items.slice(0, 7).map(x => (
              <div key={x.name} className="metarow" title={`${x.name} — ${x.n} games`}>
                <img src={champImg(x.name)} alt="" className={c.ban ? 'champ sm ban' : 'champ sm'}
                  style={{ width: 26, height: 26 }}
                  onError={e => { (e.target as HTMLImageElement).src = '/logo.png'; }} />
                <span className="nm">{x.name}</span>
                <span className="mono t2" style={{ fontSize: 12 }}>{x.pct !== undefined ? `${x.pct}%` : x.n}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const fmtDate = (s: string) => {
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

const fmtOffset = (sec: number | null) => {
  if (!sec) return null;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${h ? h + ':' : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`;
};

// localStorage can't be read during render (the server can't see it) and
// setting state in an effect triggers cascading renders; this gives the server
// a null snapshot and the client the real value.
function getStoredUser(): string | null {
  try { return localStorage.getItem('currentUser'); } catch { return null; }
}
function subscribeToUser(onChange: () => void) {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

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
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
      borderTop: '1px solid var(--border)', flexWrap: 'wrap',
    }}>
      <span className={side === 'blue' ? 'tag blue' : 'tag red'} style={{ width: 44, justifyContent: 'center' }}>
        {side === 'blue' ? 'Blue' : 'Red'}
      </span>
      <span style={{ fontWeight: 500, minWidth: 150 }}>{team}</span>
      <span className="t3" style={{ fontSize: 12 }}>Bans</span>
      <Champs names={bans} kind="ban" />
      <span className="t3" style={{ fontSize: 12, marginLeft: 8 }}>Picks</span>
      <Champs names={picks} kind="pick" />
    </div>
  );
}

function GameBlock({ g }: { g: Game }) {
  // The iframe mounts on click — a five-game series would otherwise load five
  // videos the moment it is expanded.
  const [open, setOpen] = useState(false);
  const v = g.vodDraft ?? g.vod;
  const at = fmtOffset(v?.start ?? null);

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
        borderTop: '1px solid var(--border)', flexWrap: 'wrap',
      }}>
        <span className="tag neutral">Game {g.gameInMatch ?? '?'}</span>
        {g.winner ? (
          <>
            <span style={{ fontWeight: 500 }}>{g.winner}</span>
            <span className="t3" style={{ fontSize: 13 }}>won · {g.blueTeam} on blue</span>
          </>
        ) : (
          <span className="t3" style={{ fontSize: 13 }}>{g.blueTeam} on blue</span>
        )}
        <button className="btn sm" style={{ marginLeft: 'auto' }} disabled={!v?.embed}
          onClick={() => setOpen(o => !o)}>
          <Icon name={open ? 'chevron-up' : 'play'} />
          {!v?.embed ? 'No video' : open ? 'Hide draft video' : 'Watch draft'}
        </button>
        {g.vodHighlights?.url ? (
          <a className="btn ghost sm" href={g.vodHighlights.url} target="_blank" rel="noreferrer">
            <Icon name="external" />
            Highlights
          </a>
        ) : null}
      </div>

      {open && v?.embed ? (
        <div style={{ margin: '0 20px 4px', borderRadius: 'var(--r-ctl)', overflow: 'hidden', background: '#000', border: '1px solid var(--border)', position: 'relative' }}>
          <iframe
            src={v.embed}
            title={`${g.blueTeam} vs ${g.redTeam} draft`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
            allowFullScreen
            loading="lazy"
            style={{ display: 'block', width: '100%', aspectRatio: '16 / 9', border: 0 }}
          />
          {at ? (
            <span className="tag" style={{ position: 'absolute', left: 16, bottom: 16, background: 'rgba(28,32,40,0.9)', color: 'var(--text)', height: 28, fontSize: 13 }}>
              Jumps to the draft at {at}
            </span>
          ) : null}
        </div>
      ) : null}

      <DraftSide side="blue" team={g.blueTeam} bans={g.draft.blueBans} picks={g.draft.bluePicks} />
      <DraftSide side="red" team={g.redTeam} bans={g.draft.redBans} picks={g.draft.redPicks} />
    </>
  );
}

export default function ProPage() {
  const router = useRouter();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const storedUser = useSyncExternalStore(subscribeToUser, getStoredUser, () => null);
  const user = useMemo(() => {
    if (!storedUser) return null;
    try { return JSON.parse(storedUser); } catch { return null; }
  }, [storedUser]);

  useEffect(() => {
    fetch('/api/pro-vods')
      .then(r => r.json())
      .then(d => { if (d.success) setLeagues(d.leagues || []); else setError(d.error || 'Could not load data'); })
      .catch(() => setError('Could not load data'))
      .finally(() => setLoading(false));
  }, []);

  const lg = leagues[active];

  return (
    <div className="hub">
      {user ? <Nav active="pro" user={user} /> : (
        <nav className="nav">
          <button className="nl" style={{ padding: '0 8px', gap: 10 }} onClick={() => router.push('/')}>
            <Icon name="mark" size={24} />
            <span className="h" style={{ fontSize: 17, letterSpacing: '0.06em', color: 'var(--text)' }}>
              {TEAM_NAME.toUpperCase()}
            </span>
            <span className="t3" style={{ fontSize: 12, letterSpacing: '0.14em', fontWeight: 500 }}>HUB</span>
          </button>
          <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => router.push('/')}>
            Sign in
          </button>
        </nav>
      )}

      <div className="page">
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
          <div>
            <div className="h" style={{ fontSize: 24 }}>Pro drafts</div>
            {/* Named from the data, not hardcoded — the subtitle said "LEC and
                LCK" for a while after Worlds was added to the list. */}
            <div className="t2" style={{ marginTop: 4 }}>
              Recent {leagues.length ? leagues.map(l => l.league).join(', ') : 'pro'} series with every draft and the moment it happened on the broadcast
            </div>
          </div>
          <div className="t3" style={{ fontSize: 13 }}>Updated daily · from Leaguepedia</div>
        </div>

        {leagues.length > 0 ? (
          <div className="tabs">
            {leagues.map((l, i) => (
              <button key={l.league} className={i === active ? 'tab on' : 'tab'} onClick={() => setActive(i)}>
                {l.league}
                <span className="t3" style={{ fontWeight: 400, marginLeft: 6 }}>{l.series.length} series</span>
              </button>
            ))}
          </div>
        ) : null}

        {/* Above the series, because it is the thing a coach scans first —
            and only when the league actually has it, so a cached payload from
            before this existed degrades to the plain list. */}
        {!loading && !error && lg?.meta ? <MetaStrip meta={lg.meta} /> : null}

        {loading ? (
          <div className="t3" style={{ textAlign: 'center', padding: '50px 20px' }}>Loading…</div>
        ) : error ? (
          <div className="t3" style={{ textAlign: 'center', padding: '50px 20px' }}>{error}</div>
        ) : !lg ? (
          <div className="t3" style={{ textAlign: 'center', padding: '50px 20px' }}>No data yet</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {lg.series.map(s => {
              const isOpen = !!open[s.matchId];
              return (
                <div key={s.matchId} className={isOpen ? 'card hl' : 'card'}>
                  <button
                    onClick={() => setOpen(p => ({ ...p, [s.matchId]: !p[s.matchId] }))}
                    className="srow"
                    onKeyDown={undefined}
                  >
                    <span className="t3" style={{ fontSize: 13 }}>{fmtDate(s.date)}</span>
                    <div className={s.winner === s.teamA ? 'h' : 'h t2'} style={{ fontSize: 20, textAlign: 'right' }}>{s.teamA}</div>
                    <div className="mono h" style={{ fontSize: 28, textAlign: 'center' }}>
                      {s.scoreA}<span className="t3"> – </span>{s.scoreB}
                    </div>
                    <div className={s.winner === s.teamB ? 'h' : 'h t2'} style={{ fontSize: 20 }}>{s.teamB}</div>
                    <span className="t3" style={{ fontSize: 13 }}>{s.gamesPlayed} games</span>
                    <span className={isOpen ? 'ic t2' : 'ic t3'} style={{ justifySelf: 'end' }}>
                      <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} />
                    </span>
                  </button>

                  {isOpen ? (
                    <div style={{ borderTop: '1px solid var(--border)', background: '#121519' }}>
                      {s.games.map(g => <GameBlock key={g.gameId} g={g} />)}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        <div className="t3" style={{ fontSize: 13, textAlign: 'center' }}>
          Data from <a href="https://lol.fandom.com" target="_blank" rel="noreferrer">Leaguepedia</a>
          {lg ? ` · updated ${new Date(lg.updatedAt).toLocaleString('en-GB')}` : ''}
        </div>
      </div>

      <style>{`
        .hub .srow{display:grid;grid-template-columns:110px 1fr 120px 1fr 120px 40px;gap:16px;align-items:center;padding:16px 20px;width:100%;background:none;border:none;text-align:left;cursor:pointer;}
        .hub .srow:hover{background:#12151B;}
        @media(max-width:820px){
          .hub .srow{grid-template-columns:1fr auto 1fr 40px;}
          .hub .srow > span:first-child{grid-column:1/-1;}
          .hub .srow > span:nth-last-child(2){display:none;}
        }
      `}</style>
    </div>
  );
}
