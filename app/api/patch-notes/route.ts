// /app/api/patch-notes/route.ts
//
// Reads Riot's patch notes on the server and caches them in Redis.
//
// Two shapes:
//   GET /api/patch-notes            → the list of patches
//   GET /api/patch-notes?patch=26-21 → that patch's article
//
// Cached because a patch lands every two weeks and the article never changes
// after it does (bar the occasional mid-patch update), so there is no reason
// for a second reader to make the request again. See lib/patchnotes.ts for why
// this is scraping and what that costs.

import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { fetchArticle, fetchIndex, type PatchArticle, type PatchSummary } from '../../../lib/patchnotes';

const redis = Redis.fromEnv();

// v1: bump if the stored shape changes, so an old payload can't reach the page.
const INDEX_KEY = 'patch:index:v1';
const bodyKey = (slug: string) => `patch:body:v1:${slug}`;

// The index can gain a new patch any day; a published article is settled.
const INDEX_TTL = 60 * 60 * 6;
const BODY_TTL = 60 * 60 * 24 * 30;

async function readIndex(refresh: boolean): Promise<{ patches: PatchSummary[]; stale: boolean }> {
  const cached = refresh ? null : await redis.get(INDEX_KEY).catch(() => null);
  if (cached) {
    const list = typeof cached === 'string' ? JSON.parse(cached) : cached;
    if (Array.isArray(list) && list.length) return { patches: list, stale: false };
  }

  const fresh = await fetchIndex();
  if (!fresh) {
    // Serve whatever we had rather than nothing — the notes are still readable.
    const fallback = cached
      ? (typeof cached === 'string' ? JSON.parse(cached) : cached)
      : [];
    return { patches: Array.isArray(fallback) ? fallback : [], stale: true };
  }

  await redis.set(INDEX_KEY, JSON.stringify(fresh), { ex: INDEX_TTL }).catch(() => {});
  return { patches: fresh, stale: false };
}

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const wanted = sp.get('patch');
  const refresh = sp.get('refresh') === 'true';

  try {
    const { patches, stale } = await readIndex(refresh);

    if (!wanted) {
      return NextResponse.json({ patches, stale });
    }

    if (!patches.length) {
      return NextResponse.json({ error: 'Riot’s patch list could not be read right now.' }, { status: 503 });
    }

    const summary = patches.find(p => p.slug === wanted);
    if (!summary) {
      return NextResponse.json({ error: `No patch ${wanted.replace('-', '.')} in the list.` }, { status: 404 });
    }

    const cachedBody = refresh ? null : await redis.get(bodyKey(summary.slug)).catch(() => null);
    if (cachedBody) {
      const art = typeof cachedBody === 'string' ? JSON.parse(cachedBody) : cachedBody;
      if (art?.html) return NextResponse.json({ patches, article: art as PatchArticle });
    }

    const article = await fetchArticle(summary);
    if (!article) {
      // The one case where linking out is the honest answer.
      return NextResponse.json({
        patches,
        error: 'That patch could not be parsed — Riot may have changed their page.',
        url: summary.url,
      }, { status: 502 });
    }

    await redis.set(bodyKey(summary.slug), JSON.stringify(article), { ex: BODY_TTL }).catch(() => {});
    return NextResponse.json({ patches, article });
  } catch (e) {
    console.error('[patch-notes]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Patch notes are unavailable right now.' }, { status: 500 });
  }
}
