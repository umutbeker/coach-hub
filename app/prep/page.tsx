'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { champImg } from '../../lib/champions';
import { parseVod } from '../../lib/vod';
import { newId, type DraftPlan, type DraftPlanSide, type ScrimGame } from '../../lib/hub';
import Nav from '../components/Nav';
import Icon from '../components/Icon';
import ChampionPicker, { Slot } from '../components/ChampionPicker';
import { useUser } from '../components/useUser';

// ── Opponent report ─────────────────────────────────────────────────────────
// Built in the browser from Leaguepedia (its rate limit is per-IP, so one
// viewer's build doesn't spend the server's), then saved through /api/prep
// so the next person reads the saved copy instead of rebuilding it.

type Count = { name: string; n: number; w?: number };
type RecentGame = {
  gameId: string; date: string; tournament: string; vs: string; won: boolean; side: 'blue' | 'red';
  theirPicks: string[]; theirBans: string[]; oppPicks: string[]; oppBans: string[];
  vod: string | null; minutes: number | null;
};
type Report = {
  opponent: string; builtAt: number; games: number; wins: number;
  side: { blue: { n: number; w: number }; red: { n: number; w: number } };
  avgMinutes: number | null;
  perGame: { dragons: number | null; barons: number | null; towers: number | null; grubs: number | null };
  firstPicks: Count[]; theirBans: Count[]; bannedAgainst: Count[]; picks: Count[];
  players: { name: string; role: string; games: number; wr: number; champs: Count[] }[];
  recent: RecentGame[];
  brief?: { headline: string; points: { kind: string; text: string }[]; sampleWarning?: string };
  savedAt?: number;
};

const LP = 'https://lol.fandom.com/api.php';
const five = (m: Record<string, string>, p: string) => [1, 2, 3, 4, 5].map(i => m[`${p}${i}`]).filter(Boolean);
const tally = (names: string[], wins?: boolean[]) => {
  const t: Record<string, { n: number; w: number }> = {};
  names.forEach((c, i) => { if (!c) return; t[c] ??= { n: 0, w: 0 }; t[c].n++; if (wins?.[i]) t[c].w++; });
  return Object.entries(t).map(([name, v]) => ({ name, n: v.n, w: v.w })).sort((a, b) => b.n - a.n);
};
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

async function cargo(params: Record<string, string>) {
  const q = new URLSearchParams({ action: 'cargoquery', format: 'json', origin: '*', ...params });
  const d = await (await fetch(`${LP}?${q}`)).json();
  if (d?.error?.code === 'ratelimited') throw new Error('ratelimited');
  if (d?.error) throw new Error(d.error.info || 'Leaguepedia error');
  return (d.cargoquery ?? []).map((x: { title: Record<string, string> }) => x.title) as Record<string, string>[];
}

