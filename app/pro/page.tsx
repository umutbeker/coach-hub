'use client';

// Herkese açık sayfa — giriş kontrolü YOK, bilerek.
// Veri Redis'ten geliyor (/api/pro-vods), ziyaretçi Leaguepedia'ya istek atmıyor:
// anonim trafik Leaguepedia'nın IP bazlı limitini anında patlatır.

import { useEffect, useState } from 'react';
import { champImg } from '../../lib/champions';

type Vod = { url: string; embed: string | null; kind: string; start: number | null };
type Game = {
  gameId: string; date: string; tournament: string; gameInMatch: number | null;
  blueTeam: string; redTeam: string; winner: string | null; blueWon: boolean;
  vod: Vod | null; vodDraft: Vod | null; vodHighlights: Vod | null;
  draft: { blueBans: string[]; redBans: string[]; bluePicks: string[]; redPicks: string[] };
};
type League = { league: string; tournament: string; updatedAt: string; games: Game[] };

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

export default function ProPage() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Video ancak tıklanınca gömülüyor — 20 iframe'i birden yüklemek sayfayı öldürür.
  const [open, setOpen] = useState<Record<string, boolean>>({});

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
      .Hd{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;}
      .Lg{font-size:26px;font-weight:800;color:#F0E6D2;letter-spacing:0.06em;text-transform:uppercase;}
      .Lg em{color:#C89B3C;font-style:normal;}
      .Sb{font-size:12px;color:#5B5A56;}
      .Tabs{display:flex;gap:8px;margin:18px 0 20px;border-bottom:1px solid #1E2328;}
      .Tb{background:none;border:none;border-bottom:2px solid transparent;color:#5B5A56;font:inherit;font-size:14px;font-weight:700;letter-spacing:0.08em;padding:9px 14px;cursor:pointer;text-transform:uppercase;}
      .Tb.on{color:#C89B3C;border-bottom-color:#C89B3C;}
      .Tb:hover{color:#F0E6D2;}
      .Gc{border:1px solid #1E2328;background:#0A1428;margin-bottom:10px;}
      .Gh{display:flex;align-items:center;gap:10px;padding:11px 14px;flex-wrap:wrap;}
      .Dt{font-size:11px;color:#5B5A56;min-width:92px;}
      .Tn{font-size:15px;font-weight:700;color:#A09B8C;}
      .Tn.win{color:#F0E6D2;}
      .Tn.win:after{content:'✔';color:#0ACF83;font-size:11px;margin-left:5px;}
      .Vs{font-size:10px;color:#3C3C41;margin:0 3px;}
      .Gn{font-size:10px;color:#5B5A56;border:1px solid #1E2328;padding:2px 6px;}
      .Sp{margin-left:auto;}
      .Btn{background:#1E2328;color:#C89B3C;border:1px solid #3C3C41;font:inherit;font-size:11px;font-weight:700;letter-spacing:0.05em;padding:5px 11px;cursor:pointer;text-transform:uppercase;}
      .Btn:hover{background:#26303B;border-color:#C89B3C;}
      .Btn[disabled]{opacity:0.35;cursor:default;}
      .Lk{font-size:11px;color:#5B5A56;text-decoration:none;border-bottom:1px dotted #3C3C41;}
      .Lk:hover{color:#C89B3C;}
      .Dr{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#1E2328;border-top:1px solid #1E2328;}
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
      .Vw{border-top:1px solid #1E2328;background:#000;}
      .Vw iframe{display:block;width:100%;aspect-ratio:16/9;border:0;}
      .Em{text-align:center;padding:50px 20px;color:#3C3C41;font-size:13px;}
      .Ft{margin-top:22px;font-size:11px;color:#3C3C41;text-align:center;line-height:1.7;}
      .Ft a{color:#5B5A56;}
      @media(max-width:560px){.Dr{grid-template-columns:1fr;}.Dt{min-width:0;width:100%;}.Sp{margin-left:0;}}
    `}</style>

    <div className="W"><div className="In">
      <div className="Hd">
        <div className="Lg">Pro <em>Drafts</em></div>
        {lg && <span className="Sb">{lg.tournament} · son {lg.games.length} maç</span>}
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
      : lg.games.map(g => {
        const v = g.vodDraft ?? g.vod;
        const isOpen = !!open[g.gameId];
        return (
          <div key={g.gameId} className="Gc">
            <div className="Gh">
              <span className="Dt">{fmtDate(g.date)}</span>
              <span className={g.blueWon ? 'Tn win' : 'Tn'}>{g.blueTeam}</span>
              <span className="Vs">VS</span>
              <span className={g.winner === g.redTeam ? 'Tn win' : 'Tn'}>{g.redTeam}</span>
              {g.gameInMatch ? <span className="Gn">Maç {g.gameInMatch}</span> : null}
              <button className="Btn Sp" disabled={!v?.embed}
                onClick={() => setOpen(p => ({ ...p, [g.gameId]: !p[g.gameId] }))}>
                {!v?.embed ? 'Video yok' : isOpen ? 'Kapat' : 'Draftı izle'}
              </button>
              {g.vodHighlights?.url ? (
                <a className="Lk" href={g.vodHighlights.url} target="_blank" rel="noreferrer">Özet</a>
              ) : null}
            </div>

            {isOpen && v?.embed ? (
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
      })}

      <div className="Ft">
        Veriler <a href="https://lol.fandom.com" target="_blank" rel="noreferrer">Leaguepedia</a> kaynaklı.
        {lg ? ' Son güncelleme: ' + new Date(lg.updatedAt).toLocaleString('tr-TR') : ''}
      </div>
    </div></div>
  </>);
}
