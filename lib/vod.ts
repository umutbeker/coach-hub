// lib/vod.ts
// Leaguepedia'nın Vod alanları Wikitext tipinde: çoğu zaman düz bir URL,
// ama köşeli parantezli wiki linki ya da şablon de olabiliyor. Buradaki iş
// içinden oynatılabilir bir URL çıkarmak ve mümkünse embed'e çevirmek.

export type Vod = {
  url: string;
  embed: string | null; // null ise iframe yerine dış bağlantı gösterilmeli
  kind: 'youtube' | 'twitch' | 'other';
  start: number | null; // saniye
};

// Wikitext içinden ilk http(s) URL'ini al. [https://... başlık] biçiminde
// gelirse başlık kısmını ve kapanış parantezini atmak gerekiyor.
function extractUrl(raw: string): string | null {
  if (!raw) return null;
  const m = raw.match(/https?:\/\/[^\s\]|}<]+/);
  return m ? m[0].replace(/[.,;]+$/, '') : null;
}

// YouTube zaman damgası ?t= / &start= biçiminde ve 1h2m3s de olabiliyor.
function parseStart(value: string | null): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  const m = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m || !m[0]) return null;
  const [, h, min, s] = m;
  const total = Number(h || 0) * 3600 + Number(min || 0) * 60 + Number(s || 0);
  return total > 0 ? total : null;
}

export function parseVod(raw: string | null | undefined): Vod | null {
  const url = extractUrl(raw ?? '');
  if (!url) return null;

  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');

  if (host === 'youtu.be' || host.endsWith('youtube.com')) {
    const id = host === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v');
    const start = parseStart(u.searchParams.get('t') || u.searchParams.get('start'));
    if (!id) return { url, embed: null, kind: 'youtube', start };
    const q = start ? `?start=${start}` : '';
    return { url, embed: `https://www.youtube.com/embed/${id}${q}`, kind: 'youtube', start };
  }

  // Twitch embed'i parent parametresi olarak barındığı alan adını şart koşuyor.
  // Vercel önizleme URL'leri değişken olduğu için gömmüyoruz, dış link veriyoruz.
  if (host.endsWith('twitch.tv')) {
    return { url, embed: null, kind: 'twitch', start: null };
  }

  return { url, embed: null, kind: 'other', start: null };
}

/** YouTube video id from any common link form, or null. */
export function youtubeId(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (host.endsWith('youtube.com')) {
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/);
      return m ? m[1] : null;
    }
  } catch { /* not a URL */ }
  return null;
}

/** A link a <video> element can play directly. */
export const isDirectVideo = (raw: string) => /\.(mp4|webm|mov|m4v|ogg)(\?|#|$)/i.test(raw.trim());
