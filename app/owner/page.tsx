'use client';

// The owner's screen: everything in one place, nothing to click into.
//
// Deliberately flatter than /coach. A coach needs tools; an owner needs to
// know where the team stands without learning the hub. So this reads only —
// no editors, no tabs — and every figure says what it is measuring and how
// fresh it is, because a number with no denominator raises more questions than
// it answers.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Nav from '../components/Nav';
import Icon from '../components/Icon';
import { useUser } from '../components/useUser';
import { TEAM_NAME } from '../../lib/team';
import { DEFAULT_LEAGUE } from '../../lib/tournaments';

type Owner = {
  official: {
    games: number; wins: number; losses: number; winRate: number | null;
    form: string[]; tournaments: string[];
    last: { date: string; opponent: string; won: boolean } | null;
  };
  players: {
    name: string; rank: string | null; lp: number | null; wins: number | null; losses: number | null;
    winRate: number | null; recentWinRate: number | null; synced: boolean;
    pool: { ready: number; practice: number; total: number };
  }[];
  syncedAt: string | null;
  rosterSize: number;
};
type Overview = {
  scrims: { total: number; w: number; week: { n: number; w: number }; lastBlock: { date: string; opponent: string; w: number; l: number } | null };
  review: { vods: number; notesWeek: number };
  feedback: { total14: number };
  calendar: { next: { id: string; type: string; title: string; date: string; time: string; opponent?: string }[] };
  prep: { opponent: string | null; hasPlan: boolean };
};
type Fixture = { tournaments?: { matches?: { opponent?: string; scheduledAt?: string; league?: string }[] }[] };
type Tour = { league: string; serie: string; stages?: { name: string; standings?: { rank: number; team: { name: string; ours: boolean }; wins: number; losses: number }[] }[] };

const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="card stat">
      <div className="sec sm">{label}</div>
      <div className="mono" style={{ fontSize: 26, fontWeight: 600, color: tone }}>{value}</div>
      {sub ? <div className="t3" style={{ fontSize: 13 }}>{sub}</div> : null}
    </div>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div className="h" style={{ fontSize: 18 }}>{title}</div>
        {hint ? <div className="t3" style={{ fontSize: 12 }}>{hint}</div> : null}
      </div>
      {children}
    </div>
  );
}

