'use client';

// Herkese açık sayfa — giriş kontrolü YOK, bilerek.
// Veri Redis'ten geliyor (/api/pro-vods), ziyaretçi Leaguepedia'ya istek atmıyor:
// anonim trafik Leaguepedia'nın IP bazlı limitini anında patlatır.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { champImg } from '../../lib/champions';

type Vod = { url: string; embed: string | null; kind: string; start: number | null };
type Game = {
  gameId: string; matchId: string; date: string; gameInMatch: number | null;
  blueTeam: string; redTeam: string; winner: string | null; blueWon: boolean;
  vod: Vod | null; vodDraft: Vod | null; vodHighlights: Vod | null;
  draft: { blueBans: string[]; redBans: string[]; bluePicks: string[]; redPicks: string[] };
};
type Series = {
  matchId: string; date: string; tournament: string;
  teamA: string; teamB: string; scoreA: number; scoreB: number;
  winner: string | null; gamesPlayed: number; games: Game[];
};
type League = { league: string; tournament: string; updatedAt: string; series: Series[] };

const fmtDate = (s: string) => {
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
};

function Champs({ names, kind }: { names: string[]; kind: 'ban' | 'pick' }) {
  if (!names.length) return <span className="none">—</span>;
  return (
    <div className="row">
      {names.map((c, i) => (
        <img key={c + i} src={champImg(c)} alt={c} title={c}
          className={kind === 'ban' ? 'ci ban' : 'ci'}
          onError={(e) => { (e.target as HTMLImageElement).src = '/logo.png'; }} />
      ))}
    </div>
  );
}

function GameRow({ g }: { g: Game }) {
  const [open, setOpen] = useState(false);
  // iframe ancak tıklanınca basılıyor — bir seride 5 video birden yüklenmemeli.
  const v = g.vodDraft ?? g.vod;
  return (
    <div className="Gm">
      <div className="Gh">
        <span className="Gn">Maç {g.gameInMatch ?? '?'}</span>
        <span className={g.blueWon ? 'Tn win' : 'Tn'}>{g.blueTeam}</span>
        <span className="Vs">VS</span>
        <span className={g.winner === g.redTeam ? 'Tn win' : 'Tn'}>{g.redTeam}</span>
        <button className="Btn Sp" disabled={!v?.embed} onClick={() => setOpen(o => !o)}>
          {!v?.embed ? 'Video yok' : open ? 'Kapat' : 'Draftı izle'}
        </button>
        {g.vodHighlights?.url ? (
          <a className="Lk" href={g.vodHighlights.url} target="_blank" rel="noreferrer">Özet</a>
        ) : null}
      </div>

      {open && v?.embed ? (
        <div className="Vw">
          <iframe src={v.embed} title={g.blueTeam + ' vs ' + g.redTeam + ' draft'}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
            allowFullScreen loading="lazy" />
        </div>
      ) : null}

      <div className="Dr">
        <div className="Sd">
          <div className="Sh blue">{g.blueTeam} · Mavi</div>
          <div className="Lb">Ban</div><Champs names={g.draft.blueBans} kind="ban" />
          <div className="Lb">Pick</div><Champs names={g.draft.bluePicks} kind="pick" />
        </div>
        <div className="Sd red">
          <div className="Sh red">{g.redTeam} · Kırmızı</div>
          <div className="Lb">Ban</div><Champs names={g.draft.redBans} kind="ban" />
          <div className="Lb">Pick</div><Champs names={g.draft.redPicks} kind="pick" />
        </div>
      </div>
    </div>
  );
}

// localStorage erişimi gizli sekmede/engellenmiş site verisinde hata atabiliyor.
function getStoredUser(): string | null {
  try { return localStorage.getItem('currentUser'); } catch { return null; }
}

