'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { champImg } from '../../lib/champions';
import { type Count, type RecentGame, type RecentSeries, type Report } from '../../lib/report';
import { newId, type DraftPlan, type DraftPlanSide, type ScrimGame } from '../../lib/hub';
import { USERS } from '../../lib/users';
import Nav from '../components/Nav';
import Icon from '../components/Icon';
import ChampionPicker, { Slot } from '../components/ChampionPicker';
import { useUser } from '../components/useUser';

// ── Opponent report ─────────────────────────────────────────────────────────
// The report is built by /api/opponent-report on the server and saved in
// Redis. It used to be built here, in the browser, which spent the viewer's
// own Leaguepedia rate limit — one person testing could lock their whole
// network out of the feature.

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

// ── Draft board ─────────────────────────────────────────────────────────────
// The part of the report a coach reads with the draft screen open. Everything
// here is scoped to the current patch by the server: a pick priority from
// three patches ago is not their priority.

const ROLE_ORDER = ['Top', 'Jungle', 'Mid', 'Bot', 'Support', 'Unknown'];

/** Role split of a pick slot — "their first pick is a jungler" at a glance. */
function RoleBar({ roles }: { roles: Count[] }) {
  const total = roles.reduce((a, r) => a + r.n, 0);
  if (!total) return null;
  const sorted = [...roles].sort((a, b) => ROLE_ORDER.indexOf(a.name) - ROLE_ORDER.indexOf(b.name));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="rolebar">
        {sorted.map(r => (
          <span key={r.name} className={`r-${ROLE_ORDER.includes(r.name) ? r.name : 'Unknown'}`}
            style={{ width: `${(r.n / total) * 100}%` }} title={`${r.name} ${r.n}/${total}`} />
        ))}
      </div>
      <div className="t3" style={{ fontSize: 12 }}>
        {sorted.map(r => `${r.name} ${Math.round((r.n / total) * 100)}%`).join(' · ')}
      </div>
    </div>
  );
}

const img = (e: React.SyntheticEvent<HTMLImageElement>) => { (e.target as HTMLImageElement).src = '/logo.png'; };

/** A champion tile with its count — the unit the whole board is built from. */
function Chip({ c, ban, sm }: { c: Count; ban?: boolean; sm?: boolean }) {
  const wr = c.w !== undefined ? pct(c.w, c.n) : null;
  return (
    <div className="cu" title={`${c.name} · ${c.n}×${wr !== null ? ` · ${wr}%` : ''}`}>
      <img src={champImg(c.name)} alt={c.name} className={`champ${ban ? ' ban' : ''}${sm ? ' sm' : ''}`} onError={img} />
      <span className="mono t2" style={{ fontSize: 11 }}>{c.n}</span>
    </div>
  );
}

function ChipRow({ items, ban }: { items: Count[]; ban?: boolean }) {
  if (!items.length) return <span className="t3" style={{ fontSize: 12 }}>No data</span>;
  return <div className="row">{items.map(c => <Chip key={c.name} c={c} ban={ban} />)}</div>;
}

/** One pick slot as a row: what it is, which roles go in it, what they take. */
function SlotRow({ s }: { s: NonNullable<Report['draft']>['slots'][number] }) {
  return (
    <div className="dslot">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: s.side === 'blue' ? 'var(--blue-side)' : 'var(--red-side)' }}>{s.key}</span>
        <span className="t3" style={{ fontSize: 12 }}>{s.label}</span>
        <span className="mono t3" style={{ fontSize: 11, marginLeft: 'auto' }}>{s.n}</span>
      </div>
      <RoleBar roles={s.roles} />
      <ChipRow items={s.champs} />
    </div>
  );
}

