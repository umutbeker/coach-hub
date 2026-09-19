'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { USERS } from '../../../lib/users';
import { CURRENT_PATCH } from '../../../lib/champions';
import { ROLES, ROLE_LABEL, newId, type Role, type Result, type Side } from '../../../lib/hub';
import Nav from '../../components/Nav';
import Icon from '../../components/Icon';
import ChampionPicker, { Slot } from '../../components/ChampionPicker';
import { useUser } from '../../components/useUser';

type GameDraft = {
  key: string;
  side: Side;
  result: Result | null;
  ourPicks: Record<Role, string>;
  theirPicks: string[];
  ourBans: string[];
  theirBans: string[];
  notes: string;
  vodUrl: string;
};

// Slot address. The picker walks slots in this order so one open picker can
// fill a whole game: our picks top→support, their picks, our bans, their bans.
type Target = { group: 'ourPicks'; role: Role } | { group: 'theirPicks' | 'ourBans' | 'theirBans'; i: number };
const ORDER: Target[] = [
  ...ROLES.map(role => ({ group: 'ourPicks', role }) as Target),
  ...[0, 1, 2, 3, 4].map(i => ({ group: 'theirPicks', i }) as Target),
  ...[0, 1, 2, 3, 4].map(i => ({ group: 'ourBans', i }) as Target),
  ...[0, 1, 2, 3, 4].map(i => ({ group: 'theirBans', i }) as Target),
];
const sameTarget = (a: Target | null, b: Target) =>
  !!a && a.group === b.group && (a.group === 'ourPicks' ? a.role === (b as { role: Role }).role : (a as { i: number }).i === (b as { i: number }).i);

const emptyGame = (side: Side): GameDraft => ({
  key: newId(), side, result: null,
  ourPicks: { top: '', jungle: '', mid: '', adc: '', support: '' },
  theirPicks: ['', '', '', '', ''], ourBans: ['', '', '', '', ''], theirBans: ['', '', '', '', ''],
  notes: '', vodUrl: '',
});

// Module level on purpose: defined inside the form, it would be a new
// component every render and remount its inputs, dropping focus per keystroke.
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 16, alignItems: 'center' }}>
      <div className="t2" style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>{children}</div>
    </div>
  );
}

const valueAt = (g: GameDraft, t: Target) => (t.group === 'ourPicks' ? g.ourPicks[t.role] : g[t.group][t.i]);