export default function OwnerPage() {
  const { user, ready } = useUser();
  const router = useRouter();
  const [o, setO] = useState<Owner | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [fx, setFx] = useState<Fixture | null>(null);
  const [tr, setTr] = useState<Tour | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Four reads in parallel: three are endpoints that already existed, so
    // nothing here re-derives what the hub already serves.
    Promise.allSettled([
      fetch('/api/owner').then(r => r.json()),
      fetch('/api/overview').then(r => r.json()),
      fetch('/api/fixture').then(r => r.json()),
      fetch(`/api/tournaments?league=${DEFAULT_LEAGUE}`).then(r => r.json()),
    ]).then(([a, b, c, d]) => {
      if (a.status === 'fulfilled') setO(a.value);
      if (b.status === 'fulfilled') setOv(b.value);
      if (c.status === 'fulfilled') setFx(c.value);
      if (d.status === 'fulfilled') setTr(d.value);
      setLoading(false);
    });
  }, []);

  if (!ready || !user) return <div className="hub" />;

  const next = fx?.tournaments?.flatMap(t => t.matches ?? []).find(m => m.scheduledAt) ?? null;
  const ourRow = tr?.stages?.flatMap(s => s.standings ?? []).find(r => r.team?.ours) ?? null;
  const offline = o?.players.filter(p => !p.synced) ?? [];

  return (
    <div className="hub">
      <Nav active="home" user={user} />
      <div className="page">
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
          <div>
            <div className="h" style={{ fontSize: 24 }}>{TEAM_NAME} — overview</div>
            <div className="t2" style={{ marginTop: 4 }}>Everything in one screen · data refreshed {ago(o?.syncedAt ?? null)}</div>
          </div>
          <button className="btn ghost sm" onClick={() => router.push('/tournaments')}>
            <Icon name="trophy" />Full schedule
          </button>
        </div>

        {loading ? <div className="t3" style={{ textAlign: 'center', padding: '50px' }}>Loading…</div> : (
          <>
            {/* The five numbers that answer "how are we doing" */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
              <Stat label="Official record" value={o ? `${o.official.wins}–${o.official.losses}` : '—'}
                sub={o?.official.winRate !== null && o ? `${o.official.winRate}% of ${o.official.games} games` : 'no games synced'}
                tone={o && o.official.winRate !== null ? (o.official.winRate >= 55 ? 'var(--win)' : o.official.winRate < 45 ? 'var(--loss)' : undefined) : undefined} />
              <Stat label="Scrims" value={ov ? `${ov.scrims.w}–${ov.scrims.total - ov.scrims.w}` : '—'}
                sub={ov ? `${ov.scrims.week.n} this week` : 'none logged'} />
              <Stat label="League position" value={ourRow ? `#${ourRow.rank}` : '—'}
                sub={ourRow ? `${ourRow.wins}–${ourRow.losses} · ${tr?.serie ?? ''}` : 'no standings published'} />
              <Stat label="Review activity" value={ov ? String(ov.review.vods) : '—'}
                sub={ov ? `${ov.review.notesWeek} notes this week` : 'no VODs'} />
              <Stat label="Next match" value={next?.scheduledAt ? new Date(next.scheduledAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}
                sub={next?.opponent ?? 'nothing scheduled'} />
            </div>

            {/* A dead Riot key and a player who stopped playing look identical
                in the numbers, so the difference is stated outright. */}
            {offline.length ? (
              <div className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--warn)', fontSize: 14 }}>
                <Icon name="warning" />
                <span>Solo queue data missing for {offline.map(p => p.name).join(', ')} — the sync could not reach their account.</span>
              </div>
            ) : null}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, alignItems: 'start' }}>
              <Panel title="Roster" hint="solo queue rank · season record · rated champion pool">
                {o?.players.map(p => (
                  <div key={p.name} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'baseline', paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                    <div>
                      <div style={{ fontWeight: 500 }}>{p.name}</div>
                      <div className="t3" style={{ fontSize: 12 }}>
                        {p.synced ? `${p.rank ?? 'unranked'}${p.lp !== null ? ` · ${p.lp} LP` : ''}` : 'not synced'}
                        {p.pool.total ? ` · ${p.pool.ready} ready / ${p.pool.total} rated` : ' · pool not rated'}
                      </div>
                    </div>
                    <span className="mono" style={{ fontSize: 14, color: p.winRate === null ? 'var(--text-3)' : p.winRate >= 55 ? 'var(--win)' : p.winRate < 45 ? 'var(--loss)' : undefined }}>
                      {p.winRate !== null ? `${p.winRate}%` : '—'}
                    </span>
                  </div>
                ))}
              </Panel>

              <Panel title="Form" hint="last 10 official games, newest first">
                {o?.official.form.length ? (
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {o.official.form.map((r, i) => (
                      <span key={i} className={r === 'W' ? 'tag win' : 'tag loss'} style={{ width: 28, justifyContent: 'center' }}>{r}</span>
                    ))}
                  </div>
                ) : <span className="t3" style={{ fontSize: 13 }}>No official games synced yet.</span>}
                {o?.official.last ? (
                  <div className="t3" style={{ fontSize: 13 }}>
                    Last: {o.official.last.won ? 'won' : 'lost'} vs {o.official.last.opponent} on {o.official.last.date}
                  </div>
                ) : null}
                {o?.official.tournaments.length ? (
                  <div className="t3" style={{ fontSize: 12 }}>{o.official.tournaments.join(' · ')}</div>
                ) : null}
              </Panel>

              <Panel title="What's next" hint="from the calendar and the fixture list">
                {ov?.calendar.next.length ? ov.calendar.next.map(e => (
                  <div key={e.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span className="tag neutral" style={{ textTransform: 'capitalize' }}>{e.type}</span>
                    <span style={{ fontSize: 14, flex: 1 }}>{e.title}{e.opponent ? ` · ${e.opponent}` : ''}</span>
                    <span className="mono t3" style={{ fontSize: 12 }}>{e.date} {e.time}</span>
                  </div>
                )) : <span className="t3" style={{ fontSize: 13 }}>Nothing on the calendar.</span>}
                {ov?.prep.opponent ? (
                  <div className="t3" style={{ fontSize: 13, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                    Next opponent set to <strong style={{ color: 'var(--text)' }}>{ov.prep.opponent}</strong>
                    {ov.prep.hasPlan ? ' · draft plan written' : ' · no draft plan yet'}
                  </div>
                ) : null}
              </Panel>

              <Panel title="Coaching work" hint="is the staff actually using the tools">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 10px', fontSize: 14 }}>
                  <span className="t2">VODs in the library</span><span className="mono">{ov?.review.vods ?? '—'}</span>
                  <span className="t2">Review notes this week</span><span className="mono">{ov?.review.notesWeek ?? '—'}</span>
                  <span className="t2">Player feedback, last 14 days</span><span className="mono">{ov?.feedback.total14 ?? '—'}</span>
                  <span className="t2">Scrim games logged</span><span className="mono">{ov?.scrims.total ?? '—'}</span>
                </div>
                {ov?.scrims.lastBlock ? (
                  <div className="t3" style={{ fontSize: 13 }}>
                    Last scrim block: {ov.scrims.lastBlock.w}–{ov.scrims.lastBlock.l} vs {ov.scrims.lastBlock.opponent} on {ov.scrims.lastBlock.date}
                  </div>
                ) : null}
              </Panel>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
