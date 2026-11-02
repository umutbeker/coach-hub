'use client';

// Any client-side exception used to take the whole page down to Vercel's bare
// "Application error" screen — which is what happened when a saved report
// predated a field the board read. One missing key should not look like the
// site is gone.
//
// Next.js renders this in place of the page that threw, inside the layout, so
// the nav and everything around it survives.

import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Goes to the Vercel function logs, where a silent failure is at least findable.
    console.error('[page error]', error);
  }, [error]);

  return (
    <div className="hub">
      <div className="page" style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
        <div className="card" style={{ padding: 24, maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="h" style={{ fontSize: 22 }}>This page hit an error</div>
          <div className="t2" style={{ fontSize: 15 }}>
            Something on this screen failed to render. The rest of the hub is fine — the data is in
            Redis and nothing has been lost.
          </div>
          <div className="t3" style={{ fontSize: 13 }}>
            Most often this is cached data in an older shape. Reloading rebuilds it.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            <button className="btn primary" onClick={reset}>Try again</button>
            <button className="btn" onClick={() => window.location.reload()}>Reload the page</button>
            {/* A real navigation, not next/link: client routing would re-render
                the tree that just threw. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a className="btn ghost" href="/">Back to sign in</a>
          </div>
          {/* The digest is what ties this to a line in the Vercel logs. */}
          <div className="mono t3" style={{ fontSize: 12, marginTop: 4, wordBreak: 'break-word' }}>
            {error.digest ? `ref ${error.digest}` : error.message || 'no detail available'}
          </div>
        </div>
      </div>
    </div>
  );
}
