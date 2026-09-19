'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { USERS } from '../../../lib/users';
import { NOTE_CATEGORIES, fmtTime, parseTime, type NoteCategory, type Vod, type VodNote } from '../../../lib/hub';
import Nav from '../../components/Nav';
import Icon from '../../components/Icon';
import VideoPlayer, { type PlayerHandle } from '../../components/VideoPlayer';
import { useUser } from '../../components/useUser';

const PLAYERS = USERS.filter(u => u.role === 'player').map(u => u.name);
const CAT_LABEL: Record<NoteCategory, string> = {
  laning: 'Laning', vision: 'Vision', teamfight: 'Teamfight', macro: 'Macro',
  draft: 'Draft', mechanics: 'Mechanics', comms: 'Comms', other: 'Other',
};

function Review() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const startAt = Number(params.get('t')) || 0;
  const { user, ready } = useUser();

  const player = useRef<PlayerHandle>(null);
  const [vod, setVod] = useState<Vod | null>(null);
  const [missing, setMissing] = useState(false);
  const [notes, setNotes] = useState<VodNote[]>([]);
  const [now, setNow] = useState(0);

  // Composer. `at` is frozen when the coach starts writing, so the note
  // lands where the moment was, not where the video has played on to.
  const [at, setAt] = useState('');
  const [text, setText] = useState('');
  const [cat, setCat] = useState<NoteCategory>('macro');
  const [tagged, setTagged] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const [filterCat, setFilterCat] = useState<NoteCategory | 'all'>('all');
  const [filterPlayer, setFilterPlayer] = useState('all');

  const loadNotes = useCallback(() => {
    fetch(`/api/notes?vod=${encodeURIComponent(id)}`).then(r => r.json()).then(d => setNotes(d.notes ?? [])).catch(() => {});
  }, [id]);

  useEffect(() => {
    fetch(`/api/vods?id=${encodeURIComponent(id)}`).then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => setVod(d.vod)).catch(() => setMissing(true));
    loadNotes();
  }, [id, loadNotes]);

  // Live position for the "note at" button.
  useEffect(() => {
    const t = setInterval(() => setNow(player.current?.time() ?? 0), 500);
    return () => clearInterval(t);
  }, []);

  const capture = () => setAt(fmtTime(player.current?.time() ?? now));

  const save = async () => {
    setErr('');
    const t = parseTime(at || fmtTime(now));
    if (t === null) { setErr('Timestamp should look like 5:30'); return; }
    if (!text.trim()) { setErr('Write the note first'); return; }
    setSaving(true);
    const r = await fetch('/api/notes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vodId: id, t, text, category: cat, players: tagged, author: user?.name }),
    });
    setSaving(false);
    if (!r.ok) { setErr((await r.json()).error ?? 'Could not save'); return; }
    setText(''); setAt(''); setTagged([]);
    loadNotes();
  };

  const del = async (n: VodNote) => {
    if (!confirm('Delete this note?')) return;
    await fetch(`/api/notes?vod=${encodeURIComponent(id)}&id=${encodeURIComponent(n.id)}`, { method: 'DELETE' });
    loadNotes();
  };

  const shown = useMemo(
    () => notes.filter(n => (filterCat === 'all' || n.category === filterCat) && (filterPlayer === 'all' || n.players.includes(filterPlayer))),
    [notes, filterCat, filterPlayer],
  );

  if (!ready || !user) return <div className="hub" />;

  return (
    <div className="hub">
      <Nav active="review" user={user} />
      <div className="page">
        <div>
          <button className="btn ghost sm" style={{ paddingLeft: 0, marginBottom: 8 }} onClick={() => router.push('/review')}>
            <Icon name="arrow-left" />All VODs
          </button>
          {missing ? <div className="h" style={{ fontSize: 28 }}>VOD not found</div> : (
            <>
              <div className="h" style={{ fontSize: 30 }}>{vod?.title ?? 'Loading…'}</div>
              {vod ? (
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className={vod.source === 'scrim' ? 'tag accent' : vod.source === 'official' ? 'tag blue' : 'tag neutral'}>
                    {vod.source === 'scrim' ? 'Scrim' : vod.source === 'official' ? 'Official' : 'Other'}
                  </span>
                  {vod.opponent ? <span className="t2" style={{ fontSize: 14 }}>vs {vod.opponent}</span> : null}
                  <span className="t3" style={{ fontSize: 14 }}>{vod.date}</span>
                </div>
              ) : null}
            </>
          )}
        </div>

        {vod ? (
          <div className="rv">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              <VideoPlayer ref={player} url={vod.url} start={startAt} />

              <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button className="btn" onClick={capture} title="Stamp the current video time">
                    <Icon name="plus" />Note at <span className="mono">{fmtTime(now)}</span>
                  </button>
                  <input className="input mono" style={{ width: 110, height: 40 }} placeholder={fmtTime(now)} value={at} onChange={e => setAt(e.target.value)} aria-label="Timestamp" />
                  <select className="input" style={{ width: 150, height: 40 }} value={cat} onChange={e => setCat(e.target.value as NoteCategory)} aria-label="Category">
                    {NOTE_CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
                  </select>
                </div>
                <textarea className="input" placeholder="What happened here? e.g. Dragon setup is late — no vision on the river before 5:10."
                  value={text} onFocus={() => { if (!at) capture(); }} onChange={e => setText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); }} />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="t3" style={{ fontSize: 13 }}>About</span>
                  {PLAYERS.map(p => (
                    <button key={p} className={tagged.includes(p) ? 'chip on' : 'chip'} style={{ height: 30 }}
                      onClick={() => setTagged(t => (t.includes(p) ? t.filter(x => x !== p) : [...t, p]))}>{p}</button>
                  ))}
                  <button className="btn primary" style={{ marginLeft: 'auto', height: 40, fontSize: 14 }} onClick={save} disabled={saving}>
                    {saving ? 'Saving…' : 'Save note'}
                  </button>
                </div>
                <div className="t3" style={{ fontSize: 12 }}>
                  The time is stamped when you start typing. Ctrl+Enter saves.
                </div>
                {err ? <div style={{ color: 'var(--loss)', fontSize: 13 }}>{err}</div> : null}
              </div>
            </div>

            <div className="card" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <div className="h" style={{ fontSize: 20 }}>Notes</div>
                  <span className="t3" style={{ fontSize: 13 }}>{notes.length} total</span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select className="input" style={{ height: 34, fontSize: 13 }} value={filterCat} onChange={e => setFilterCat(e.target.value as NoteCategory | 'all')}>
                    <option value="all">All categories</option>
                    {NOTE_CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
                  </select>
                  <select className="input" style={{ height: 34, fontSize: 13 }} value={filterPlayer} onChange={e => setFilterPlayer(e.target.value)}>
                    <option value="all">All players</option>
                    {PLAYERS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ overflowY: 'auto', maxHeight: '70vh' }}>
                {!shown.length ? <div className="empty" style={{ padding: 32 }}>{notes.length ? 'No notes match these filters.' : 'No notes yet. Pause on a moment and write one.'}</div> : null}
                {shown.map(n => (
                  <div key={n.id} className="note">
                    <button className="tbtn mono" onClick={() => player.current?.seek(n.t)} title="Jump to this moment">{fmtTime(n.t)}</button>
                    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>{n.text}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span className="tag neutral">{CAT_LABEL[n.category]}</span>
                        {n.players.map(p => <span key={p} className="tag accent">{p}</span>)}
                        <span className="t3" style={{ fontSize: 12 }}>{n.author}</span>
                        <button className="btn ghost sm" style={{ marginLeft: 'auto', height: 28, padding: '0 6px' }} onClick={() => del(n)} aria-label="Delete note"><Icon name="trash" size={15} /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <style>{`
        .hub .rv{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:16px;align-items:start;}
        .hub .note{display:grid;grid-template-columns:64px 1fr;gap:12px;padding:12px 18px;border-bottom:1px solid var(--border);}
        .hub .tbtn{height:30px;border-radius:var(--r-ctl);border:1px solid var(--border-strong);background:var(--surface-2);color:var(--accent);font-weight:600;font-size:13px;cursor:pointer;}
        .hub .tbtn:hover{border-color:var(--accent);background:rgba(139,124,246,0.12);}
        @media(max-width:1100px){.hub .rv{grid-template-columns:1fr;}}
      `}</style>
    </div>
  );
}

export default function ReviewVodPage() {
  return <Suspense fallback={<div className="hub" />}><Review /></Suspense>;
}