// Başka sekmede çıkış yapılırsa geri butonu da güncellensin.
function subscribeToUser(onChange: () => void) {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

export default function ProPage() {
  const router = useRouter();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Sayfa herkese açık; giriş yapmış ziyaretçiye kendi paneline dönüş sunuyoruz.
  // Girişsiz ziyaretçide geri butonu yok — onu login'e atmanın anlamı olmaz.
  //
  // localStorage'ı effect içinde okuyup setState etmek cascading render
  // uyarısı veriyor; sunucuda okunamadığı için de doğrudan render'da
  // okunamıyor (hydration uyuşmazlığı). useSyncExternalStore ikisini de çözüyor:
  // sunucu anlık görüntüsü null, istemci gerçek değeri veriyor.
  const storedUser = useSyncExternalStore(subscribeToUser, getStoredUser, () => null);

  const home = useMemo(() => {
    if (!storedUser) return null;
    try {
      const u = JSON.parse(storedUser);
      return u?.role === 'coach'
        ? { href: '/coach', label: '← Koç Paneli' }
        : { href: '/player', label: '← Panelim' };
    } catch { return null; }
  }, [storedUser]);

  useEffect(() => {
    fetch('/api/pro-vods')
      .then(r => r.json())
      .then(d => { if (d.success) setLeagues(d.leagues || []); else setError(d.error || 'Veri alınamadı'); })
      .catch(() => setError('Veri alınamadı'))
      .finally(() => setLoading(false));
  }, []);

  const lg = leagues[active];

  return (<>
    <style>{`
      .W{min-height:100vh;background:#010A13;color:#A09B8C;font-family:'Barlow Condensed',Arial,sans-serif;padding:24px 16px 60px;}
      .In{max-width:960px;margin:0 auto;}
      .Nv{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:18px;}
      .Nb{background:#0A1428;color:#5B5A56;border:1px solid #1E2328;font:inherit;font-size:11px;font-weight:700;letter-spacing:0.05em;padding:6px 12px;cursor:pointer;text-transform:uppercase;}
      .Nb:hover{color:#C89B3C;border-color:#C89B3C;}
      .Nb.on{color:#C89B3C;border-color:#C89B3C;}
      .Hd{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;}
      .Lg{font-size:26px;font-weight:800;color:#F0E6D2;letter-spacing:0.06em;text-transform:uppercase;}
      .Lg em{color:#C89B3C;font-style:normal;}
      .Sb{font-size:12px;color:#5B5A56;}
      .Tabs{display:flex;gap:8px;margin:18px 0 20px;border-bottom:1px solid #1E2328;}
      .Tb{background:none;border:none;border-bottom:2px solid transparent;color:#5B5A56;font:inherit;font-size:14px;font-weight:700;letter-spacing:0.08em;padding:9px 14px;cursor:pointer;text-transform:uppercase;}
      .Tb.on{color:#C89B3C;border-bottom-color:#C89B3C;}
      .Tb:hover{color:#F0E6D2;}

      .Sc{border:1px solid #1E2328;background:#0A1428;margin-bottom:8px;}
      .Sr{display:flex;align-items:center;gap:12px;padding:13px 14px;cursor:pointer;width:100%;background:none;border:none;font:inherit;color:inherit;text-align:left;}
      .Sr:hover{background:#0D1A2E;}
      .Dt{font-size:11px;color:#5B5A56;min-width:92px;}
      .Mt{display:flex;align-items:center;gap:10px;flex:1;min-width:0;flex-wrap:wrap;}
      .Tm{font-size:17px;font-weight:700;color:#5B5A56;}
      .Tm.win{color:#F0E6D2;}
      .Sq{font-size:17px;font-weight:800;color:#C89B3C;letter-spacing:0.08em;}
      .Bo{font-size:10px;color:#5B5A56;border:1px solid #1E2328;padding:2px 7px;}
      .Ch{font-size:11px;color:#5B5A56;margin-left:6px;}
      .Gs{border-top:1px solid #1E2328;}
      .Gm{border-bottom:1px solid #1E2328;}
      .Gm:last-child{border-bottom:none;}
      .Gh{display:flex;align-items:center;gap:10px;padding:9px 14px;flex-wrap:wrap;background:#081120;}
      .Gn{font-size:10px;color:#C89B3C;border:1px solid #3C3C41;padding:2px 7px;letter-spacing:0.05em;}
      .Tn{font-size:13px;font-weight:700;color:#5B5A56;}
      .Tn.win{color:#F0E6D2;}
      .Tn.win:after{content:'✔';color:#0ACF83;font-size:10px;margin-left:5px;}
      .Vs{font-size:10px;color:#3C3C41;}
      .Sp{margin-left:auto;}
      .Btn{background:#1E2328;color:#C89B3C;border:1px solid #3C3C41;font:inherit;font-size:11px;font-weight:700;letter-spacing:0.05em;padding:5px 11px;cursor:pointer;text-transform:uppercase;}
      .Btn:hover{background:#26303B;border-color:#C89B3C;}
      .Btn[disabled]{opacity:0.35;cursor:default;}
      .Lk{font-size:11px;color:#5B5A56;text-decoration:none;border-bottom:1px dotted #3C3C41;}
      .Lk:hover{color:#C89B3C;}
      .Dr{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#1E2328;}
      .Sd{background:#0A1428;padding:11px 14px;}
      .Sd.red{background:#100D14;}
      .Sh{font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px;}
      .Sh.blue{color:#0596AA;}
      .Sh.red{color:#E84057;}
      .Lb{font-size:9px;color:#3C3C41;letter-spacing:0.08em;text-transform:uppercase;margin:7px 0 3px;}
      .row{display:flex;gap:3px;flex-wrap:wrap;}
      .ci{width:30px;height:30px;border:1px solid #1E2328;}
      .ci.ban{filter:grayscale(1);opacity:0.42;}
      .none{font-size:11px;color:#3C3C41;}
      .Vw{background:#000;}
      .Vw iframe{display:block;width:100%;aspect-ratio:16/9;border:0;}
      .Em{text-align:center;padding:50px 20px;color:#3C3C41;font-size:13px;}
      .Ft{margin-top:22px;font-size:11px;color:#3C3C41;text-align:center;line-height:1.7;}
      .Ft a{color:#5B5A56;}
      @media(max-width:560px){.Dr{grid-template-columns:1fr;}.Dt{min-width:0;}.Sr{flex-wrap:wrap;}.Sp{margin-left:0;}}
    `}</style>

    <div className="W"><div className="In">
      {home ? (
        <div className="Nv">
          <button className="Nb" onClick={() => router.push(home.href)}>{home.label}</button>
        </div>
      ) : null}

      <div className="Hd">
        <div className="Lg">Pro <em>Drafts</em></div>
        {lg ? <span className="Sb">{lg.tournament} · {lg.series.length} seri</span> : null}
      </div>

      <div className="Tabs">
        {leagues.map((l, i) => (
          <button key={l.league} className={i === active ? 'Tb on' : 'Tb'} onClick={() => setActive(i)}>
            {l.league}
          </button>
        ))}
      </div>

      {loading ? <div className="Em">Yükleniyor…</div>
      : error ? <div className="Em">{error}</div>
      : !lg ? <div className="Em">Veri yok</div>
      : lg.series.map(s => {
        const isOpen = !!open[s.matchId];
        return (
          <div key={s.matchId} className="Sc">
            <button className="Sr" onClick={() => setOpen(p => ({ ...p, [s.matchId]: !p[s.matchId] }))}>
              <span className="Dt">{fmtDate(s.date)}</span>
              <span className="Mt">
                <span className={s.winner === s.teamA ? 'Tm win' : 'Tm'}>{s.teamA}</span>
                <span className="Sq">{s.scoreA}–{s.scoreB}</span>
                <span className={s.winner === s.teamB ? 'Tm win' : 'Tm'}>{s.teamB}</span>
                <span className="Bo">{s.gamesPlayed} maç</span>
              </span>
              <span className="Ch">{isOpen ? '▲ kapat' : '▼ maçları aç'}</span>
            </button>

            {isOpen ? (
              <div className="Gs">
                {s.games.map(g => <GameRow key={g.gameId} g={g} />)}
              </div>
            ) : null}
          </div>
        );
      })}

      <div className="Ft">
        Veriler <a href="https://lol.fandom.com" target="_blank" rel="noreferrer">Leaguepedia</a> kaynaklı.
        {lg ? ' Son güncelleme: ' + new Date(lg.updatedAt).toLocaleString('tr-TR') : ''}
      </div>
    </div></div>
  </>);
}