/** One side's whole draft behaviour, in the column it sits in during a draft. */
function SideColumn({ side, slots, rec }: {
  side: 'blue' | 'red'; slots: NonNullable<Report['draft']>['slots']; rec: { n: number; w: number };
}) {
  const mine = slots.filter(s => s.side === side);
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className={`sidehead ${side}`}>
        <span className={side === 'blue' ? 'tag blue' : 'tag red'}>{side === 'blue' ? 'Blue side' : 'Red side'}</span>
        <span className="mono t2" style={{ fontSize: 12 }}>{rec.n} games · {rec.w}–{rec.n - rec.w}</span>
      </div>
      {mine.length ? mine.map(s => <SlotRow key={s.key} s={s} />) : <div className="dslot t3" style={{ fontSize: 13 }}>No games on this side.</div>}
      {/* A thin sample reads as a tendency unless it is called out. */}
      {rec.n > 0 && rec.n < 5 ? (
        <div className="dslot" style={{ fontSize: 12, color: 'var(--warn)' }}>
          Only {rec.n} games on this side this patch — read lightly.
        </div>
      ) : null}
    </div>
  );
}

/**
 * "What do they never let through." The denominator is the point: a champion
 * taken 4 times out of 4 games where nobody banned it is a completely
 * different read from one taken 4 times in 20.
 */
