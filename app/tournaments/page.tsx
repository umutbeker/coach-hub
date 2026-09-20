'use client';

// Tournaments — the schedule of the competitions we play in and care about.
//
// Everything on this page comes from /api/tournaments, which serves Redis and
// refreshes itself when its copy goes stale. This page never calls PandaScore.
// It stays current two ways: a poll while the tab is visible, and a Pusher
// broadcast the moment any viewer's poll triggers a rebuild — so a score moves
// for everyone at once rather than up to a poll interval apart.
//
// Slots that the organiser has not filled in yet are drawn, not hidden: a
// playoff bracket announced as eight TBD matches is the shape of the week, and
// the page fills in as the names land.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Pusher from 'pusher-js';
import Nav from '../components/Nav';
import Icon from '../components/Icon';
import { useUser } from '../components/useUser';
import {
  TRACKED, DEFAULT_LEAGUE, findLeague,
  type LeagueSchedule, type TMatch, type TStage, type TStanding, type TStream, type TTeam,
} from '../../lib/tournaments';

// ── Formatting ──────────────────────────────────────────────────────────────

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function dayLabel(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  const pretty = date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  if (diff === 0) return { label: 'Today', sub: pretty, soon: true };
  if (diff === 1) return { label: 'Tomorrow', sub: pretty, soon: true };
  return { label: pretty, sub: '', soon: false };
}

/** "in 3d 4h" / "in 42m" / "started 12m ago" — the countdown on the spotlight. */
function countdown(iso: string, now: number) {
  const ms = new Date(iso).getTime() - now;
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86_400_000);
  const h = Math.floor((abs % 86_400_000) / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const body = d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
  return ms >= 0 ? `in ${body}` : `${body} ago`;
}

const ago = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
};

// ── Pieces ──────────────────────────────────────────────────────────────────

/** A team on a match row, or the dashed placeholder that stands in for one. */
function Side({ team, align, won }: { team: TTeam | null; align: 'left' | 'right'; won?: boolean }) {
  const row: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
    flexDirection: align === 'right' ? 'row-reverse' : 'row',
    justifyContent: align === 'right' ? 'flex-start' : 'flex-start',
  };

  if (!team) {
    return (
      <div style={row}>
        <span style={{
          width: 26, height: 26, borderRadius: 6, border: '1px dashed var(--border-strong)', flex: 'none',
        }} />
        <span className="t3" style={{ fontSize: 14, letterSpacing: '0.04em' }}>TBA</span>
      </div>
    );
  }

  return (
    <div style={row}>
      {team.image
        ? <img src={team.image} alt="" width={26} height={26}
            style={{ width: 26, height: 26, objectFit: 'contain', flex: 'none' }} />
        : <span style={{
            width: 26, height: 26, borderRadius: 6, background: 'var(--surface-2)', flex: 'none',
            display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text-3)',
          }}>{(team.acronym ?? team.name).slice(0, 3).toUpperCase()}</span>}
      <span style={{
        fontWeight: team.ours ? 600 : won ? 500 : 400,
        color: team.ours ? 'var(--accent)' : won === false ? 'var(--text-3)' : 'var(--text)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{team.name}</span>
    </div>
  );
}

/**
 * The broadcasts for one match. The organiser's main stream is a button; the
 * co-streams and other languages hide behind the chevron, because a playoff
 * day carries eight of them and they are not the point of the row.
 */
