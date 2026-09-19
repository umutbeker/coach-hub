'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Vod, VodSource } from '../../lib/hub';
import { youtubeId } from '../../lib/vod';
import Nav from '../components/Nav';
import Icon from '../components/Icon';
import { useUser } from '../components/useUser';

const SRC_LABEL: Record<VodSource, string> = { scrim: 'Scrim', official: 'Official', other: 'Other' };
const SRC_TAG: Record<VodSource, string> = { scrim: 'tag accent', official: 'tag blue', other: 'tag neutral' };

export default function ReviewLibrary() {
  const router = useRouter();
  const { user, ready } = useUser();
  const [vods, setVods] = useState<Vod[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<VodSource | 'all'>('all');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', url: '', source: 'scrim' as VodSource, opponent: '', date: new Date().toISOString().slice(0, 10) });
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    fetch('/api/vods').then(r => r.json()).then(d => setVods(d.vods ?? [])).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => vods.filter(v => filter === 'all' || v.source === filter), [vods, filter]);

  const add = async () => {
    setErr('');
    const r = await fetch('/api/vods', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, createdBy: user?.name }),
    });
    const d = await r.json();
    if (!r.ok) { setErr(d.error ?? 'Could not save'); return; }
    router.push(`/review/${d.vod.id}`);
  };

  const del = async (v: Vod) => {
    if (!confirm(`Delete “${v.title}” and all its notes?`)) return;
    await fetch(`/api/vods?id=${encodeURIComponent(v.id)}`, { method: 'DELETE' });
    load();
  };

  if (!ready || !user) return <div className="hub" />;

  return (
    <div className="hub">
      <Nav active="review" user={user} />
      <div className="page">
        <div className="page-head">
          <div>
            <div className="h" style={{ fontSize: 32 }}>VOD review</div>
            <div className="t2" style={{ marginTop: 4 }}>Leave notes at a timestamp; clicking a note jumps the video there</div>
          </div>
          <button className="btn primary" onClick={() => setAdding(a => !a)}><Icon name="plus" />Add VOD</button>
        </div>

        {adding ? (
          <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label className="label" htmlFor="u">Video link</label>
                <input id="u" className="input" placeholder="Unlisted YouTube link, or a direct .mp4 / .webm URL" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} autoFocus />
              </div>
              <div className="field"><label className="label" htmlFor="t">Title</label><input id="t" className="input" placeholder="e.g. Scrim vs Anubis · Game 2" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
              <div className="field"><label className="label" htmlFor="o">Opponent</label><input id="o" className="input" value={form.opponent} onChange={e => setForm({ ...form, opponent: e.target.value })} /></div>
              <div className="field"><label className="label" htmlFor="s">Type</label>
                <select id="s" className="input" value={form.source} onChange={e => setForm({ ...form, source: e.target.value as VodSource })}>
                  <option value="scrim">Scrim</option><option value="official">Official match</option><option value="other">Other</option>
                </select>
              </div>
              <div className="field"><label className="label" htmlFor="d">Date</label><input id="d" type="date" className="input" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
            </div>
            <div className="t3" style={{ fontSize: 13 }}>
              Upload scrim VODs to YouTube as <b>Unlisted</b> — only people with the link can watch, and timestamps jump inside the page.
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="btn primary" onClick={add}>Save and open</button>
              <button className="btn ghost" onClick={() => setAdding(false)}>Cancel</button>
              {err ? <span style={{ color: 'var(--loss)', fontSize: 14 }}>{err}</span> : null}
            </div>
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['all', 'scrim', 'official', 'other'] as const).map(f => (
            <button key={f} className={filter === f ? 'chip on' : 'chip'} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : SRC_LABEL[f]}</button>
          ))}
        </div>

        {loading ? <div className="empty">Loading…</div> : !shown.length ? (
          <div className="card empty">{vods.length ? 'No VODs of this type.' : 'No VODs yet. Add a link, or attach one when you log a scrim.'}</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {shown.map(v => {
              const yt = youtubeId(v.url);
              return (
                <div key={v.id} className="card vcard" onClick={() => router.push(`/review/${v.id}`)} role="button" tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') router.push(`/review/${v.id}`); }}>
                  <div style={{ aspectRatio: '16 / 9', background: '#000', position: 'relative', borderRadius: '8px 8px 0 0', overflow: 'hidden' }}>
                    {yt ? <img src={`https://i.ytimg.com/vi/${yt}/mqdefault.jpg`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.85 }} /> : null}
                    <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}><Icon name="play" size={36} /></span>
                  </div>
                  <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontWeight: 500 }}>{v.title}</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className={SRC_TAG[v.source]}>{SRC_LABEL[v.source]}</span>
                      {v.opponent ? <span className="t2" style={{ fontSize: 13 }}>vs {v.opponent}</span> : null}
                      <span className="t3" style={{ fontSize: 13 }}>{v.date}</span>
                      <button className="btn ghost sm" style={{ marginLeft: 'auto', height: 28, padding: '0 6px' }}
                        onClick={e => { e.stopPropagation(); del(v); }} aria-label="Delete VOD"><Icon name="trash" size={15} /></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <style>{`.hub .vcard{cursor:pointer;overflow:hidden;}.hub .vcard:hover{border-color:var(--border-strong);}`}</style>
    </div>
  );
}
