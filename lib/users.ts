// lib/users.ts
// name alanı hem Redis anahtarı (player:<name>) hem de Leaguepedia sorgusundaki
// Name değeri olarak kullanılıyor — wiki'deki yazımla aynı tutulmalı.
export const USERS = [
  { username: 'akashi',     password: 'akashi123',     role: 'player', lane: 'mid',     riotId: 'makaynch#0404',      name: 'Akashi',     image: '/logo.png' },
  { username: 'starscreen', password: 'starscreen123', role: 'player', lane: 'top',     riotId: 'THE MENTALIST#1702', name: 'StarScreen', image: '/players/star.png' },
  { username: 'moe',        password: 'moe123',        role: 'player', lane: 'jungle',  riotId: 'tommy vercetti#252', name: 'Moe',        image: '/logo.png' },
  { username: 'jalleba',    password: 'jalleba123',    role: 'player', lane: 'adc',     riotId: 'Thomas Jalbi#XD3',   name: 'Jalleba',    image: '/logo.png' },
  { username: 'mahonix',    password: 'mahonix123',    role: 'player', lane: 'support', riotId: 'RVL Mahonix#BROCK',  name: 'Mahonix',    image: '/logo.png' },
  { username: 'zetsu',      password: 'arsdf33',       role: 'coach',  lane: null,      riotId: null,                 name: 'Baş Koç',    image: '/logo.png' },
  { username: 'waves',      password: 'k7xx6w9s5p6',   role: 'coach',  lane: null,      riotId: null,                 name: 'Baş Koç',    image: '/logo.png' },
];
