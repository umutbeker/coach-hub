// lib/champions.ts
// Data Dragon şampiyon görselleri.
//
// Leaguepedia şampiyon adlarını insan okunur yazıyor ("Kai'Sa", "Nunu & Willump"),
// Data Dragon ise dosya adı olarak sadeleştirilmiş halini bekliyor ("Kaisa", "Nunu").
// Çoğu isim boşluk/kesme işareti atılarak dönüşüyor; dönüşmeyenler burada.

// Data Dragon birikimli: yeni sürüm eski şampiyonları da içeriyor, bu yüzden
// güncel tutmak güvenli. Eski sürümde yeni şampiyonlar 403 veriyor
// (16.5.1'de 'Locke' yoktu).
export const DDRAGON_VERSION = '16.18.1';

const CHAMP_MAP: Record<string, string> = {
  "Ambessa": "Ambessa",
  "Aurelion Sol": "AurelionSol",
  "Bel'Veth": "Belveth",
  "Briar": "Briar",
  "Cho'Gath": "Chogath",
  "Dr. Mundo": "DrMundo",
  "Hwei": "Hwei",
  "Jarvan IV": "JarvanIV",
  "K'Sante": "KSante",
  "Kai'Sa": "Kaisa",
  "Kha'Zix": "Khazix",
  "Kog'Maw": "KogMaw",
  "LeBlanc": "Leblanc",
  "Lee Sin": "LeeSin",
  "Master Yi": "MasterYi",
  "Miss Fortune": "MissFortune",
  "Nunu & Willump": "Nunu",
  "Rek'Sai": "RekSai",
  "Renata Glasc": "Renata",
  "Smolder": "Smolder",
  "Tahm Kench": "TahmKench",
  "Twisted Fate": "TwistedFate",
  "Vel'Koz": "Velkoz",
  "Wukong": "MonkeyKing",
  "Xin Zhao": "XinZhao",
  "Yunara": "Yunara",
};

export function champImg(name: string | null | undefined): string {
  if (!name || name === 'None') return '/logo.png';
  const key = CHAMP_MAP[name] ?? name.replace(/[\s'".]/g, '');
  return `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/${key}.png`;
}

// Boş dönüyor, '/logo.png' değil: değeri CSS backgroundImage olarak
// kullanılıyor ve boş pick slotlarının arkasında logo görünmemeli.
export function champSplash(name: string | null | undefined): string {
  if (!name || name === 'None') return '';
  const key = CHAMP_MAP[name] ?? name.replace(/[\s'".]/g, '');
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${key}_0.jpg`;
}

/** "16.18" from "16.18.1" — the patch a scrim is played on, for filtering. */
export const CURRENT_PATCH = DDRAGON_VERSION.split('.').slice(0, 2).join('.');

export type ChampionEntry = { id: string; name: string };

/**
 * Every champion, from Data Dragon. Names are the human ones Leaguepedia also
 * uses ("Kai'Sa"), so scrim picks and official picks join on the same string.
 * Browser-only; cached in localStorage per Data Dragon version.
 */
export async function loadChampionList(): Promise<ChampionEntry[]> {
  const cacheKey = `champions_${DDRAGON_VERSION}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch { /* storage unavailable — fetch instead */ }
  const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/data/en_US/champion.json`);
  const json = await res.json();
  const list: ChampionEntry[] = Object.values(json.data as Record<string, { id: string; name: string }>)
    .map(c => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  try { localStorage.setItem(cacheKey, JSON.stringify(list)); } catch { /* ignore */ }
  return list;
}
