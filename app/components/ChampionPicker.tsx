'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { champImg, loadChampionList, type ChampionEntry } from '../../lib/champions';
import Icon from './Icon';

/**
 * Search-and-click champion grid. Typing narrows the grid; Enter picks the
 * first match, so "ahr ⏎" is a pick. Champions already used elsewhere in the
 * draft are dimmed, not hidden, so a correction is still one click.
 */
export default function ChampionPicker({
  title, used = [], onPick, onClear, onClose,
}: {
  title: string;
  used?: string[];
  onPick: (name: string) => void;
  onClear?: () => void;
  onClose: () => void;
}) {
  const [list, setList] = useState<ChampionEntry[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadChampionList().then(setList).catch(() => setError(true));
    input.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase().replace(/[^a-z]/g, '');
    return n ? list.filter(c => c.name.toLowerCase().replace(/[^a-z]/g, '').includes(n)) : list;
  }, [list, q]);

  const usedSet = useMemo(() => new Set(used.filter(Boolean)), [used]);

  return (
    <div className="modal-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 760 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <div className="h" style={{ fontSize: 20 }}>{title}</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {onClear ? <button className="btn ghost sm" onClick={onClear}>Clear slot</button> : null}
            <button className="btn ghost sm" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
          </div>
        </div>
        <div style={{ padding: '14px 20px' }}>
          <input
            ref={input}
            className="input"
            placeholder="Type to search — Enter picks the first match"
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && shown[0]) onPick(shown[0].name); }}
          />
        </div>
        <div style={{
          padding: '0 20px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))',
          gap: 8, maxHeight: '56vh', overflowY: 'auto',
        }}>
          {error ? <div className="t3" style={{ gridColumn: '1/-1' }}>Could not load the champion list. Check your connection.</div> : null}
          {!error && !list.length ? <div className="t3" style={{ gridColumn: '1/-1' }}>Loading champions…</div> : null}
          {shown.map(c => {
            const isUsed = usedSet.has(c.name);
            return (
              <button key={c.id} onClick={() => onPick(c.name)} title={c.name}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: 4,
                  background: 'none', border: '1px solid transparent', borderRadius: 'var(--r-ctl)',
                  cursor: 'pointer', opacity: isUsed ? 0.35 : 1,
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; }}>
                <img src={champImg(c.name)} alt="" style={{ width: 48, height: 48, borderRadius: 6 }}
                  onError={e => { (e.target as HTMLImageElement).src = '/logo.png'; }} />
                <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.2, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
                  {c.name}
                </span>
              </button>
            );
          })}
          {list.length && !shown.length ? <div className="t3" style={{ gridColumn: '1/-1' }}>No champion matches “{q}”.</div> : null}
        </div>
      </div>
    </div>
  );
}

/** A clickable champion slot: empty dashed box, or the champion's icon. */
export function Slot({ name, ban, active, onClick, size = 44 }: {
  name?: string; ban?: boolean; active?: boolean; onClick: () => void; size?: number;
}) {
  const cls = ['slot', name ? 'filled' : '', ban ? 'ban' : '', active ? 'active' : ''].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} style={{ width: size, height: size }} onClick={onClick} title={name || 'Pick'}>
      {name
        ? <img src={champImg(name)} alt={name} onError={e => { (e.target as HTMLImageElement).src = '/logo.png'; }} />
        : <Icon name="plus" size={16} />}
    </button>
  );
}