async function buildReport(team: string): Promise<Report> {
  const t = team.replace(/"/g, '');
  const games = await cargo({
    tables: 'ScoreboardGames=SG,PicksAndBansS7=PB,MatchScheduleGame=MSG',
    join_on: 'SG.GameId=PB.GameId,SG.GameId=MSG.GameId',
    fields: [
      'SG.Team1', 'SG.Team2', 'SG.Winner', 'SG.Gamelength_Number', 'SG.DateTime_UTC', 'SG.Tournament', 'SG.GameId',
      'SG.Team1Dragons', 'SG.Team2Dragons', 'SG.Team1Barons', 'SG.Team2Barons', 'SG.Team1Towers', 'SG.Team2Towers',
      'SG.Team1VoidGrubs', 'SG.Team2VoidGrubs',
      ...[1, 2, 3, 4, 5].flatMap(i => [`PB.Team1Ban${i}`, `PB.Team2Ban${i}`, `PB.Team1Pick${i}`, `PB.Team2Pick${i}`]),
      'MSG.VodPB', 'MSG.Vod',
    ].join(','),
    where: `SG.Team1="${t}" OR SG.Team2="${t}"`,
    order_by: 'SG.DateTime_UTC DESC',
    limit: '30',
  });
  // Sequential on purpose: two queries at once is enough to trip the limit.
  const rows = await cargo({
    tables: 'ScoreboardPlayers',
    fields: 'Name,Role,Champion,PlayerWin,DateTime_UTC',
    where: `Team="${t}"`,
    order_by: 'DateTime_UTC DESC',
    limit: '150',
  });

  const recent: RecentGame[] = games.map(g => {
    const blue = g.Team1 === t;
    const won = (g.Winner === '1') === blue;
    return {
      gameId: g.GameId,
      date: (g['DateTime UTC'] ?? g.DateTime_UTC ?? '').split(' ')[0],
      tournament: g.Tournament ?? '',
      vs: blue ? g.Team2 : g.Team1,
      won, side: blue ? 'blue' : 'red',
      theirPicks: five(g, blue ? 'Team1Pick' : 'Team2Pick'),
      theirBans: five(g, blue ? 'Team1Ban' : 'Team2Ban'),
      oppPicks: five(g, blue ? 'Team2Pick' : 'Team1Pick'),
      oppBans: five(g, blue ? 'Team2Ban' : 'Team1Ban'),
      vod: parseVod(g.VodPB)?.embed ?? parseVod(g.Vod)?.embed ?? null,
      minutes: num(g['Gamelength Number'] ?? g.Gamelength_Number),
    };
  });
  const side = (s: 'blue' | 'red') => {
    const x = recent.filter(r => r.side === s);
    return { n: x.length, w: x.filter(r => r.won).length };
  };
  const mine = (g: Record<string, string>, k: string) => num(g[`${g.Team1 === t ? 'Team1' : 'Team2'}${k}`]);

  // Players: most games first; role is whatever they played most.
  const byPlayer: Record<string, { roles: string[]; champs: string[]; wins: boolean[] }> = {};
  rows.forEach(r => {
    const p = r.Name || '?';
    byPlayer[p] ??= { roles: [], champs: [], wins: [] };
    byPlayer[p].roles.push(r.Role || ''); byPlayer[p].champs.push(r.Champion || ''); byPlayer[p].wins.push(r.PlayerWin === 'Yes');
  });
  const players = Object.entries(byPlayer).map(([name, v]) => {
    const role = tally(v.roles)[0]?.name ?? '';
    return { name, role, games: v.champs.length, wr: Math.round((v.wins.filter(Boolean).length / v.champs.length) * 100), champs: tally(v.champs, v.wins).slice(0, 5) };
  }).sort((a, b) => b.games - a.games).slice(0, 7);

  return {
    opponent: team,
    builtAt: Date.now(),
    games: recent.length,
    wins: recent.filter(r => r.won).length,
    side: { blue: side('blue'), red: side('red') },
    avgMinutes: avg(recent.map(r => r.minutes)),
    perGame: {
      dragons: avg(games.map(g => mine(g, 'Dragons'))),
      barons: avg(games.map(g => mine(g, 'Barons'))),
      towers: avg(games.map(g => mine(g, 'Towers'))),
      grubs: avg(games.map(g => mine(g, 'VoidGrubs'))),
    },
    // B1 — the first pick of the draft — only exists when they're on blue.
    firstPicks: tally(recent.filter(r => r.side === 'blue').map(r => r.theirPicks[0])).slice(0, 6),
    theirBans: tally(recent.flatMap(r => r.theirBans)).slice(0, 8),
    bannedAgainst: tally(recent.flatMap(r => r.oppBans)).slice(0, 8),
    picks: tally(recent.flatMap(r => r.theirPicks), recent.flatMap(r => r.theirPicks.map(() => r.won))).slice(0, 10),
    players,
    recent: recent.slice(0, 8),
  };
}

// ── UI bits ─────────────────────────────────────────────────────────────────

const pct = (w: number, n: number) => (n ? Math.round((w / n) * 100) : 0);
const wrColor = (p: number) => (p >= 55 ? 'var(--win)' : p < 45 ? 'var(--loss)' : 'var(--text)');

function CountList({ title, hint, items, showWr }: { title: string; hint: string; items: Count[]; showWr?: boolean }) {
  return (
    <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div><div className="h" style={{ fontSize: 18 }}>{title}</div><div className="t3" style={{ fontSize: 12 }}>{hint}</div></div>
      {!items.length ? <div className="t3" style={{ fontSize: 13 }}>No data</div> : items.map(c => (
        <div key={c.name} style={{ display: 'grid', gridTemplateColumns: '32px 1fr auto', gap: 10, alignItems: 'center' }}>
          <img src={champImg(c.name)} alt="" style={{ width: 32, height: 32, borderRadius: 6 }} onError={e => { (e.target as HTMLImageElement).src = '/logo.png'; }} />
          <span style={{ fontWeight: 500, fontSize: 14 }}>{c.name}</span>
          <span className="mono" style={{ fontSize: 13 }}>
            {c.n}×{showWr && c.w !== undefined ? <span style={{ color: wrColor(pct(c.w, c.n)), marginLeft: 8 }}>{pct(c.w, c.n)}%</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

const KIND_TAG: Record<string, string> = { ban: 'tag loss', watch: 'tag warn', exploit: 'tag win', draft: 'tag accent', player: 'tag blue' };

function ReportView({ r, onBrief, briefing, briefErr }: { r: Report; onBrief: () => void; briefing: boolean; briefErr: string }) {
  const [vod, setVod] = useState<string | null>(null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        <div className="card stat"><div className="sec sm">Record · last {r.games}</div><div className="mono" style={{ fontSize: 30, fontWeight: 600 }}>{r.wins}<span className="t3">–</span>{r.games - r.wins}</div><div className="t3" style={{ fontSize: 13 }}>{pct(r.wins, r.games)}% win rate</div></div>
        <div className="card stat"><div className="sec sm">Blue side</div><div className="mono" style={{ fontSize: 30, fontWeight: 600, color: 'var(--blue-side)' }}>{pct(r.side.blue.w, r.side.blue.n)}%</div><div className="t3" style={{ fontSize: 13 }}>{r.side.blue.w}–{r.side.blue.n - r.side.blue.w}</div></div>
        <div className="card stat"><div className="sec sm">Red side</div><div className="mono" style={{ fontSize: 30, fontWeight: 600, color: 'var(--red-side)' }}>{pct(r.side.red.w, r.side.red.n)}%</div><div className="t3" style={{ fontSize: 13 }}>{r.side.red.w}–{r.side.red.n - r.side.red.w}</div></div>
        <div className="card stat"><div className="sec sm">Avg game</div><div className="mono" style={{ fontSize: 30, fontWeight: 600 }}>{r.avgMinutes ? `${Math.round(r.avgMinutes)}m` : '—'}</div><div className="t3" style={{ fontSize: 13 }}>{r.avgMinutes ? (r.avgMinutes < 29 ? 'plays for early' : r.avgMinutes > 34 ? 'goes long' : 'mid-length games') : ''}</div></div>
        <div className="card stat"><div className="sec sm">Per game</div><div className="mono" style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>{r.perGame.dragons?.toFixed(1) ?? '—'} <span className="t3" style={{ fontSize: 13 }}>drag</span> · {r.perGame.barons?.toFixed(1) ?? '—'} <span className="t3" style={{ fontSize: 13 }}>baron</span></div><div className="t3" style={{ fontSize: 13 }}>{r.perGame.towers?.toFixed(1) ?? '—'} towers · {r.perGame.grubs?.toFixed(1) ?? '—'} grubs</div></div>
      </div>

      <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="h" style={{ fontSize: 20 }}>Brief</div>
          <span className="t3" style={{ fontSize: 13 }}>written by AI from the numbers on this page</span>
          <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={onBrief} disabled={briefing}>
            <Icon name="refresh" />{briefing ? 'Writing…' : r.brief ? 'Rewrite' : 'Write brief'}
          </button>
        </div>
        {briefErr ? <div style={{ color: 'var(--loss)', fontSize: 14 }}>{briefErr}</div> : null}
        {r.brief ? (
          <>
            <div style={{ fontSize: 17, fontWeight: 500 }}>{r.brief.headline}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {r.brief.points.map((p, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 12, alignItems: 'start' }}>
                  <span className={KIND_TAG[p.kind] ?? 'tag neutral'} style={{ justifyContent: 'center', textTransform: 'capitalize' }}>{p.kind}</span>
                  <span style={{ fontSize: 15 }}>{p.text}</span>
                </div>
              ))}
            </div>
            {r.brief.sampleWarning ? <div className="t3" style={{ fontSize: 13 }}>{r.brief.sampleWarning}</div> : null}
          </>
        ) : !briefErr ? <div className="t3" style={{ fontSize: 14 }}>No brief yet.</div> : null}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
        <CountList title="First pick on blue" hint="what they take B1" items={r.firstPicks} />
        <CountList title="They ban" hint="their own bans" items={r.theirBans} />
        <CountList title="Banned against them" hint="what opponents respect" items={r.bannedAgainst} />
        <CountList title="They pick" hint="most picked · win rate" items={r.picks} showWr />
      </div>

      <div>
        <div className="h" style={{ fontSize: 22, marginBottom: 12 }}>Players</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {r.players.map(p => (
            <div key={p.name} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <div><div style={{ fontWeight: 600 }}>{p.name}</div><div className="t3" style={{ fontSize: 12 }}>{p.role || '—'} · {p.games} games</div></div>
                <span className="mono" style={{ fontSize: 18, fontWeight: 600, color: wrColor(p.wr) }}>{p.wr}%</span>
              </div>
              {p.champs.map(c => (
                <div key={c.name} style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto', gap: 8, alignItems: 'center' }}>
                  <img src={champImg(c.name)} alt="" style={{ width: 28, height: 28, borderRadius: 5 }} onError={e => { (e.target as HTMLImageElement).src = '/logo.png'; }} />
                  <span style={{ fontSize: 14 }}>{c.name}</span>
                  <span className="mono t2" style={{ fontSize: 13 }}>{c.n}× <span style={{ color: wrColor(pct(c.w ?? 0, c.n)) }}>{pct(c.w ?? 0, c.n)}%</span></span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="h" style={{ fontSize: 22, marginBottom: 12 }}>Recent drafts</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {r.recent.map(g => (
            <div key={g.gameId} className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', flexWrap: 'wrap' }}>
                <span className={g.won ? 'tag win' : 'tag loss'}>{g.won ? 'Win' : 'Loss'}</span>
                <span style={{ fontWeight: 500 }}>vs {g.vs}</span>
                <span className={g.side === 'blue' ? 'tag blue' : 'tag red'}>{g.side === 'blue' ? 'Blue' : 'Red'}</span>
                <span className="t3" style={{ fontSize: 13 }}>{g.tournament} · {g.date}{g.minutes ? ` · ${Math.round(g.minutes)}m` : ''}</span>
                {g.vod ? <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setVod(vod === g.gameId ? null : g.gameId)}><Icon name={vod === g.gameId ? 'chevron-up' : 'play'} />{vod === g.gameId ? 'Hide' : 'Watch draft'}</button> : null}
              </div>
              {vod === g.gameId && g.vod ? (
                <iframe src={g.vod} title="draft" allow="encrypted-media; picture-in-picture" allowFullScreen style={{ display: 'block', width: 'calc(100% - 32px)', margin: '0 16px 12px', aspectRatio: '16 / 9', border: 0, borderRadius: 6 }} />
              ) : null}
              <div className="pdr">
                <span className="t3" style={{ fontSize: 12 }}>Their picks</span><div className="row">{g.theirPicks.map((c, i) => <img key={i} src={champImg(c)} className="champ" alt={c} title={c} onError={e => { (e.target as HTMLImageElement).src = '/logo.png'; }} />)}</div>
                <span className="t3" style={{ fontSize: 12 }}>Their bans</span><div className="row">{g.theirBans.map((c, i) => <img key={i} src={champImg(c)} className="champ ban" alt={c} title={c} onError={e => { (e.target as HTMLImageElement).src = '/logo.png'; }} />)}</div>
                <span className="t3" style={{ fontSize: 12 }}>{g.vs}</span><div className="row">{g.oppPicks.map((c, i) => <img key={i} src={champImg(c)} className="champ" alt={c} title={c} onError={e => { (e.target as HTMLImageElement).src = '/logo.png'; }} />)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Draft plan ──────────────────────────────────────────────────────────────

const emptySide = (): DraftPlanSide => ({ bans: ['', '', '', '', ''], priorityPicks: [], notes: '' });
const emptyPlan = (opponent: string): DraftPlan => ({ opponent, blue: emptySide(), red: emptySide(), branches: [], updatedBy: '', updatedAt: 0 });

function PlanEditor({ plan, onChange, onSave, saving, savedAt }: {
  plan: DraftPlan; onChange: (p: DraftPlan) => void; onSave: () => void; saving: boolean; savedAt: number;
}) {
  const [picker, setPicker] = useState<{ side: 'blue' | 'red'; kind: 'ban' | 'pick'; i: number } | null>(null);
  const setSide = (s: 'blue' | 'red', v: DraftPlanSide) => onChange({ ...plan, [s]: v });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
        {(['blue', 'red'] as const).map(s => {
          const v = plan[s];
          return (
            <div key={s} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14, borderTop: `3px solid ${s === 'blue' ? 'var(--blue-side)' : 'var(--red-side)'}` }}>
              <div className="h" style={{ fontSize: 20 }}>If we are {s === 'blue' ? 'blue' : 'red'}</div>
              <div>
                <div className="sec sm" style={{ marginBottom: 8 }}>Planned bans</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {v.bans.map((c, i) => <Slot key={i} ban name={c} onClick={() => setPicker({ side: s, kind: 'ban', i })} />)}
                </div>
              </div>
              <div>
                <div className="sec sm" style={{ marginBottom: 8 }}>Priority picks <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>· in order</span></div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {v.priorityPicks.map((c, i) => (
                    <div key={c + i} style={{ position: 'relative' }}>
                      <Slot name={c} onClick={() => setPicker({ side: s, kind: 'pick', i })} />
                      <span className="mono" style={{ position: 'absolute', top: -6, left: -6, width: 18, height: 18, borderRadius: 9, background: 'var(--accent)', color: 'var(--accent-ink)', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                    </div>
                  ))}
                  {v.priorityPicks.length < 10 ? <Slot onClick={() => setPicker({ side: s, kind: 'pick', i: v.priorityPicks.length })} /> : null}
                </div>
              </div>
              <div className="field">
                <label className="label">Plan notes</label>
                <textarea className="input" placeholder="Win condition, who we play around, what we avoid…" value={v.notes}
                  onChange={e => setSide(s, { ...v, notes: e.target.value })} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="h" style={{ fontSize: 20 }}>If they… then we…</div>
          <button className="btn sm" style={{ marginLeft: 'auto' }}
            onClick={() => onChange({ ...plan, branches: [...plan.branches, { id: newId(), when: '', then: '' }] })}>
            <Icon name="plus" />Add branch
          </button>
        </div>
        {!plan.branches.length ? <div className="t3" style={{ fontSize: 14 }}>Contingencies for the draft — e.g. “they first-pick Rumble” → “take Gnar and ban Ahri next”.</div> : null}
        {plan.branches.map((b, i) => (
          <div key={b.id} style={{ display: 'grid', gridTemplateColumns: '1fr 24px 1fr 36px', gap: 10, alignItems: 'center' }}>
            <input className="input" placeholder="If they…" value={b.when}
              onChange={e => { const br = [...plan.branches]; br[i] = { ...b, when: e.target.value }; onChange({ ...plan, branches: br }); }} />
            <span className="t3" style={{ textAlign: 'center' }}><Icon name="chevron-right" /></span>
            <input className="input" placeholder="…then we" value={b.then}
              onChange={e => { const br = [...plan.branches]; br[i] = { ...b, then: e.target.value }; onChange({ ...plan, branches: br }); }} />
            <button className="btn ghost sm" style={{ padding: 0, width: 36 }} aria-label="Remove branch"
              onClick={() => onChange({ ...plan, branches: plan.branches.filter(x => x.id !== b.id) })}><Icon name="trash" /></button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button className="btn primary" onClick={onSave} disabled={saving}><Icon name="check" />{saving ? 'Saving…' : 'Save plan'}</button>
        {savedAt ? <span className="t3" style={{ fontSize: 13 }}>Saved {new Date(savedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{plan.updatedBy ? ` by ${plan.updatedBy}` : ''}</span> : null}
      </div>

      {picker ? (() => {
        const side = plan[picker.side];
        const current = picker.kind === 'ban' ? side.bans[picker.i] : side.priorityPicks[picker.i];
        const apply = (name: string) => {
          if (picker.kind === 'ban') { const b = [...side.bans]; b[picker.i] = name; setSide(picker.side, { ...side, bans: b }); }
          else {
            const p = [...side.priorityPicks];
            if (name) p[picker.i] = name; else p.splice(picker.i, 1);
            setSide(picker.side, { ...side, priorityPicks: p.filter(Boolean) });
          }
          setPicker(null);
        };
        return (
          <ChampionPicker
            title={`${picker.side === 'blue' ? 'Blue' : 'Red'} · ${picker.kind === 'ban' ? `ban ${picker.i + 1}` : `priority pick ${picker.i + 1}`}`}
            used={[...side.bans, ...side.priorityPicks]}
            onPick={apply}
            onClear={current ? () => apply('') : undefined}
            onClose={() => setPicker(null)}
          />
        );
      })() : null}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

function Prep() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, ready } = useUser();
  const [input, setInput] = useState(() => params.get('opponent') ?? '');
  const [opponent, setOpponent] = useState(() => params.get('opponent') ?? '');
  const [suggest, setSuggest] = useState<{ name: string; why: string }[]>([]);
  const [tab, setTab] = useState<'report' | 'plan'>('report');

  const [report, setReport] = useState<Report | null>(null);
  const [plan, setPlan] = useState<DraftPlan | null>(null);
  const [loadingFor, setLoadingFor] = useState('');
  const [building, setBuilding] = useState(false);
  const [err, setErr] = useState('');
  const [briefing, setBriefing] = useState(false);
  const [briefErr, setBriefErr] = useState('');
  const [saving, setSaving] = useState(false);
  // The opponent the draft room scouts. Set here, stored on the shared draft
  // state (SET_OPPONENT), so it reaches the draft room over Pusher.
  const [nextOpp, setNextOpp] = useState<string | null>(null);

  // Who could we be preparing for: next fixture, the coach's manual pick,
  // teams we've scrimmed, and teams we already have a plan for.
  useEffect(() => {
    const add = new Map<string, string>();
    Promise.allSettled([
      fetch('/api/fixture').then(r => r.json()).then(d => {
        (d.tournaments ?? []).flatMap((t: { matches: { opponent: string; isPast: boolean }[] }) => t.matches)
          .filter((m: { isPast: boolean }) => !m.isPast).forEach((m: { opponent: string }) => { if (m.opponent && m.opponent !== 'TBD') add.set(m.opponent, 'next match'); });
      }),
      fetch('/api/draft').then(r => r.json()).then(d => {
        setNextOpp(d.opponent ?? null);
        if (d.opponent && !add.has(d.opponent)) add.set(d.opponent, 'next opponent');
      }),
      fetch('/api/prep').then(r => r.json()).then(d => (d.plans ?? []).forEach((p: DraftPlan) => { if (!add.has(p.opponent)) add.set(p.opponent, 'has a plan'); })),
      fetch('/api/scrims').then(r => r.json()).then(d => (d.games ?? []).slice(0, 40).forEach((g: ScrimGame) => { if (!add.has(g.opponent)) add.set(g.opponent, 'scrimmed'); })),
    ]).then(() => setSuggest([...add.entries()].slice(0, 10).map(([name, why]) => ({ name, why }))));
  }, []);

  const load = useCallback((opp: string) => {
    setLoadingFor(opp); setErr(''); setBriefErr(''); setReport(null); setPlan(null);
    fetch(`/api/prep?opponent=${encodeURIComponent(opp)}`).then(r => r.json()).then(d => {
      setReport(d.report ?? null);
      setPlan(d.plan ?? emptyPlan(opp));
    }).catch(() => setPlan(emptyPlan(opp))).finally(() => setLoadingFor(''));
  }, []);

  useEffect(() => { if (opponent) load(opponent); }, [opponent, load]);

  const choose = (name: string) => {
    const n = name.trim(); if (!n) return;
    setInput(n); setOpponent(n);
    router.replace(`/prep?opponent=${encodeURIComponent(n)}`);
  };

  const saveReport = (r: Report) => fetch('/api/prep', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'report', opponent: r.opponent, report: r }),
  }).catch(() => {});

  const build = async () => {
    setBuilding(true); setErr('');
    try {
      const r = await buildReport(opponent);
      if (!r.games) { setErr(`Leaguepedia has no games for “${opponent}”. Check the team’s exact name there.`); setBuilding(false); return; }
      setReport(r); saveReport(r);
    } catch (e) {
      setErr(e instanceof Error && e.message === 'ratelimited'
        ? 'Leaguepedia is rate-limiting right now. Try again in a few minutes — a saved report is shared with the team, so this only needs to succeed once.'
        : 'Could not reach Leaguepedia.');
    }
    setBuilding(false);
  };

  const brief = async () => {
    if (!report) return;
    setBriefing(true); setBriefErr('');
    const stats = {
      games: report.games, record: `${report.wins}-${report.games - report.wins}`,
      blueSide: `${report.side.blue.w}-${report.side.blue.n - report.side.blue.w}`,
      redSide: `${report.side.red.w}-${report.side.red.n - report.side.red.w}`,
      avgGameMinutes: report.avgMinutes && Math.round(report.avgMinutes),
      perGame: report.perGame,
      firstPickOnBlue: report.firstPicks.slice(0, 5), theirBans: report.theirBans.slice(0, 6),
      bannedAgainstThem: report.bannedAgainst.slice(0, 6), mostPicked: report.picks.slice(0, 8),
      players: report.players.slice(0, 5).map(p => ({ name: p.name, role: p.role, games: p.games, winRate: p.wr, champions: p.champs.slice(0, 3) })),
    };
    try {
      const res = await fetch('/api/opponent-ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ opponent: report.opponent, stats }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'AI error');
      const next = { ...report, brief: d.brief };
      setReport(next); saveReport(next);
    } catch (e) { setBriefErr(e instanceof Error ? e.message : 'AI error'); }
    setBriefing(false);
  };

  const savePlan = async () => {
    if (!plan) return;
    setSaving(true);
    const res = await fetch('/api/prep', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'plan', plan: { ...plan, opponent }, updatedBy: user?.name }),
    });
    const d = await res.json();
    if (res.ok) setPlan(d.plan);
    setSaving(false);
  };

  const setAsNext = async (name: string | null) => {
    setNextOpp(name);
    await fetch('/api/draft', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'SET_OPPONENT', payload: { opponent: name ?? '' }, userName: user?.name }),
    }).catch(() => {});
  };
  const isNext = !!nextOpp && !!opponent && nextOpp.toLowerCase() === opponent.toLowerCase();

  const age = report?.savedAt ?? report?.builtAt;
  const stale = useMemo(() => (age ? Date.now() - age > 3 * 86400000 : false), [age]);

  if (!ready || !user) return <div className="hub" />;

  return (
    <div className="hub">
      <Nav active="prep" user={user} />
      <div className="page">
        <div className="page-head">
          <div>
            <div className="h" style={{ fontSize: 32 }}>Match prep</div>
            <div className="t2" style={{ marginTop: 4 }}>Scouting report and draft plan for an opponent</div>
          </div>
        </div>

        <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <input className="input" style={{ flex: 1, minWidth: 240 }} placeholder="Opponent — team name as written on Leaguepedia" value={input}
              onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') choose(input); }} />
            <button className="btn primary" onClick={() => choose(input)}>Open</button>
          </div>
          {suggest.length ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {suggest.map(s => (
                <button key={s.name} className={opponent === s.name ? 'chip on' : 'chip'} onClick={() => choose(s.name)}>
                  {s.name}<span className="t3" style={{ fontSize: 12, marginLeft: 6, fontWeight: 400 }}>{s.why}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {!opponent ? <div className="card empty">Pick an opponent to start.</div> : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div className="h" style={{ fontSize: 28 }}>{opponent}</div>
              {isNext ? (
                <>
                  <span className="tag win" style={{ gap: 6 }}><Icon name="check" size={14} />Next opponent</span>
                  <button className="btn ghost sm" onClick={() => setAsNext(null)}>Clear</button>
                </>
              ) : (
                <button className="btn sm" onClick={() => setAsNext(opponent)} title="The draft room scouts the next opponent">
                  <Icon name="target" />Set as next opponent
                </button>
              )}
              {nextOpp && !isNext ? <span className="t3" style={{ fontSize: 13 }}>Currently: {nextOpp}</span> : null}
            </div>
            <div className="tabs">
              <button className={tab === 'report' ? 'tab on' : 'tab'} onClick={() => setTab('report')}>Scouting report</button>
              <button className={tab === 'plan' ? 'tab on' : 'tab'} onClick={() => setTab('plan')}>Draft plan</button>
            </div>

            {loadingFor ? <div className="empty">Loading…</div> : tab === 'report' ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  {age ? <span className={stale ? 'tag warn' : 'tag neutral'}>Built {new Date(age).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}{stale ? ' · may be out of date' : ''}</span> : null}
                  <button className="btn" style={{ marginLeft: 'auto' }} onClick={build} disabled={building}>
                    <Icon name="refresh" />{building ? 'Building…' : report ? 'Rebuild' : 'Build report'}
                  </button>
                </div>
                {err ? <div className="card" style={{ padding: 16, color: 'var(--loss)', borderColor: 'rgba(248,113,113,0.4)' }}>{err}</div> : null}
                {report ? <ReportView r={report} onBrief={brief} briefing={briefing} briefErr={briefErr} /> : !building && !err ? (
                  <div className="card empty">No report for {opponent} yet. Build it once and the whole team can open it.</div>
                ) : null}
              </>
            ) : plan ? (
              <PlanEditor plan={plan} onChange={setPlan} onSave={savePlan} saving={saving} savedAt={plan.updatedAt} />
            ) : null}
          </>
        )}
      </div>
      <style>{`.hub .pdr{display:grid;grid-template-columns:110px 1fr;gap:8px 12px;align-items:center;padding:0 16px 14px;}`}</style>
    </div>
  );
}

export default function PrepPage() {
  return <Suspense fallback={<div className="hub" />}><Prep /></Suspense>;
}
