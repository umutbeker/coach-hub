// lib/users.ts
//
// name   — ekranda görünen ad ve Redis anahtarı (player:<name>, lp:<name>).
// lpName — Leaguepedia'daki (lol.fandom.com) Name değeri. Sorgulara birebir
//          gömülüyor ve wiki'deki yazım ekrandakinden farklı olabiliyor
//          (Akashii çift i, moe küçük harf), o yüzden ayrı tutuluyor.
//          Yanlış değer hata vermez, sessizce 0 satır döner.
//          2026-09-19'da Pyramid IV Esports kadrosuna karşı doğrulandı.
export const USERS = [
  { username: 'akashi',     password: 'akashi123',     role: 'player', lane: 'mid',     riotId: 'makaynch#0404',      name: 'Akashi',     lpName: 'Akashii',    image: '/logo.png' },
  { username: 'starscreen', password: 'starscreen123', role: 'player', lane: 'top',     riotId: 'THE MENTALIST#1702', name: 'StarScreen', lpName: 'StarScreen', image: '/players/star.png' },
  { username: 'moe',        password: 'moe123',        role: 'player', lane: 'jungle',  riotId: 'tommy vercetti#252', name: 'Moe',        lpName: 'moe',        image: '/logo.png' },
  { username: 'jalleba',    password: 'jalleba123',    role: 'player', lane: 'adc',     riotId: 'Thomas Jalbi#XD3',   name: 'Jalleba',    lpName: 'Jalleba',    image: '/logo.png' },
  { username: 'mahonix',    password: 'mahonix123',    role: 'player', lane: 'support', riotId: 'RVL Mahonix#BROCK',  name: 'Mahonix',    lpName: 'Mahonix',    image: '/logo.png' },
  { username: 'zetsu',      password: 'arsdf33',       role: 'coach',  lane: null,      riotId: null,                 name: 'Baş Koç',    lpName: null,         image: '/logo.png' },
  { username: 'waves',      password: 'k7xx6w9s5p6',   role: 'coach',  lane: null,      riotId: null,                 name: 'Baş Koç',    lpName: null,         image: '/logo.png' },
];
