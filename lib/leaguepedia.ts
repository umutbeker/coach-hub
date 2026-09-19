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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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
      const res = await fetch(`${LP_ENDPOINT}?${params}`);
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
  return new URLSearchParams({ action: 'cargoquery', format: 'json', origin: '*', ...fields });
}