function Priority({ items }: { items: NonNullable<Report['draft']>['priority'] }) {
  if (!items.length) return null;
  return (
    <div className="card" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div>
        <div className="sec sm">Never let through</div>
        <div className="t3" style={{ fontSize: 11 }}>taken / games where nobody banned it</div>
      </div>
      <div className="priogrid">
        {items.slice(0, 10).map(p => (
          <div key={p.name} className="prio" title={`Picked ${p.picked} of ${p.open} games it was open${p.conceded ? ` · opponents took it ${p.conceded}x` : ''}`}>
            <img src={champImg(p.name)} alt="" className="champ" onError={img} />
            <span style={{ fontSize: 13 }}>{p.name}</span>
            <span className="mono" style={{ fontSize: 12, textAlign: 'right', color: p.rate >= 35 ? 'var(--warn)' : 'var(--text)' }}>{p.rate}%</span>
            <div className="track"><span style={{ width: `${p.rate}%` }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Their record on a champion, best or worst first.
 *
 * A scouting report that only lists comfort picks is half a report: what a
 * team keeps losing on is as actionable as what they are good at, and it is
 * the same column of data read from the other end.
 */
function RecordList({ items, worst }: { items: Count[]; worst?: boolean }) {
  const sorted = worst ? [...items].reverse() : items;
  const shown = sorted.filter(c => {
    const wr = pct(c.w ?? 0, c.n);
    return worst ? wr <= 50 : wr >= 50;
  }).slice(0, 6);
  return (
    <div className="card" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div>
        <div className="sec sm">{worst ? 'They lose with' : 'They win with'}</div>
        <div className="t3" style={{ fontSize: 11 }}>their record when they pick it · 2+ games</div>
      </div>
      {!shown.length ? <span className="t3" style={{ fontSize: 12 }}>Not enough repeats this patch</span> : shown.map(c => {
        const w = c.w ?? 0;
        return (
          <div key={c.name} style={{ display: 'grid', gridTemplateColumns: '30px 1fr auto', gap: 9, alignItems: 'center' }}>
            <img src={champImg(c.name)} alt="" className="champ" onError={img} />
            <span style={{ fontSize: 13 }}>{c.name}</span>
            <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: wrColor(pct(w, c.n)) }}>{w}–{c.n - w}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Whole drafts, so a composition reads as one thing rather than five picks. */
function Comps({ items, won }: { items: NonNullable<Report['draft']>['comps']['won']; won?: boolean }) {
  return (
    <div className="card" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div>
        <div className="sec sm">{won ? `Drafts they won (${items.length})` : `Drafts they lost (${items.length})`}</div>
        <div className="t3" style={{ fontSize: 11 }}>in draft order, this patch</div>
      </div>
      {!items.length ? <span className="t3" style={{ fontSize: 12 }}>None this patch</span> : items.map(c => (
        <div key={c.gameId} style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <span className={c.side === 'blue' ? 'tag blue' : 'tag red'} style={{ height: 20, fontSize: 11 }}>
            {c.side === 'blue' ? 'B' : 'R'}
          </span>
          <div className="row" style={{ gap: 5 }}>
            {c.picks.map((p, i) => (
              <img key={i} src={champImg(p)} className="champ sm" alt={p}
                title={`${p}${c.roles[i] ? ` · ${c.roles[i]}` : ''}`} onError={img} />
            ))}
          </div>
          <span className="t3" style={{ fontSize: 11, marginLeft: 'auto' }}>vs {c.vs}</span>
        </div>
      ))}
    </div>
  );
}

/** Bans 1-3 go down blind; 4-5 answer what is already picked. Different reads. */
function Bans({ title, hint, first, second, flag }: {
  title: string; hint: string; first: Count[]; second: Count[]; flag?: string;
}) {
  return (
    <div className="card" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div><div className="sec sm">{title}</div><div className="t3" style={{ fontSize: 11 }}>{hint}</div></div>
      <div className="t3" style={{ fontSize: 11 }}>first rotation · blind</div>
      <ChipRow items={first} ban />
      <div className="t3" style={{ fontSize: 11 }}>second rotation · reactive</div>
      <ChipRow items={second} ban />
      {flag ? <div style={{ fontSize: 12, color: 'var(--warn)' }}>{flag}</div> : null}
    </div>
  );
}

/**
 * "Banned in every game" is the strongest single line a scouting report has,
 * so it is stated in words rather than left for the reader to spot.
 */
function alwaysBanned(items: Count[], games: number): string | undefined {
  const top = items[0];
  if (!top || !games || top.n < Math.max(3, Math.ceil(games * 0.8))) return undefined;
  return top.n >= games
    ? `${top.name} banned in all ${games} games.`
    : `${top.name} banned in ${top.n} of ${games}.`;
}

/**
 * The whole draft read on one screen, laid out the way a draft is: their blue
 * behaviour on the left, red on the right, the bans between them. Rows rather
 * than cards — a card per pick slot is what made this unreadable at a glance.
 */
function DraftBoard({ d, patchCounts }: { d: NonNullable<Report['draft']>; patchCounts: Report['patchCounts'] }) {
  const [wide, setWide] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div className="h" style={{ fontSize: 22 }}>Draft</div>
        <span className="tag accent">Patch {d.patches.join(' + ')}</span>
        <span className="t3" style={{ fontSize: 13 }}>{d.games} games · {d.wins}–{d.games - d.wins}</span>
        {d.widened ? (
          <span className="tag warn" title="The newest patch alone had too few games to read">
            widened to {d.patches.length} patches
          </span>
        ) : null}
        {patchCounts?.length ? (
          <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setWide(v => !v)}>
            <Icon name={wide ? 'chevron-up' : 'chevron-down'} />Patches
          </button>
        ) : null}
      </div>

      {wide && patchCounts?.length ? (
        <div className="card" style={{ padding: '10px 14px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {patchCounts.map(p => (
            <span key={p.patch} className={d.patches.includes(p.patch) ? 'tag accent' : 'tag neutral'}>{p.patch} · {p.n}</span>
          ))}
        </div>
      ) : null}

      <div className="dboard">
        <SideColumn side="blue" slots={d.slots} rec={d.side.blue} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <Bans title="They ban" hint="their own bans" first={d.bans.first} second={d.bans.second} />
          <Bans title="Banned against them" hint="the pool other teams respect"
            first={d.bannedAgainst.first} second={d.bannedAgainst.second}
            flag={alwaysBanned(d.bannedAgainst.first, d.games)} />
        </div>

        <SideColumn side="red" slots={d.slots} rec={d.side.red} />
      </div>

      {/* What they win and lose with, side by side — a report that lists only
          comfort picks answers half the question a coach came with.

          Optional throughout: ANALYSIS_VERSION makes an older-shaped saved
          report rebuild, but a section that is missing should go missing, not
          take the page down with it. */}
      {d.record?.length ? (
        <div className="duo">
          <RecordList items={d.record} />
          <RecordList items={d.record} worst />
        </div>
      ) : null}

      {d.comps ? (
        <div className="duo">
          <Comps items={d.comps.won ?? []} won />
          <Comps items={d.comps.lost ?? []} />
        </div>
      ) : null}

      {/* Full width now: eight tall rows in the middle column left the two side
          columns short and the whole board lopsided. */}
      <Priority items={d.priority} />

      {/* Pools last: the slots above already say when each role gets picked. */}
      <div className="card" style={{ padding: '12px 14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 16 }}>
        {d.byRole.map(r => (
          <div key={r.role} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className={`r-${ROLE_ORDER.includes(r.role) ? r.role : 'Unknown'}`}
                style={{ width: 8, height: 8, borderRadius: 2, display: 'block' }} />
              <span className="sec sm">{r.role}</span>
            </div>
            <ChipRow items={r.champs} />
          </div>
        ))}
        {d.flex.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="sec sm" title="Played in more than one role — the draft cannot pin them down">Flex</span>
            <div className="row">
              {d.flex.map(f => (
                <img key={f.name} src={champImg(f.name)} alt={f.name} className="champ" onError={img}
                  title={`${f.name} · ${f.roles.map(r => `${r.name} ${r.n}x`).join(', ')}`} />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const KIND_TAG: Record<string, string> = { ban: 'tag loss', watch: 'tag warn', exploit: 'tag win', draft: 'tag accent', player: 'tag blue' };

/** One team’s half of a game: who they are, what they picked, what they banned. */
function GameTeam({ who, side, picks, roles, bans }: {
  who: string; side: 'blue' | 'red'; picks: string[]; roles: string[]; bans: string[];
}) {
  return (
    <div className="gteam">
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <span style={{ width: 6, height: 6, borderRadius: 2, flex: 'none', background: side === 'blue' ? 'var(--blue-side)' : 'var(--red-side)' }} />
        <span className="who t2" title={who}>{who}</span>
      </div>
      <div className="gset">
        <span className="k">picks</span>
        <div className="row" style={{ gap: 6 }}>
          {picks.map((c, j) => (
            <img key={j} src={champImg(c)} className="champ sm" alt={c} title={`${c}${roles[j] ? ` · ${roles[j]}` : ''}`} onError={img} />
          ))}
        </div>
      </div>
      <div className="gset">
        <span className="k">bans</span>
        <div className="row" style={{ gap: 6 }}>
          {bans.map((c, j) => (
            <img key={j} src={champImg(c)} className="champ sm ban" alt={c} title={`banned ${c}`} onError={img} />
          ))}
        </div>
      </div>
    </div>
  );
}
/**
 * Recent games as SERIES, not games. A BO3/BO5 is one row that opens into its
 * games — listing five games of one BO5 as five separate results made a single
 * match look like a week of play.
 */
function SeriesList({ series, recent, opponent }: { series?: RecentSeries[]; recent: RecentGame[]; opponent: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [vod, setVod] = useState<{ id: string; kind: 'draft' | 'game' } | null>(null);

  // A report saved before series grouping existed only has the flat list.
  const rows: RecentSeries[] = series ?? recent.map(g => ({
    matchId: g.gameId, date: g.date, tournament: g.tournament, vs: g.vs,
    us: g.won ? 1 : 0, them: g.won ? 0 : 1, won: g.won, patch: g.patch, games: [g],
  }));
  if (!rows.length) return null;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div className="h" style={{ fontSize: 22 }}>Recent series</div>
        <span className="t3" style={{ fontSize: 13 }}>
          {rows.length} series · {rows.reduce((a, s) => a + s.games.length, 0)} games
        </span>
        {/* Which VOD fields Leaguepedia fills is per-league, and some fill none
            at all — say so rather than leaving a row that looks broken. */}
        {rows.every(s => s.games.every(g => !g.vod && !g.vodGame)) ? (
          <span className="t3" style={{ fontSize: 12 }}>· Leaguepedia has no VODs for this league</span>
        ) : null}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(s => {
          const on = open === s.matchId;
          return (
            <div key={s.matchId} className="card" style={on ? { borderColor: 'var(--border-strong)' } : undefined}>
              <button className="srow" style={{ width: '100%', background: 'none', border: 0, color: 'inherit', textAlign: 'left', font: 'inherit', cursor: 'pointer' }}
                onClick={() => setOpen(on ? null : s.matchId)} aria-expanded={on}>
                <span className={s.won ? 'tag win' : 'tag loss'}>{s.won ? 'Won' : 'Lost'}</span>
                <span style={{ fontWeight: 500 }}>vs {s.vs}</span>
                <span className="mono" style={{ fontSize: 19, fontWeight: 600 }}>
                  <span style={{ color: s.won ? 'var(--win)' : 'var(--loss)' }}>{s.us}</span>
                  <span className="t3">–</span>{s.them}
                </span>
                {/* gamesPlayed is not the format: a BO5 ending 3-1 has four. */}
                <span className="t3 s-hide" style={{ fontSize: 12 }}>{s.games.length} game{s.games.length > 1 ? 's' : ''}</span>
                <span className="t3 s-hide" style={{ fontSize: 12 }}>{s.date} · {s.tournament}</span>
                <span className="tag neutral mono s-hide">{s.patch || '—'}</span>
                <Icon name={on ? 'chevron-up' : 'chevron-down'} />
              </button>

              {on ? s.games.map((g, i) => {
                const open = vod?.id === g.gameId ? vod : null;
                return (
                <div key={g.gameId}>
                  <div className="grow">
                    <span className="mono t3" style={{ fontSize: 12 }}>G{g.gameNo || i + 1}</span>
                    <div>
                      <GameTeam who={opponent} side={g.side} picks={g.theirPicks} roles={g.theirRoles} bans={g.theirBans} />
                      {/* The other side matters as much: their picks are what
                          this draft was answering. */}
                      <GameTeam who={g.vs} side={g.side === 'blue' ? 'red' : 'blue'} picks={g.oppPicks} roles={g.oppRoles} bans={g.oppBans} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                      <span className="mono" style={{ fontSize: 12, color: g.won ? 'var(--win)' : 'var(--loss)' }}>{g.won ? 'Win' : 'Loss'}</span>
                      {/* Both links are the same broadcast at different offsets:
                          VodPB lands on the draft, VodGameStart on the game. */}
                      {g.vod ? (
                        <button className="btn ghost sm" onClick={() => setVod(open?.kind === 'draft' ? null : { id: g.gameId, kind: 'draft' })}>
                          <Icon name={open?.kind === 'draft' ? 'chevron-up' : 'play'} />Draft
                        </button>
                      ) : null}
                      {g.vodGame ? (
                        <button className="btn ghost sm" onClick={() => setVod(open?.kind === 'game' ? null : { id: g.gameId, kind: 'game' })}>
                          <Icon name={open?.kind === 'game' ? 'chevron-up' : 'play'} />Game
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {open ? (
                    <iframe src={(open.kind === 'draft' ? g.vod : g.vodGame) ?? ''} title={`${open.kind} vs ${g.vs}`}
                      allow="encrypted-media; picture-in-picture" allowFullScreen
                      style={{ display: 'block', width: 'calc(100% - 44px)', margin: '4px 22px 12px', aspectRatio: '16 / 9', border: 0, borderRadius: 6 }} />
                  ) : null}
                </div>
                );
              }) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}


function ReportView({ r, onBrief, briefing, briefErr }: { r: Report; onBrief: () => void; briefing: boolean; briefErr: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        <div className="card stat"><div className="sec sm">Record · last {r.games}</div><div className="mono" style={{ fontSize: 24, fontWeight: 600 }}>{r.wins}<span className="t3">–</span>{r.games - r.wins}</div><div className="t3" style={{ fontSize: 13 }}>{pct(r.wins, r.games)}% win rate</div></div>
        <div className="card stat"><div className="sec sm">Blue side</div><div className="mono" style={{ fontSize: 24, fontWeight: 600, color: 'var(--blue-side)' }}>{pct(r.side.blue.w, r.side.blue.n)}%</div><div className="t3" style={{ fontSize: 13 }}>{r.side.blue.w}–{r.side.blue.n - r.side.blue.w}</div></div>
        <div className="card stat"><div className="sec sm">Red side</div><div className="mono" style={{ fontSize: 24, fontWeight: 600, color: 'var(--red-side)' }}>{pct(r.side.red.w, r.side.red.n)}%</div><div className="t3" style={{ fontSize: 13 }}>{r.side.red.w}–{r.side.red.n - r.side.red.w}</div></div>
        <div className="card stat"><div className="sec sm">Avg game</div><div className="mono" style={{ fontSize: 24, fontWeight: 600 }}>{r.avgMinutes ? `${Math.round(r.avgMinutes)}m` : '—'}</div><div className="t3" style={{ fontSize: 13 }}>{r.avgMinutes ? (r.avgMinutes < 29 ? 'plays for early' : r.avgMinutes > 34 ? 'goes long' : 'mid-length games') : ''}</div></div>
        <div className="card stat"><div className="sec sm">Per game</div><div className="mono" style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>{r.perGame.dragons?.toFixed(1) ?? '—'} <span className="t3" style={{ fontSize: 13 }}>drag</span> · {r.perGame.barons?.toFixed(1) ?? '—'} <span className="t3" style={{ fontSize: 13 }}>baron</span></div><div className="t3" style={{ fontSize: 13 }}>{r.perGame.towers?.toFixed(1) ?? '—'} towers · {r.perGame.grubs?.toFixed(1) ?? '—'} grubs</div></div>
      </div>

      <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
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

      {/* The draft board replaces the four flat count lists that used to sit
          here: it says the same things per pick slot and per patch instead of
          averaging every game we fetched. */}
      {r.draft ? <DraftBoard d={r.draft} patchCounts={r.patchCounts} /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
          <CountList title="First pick on blue" hint="what they take B1" items={r.firstPicks} />
          <CountList title="They ban" hint="their own bans" items={r.theirBans} />
          <CountList title="Banned against them" hint="what opponents respect" items={r.bannedAgainst} />
          <CountList title="They pick" hint="most picked · win rate" items={r.picks} showWr />
        </div>
      )}


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
                  <img src={champImg(c.name)} alt="" style={{ width: 28, height: 28, borderRadius: 5 }} onError={img} />
                  <span style={{ fontSize: 14 }}>{c.name}</span>
                  <span className="mono t2" style={{ fontSize: 13 }}>{c.n}× <span style={{ color: wrColor(pct(c.w ?? 0, c.n)) }}>{pct(c.w ?? 0, c.n)}%</span></span>
                </div>
              ))}
              {/* The other end of the same tally: a top-5 by games played hides
                  whatever they keep losing on. */}
              {p.weak?.length ? (
                <>
                  <div className="sec sm" style={{ marginTop: 2 }}>Struggles on</div>
                  {p.weak.map(c => (
                    <div key={c.name} style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto', gap: 8, alignItems: 'center' }}>
                      <img src={champImg(c.name)} alt="" style={{ width: 28, height: 28, borderRadius: 5, opacity: 0.75 }} onError={img} />
                      <span style={{ fontSize: 14 }}>{c.name}</span>
                      <span className="mono" style={{ fontSize: 13, color: 'var(--loss)' }}>{c.w ?? 0}–{c.n - (c.w ?? 0)}</span>
                    </div>
                  ))}
                </>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <SeriesList series={r.series} recent={r.recent} opponent={r.opponent} />
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
        {(['blue', 'red'] as const).map(s => {
          const v = plan[s];
          return (
            <div key={s} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, borderTop: `3px solid ${s === 'blue' ? 'var(--blue-side)' : 'var(--red-side)'}` }}>
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
                      <span className="mono" style={{ position: 'absolute', top: -7, left: -7, width: 20, height: 20, borderRadius: 10, background: 'var(--accent)', color: 'var(--accent-ink)', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
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

      <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
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

// ── Opponent input ──────────────────────────────────────────────────────────

type TeamHit = { name: string; short: string; region: string; disbanded: boolean };

/**
 * The opponent is picked from a list rather than typed from memory: the name
 * has to match Leaguepedia exactly, and a wrong spelling comes back as zero
 * rows rather than an error, so a typo looks like "this team has no games".
 *
 * /api/teams answers from a weekly cache keyed by the first two letters; the
 * debounce is what keeps a fast typist from spending Leaguepedia's rate limit
 * while that cache is still filling.
 */
function OpponentInput({ value, onChange, onChoose }: {
  value: string;
  onChange: (v: string) => void;
  onChoose: (name: string) => void;
}) {
  // Results carry the search they answer, so a half-typed name never shows
  // the previous search's list while the next one is in flight.
  const [res, setRes] = useState<{ q: string; list: TeamHit[] }>({ q: '', list: [] });
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const q = value.trim();
  const hits = open && res.q === q && q ? res.list : [];

  useEffect(() => {
    const term = value.trim();
    if (!open || !term) return;
    let live = true;
    const t = setTimeout(() => {
      fetch(`/api/teams?q=${encodeURIComponent(term)}`)
        .then(r => r.json())
        .then(d => { if (live) { setRes({ q: term, list: d.teams ?? [] }); setCursor(-1); } })
        .catch(() => { if (live) setRes({ q: term, list: [] }); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [value, open]);

  const pick = (name: string) => { setOpen(false); onChoose(name); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!hits.length) return;
      setCursor(c => e.key === 'ArrowDown'
        ? (c + 1 >= hits.length ? 0 : c + 1)
        : (c - 1 < 0 ? hits.length - 1 : c - 1));
    } else if (e.key === 'Enter') {
      pick(cursor >= 0 && hits[cursor] ? hits[cursor].name : value);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div style={{ flex: 1, minWidth: 240, position: 'relative' }}>
      <input
        className="input" style={{ width: '100%' }} autoComplete="off"
        placeholder="Opponent — start typing a team name"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        // A click on an option fires after blur, so the list stays up long
        // enough for that click to land.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKey}
      />
      {open && hits.length ? (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 20,
          background: 'var(--surface-2)', border: '1px solid var(--border-strong)',
          borderRadius: 'var(--r-ctl)', overflow: 'hidden', maxHeight: 320, overflowY: 'auto',
        }}>
          {hits.map((t, i) => (
            <button
              key={t.name} type="button"
              onMouseDown={e => e.preventDefault()}
              onMouseEnter={() => setCursor(i)}
              onClick={() => pick(t.name)}
              style={{
                display: 'flex', width: '100%', alignItems: 'baseline', gap: 8, textAlign: 'left',
                padding: '8px 10px', border: 0, cursor: 'pointer', font: 'inherit',
                color: t.disbanded ? 'var(--text-2)' : 'var(--text)',
                background: i === cursor ? 'var(--surface)' : 'transparent',
              }}>
              <span style={{ fontWeight: 500 }}>{t.name}</span>
              {t.short ? <span className="mono t3" style={{ fontSize: 12 }}>{t.short}</span> : null}
              <span className="t3" style={{ fontSize: 12, marginLeft: 'auto' }}>
                {t.disbanded ? 'disbanded' : t.region}
              </span>
            </button>
          ))}
        </div>
      ) : null}
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
      fetch('/api/scrims').then(r => r.json()).then(d => {
        (d.games ?? []).slice(0, 40).forEach((g: ScrimGame) => { if (!add.has(g.opponent)) add.set(g.opponent, 'scrimmed'); });
      }),
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

  // Only the brief is saved from here; the report itself is written by
  // /api/opponent-report when it builds.
  const saveReport = (r: Report) => fetch('/api/prep', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'report', opponent: r.opponent, report: r }),
  }).catch(() => {});

  const build = async (refresh = true) => {
    setBuilding(true); setErr('');
    try {
      const res = await fetch(`/api/opponent-report?opponent=${encodeURIComponent(opponent)}${refresh ? '&refresh=true' : ''}`);
      const d = await res.json();
      if (!res.ok) { setErr(d.error ?? 'Could not build the report'); setBuilding(false); return; }
      setReport(d.report);
      if (d.stale) setErr('Leaguepedia is rate-limiting; showing the last saved report.');
      else if (d.report?.partial) setErr('Player pools could not be fetched this time — rebuild in a minute to complete the report.');
    } catch {
      setErr('Could not reach the server.');
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
            <div className="h" style={{ fontSize: 24 }}>Match prep</div>
            <div className="t2" style={{ marginTop: 4 }}>Scouting report and draft plan for an opponent</div>
          </div>
        </div>

        <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <OpponentInput value={input} onChange={setInput} onChoose={choose} />
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
              <div className="h" style={{ fontSize: 22 }}>{opponent}</div>
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
                  <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => build(true)} disabled={building}>
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
    </div>
  );
}

export default function PrepPage() {
  return <Suspense fallback={<div className="hub" />}><Prep /></Suspense>;
}
