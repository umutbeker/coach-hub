'use client';

import { useRouter } from 'next/navigation';
import Icon, { type IconName } from './Icon';

/** A one-glance summary of a section. The whole card opens the page. */
export default function HubCard({ title, icon, href, cta, children }: {
  title: string; icon: IconName; href: string; cta: string; children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <div className="card hubc" role="link" tabIndex={0}
      onClick={() => router.push(href)} onKeyDown={e => { if (e.key === 'Enter') router.push(href); }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ color: 'var(--accent)', display: 'inline-flex' }}><Icon name={icon} /></span>
        <span className="h" style={{ fontSize: 18 }}>{title}</span>
        <span className="t3 hubgo" style={{ marginLeft: 'auto', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          {cta}<Icon name="chevron-right" size={15} />
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>{children}</div>
    </div>
  );
}

export const Line = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, minWidth: 0 }}>{children}</div>
);
export const Muted = ({ children }: { children: React.ReactNode }) => <div className="t3" style={{ fontSize: 14 }}>{children}</div>;
export const Big = ({ children, color }: { children: React.ReactNode; color?: string }) => (
  <div className="mono" style={{ fontSize: 24, fontWeight: 600, color, lineHeight: 1.15 }}>{children}</div>
);
