'use client';

// Patch notes, read here instead of on Riot's site.
//
// There is no official API for these — /api/patch-notes explains what that
// means and what it costs. The page's job is to degrade honestly: if the
// scrape breaks, it says so and hands over the link rather than showing a
// blank reader.

import { useCallback, useEffect, useState } from 'react';
import Nav from '../components/Nav';
import Icon from '../components/Icon';
import { useUser } from '../components/useUser';

type PatchSummary = {
  slug: string; patch: string; title: string;
  date: string; description: string; image: string | null; url: string;
};
type Article = { slug: string; title: string; date: string; url: string; html: string };

const fmtDate = (s: string) => {
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function PatchPage() {
  // useUser pushes to / by itself when nobody is signed in.
  const { user, ready } = useUser();

  const [patches, setPatches] = useState<PatchSummary[]>([]);
  const [slug, setSlug] = useState<string>('');
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [fallbackUrl, setFallbackUrl] = useState('');

  const load = useCallback(async (want?: string) => {
    setLoading(true); setErr(''); setFallbackUrl('');
    try {
      const q = want ? `?patch=${encodeURIComponent(want)}` : '';
      const res = await fetch(`/api/patch-notes${q}`);
      const d = await res.json();
      if (d.patches?.length) setPatches(d.patches);

      if (!want) {
        // First load: the newest patch is the one anyone came here for.
        const first = d.patches?.[0]?.slug;
        if (first) { setSlug(first); await load(first); return; }
        setErr(d.error ?? 'No patches found.');
      } else if (d.article) {
        setArticle(d.article);
      } else {
        setArticle(null);
        setErr(d.error ?? 'Could not load that patch.');
        if (d.url) setFallbackUrl(d.url);
      }
    } catch {
      setErr('Could not reach the server.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // An event handler, not an effect on `slug` — a fetch in an effect would also
  // run on the mount that already fetched.
  const choose = (next: string) => {
    if (next === slug) return;
    setSlug(next); setArticle(null); load(next);
  };

  if (!ready || !user) return <div className="hub" />;

  const current = patches.find(p => p.slug === slug);

  return (
    <div className="hub">
      <Nav active="patch" user={user} />
      <div className="page">
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
          <div>
            <div className="h" style={{ fontSize: 24 }}>Patch notes</div>
            <div className="t2" style={{ marginTop: 4 }}>
              {patches.length ? `${patches.length} patches, newest first` : 'Straight from Riot, read here'}
            </div>
          </div>
          {current ? (
            <a className="btn ghost sm" href={current.url} target="_blank" rel="noopener noreferrer">
              <Icon name="external" />Open on Riot
            </a>
          ) : null}
        </div>

        <div className="patchwrap">
          <div className="patchlist">
            {patches.map(p => (
              <button key={p.slug} className={p.slug === slug ? 'patchitem on' : 'patchitem'}
                onClick={() => choose(p.slug)}>
                <span className="pv">{p.patch}</span>
                <span className="pd">{fmtDate(p.date)}</span>
              </button>
            ))}
            {!patches.length && !loading ? <span className="t3" style={{ fontSize: 13 }}>No patches</span> : null}
          </div>

          <div className="card">
            {loading ? (
              <div className="t3" style={{ textAlign: 'center', padding: '60px 20px' }}>Loading…</div>
            ) : err ? (
              <div style={{ padding: '40px 24px', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--warn)' }}>
                  <Icon name="warning" />{err}
                </div>
                {/* Riot has no patch-notes API, so this page reads their site.
                    When that stops working the link is the honest answer. */}
                <div className="t3" style={{ fontSize: 13 }}>
                  These are read from Riot&apos;s own site, which has no API for them — so a change on their
                  end can break this. The original is always there.
                </div>
                {(fallbackUrl || current?.url) ? (
                  <a className="btn" href={fallbackUrl || current!.url} target="_blank" rel="noopener noreferrer">
                    <Icon name="external" />Read it on Riot
                  </a>
                ) : null}
                <button className="btn ghost sm" onClick={() => load(slug || undefined)}>
                  <Icon name="refresh" />Try again
                </button>
              </div>
            ) : article ? (
              <>
                <div style={{ padding: '16px 24px 0' }}>
                  <div className="h" style={{ fontSize: 20 }}>{article.title}</div>
                  <div className="t3" style={{ fontSize: 13, marginTop: 2 }}>{fmtDate(article.date)}</div>
                </div>
                {/* Sanitised server-side: lib/patchnotes.ts rebuilds every tag
                    from an allowlist and keeps no class, style or handler. */}
                <div className="patchbody" dangerouslySetInnerHTML={{ __html: article.html }} />
              </>
            ) : (
              <div className="t3" style={{ textAlign: 'center', padding: '60px 20px' }}>Pick a patch</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