function Form() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, ready } = useUser();

  const [date, setDate] = useState(() => params.get('date') || new Date().toISOString().slice(0, 10));
  const [opponent, setOpponent] = useState(() => params.get('opponent') || '');
  const [patch, setPatch] = useState(CURRENT_PATCH);
  const [games, setGames] = useState<GameDraft[]>(() => [emptyGame('blue')]);
  const [cur, setCur] = useState(0);
  const [target, setTarget] = useState<Target | null>(null);
  const [known, setKnown] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Past opponents feed the autocomplete, so a name is typed the same way twice.
  useEffect(() => {
    fetch('/api/scrims').then(r => r.json())
      .then(d => setKnown([...new Set<string>((d.games ?? []).map((g: { opponent: string }) => g.opponent))].sort()))
      .catch(() => {});
  }, []);

  const g = games[cur];
  const rosterByRole = useMemo(
    () => Object.fromEntries(ROLES.map(r => [r, USERS.find(u => u.role === 'player' && u.lane === r)?.name ?? ''])) as Record<Role, string>,
    [],
  );
  const usedInGame = useMemo(
    () => [...Object.values(g.ourPicks), ...g.theirPicks, ...g.ourBans, ...g.theirBans].filter(Boolean),
    [g],
  );

  const patchGame = (fn: (x: GameDraft) => GameDraft) => setGames(gs => gs.map((x, i) => (i === cur ? fn(x) : x)));

  const setSlot = (t: Target, name: string) => patchGame(x => {
    if (t.group === 'ourPicks') return { ...x, ourPicks: { ...x.ourPicks, [t.role]: name } };
    const arr = [...x[t.group]]; arr[t.i] = name;
    return { ...x, [t.group]: arr };
  });

  const pick = (name: string) => {
    if (!target) return;
    setSlot(target, name);
    // Advance to the next empty slot after this one; close when the game is
    // full. `g` is from before this pick, so the slot just filled is skipped
    // explicitly rather than read.
    const at = ORDER.findIndex(t => sameTarget(target, t));
    const after = [...ORDER.slice(at + 1), ...ORDER.slice(0, at)];
    setTarget(after.find(t => !valueAt(g, t)) ?? null);
  };

  const addGame = () => {
    // Sides usually alternate within a scrim block.
    setGames(gs => [...gs, emptyGame(gs[gs.length - 1].side === 'blue' ? 'red' : 'blue')]);
    setCur(games.length);
  };
  const removeGame = (i: number) => {
    if (games.length === 1) return;
    setGames(gs => gs.filter((_, j) => j !== i));
    setCur(c => Math.max(0, c >= i ? c - 1 : c));
  };

  const save = async () => {
    setError('');
    if (!opponent.trim()) { setError('Enter the opponent.'); return; }
    const missing = games.findIndex(x => !x.result);
    if (missing >= 0) { setCur(missing); setError(`Game ${missing + 1}: mark it as a win or a loss.`); return; }
    setSaving(true);
    try {
      const withVod = games.map(x => ({ ...x, vodId: x.vodUrl.trim() ? newId() : undefined }));
      for (const [i, x] of withVod.entries()) {
        if (!x.vodId) continue;
        const r = await fetch('/api/vods', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: x.vodId, url: x.vodUrl.trim(), title: `Scrim vs ${opponent.trim()} · Game ${i + 1}`, source: 'scrim', opponent: opponent.trim(), date, createdBy: user?.name }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(`Game ${i + 1} VOD: ${d.error ?? 'could not save'}`);
      }
      const r = await fetch('/api/scrims', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          createdBy: user?.name,
          games: withVod.map((x, i) => ({
            gameNo: i + 1, date, opponent: opponent.trim(), patch: patch.trim(), side: x.side, result: x.result,
            ourPicks: x.ourPicks, theirPicks: x.theirPicks, ourBans: x.ourBans, theirBans: x.theirBans,
            notes: x.notes, vodId: x.vodId,
          })),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Could not save');
      router.push('/scrims');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
      setSaving(false);
    }
  };

  if (!ready || !user) return <div className="hub" />;

  const targetLabel = (t: Target) =>
    t.group === 'ourPicks' ? `Our ${ROLE_LABEL[t.role]}${rosterByRole[t.role] ? ` · ${rosterByRole[t.role]}` : ''}`
      : t.group === 'theirPicks' ? `Their pick ${t.i + 1}` : t.group === 'ourBans' ? `Our ban ${t.i + 1}` : `Their ban ${t.i + 1}`;

  return (
    <div className="hub">
      <Nav active="scrims" user={user} />
      <div className="page" style={{ maxWidth: 1100 }}>
        <div className="page-head">
          <div>
            <button className="btn ghost sm" style={{ paddingLeft: 0, marginBottom: 8 }} onClick={() => router.push('/scrims')}>
              <Icon name="arrow-left" />Scrims
            </button>
            <div className="h" style={{ fontSize: 32 }}>Log a scrim block</div>
            <div className="t2" style={{ marginTop: 4 }}>
              Click a slot, then type and press Enter — the picker moves to the next empty slot on its own.
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <div className="field">
            <label className="label" htmlFor="opp">Opponent</label>
            <input id="opp" className="input" list="known-opps" value={opponent} onChange={e => setOpponent(e.target.value)} placeholder="Team name" autoFocus={!opponent} />
            <datalist id="known-opps">{known.map(o => <option key={o} value={o} />)}</datalist>
          </div>
          <div className="field">
            <label className="label" htmlFor="date">Date</label>
            <input id="date" type="date" className="input" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="patch">Patch</label>
            <input id="patch" className="input" value={patch} onChange={e => setPatch(e.target.value)} />
          </div>
        </div>

        <div className="tabs" style={{ alignItems: 'center' }}>
          {games.map((x, i) => (
            <button key={x.key} className={i === cur ? 'tab on' : 'tab'} onClick={() => setCur(i)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              Game {i + 1}
              {x.result ? <span className={x.result === 'W' ? 'tag win' : 'tag loss'}>{x.result === 'W' ? 'Win' : 'Loss'}</span> : null}
            </button>
          ))}
          <button className="btn ghost sm" style={{ marginLeft: 8 }} onClick={addGame}><Icon name="plus" />Add game</button>
        </div>

        <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Row label="Our side">
            <div className="seg" style={{ width: 240 }}>
              <button type="button" className={g.side === 'blue' ? 'on' : ''} onClick={() => patchGame(x => ({ ...x, side: 'blue' }))}>Blue</button>
              <button type="button" className={g.side === 'red' ? 'on' : ''} onClick={() => patchGame(x => ({ ...x, side: 'red' }))}>Red</button>
            </div>
          </Row>
          <Row label="Result">
            <div className="seg" style={{ width: 240 }}>
              <button type="button" className={g.result === 'W' ? 'on' : ''} style={g.result === 'W' ? { color: 'var(--win)' } : undefined} onClick={() => patchGame(x => ({ ...x, result: 'W' }))}>Win</button>
              <button type="button" className={g.result === 'L' ? 'on' : ''} style={g.result === 'L' ? { color: 'var(--loss)' } : undefined} onClick={() => patchGame(x => ({ ...x, result: 'L' }))}>Loss</button>
            </div>
          </Row>

          <Row label="Our picks">
            {ROLES.map(role => {
              const t: Target = { group: 'ourPicks', role };
              return (
                <div key={role} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 64 }}>
                  <Slot name={g.ourPicks[role]} active={sameTarget(target, t)} onClick={() => setTarget(t)} size={52} />
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{ROLE_LABEL[role]}</span>
                  <span className="t3" style={{ fontSize: 12, marginTop: -4 }}>{rosterByRole[role] || '—'}</span>
                </div>
              );
            })}
          </Row>
          <Row label="Their picks">
            {[0, 1, 2, 3, 4].map(i => { const t: Target = { group: 'theirPicks', i }; return <Slot key={i} name={g.theirPicks[i]} active={sameTarget(target, t)} onClick={() => setTarget(t)} />; })}
          </Row>
          <Row label="Our bans">
            {[0, 1, 2, 3, 4].map(i => { const t: Target = { group: 'ourBans', i }; return <Slot key={i} ban name={g.ourBans[i]} active={sameTarget(target, t)} onClick={() => setTarget(t)} />; })}
          </Row>
          <Row label="Their bans">
            {[0, 1, 2, 3, 4].map(i => { const t: Target = { group: 'theirBans', i }; return <Slot key={i} ban name={g.theirBans[i]} active={sameTarget(target, t)} onClick={() => setTarget(t)} />; })}
          </Row>

          <Row label="VOD link">
            <input className="input" style={{ maxWidth: 520 }} placeholder="Optional — unlisted YouTube link or video URL" value={g.vodUrl}
              onChange={e => { const v = e.target.value; patchGame(x => ({ ...x, vodUrl: v })); }} />
          </Row>
          <Row label="Notes">
            <textarea className="input" style={{ maxWidth: 720 }} placeholder="What stood out in this game" value={g.notes}
              onChange={e => { const v = e.target.value; patchGame(x => ({ ...x, notes: v })); }} />
          </Row>

          {games.length > 1 ? (
            <div><button className="btn ghost sm" onClick={() => removeGame(cur)}><Icon name="trash" />Remove game {cur + 1}</button></div>
          ) : null}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={save} disabled={saving}>
            <Icon name="check" />
            {saving ? 'Saving…' : `Save ${games.length} game${games.length > 1 ? 's' : ''}`}
          </button>
          <button className="btn ghost" onClick={() => router.push('/scrims')}>Cancel</button>
          {error ? <span style={{ color: 'var(--loss)', fontSize: 14, display: 'inline-flex', gap: 6, alignItems: 'center' }}><Icon name="warning" size={16} />{error}</span> : null}
        </div>
      </div>

      {target ? (
        <ChampionPicker
          title={targetLabel(target)}
          used={usedInGame}
          onPick={pick}
          onClear={valueAt(g, target) ? () => { setSlot(target, ''); } : undefined}
          onClose={() => setTarget(null)}
        />
      ) : null}
    </div>
  );
}

export default function NewScrimPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return <Suspense fallback={<div className="hub" />}><Form /></Suspense>;
}
