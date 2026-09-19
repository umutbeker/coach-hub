// Takım kimliği — tek kaynak. Takım adı değişirse SADECE burası değişir.

// Arayüzde gösterilen kısa ad.
export const TEAM_NAME = 'Pyramid4';

// Leaguepedia'daki (lol.fandom.com) Team değeri. cargoquery where cümlelerine
// birebir gömüldüğü için wiki'deki yazımla harfi harfine aynı olmalı.
// 2026-09-19'da lol.fandom.com sorgusuyla doğrulandı.
export const TEAM_LP_NAME = 'Pyramid IV Esports';

// PandaScore eşleşmesi: takım adı küçük harfe çevrilip includes ile,
// acronym ise tam eşitlikle karşılaştırılıyor.
// PandaScore kaydı: name 'Pyramid IV Esports', acronym 'PIV', id 138971.
export const TEAM_PANDASCORE_NAME = 'pyramid iv';
export const TEAM_ACRONYM = 'piv';
