// lib/patchnotes.ts
// Riot's patch notes, read on the server.
//
// There is NO official API for these. The developer API has no patch-notes
// endpoint and Data Dragon carries the data, not the prose. What exists is
// leagueoflegends.com, a Next.js site that ships its content as JSON in a
// __NEXT_DATA__ script tag — the index of articles on the news page, and each
// article's whole body on its own page.
//
// So this is scraping, with the consequences that implies: it is undocumented,
// Riot can change the shape whenever they deploy, and when they do it breaks.
// Every parse step therefore fails soft and the page keeps a link to the
// original, so the worst case is "read it on Riot's site", not a blank screen.
//
// Runs server-side only and the result is cached in Redis, for the same reason
// the Leaguepedia queries do: visitors should never make our requests for us.

export type PatchSummary = {
  /** "26-21", from the article URL — also the Redis cache segment. */
  slug: string;
  /** "26.21", for display and sorting. */
  patch: string;
  title: string;
  date: string;
  description: string;
  image: string | null;
  url: string;
};

export type PatchArticle = {
  slug: string;
  title: string;
  date: string;
  url: string;
  /** Sanitised HTML, safe to inject. */
  html: string;
};

const SITE = 'https://www.leagueoflegends.com';
const UA = 'Mozilla/5.0 (compatible; PyramidHub/1.0; +team coaching tool)';

/** The JSON Next.js embeds in every page. */
function nextData(html: string): unknown | null {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/**
 * Walk an unknown object for the first array of things that look like news
 * items. Deliberately shape-agnostic: keying off `page.blades[2].items` would
 * break the first time Riot reorders a blade.
 */
function findItems(node: unknown, depth = 0): Record<string, unknown>[] | null {
  if (depth > 7 || !node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    const looksRight = node.length > 5 && node.every(
      x => x && typeof x === 'object' && 'title' in (x as object) && 'action' in (x as object),
    );
    if (looksRight) return node as Record<string, unknown>[];
    for (const v of node) { const r = findItems(v, depth + 1); if (r) return r; }
    return null;
  }
  for (const v of Object.values(node)) { const r = findItems(v, depth + 1); if (r) return r; }
  return null;
}

/** The longest string in the tree is the article body. */
function findBody(node: unknown, depth = 0): string | null {
  if (depth > 7 || !node || typeof node !== 'object') return null;
  let best: string | null = null;
  for (const v of Object.values(node)) {
    if (typeof v === 'string') { if (v.length > 5000 && v.includes('<') && (!best || v.length > best.length)) best = v; }
    else { const r = findBody(v, depth + 1); if (r && (!best || r.length > best.length)) best = r; }
  }
  return best;
}

const urlOf = (item: Record<string, unknown>): string => {
  const action = item.action as { payload?: { url?: string } } | undefined;
  return action?.payload?.url ?? '';
};

/** "…/league-of-legends-patch-26-21-notes" → "26-21" */
const slugOf = (url: string) => url.match(/patch-(\d+-\d+)-notes/)?.[1] ?? '';

export function parseIndex(html: string): PatchSummary[] {
  const data = nextData(html);
  const items = data ? findItems(data) : null;
  if (!items) return [];

  return items
    .map(i => {
      const url = urlOf(i);
      const slug = slugOf(url);
      if (!slug) return null;
      const media = i.media as { url?: string } | undefined;
      return {
        slug,
        patch: slug.replace('-', '.'),
        title: String(i.title ?? `Patch ${slug.replace('-', '.')}`),
        date: String(i.publishedAt ?? '').slice(0, 10),
        description: String(i.description ?? ''),
        image: media?.url ?? null,
        url: url.startsWith('http') ? url : SITE + url,
      } satisfies PatchSummary;
    })
    .filter((p): p is PatchSummary => !!p)
    // Newest first. "26.21" must sort above "26.9", which a string compare
    // gets backwards.
    .sort((a, b) => rank(b.patch) - rank(a.patch));
}

export function rank(patch: string): number {
  const [a, b] = patch.split('.').map(Number);
  return (Number.isFinite(a) ? a : 0) * 1000 + (Number.isFinite(b) ? b : 0);
}

// ── Sanitising ──────────────────────────────────────────────────────────────
// This HTML goes straight into our DOM. The sample checked carried nothing
// dangerous — no script, iframe, inline handler or javascript: URL — but "the
// one patch I looked at was clean" is not a guarantee about every future one,
// so the allowlist decides rather than the source.

const ALLOWED = new Set([
  'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 'span', 'div', 'header',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'a', 'figure', 'figcaption',
]);
/** Dropped with their contents — the rest only lose their tags. */
const STRIP_WHOLE = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'noscript', 'svg'];

export function sanitize(raw: string): string {
  let html = raw;
  for (const tag of STRIP_WHOLE) {
    html = html.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, 'gi'), '');
    html = html.replace(new RegExp(`<${tag}\\b[^>]*/?>`, 'gi'), '');
  }
  html = html.replace(/<!--[\s\S]*?-->/g, '');

  return html.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (_full, close: string, name: string, attrs: string) => {
    const tag = name.toLowerCase();
    if (!ALLOWED.has(tag)) return '';          // unwrap: keep the text, drop the tag
    if (close) return `</${tag}>`;

    // Attributes are rebuilt from scratch, so nothing unexpected survives —
    // no class (their CSS does not exist here), no style, no on* handler.
    const keep: string[] = [];
    const attr = (n: string) => attrs.match(new RegExp(`${n}\\s*=\\s*"([^"]*)"`, 'i'))?.[1]
      ?? attrs.match(new RegExp(`${n}\\s*=\\s*'([^']*)'`, 'i'))?.[1];

    if (tag === 'img') {
      const src = attr('src');
      // Only http(s): a data: or javascript: src has no business here.
      if (!src || !/^https?:\/\//i.test(src)) return '';
      keep.push(`src="${esc(src)}"`, `alt="${esc(attr('alt') ?? '')}"`, 'loading="lazy"');
    } else if (tag === 'a') {
      const href = attr('href');
      if (!href || !/^(https?:\/\/|\/|#)/i.test(href)) return `<span>`;
      const abs = href.startsWith('/') ? SITE + href : href;
      keep.push(`href="${esc(abs)}"`, 'target="_blank"', 'rel="noopener noreferrer"');
    }
    return `<${tag}${keep.length ? ' ' + keep.join(' ') : ''}>`;
  });
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── Fetching ────────────────────────────────────────────────────────────────

async function get(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store' });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Every patch note Riot currently lists, newest first. */
export async function fetchIndex(): Promise<PatchSummary[] | null> {
  const html = await get(`${SITE}/en-us/news/game-updates/`);
  if (!html) return null;
  const list = parseIndex(html);
  return list.length ? list : null;
}

export async function fetchArticle(summary: PatchSummary): Promise<PatchArticle | null> {
  const html = await get(summary.url);
  if (!html) return null;
  const data = nextData(html);
  const body = data ? findBody(data) : null;
  if (!body) return null;
  return {
    slug: summary.slug,
    title: summary.title,
    date: summary.date,
    url: summary.url,
    html: sanitize(body),
  };
}
