'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CalendarEvent, EventType, ScrimGame } from '../../lib/hub';
import Nav from '../components/Nav';
import Icon from '../components/Icon';
import { useUser } from '../components/useUser';

type Item = CalendarEvent & { fixed?: boolean };

const TYPE: Record<EventType, { label: string; color: string; bg: string }> = {
  scrim: { label: 'Scrim', color: 'var(--accent)', bg: 'rgba(139,124,246,0.16)' },
  official: { label: 'Official', color: 'var(--blue-side)', bg: 'rgba(96,165,250,0.16)' },
  review: { label: 'Review', color: 'var(--win)', bg: 'rgba(52,211,153,0.14)' },
  other: { label: 'Other', color: 'var(--text-2)', bg: 'var(--surface-2)' },
};

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const mondayOf = (d: Date) => { const x = new Date(d); const k = (x.getDay() + 6) % 7; x.setDate(x.getDate() - k); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export default function CalendarPage() {
  const router = useRouter();
  const { user, ready } = useUser();
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [fixture, setFixture] = useState<Item[]>([]);
  const [logged, setLogged] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<Partial<CalendarEvent> | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    fetch('/api/calendar').then(r => r.json()).then(d => setEvents(d.events ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    // Official matches come from the fixture, not from here — one source.
    fetch('/api/fixture').then(r => r.json()).then(d => {
      const out: Item[] = [];
      (d.tournaments ?? []).forEach((t: { name: string; league: string; matches: { id: string | number; opponent: string; scheduledAt: string | null; matchType: string }[] }) =>
        t.matches.forEach(m => {
          if (!m.scheduledAt) return;
          const at = new Date(m.scheduledAt);
          out.push({
            id: `fx_${m.id}`, type: 'official', title: `vs ${m.opponent}`, opponent: m.opponent,
            date: iso(at), time: `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`,
            durationMin: 180, notes: `${t.league} · ${t.name} · ${m.matchType}`, createdBy: 'PandaScore', fixed: true,
          });
        }));
      setFixture(out);
    }).catch(() => {});
    // Which scrim days already have results, so the calendar can say so.
    fetch('/api/scrims').then(r => r.json()).then(d => {
      setLogged(new Set((d.games ?? []).map((g: ScrimGame) => `${g.date}|${g.opponent.toLowerCase()}`)));
    }).catch(() => {});
  }, [load]);

  const all = useMemo<Item[]>(() => [...events, ...fixture].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)), [events, fixture]);
  const days = useMemo(() => [0, 1, 2, 3, 4, 5, 6].map(i => addDays(week, i)), [week]);
  const today = iso(new Date());
  const upcoming = useMemo(() => all.filter(e => e.date >= today).slice(0, 8), [all, today]);

  const save = async () => {
    setErr('');
    const r = await fetch('/api/calendar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, createdBy: user?.name }),
    });
    const d = await r.json();
    if (!r.ok) { setErr(d.error ?? 'Could not save'); return; }
    setForm(null); load();
  };
  const del = async (id: string) => {
    if (!confirm('Delete this event?')) return;
    await fetch(`/api/calendar?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    setForm(null); load();
  };

  const isLogged = (e: Item) => !!e.opponent && logged.has(`${e.date}|${e.opponent.toLowerCase()}`);

  if (!ready || !user) return <div className="hub" />;

  const EventChip = ({ e }: { e: Item }) => (
    <button className="ev" style={{ borderLeftColor: TYPE[e.type].color, background: TYPE[e.type].bg }}
      onClick={() => (e.fixed ? router.push('/prep?opponent=' + encodeURIComponent(e.opponent ?? '')) : setForm(e))}
      title={e.notes || e.title}>
      <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>{e.time}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</span>
      {e.type === 'scrim' && isLogged(e) ? <span style={{ fontSize: 12, color: 'var(--win)' }}>results logged</span> : null}
    </button>
  );

  return (
    <div className="hub">
      <Nav active="calendar" user={user} />
      <div className="page">
        <div className="page-head">
          <div>
            <div className="h" style={{ fontSize: 24 }}>Calendar</div>
            <div className="t2" style={{ marginTop: 4 }}>Scrims, reviews and official matches — official ones come from the fixture automatically</div>
          </div>
          <button className="btn primary" onClick={() => setForm({ type: 'scrim', date: today, time: '19:00', durationMin: 180, notes: '' })}>
            <Icon name="plus" />Add event
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn sm" onClick={() => setWeek(w => addDays(w, -7))} aria-label="Previous week"><span style={{ transform: 'rotate(180deg)', display: 'inline-flex' }}><Icon name="chevron-right" /></span></button>
          <button className="btn sm" onClick={() => setWeek(mondayOf(new Date()))}>This week</button>
          <button className="btn sm" onClick={() => setWeek(w => addDays(w, 7))} aria-label="Next week"><Icon name="chevron-right" /></button>
          <div className="h" style={{ fontSize: 20, marginLeft: 8 }}>
            {days[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – {days[6].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
        </div>

        <div className="wk">
          {days.map(d => {
            const k = iso(d);
            const list = all.filter(e => e.date === k);
            return (
              <div key={k} className={k === today ? 'card day now' : 'card day'}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                  <span className="sec sm">{d.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
                  <span className="mono" style={{ fontSize: 18, fontWeight: 600, color: k === today ? 'var(--accent)' : 'var(--text)' }}>{d.getDate()}</span>
                </div>
                <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 140 }}>
                  {list.map(e => <EventChip key={e.id} e={e} />)}
                  <button className="addday" onClick={() => setForm({ type: 'scrim', date: k, time: '19:00', durationMin: 180, notes: '' })} aria-label={`Add event on ${k}`}>
                    <Icon name="plus" size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="card">
          <div style={{ padding: '16px 20px 8px' }}><div className="h" style={{ fontSize: 20 }}>Coming up</div></div>
          {!upcoming.length ? <div className="t3" style={{ padding: '0 20px 18px', fontSize: 14 }}>Nothing scheduled.</div> : upcoming.map(e => (
            <div key={e.id} className="trow" style={{ gridTemplateColumns: '130px 70px 1fr auto', padding: '10px 16px' }}>
              <span className="t2" style={{ fontSize: 14 }}>{new Date(e.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
              <span className="mono t2">{e.time}</span>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
                <span className="tag" style={{ background: TYPE[e.type].bg, color: TYPE[e.type].color }}>{TYPE[e.type].label}</span>
                <span style={{ fontWeight: 500 }}>{e.title}</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {e.opponent && (e.type === 'scrim' || e.type === 'official') ? (
                  <button className="btn sm" onClick={() => router.push('/prep?opponent=' + encodeURIComponent(e.opponent!))}><Icon name="book" />Prep</button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      {form ? (
        <div className="modal-back" onMouseDown={e => { if (e.target === e.currentTarget) setForm(null); }}>
          <div className="modal" style={{ maxWidth: 560 }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <div className="h" style={{ fontSize: 20 }}>{form.id ? 'Edit event' : 'New event'}</div>
              <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setForm(null)} aria-label="Close"><Icon name="x" /></button>
            </div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="seg" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                {(['scrim', 'review', 'other'] as const).map(t => (
                  <button key={t} type="button" className={form.type === t ? 'on' : ''} onClick={() => setForm({ ...form, type: t })}>{TYPE[t].label}</button>
                ))}
              </div>
              {form.type === 'scrim' ? (
                <div className="field"><label className="label">Opponent</label><input className="input" value={form.opponent ?? ''} onChange={e => setForm({ ...form, opponent: e.target.value })} autoFocus /></div>
              ) : null}
              <div className="field"><label className="label">Title {form.type === 'scrim' ? <span className="t3">· optional</span> : null}</label>
                <input className="input" placeholder={form.type === 'review' ? 'e.g. Review: scrims vs Anubis' : form.type === 'scrim' ? 'Defaults to “Scrim vs …”' : ''} value={form.title ?? ''} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div className="field"><label className="label">Date</label><input type="date" className="input" value={form.date ?? ''} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
                <div className="field"><label className="label">Start</label><input type="time" className="input" value={form.time ?? ''} onChange={e => setForm({ ...form, time: e.target.value })} /></div>
                <div className="field"><label className="label">Length (min)</label><input type="number" className="input" min={15} step={15} value={form.durationMin ?? 120} onChange={e => setForm({ ...form, durationMin: Number(e.target.value) })} /></div>
              </div>
              <div className="field"><label className="label">Notes</label><textarea className="input" value={form.notes ?? ''} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
              {err ? <div style={{ color: 'var(--loss)', fontSize: 14 }}>{err}</div> : null}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn primary" onClick={save}><Icon name="check" />Save</button>
                {form.id && form.type === 'scrim' && form.opponent ? (
                  <button className="btn" onClick={() => router.push(`/scrims/new?opponent=${encodeURIComponent(form.opponent!)}&date=${form.date}`)}>
                    <Icon name="target" />{isLogged(form as Item) ? 'Log more results' : 'Log results'}
                  </button>
                ) : null}
                {form.id ? <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={() => del(form.id!)}><Icon name="trash" />Delete</button> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <style>{`
        .hub .wk{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:10px;}
        .hub .day.now{border-color:var(--accent);}
        .hub .ev{display:flex;flex-direction:column;gap:2px;text-align:left;padding:7px 9px;border:none;border-left:3px solid;border-radius:5px;cursor:pointer;min-width:0;}
        .hub .ev:hover{filter:brightness(1.15);}
        .hub .addday{height:28px;border:1px dashed var(--border);border-radius:5px;background:none;color:var(--text-3);cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .12s;}
        .hub .day:hover .addday{opacity:1;}
        .hub .addday:hover{border-color:var(--accent);color:var(--accent);}
        @media(max-width:1100px){.hub .wk{grid-template-columns:1fr;}.hub .addday{opacity:1;}}
      `}</style>
    </div>
  );
}
