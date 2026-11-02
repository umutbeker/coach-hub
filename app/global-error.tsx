'use client';

// The last resort: an error thrown in the root layout itself, where error.tsx
// cannot help because the layout it would render inside is the thing that
// failed. Next.js replaces the whole document here, so this file ships its own
// <html> and <body> — and cannot rely on globals.css having loaded, which is
// why the styling is inline.

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{
        margin: 0, minHeight: '100vh', background: '#0F1115', color: '#E6E8EC',
        fontFamily: "'Segoe UI', system-ui, sans-serif", display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 20,
      }}>
        <div style={{
          background: '#161920', border: '1px solid #262B36', borderRadius: 8,
          padding: 24, maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <div style={{ fontSize: 22, fontWeight: 600 }}>The hub failed to start</div>
          <div style={{ color: '#9AA3B2', fontSize: 15, lineHeight: 1.5 }}>
            This is the whole app failing, not one page — usually a bad deploy or Redis being
            unreachable. Your data is not affected.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            <button onClick={reset} style={{
              height: 40, padding: '0 18px', borderRadius: 6, border: 'none',
              background: '#8B7CF6', color: '#0F1115', fontWeight: 600, fontSize: 14, cursor: 'pointer',
            }}>Try again</button>
            {/* Same reason, more so: the layout itself failed, so only a full
                document load is trustworthy here. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" style={{
              height: 40, padding: '0 16px', borderRadius: 6, border: '1px solid #333A48',
              background: '#1C2028', color: '#E6E8EC', fontSize: 14, textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center',
            }}>Reload</a>
          </div>
          <div style={{ fontFamily: 'Consolas, monospace', fontSize: 12, color: '#5C6577', wordBreak: 'break-word' }}>
            {error.digest ? `ref ${error.digest}` : error.message || 'no detail available'}
          </div>
        </div>
      </body>
    </html>
  );
}
