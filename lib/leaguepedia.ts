// lib/leaguepedia.ts
// lol.fandom.com cargo API'siyle konuşan ortak katman.
//
// Buradaki tek önemli davranış rate limit yönetimi: Leaguepedia'nın limiti
// IP bazlı, dar ve dakikalarca sürebiliyor. Limit yanıtı HTTP 200 + gövdede
// error.code='ratelimited' olarak geliyor, yani !res.ok kontrolü bunu
// YAKALAMAZ — yanıt boş bir sonuç gibi görünür ve "veri yok" sanılır.

// cargoquery her satırı { title: {...} } olarak sarmalıyor; alanlar düz string.
export type LpRow = Record<string, string>;

export const LP_ENDPOINT = 'https://lol.fandom.com/api.php';

// Fandom asks API clients to identify themselves.
const UA = 'PyramidHub/1.0 (team coaching tool; +https://github.com/umutbeker/coach-hub)';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Optional Leaguepedia sign-in.
 *
 * Anonymous requests are rate limited per IP, and that limit is tight enough
 * that a handful of queries locks a whole network out for minutes — a home
 * connection and a serverless region alike. A logged-in account gets a far
 * higher limit, so when LEAGUEPEDIA_USER and LEAGUEPEDIA_BOT_PASSWORD are
 * set (Special:BotPasswords on lol.fandom.com), queries use that session.
 * Without them everything still works, anonymously, exactly as before.
 *
 * The session is per server instance and logged in lazily; a failed login is
 * remembered so it is not retried on every query.
 */
let session: Promise<string | null> | null = null;

async function login(): Promise<string | null> {
  const user = process.env.LEAGUEPEDIA_USER;
  const pass = process.env.LEAGUEPEDIA_BOT_PASSWORD;
  if (!user || !pass) return null;

  const jar: string[] = [];
  const cookie = () => jar.join('; ');
  const take = (res: Response) => {
    // Keep only name=value; the attributes don't matter for sending it back.
    for (const c of res.headers.getSetCookie?.() ?? []) jar.push(c.split(';')[0]);
  };

  try {
    const tokRes = await fetch(`${LP_ENDPOINT}?action=query&meta=tokens&type=login&format=json`, {
      headers: { 'User-Agent': UA },
    });
    take(tokRes);
    const token = (await tokRes.json())?.query?.tokens?.logintoken;
    if (!token) return null;

    const body = new URLSearchParams({ action: 'login', format: 'json', lgname: user, lgpassword: pass, lgtoken: token });
    const logRes = await fetch(LP_ENDPOINT, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie() },
      body,
    });
    take(logRes);
    const result = (await logRes.json())?.login?.result;
    if (result !== 'Success') {
      console.error('[lp] login failed:', result);
      return null;
    }
    return cookie();
  } catch (e) {
    console.error('[lp] login error:', e);
    return null;
  }
}

function authCookie(): Promise<string | null> {
  session ??= login();
  return session;
}

// Sezon yılı çalışma anında türetiliyor — 'LEC 2025' gibi sabit bir string
// yeni yıla girince sessizce 0 satır döner. Yeni sezonun henüz maçı yoksa
// bir öncekine düşüyoruz.
export function seasonCandidates(): number[] {
  const y = new Date().getFullYear();
  return [y, y - 1];
}

/**
 * Tek bir cargoquery çalıştırır.
 * Dönen değer: satırlar, ya da limit/hata durumunda null.
 * null ile boş dizi arasındaki fark önemli — biri "çekemedik", diğeri "veri yok".
 * Çağıran taraf bunları farklı raporlamalı.
 */
export async function lpQuery(
  params: URLSearchParams,
  label: string,
  deadline: number,
): Promise<LpRow[] | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      const cookie = await authCookie();
      const res = await fetch(`${LP_ENDPOINT}?${params}`, {
        headers: cookie ? { 'User-Agent': UA, Cookie: cookie } : { 'User-Agent': UA },
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.error?.code !== 'ratelimited') {
          return data.cargoquery?.map((item: { title: LpRow }) => item.title) || [];
        }
      }
    } catch (e) {
      console.error(`[lp] ${label} fetch hatası:`, e);
    }
    const wait = 3000 * (attempt + 1);
    if (Date.now() + wait > deadline) {
      console.error(`[lp] ${label}: bütçe doldu (rate limit)`);
      return null;
    }
    await sleep(wait);
  }
}

// Sorgular SIRAYLA atılmalı — Promise.all ile paralel atmak limiti tek
// seferde tetikliyor.
export function cargo(fields: Record<string, string>): URLSearchParams {
  // No `origin=*` here: MediaWiki treats a request carrying it as an anonymous
  // CORS request and ignores the session, which would drop us back to the
  // anonymous rate limit even when signed in. Browser callers still need it;
  // these queries run on the server.
  return new URLSearchParams({ action: 'cargoquery', format: 'json', ...fields });
}