function Streams({ streams, live }: { streams: TStream[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  if (!streams.length) {
    return <span className="t3" style={{ fontSize: 12, letterSpacing: '0.04em' }}>Stream TBA</span>;
  }

  const [main, ...rest] = streams;
  return (
    <div style={{ position: 'relative', display: 'flex', gap: 4 }}>
      <a className={live ? 'btn primary sm' : 'btn sm'} href={main.url} target="_blank" rel="noreferrer"
        onClick={e => e.stopPropagation()}>
        <Icon name={live ? 'live' : 'play'} size={15} />
        {live ? 'Watch live' : 'Watch'}
        {main.language ? <span style={{ opacity: 0.6, textTransform: 'uppercase', fontSize: 11 }}>{main.language}</span> : null}
      </a>
      {rest.length ? (
        <>
          <button className="btn ghost sm" style={{ padding: '0 6px' }} aria-label={`${rest.length} more streams`}
            onClick={e => { e.stopPropagation(); setOpen(o => !o); }}>
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={15} />
          </button>
          {open ? (
            <div className="card" style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 20,
              padding: 6, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 170,
            }}>
              {rest.map(s => (
                <a key={s.url} className="btn ghost sm" href={s.url} target="_blank" rel="noreferrer"
                  style={{ justifyContent: 'flex-start' }} onClick={e => e.stopPropagation()}>
                  <Icon name={s.platform === 'youtube' ? 'video' : 'play'} size={14} />
                  <span style={{ textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.06em' }}>{s.language || '—'}</span>
                  <span className="t3" style={{ fontSize: 12, marginLeft: 'auto' }}>{s.official ? 'Official' : 'Co-stream'}</span>
                </a>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function MatchRow({ m }: { m: TMatch }) {
  const live = m.status === 'live';
  const done = m.status === 'finished';
  const aWon = done && m.winnerId != null && m.teamA?.id === m.winnerId;
  const bWon = done && m.winnerId != null && m.teamB?.id === m.winnerId;

  return (
    // The column template lives in globals.css so the phone breakpoint can
    // restack it — an inline one would win over the media query.
    <div className="tmatch" style={{
      background: live ? 'rgba(248,113,113,0.05)' : m.ours ? 'rgba(139,124,246,0.06)' : undefined,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span className="mono" style={{ fontSize: 14, color: m.scheduledAt ? 'var(--text)' : 'var(--text-3)' }}>
          {m.scheduledAt ? hhmm(m.scheduledAt) : 'TBA'}
        </span>
        <span className="t3" style={{ fontSize: 11, letterSpacing: '0.06em' }}>BO{m.bestOf}</span>
      </div>

      <Side team={m.teamA} align="right" won={done ? aWon : undefined} />

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 62 }}>
        {done || live ? (
          <span className="mono" style={{ fontSize: 16, fontWeight: 600, letterSpacing: '0.04em' }}>
            <span style={{ color: aWon ? 'var(--win)' : undefined }}>{m.scoreA ?? 0}</span>
            <span className="t3" style={{ margin: '0 5px', fontWeight: 400 }}>–</span>
            <span style={{ color: bWon ? 'var(--win)' : undefined }}>{m.scoreB ?? 0}</span>
          </span>
        ) : (
          <span className="t3" style={{ fontSize: 14 }}>vs</span>
        )}
        {live ? <span className="tag loss" style={{ fontSize: 10, padding: '1px 6px' }}>LIVE</span> : null}
      </div>

      <Side team={m.teamB} align="left" won={done ? bWon : undefined} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
        {m.round ? <span className="t3 hide-sm" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{m.round}</span> : null}
        {done
          ? <span className="t3" style={{ fontSize: 12, letterSpacing: '0.04em' }}>Final</span>
          : <Streams streams={m.streams} live={live} />}
      </div>
    </div>
  );
}

/** The shape of a schedule nobody has announced yet — five empty slots. */
function TbaSkeleton() {
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="h" style={{ fontSize: 15 }}>Not announced yet</span>
        <span className="t3" style={{ fontSize: 13 }}>
          Dates and opponents appear here automatically once the organiser publishes them.
        </span>
      </div>
      {[0, 1, 2, 3, 4].map(i => (
        <MatchRow key={i} m={{
          id: -i - 1, round: null, scheduledAt: null, bestOf: 3, status: 'tba',
          teamA: null, teamB: null, scoreA: null, scoreB: null, winnerId: null,
          ours: false, streams: [],
        }} />
      ))}
    </div>
  );
}

function Standings({ rows }: { rows: TStanding[] }) {
  return (
    <div className="card" style={{ overflow: 'hidden', alignSelf: 'start' }}>
      <div className="sec" style={{ padding: '12px 14px 10px' }}>Standings</div>
      <div className="thead" style={{ gridTemplateColumns: '24px 1fr 46px 52px', padding: '0 14px 8px' }}>
        <span>#</span><span>Team</span><span style={{ textAlign: 'right' }}>W–L</span><span style={{ textAlign: 'right' }}>Games</span>
      </div>
      {rows.map(r => (
        <div key={r.team.id} className="trow" style={{
          gridTemplateColumns: '24px 1fr 46px 52px',
          background: r.team.ours ? 'rgba(139,124,246,0.08)' : undefined,
        }}>
          <span className="mono t3" style={{ fontSize: 13 }}>{r.rank}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            {r.team.image ? <img src={r.team.image} alt="" style={{ width: 20, height: 20, objectFit: 'contain', flex: 'none' }} /> : null}
            <span style={{
              fontSize: 14, fontWeight: r.team.ours ? 600 : 400,
              color: r.team.ours ? 'var(--accent)' : undefined,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{r.team.name}</span>
          </span>
          <span className="mono" style={{ fontSize: 13, textAlign: 'right' }}>
            <span style={{ color: 'var(--win)' }}>{r.wins}</span>–<span style={{ color: 'var(--loss)' }}>{r.losses}</span>
          </span>
          <span className="mono t3" style={{ fontSize: 13, textAlign: 'right' }}>{r.gameWins}–{r.gameLosses}</span>
        </div>
      ))}
    </div>
  );
}

/** The one match that matters most: ours, next, with its countdown. */
function Spotlight({ m, now }: { m: TMatch; now: number }) {
  const live = m.status === 'live';
  return (
    <div className="card hl" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className={live ? 'tag loss' : 'tag accent'}>{live ? 'LIVE NOW' : 'Our next match'}</span>
        {m.round ? <span className="t3" style={{ fontSize: 13 }}>{m.round}</span> : null}
        <span className="t3" style={{ fontSize: 13 }}>BO{m.bestOf}</span>
        <span className="mono" style={{ marginLeft: 'auto', fontSize: 13, color: live ? 'var(--loss)' : 'var(--text-2)' }}>
          {m.scheduledAt ? (live ? 'in progress' : countdown(m.scheduledAt, now)) : 'date TBA'}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 160px', minWidth: 0 }}><Side team={m.teamA} align="left" /></div>
        <span className="mono" style={{ fontSize: 20, fontWeight: 600 }}>
          {live || m.status === 'finished' ? `${m.scoreA ?? 0} – ${m.scoreB ?? 0}` : 'vs'}
        </span>
        <div style={{ flex: '1 1 160px', minWidth: 0 }}><Side team={m.teamB} align="left" /></div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span className="t2" style={{ fontSize: 14 }}>
          {m.scheduledAt
            ? new Date(m.scheduledAt).toLocaleString('en-GB', {
                weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
              })
            : 'Kickoff not announced'}
        </span>
        <span style={{ marginLeft: 'auto' }}><Streams streams={m.streams} live={live} /></span>
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function TournamentsPage() {
  const router = useRouter();
  const { user, ready } = useUser();

  const [slug, setSlug] = useState(DEFAULT_LEAGUE);
  const [data, setData] = useState<LeagueSchedule | null>(null);
  const [stage, setStage] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [now, setNow] = useState(() => Date.now());
  // The poll and the Pusher handler outlive the render that created them, so
  // they read the league from a ref rather than closing over a stale value.
  const slugRef = useRef(slug);

  useEffect(() => { if (ready && !user) router.push('/'); }, [ready, user, router]);

  const load = useCallback((which: string, refresh = false) => {
    return fetch(`/api/tournaments?league=${which}${refresh ? '&refresh=1' : ''}`)
      .then(r => r.json())
      .then((d: LeagueSchedule & { error?: string }) => {
        if (slugRef.current !== which) return;   // the viewer switched league mid-flight
        if (d.error) { setErr(d.error); return; }
        setErr('');
        setData(d);
      })
      .catch(() => setErr('Could not reach the schedule.'))
      .finally(() => setLoading(false));
  }, []);

  // First paint. Switching league is an event, not a derived effect — see
  // `switchLeague` — so this runs once.
  useEffect(() => { load(DEFAULT_LEAGUE); }, [load]);

  /** Clearing here rather than in an effect keeps the render cascade to one. */
  const switchLeague = (next: string) => {
    if (next === slug) return;
    setSlug(next);
    slugRef.current = next;
    setData(null);
    setStage(null);
    setLoading(true);
    load(next);
  };

  // Staying current. The poll is cheap — the API answers from Redis and only
  // crosses to PandaScore once its copy has aged out — and it stops while the
  // tab is hidden so a forgotten tab is not a background cost.
  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
      if (document.visibilityState === 'visible') load(slugRef.current);
    };
    const id = setInterval(tick, 45_000);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  // …and the broadcast, so a score that one viewer's poll pulled in lands on
  // every other open page immediately instead of at its own next poll.
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
    if (!key) return;
    const pusher = new Pusher(key, { cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER! });
    const channel = pusher.subscribe('tournaments-channel');
    channel.bind('tournaments-updated', (p: { slug?: string }) => {
      if (p?.slug === slugRef.current) load(slugRef.current);
    });
    return () => { channel.unbind_all(); pusher.unsubscribe('tournaments-channel'); pusher.disconnect(); };
  }, [load]);

  const stages = useMemo(() => data?.stages ?? [], [data]);

  // Default stage: whichever one has the next match to be played, else the last.
  const activeStage: TStage | null = useMemo(() => {
    if (!stages.length) return null;
    if (stage != null) return stages.find(s => s.id === stage) ?? stages[0];
    const withPending = stages.find(s => s.matches.some(m => m.status === 'live'))
      ?? stages.find(s => s.matches.some(m => m.status !== 'finished'));
    return withPending ?? stages[stages.length - 1];
  }, [stages, stage]);

  const liveCount = useMemo(
    () => stages.flatMap(s => s.matches).filter(m => m.status === 'live').length,
    [stages]
  );

  // Our next game anywhere in this competition, live one first.
  const ourNext = useMemo(() => {
    const mine = stages.flatMap(s => s.matches).filter(m => m.ours && m.status !== 'finished');
    return mine.find(m => m.status === 'live')
      ?? mine.filter(m => m.scheduledAt)
        .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!))[0]
      ?? null;
  }, [stages]);

  // Matches of the open stage, grouped into the days they are played on.
  const days = useMemo(() => {
    if (!activeStage) return [];
    const groups = new Map<string, TMatch[]>();
    const undated: TMatch[] = [];
    for (const m of activeStage.matches) {
      if (!m.scheduledAt) { undated.push(m); continue; }
      const k = dayKey(m.scheduledAt);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(m);
    }
    const out = [...groups.entries()].map(([k, matches]) => ({ key: k, matches }));
    if (undated.length) out.push({ key: '', matches: undated });
    return out;
  }, [activeStage]);

  if (!ready || !user) return null;

  const league = findLeague(slug);

  return (
    <div className="hub">
      <Nav active="tournaments" user={user} />

      <div className="page">
        <div className="page-head">
          <div>
            <h1 className="h" style={{ fontSize: 24, margin: 0 }}>Tournaments</h1>
            <div className="t3" style={{ fontSize: 14 }}>
              {data?.serie ? `${data.league} · ${data.serie}` : league.blurb}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {liveCount ? (
              <span className="tag loss"><Icon name="live" size={13} />{liveCount} live</span>
            ) : null}
            {data ? (
              <span className={data.stale ? 'tag warn' : 't3'} style={{ fontSize: 12 }}>
                {data.stale ? 'Showing last known' : `Updated ${ago(data.updatedAt, now)}`}
              </span>
            ) : null}
            <button className="btn ghost sm" onClick={() => { setLoading(true); load(slug, true); }} disabled={loading}>
              <Icon name="refresh" size={15} /><span className="hide-sm">Refresh</span>
            </button>
          </div>
        </div>

        <div className="seg" style={{ alignSelf: 'flex-start' }}>
          {TRACKED.map(l => (
            <button key={l.slug} className={l.slug === slug ? 'on' : ''} onClick={() => switchLeague(l.slug)}>
              {l.name}
            </button>
          ))}
        </div>

        {err && !data ? (
          <div className="card empty"><Icon name="warning" /><div style={{ marginTop: 8 }}>{err}</div></div>
        ) : null}

        {loading && !data ? (
          <div className="card empty">Loading the schedule…</div>
        ) : null}

        {data ? (
          <>
            {ourNext ? <Spotlight m={ourNext} now={now} /> : null}

            {!stages.length ? <TbaSkeleton /> : (
              <>
                {stages.length > 1 ? (
                  <div className="tabs">
                    {stages.map(s => {
                      const live = s.matches.some(m => m.status === 'live');
                      return (
                        <button key={s.id} className={s.id === activeStage?.id ? 'tab on' : 'tab'}
                          onClick={() => setStage(s.id)}>
                          {s.name}
                          {live ? <span className="tag loss" style={{ fontSize: 10, padding: '1px 5px', marginLeft: 6 }}>LIVE</span> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                <div className={activeStage?.standings.length ? 'tgrid has-side' : 'tgrid'}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
                    {!days.length ? <TbaSkeleton /> : days.map(({ key, matches }) => {
                      const d = key ? dayLabel(key) : { label: 'Date to be announced', sub: '', soon: false };
                      return (
                        <div key={key || 'tba'} className="card" style={{ overflow: 'hidden' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '11px 14px' }}>
                            <span className="h" style={{ fontSize: 15, color: d.soon ? 'var(--accent)' : 'var(--text)' }}>{d.label}</span>
                            {d.sub ? <span className="t3" style={{ fontSize: 13 }}>{d.sub}</span> : null}
                            <span className="t3" style={{ marginLeft: 'auto', fontSize: 12 }}>
                              {matches.length} {matches.length === 1 ? 'match' : 'matches'}
                            </span>
                          </div>
                          {matches.map(m => <MatchRow key={m.id} m={m} />)}
                        </div>
                      );
                    })}
                  </div>

                  {activeStage?.standings.length ? <Standings rows={activeStage.standings} /> : null}
                </div>
              </>
            )}
          </>
        ) : null}
      </div>

    </div>
  );
}
