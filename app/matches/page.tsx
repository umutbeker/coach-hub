'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TEAM_NAME, TEAM_LP_NAME } from '../../lib/team';
import { champImg } from '../../lib/champions';

const LP_CACHE_KEY = 'matches_lp_v4';
const LP_CACHE_DURATION = 60 * 60 * 1000;

function isFresh(key: string, duration: number) { const t = localStorage.getItem(`${key}_time`); return t ? Date.now() - Number(t) < duration : false; }
function saveCache(key: string, data: any) { localStorage.setItem(key, JSON.stringify(data)); localStorage.setItem(`${key}_time`, String(Date.now())); }
function loadCache(key: string) { const d = localStorage.getItem(key); return d ? JSON.parse(d) : null; }
function dayDiff(a: string, b: string) { return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / (1000*60*60*24); }



function parseCargoData(data: any) {
  const gameMap: Record<string, any> = {};
  data.cargoquery.forEach((item: any) => {
    const m = item.title; const rawDate = (m['DateTime UTC'] ?? m['DateTime_UTC'] ?? '').split(' ')[0];
    const isS2G = m.Team === TEAM_LP_NAME; const opponent = isS2G ? m.TeamVs : m.Team;
    const gid = m.GameId || `${opponent}_${rawDate}`;
    if (!gameMap[gid]) {
      const bluePlayer = m.Side === '1' || m.Side?.toLowerCase() === 'blue';
      const s2gBlue = isS2G ? bluePlayer : !bluePlayer;
      gameMap[gid] = { id:gid, date:rawDate, tournament:m.Tournament||'TCL', opponent, blueTeam:s2gBlue?TEAM_NAME:opponent, redTeam:s2gBlue?opponent:TEAM_NAME, s2gBlue, result:isS2G?(m.PlayerWin==='Yes'?'W':'L'):(m.PlayerWin==='Yes'?'L':'W'), blueBans:[m.Team1Ban1,m.Team1Ban2,m.Team1Ban3,m.Team1Ban4,m.Team1Ban5].filter(Boolean), redBans:[m.Team2Ban1,m.Team2Ban2,m.Team2Ban3,m.Team2Ban4,m.Team2Ban5].filter(Boolean), bluePicks:[m.Team1Pick1,m.Team1Pick2,m.Team1Pick3,m.Team1Pick4,m.Team1Pick5].filter(Boolean), redPicks:[m.Team2Pick1,m.Team2Pick2,m.Team2Pick3,m.Team2Pick4,m.Team2Pick5].filter(Boolean) };
    }
  });
  const games = Object.values(gameMap).sort((a:any,b:any)=>b.date.localeCompare(a.date));
  const seriesArr: any[] = [];
  games.forEach((g:any)=>{const ex=seriesArr.find(s=>s.opponent===g.opponent&&s.tournament===g.tournament&&dayDiff(s.date,g.date)<=3);if(ex){ex.games.push(g);if(g.result==='W')ex.wins++;else ex.losses++;ex.result=ex.wins>ex.losses?'W':'L';}else seriesArr.push({id:`s_${g.opponent}_${g.date}`,date:g.date,tournament:g.tournament,opponent:g.opponent,wins:g.result==='W'?1:0,losses:g.result==='L'?1:0,result:g.result,games:[g]});});
  seriesArr.forEach((s:any)=>s.games.sort((a:any,b:any)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)));
  return seriesArr;
}

export default function MatchesPage() {
  const router = useRouter();
  const [series, setSeries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string|null>(null);
  const [activeGame, setActiveGame] = useState<Record<string,number>>({});

  useEffect(() => {
    const fetchData = async () => {
      if (isFresh(LP_CACHE_KEY, LP_CACHE_DURATION)) { const c = loadCache(LP_CACHE_KEY); if (c?.length > 0) { setSeries(c); setLoading(false); return; } }
      try { const rr = await fetch('/api/data?type=matches'); const rd = await rr.json(); if (rd.data?.cargoquery?.length > 0) { const p = parseCargoData(rd.data); saveCache(LP_CACHE_KEY, p); setSeries(p); setLoading(false); return; } } catch {}
      try { const p = new URLSearchParams({ action:'cargoquery', tables:'ScoreboardPlayers=SP,PicksAndBansS7=PB', fields:['SP.PlayerWin','SP.DateTime_UTC','SP.Tournament','SP.Team','SP.TeamVs','SP.Side','SP.GameId','PB.Team1Ban1','PB.Team1Ban2','PB.Team1Ban3','PB.Team1Ban4','PB.Team1Ban5','PB.Team2Ban1','PB.Team2Ban2','PB.Team2Ban3','PB.Team2Ban4','PB.Team2Ban5','PB.Team1Pick1','PB.Team1Pick2','PB.Team1Pick3','PB.Team1Pick4','PB.Team1Pick5','PB.Team2Pick1','PB.Team2Pick2','PB.Team2Pick3','PB.Team2Pick4','PB.Team2Pick5'].join(','), join_on:'SP.GameId=PB.GameId', where:`SP.Team='${TEAM_LP_NAME}' OR SP.TeamVs='${TEAM_LP_NAME}'`, order_by:'SP.DateTime_UTC DESC', limit:'500', format:'json', origin:'*' }); const res = await fetch(`https://lol.fandom.com/api.php?${p}`); const data = await res.json(); if (!data.cargoquery?.length) throw new Error('empty'); const parsed = parseCargoData(data); saveCache(LP_CACHE_KEY, parsed); setSeries(parsed); } catch {}
      setLoading(false);
    };
    fetchData();
  }, []);

  const toggle = (id:string) => { setExpanded(p=>p===id?null:id); setActiveGame(p=>({...p,[id]:0})); };
  const totalGames = series.reduce((a,s)=>a+s.wins+s.losses,0);
  const totalWins = series.reduce((a,s)=>a+s.wins,0);
  const wr = totalGames>0?Math.round((totalWins/totalGames)*100):0;
  const serW = series.filter(s=>s.result==='W').length;

  return (<>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;900&family=Barlow:wght@300;400;500;600&display=swap');
      *{box-sizing:border-box;margin:0;padding:0;}body{background:#010A13;font-family:'Barlow',sans-serif;color:#A09B8C;}
      .R{min-height:100vh;padding:30px 40px;}

      .H{display:flex;justify-content:space-between;align-items:center;padding-bottom:20px;margin-bottom:24px;border-bottom:1px solid #1E2328;}
      .HT{font-family:'Barlow Condensed';font-weight:900;font-size:28px;text-transform:uppercase;letter-spacing:0.04em;color:#F0E6D2;}
      .HT em{color:#C89B3C;font-style:normal;}
      .HS{color:#5B5A56;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;margin-top:4px;}
      .BB{background:transparent;color:#5B5A56;border:1px solid #1E2328;padding:7px 18px;border-radius:4px;cursor:pointer;font-family:'Barlow Condensed';font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;transition:all 0.15s;}
      .BB:hover{color:#F0E6D2;border-color:#C89B3C;}

      .KP{display:flex;align-items:stretch;background:#091428;border:1px solid #1E2328;border-radius:6px;margin-bottom:24px;overflow:hidden;}
      .KI{flex:1;display:flex;align-items:center;gap:14px;padding:18px 24px;border-right:1px solid #1E2328;}.KI:last-child{border-right:none;}
      .KV{font-family:'Barlow Condensed';font-weight:900;font-size:32px;line-height:1;}
      .KL{font-size:10px;color:#5B5A56;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;line-height:1.3;}

      .LS{display:flex;flex-direction:column;gap:10px;}
      .SC{background:#091428;border:1px solid #1E2328;border-radius:6px;overflow:hidden;transition:border-color 0.2s;}
      .SC:hover{border-color:rgba(200,155,60,0.15);}
      .SC.op{border-color:rgba(200,155,60,0.25);}

      .SH{display:flex;justify-content:space-between;align-items:center;padding:16px 22px;cursor:pointer;user-select:none;transition:background 0.15s;}
      .SH:hover{background:rgba(200,155,60,0.02);}
      .SHL{display:flex;flex-direction:column;gap:4px;}
      .SHM{font-size:10px;font-weight:700;color:#3C3C41;text-transform:uppercase;letter-spacing:0.1em;}
      .SHT{font-family:'Barlow Condensed';font-size:24px;font-weight:900;line-height:1;display:flex;align-items:center;color:#F0E6D2;}
      .SHT .s2g{color:#C89B3C;}
      .SHT .sep{color:#1E2328;margin:0 12px;font-size:18px;font-weight:400;}
      .SHR{display:flex;align-items:center;gap:10px;}
      .BO{font-size:10px;font-weight:700;color:#5B5A56;letter-spacing:0.08em;background:rgba(30,35,40,0.4);border:1px solid #1E2328;padding:4px 10px;border-radius:4px;}
      .SCO{font-family:'Barlow Condensed';font-weight:900;font-size:24px;display:flex;align-items:center;gap:5px;}
      .SCO .w{color:#0ACF83;}.SCO .d{color:#1E2328;font-size:16px;}.SCO .l{color:#E84057;}
      .RB{font-family:'Barlow Condensed';font-weight:800;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;padding:5px 14px;border-radius:4px;}
      .RB.w{background:rgba(10,207,131,0.08);color:#0ACF83;border:1px solid rgba(10,207,131,0.15);}
      .RB.l{background:rgba(232,64,87,0.08);color:#E84057;border:1px solid rgba(232,64,87,0.15);}
      .AR{font-size:9px;color:#3C3C41;letter-spacing:0.08em;text-transform:uppercase;min-width:44px;text-align:right;}

      .GT{display:flex;padding:0 20px;border-top:1px solid #1E2328;border-bottom:1px solid #1E2328;background:rgba(0,0,0,0.15);}
      .GTB{display:flex;align-items:center;gap:6px;font-family:'Barlow Condensed';font-weight:700;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;padding:10px 14px;cursor:pointer;border:none;background:none;border-bottom:2px solid transparent;margin-bottom:-1px;transition:all 0.15s;color:#5B5A56;}
      .GTB.on{color:#C89B3C;border-bottom-color:#C89B3C;}
      .GTB:hover:not(.on){color:#A09B8C;}
      .GDT{width:6px;height:6px;border-radius:50%;flex-shrink:0;}

      .DR{padding:22px 24px;display:grid;grid-template-columns:1fr 32px 1fr;gap:0;}
      .DS{display:flex;flex-direction:column;gap:16px;}
      .DSH{display:flex;align-items:center;gap:10px;padding-bottom:10px;border-bottom:2px solid;}
      .BL .DSH{border-color:rgba(5,150,170,0.3);}.RD .DSH{border-color:rgba(232,64,87,0.3);}
      .DSN{font-family:'Barlow Condensed';font-weight:800;font-size:16px;text-transform:uppercase;letter-spacing:0.03em;}
      .BL .DSN{color:#0596AA;}.RD .DSN{color:#E84057;}
      .UT{background:#C89B3C;color:#010A13;font-size:8px;font-weight:800;padding:2px 7px;border-radius:3px;letter-spacing:0.06em;text-transform:uppercase;}
      .GR{font-size:9px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:3px 8px;border-radius:3px;margin-left:auto;}
      .GR.w{background:rgba(10,207,131,0.08);color:#0ACF83;}.GR.l{background:rgba(232,64,87,0.08);color:#E84057;}
      .DSC{display:flex;flex-direction:column;gap:8px;}
      .DLB{font-size:9px;font-weight:700;color:#3C3C41;letter-spacing:0.12em;text-transform:uppercase;}
      .CHS{display:flex;gap:7px;flex-wrap:wrap;}
      .CH{display:flex;flex-direction:column;align-items:center;gap:3px;}
      .CHL{font-size:8px;color:#3C3C41;text-align:center;max-width:50px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .PI{width:52px;height:52px;border-radius:8px;border:2px solid #1E2328;object-fit:cover;transition:all 0.15s;}
      .PI:hover{transform:scale(1.08);}
      .BL .PI:hover{border-color:rgba(5,150,170,0.5);}.RD .PI:hover{border-color:rgba(232,64,87,0.5);}
      .BW{position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;}
      .BI{width:34px;height:34px;border-radius:6px;border:1px solid #1E2328;object-fit:cover;}
      .BW::after{content:'✕';position:absolute;top:50%;left:50%;transform:translate(-50%,-55%);font-size:13px;font-weight:900;color:rgba(232,64,87,0.6);pointer-events:none;margin-top:-4px;}
      .DVC{display:flex;justify-content:center;align-items:flex-start;padding-top:14px;}
      .DVT{font-family:'Barlow Condensed';font-weight:900;font-size:11px;color:#1E2328;letter-spacing:0.2em;}
      .ND{font-size:11px;color:#3C3C41;font-style:italic;}

      .LW{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 0;gap:12px;}
      .LT{font-family:'Barlow Condensed';font-weight:700;font-size:18px;letter-spacing:0.1em;text-transform:uppercase;color:#C89B3C;}
      .LSB{font-size:11px;color:#3C3C41;}
      .SP{width:32px;height:32px;border:3px solid #1E2328;border-top-color:#C89B3C;border-radius:50%;animation:sp .8s linear infinite;}
      @keyframes sp{to{transform:rotate(360deg)}}
      .EM{text-align:center;padding:80px 0;color:#3C3C41;font-size:13px;}
    `}</style>

    <div className="R">
      <div className="H">
        <div><div className="HT">Match <em>History</em></div><div className="HS">Series History · Draft Analysis · Leaguepedia</div></div>
        <button className="BB" onClick={()=>router.back()}>← Back</button>
        <button className="BB" onClick={()=>router.push('/pro')}>🎬 Pro Drafts</button>
      </div>

      {!loading && series.length>0 && (
        <div className="KP">
          <div className="KI"><div className="KV" style={{color:'#C89B3C'}}>{totalGames}</div><div className="KL">Total<br/>Games</div></div>
          <div className="KI"><div className="KV" style={{color:'#0ACF83'}}>{wr}%</div><div className="KL">Win<br/>Rate</div></div>
          <div className="KI"><div className="KV" style={{color:'#E84057'}}>{series.length}</div><div className="KL">Total<br/>Series</div></div>
          <div className="KI"><div className="KV" style={{color:'#9D48E0'}}>{serW}</div><div className="KL">Series<br/>Wins</div></div>
        </div>
      )}

      {loading ? (
        <div className="LW"><div className="SP"/><div className="LT">Loading Data</div><div className="LSB">Fetching match history...</div></div>
      ) : series.length===0 ? (
        <div className="EM">No match data found</div>
      ) : (
        <div className="LS">
          {series.map(s => {
            const isOpen = expanded===s.id;
            const gc = s.games.length;
            const bo = gc>=4?'BO5':gc>=2?'BO3':'BO1';
            const gi = activeGame[s.id]??0;
            const g = s.games[gi]??s.games[0];
            const blueIsS2G = g.blueTeam===TEAM_NAME;
            const blueWin = (blueIsS2G&&g.result==='W')||(!blueIsS2G&&g.result==='L');
            return (
              <div key={s.id} className={`SC ${isOpen?'op':''}`}>
                <div className="SH" onClick={()=>toggle(s.id)}>
                  <div className="SHL">
                    <div className="SHM">{s.tournament} · {s.date}</div>
                    <div className="SHT"><span className="s2g">{TEAM_NAME}</span><span className="sep">vs</span><span>{s.opponent}</span></div>
                  </div>
                  <div className="SHR">
                    <span className="BO">{bo}</span>
                    <div className="SCO"><span className="w">{s.wins}</span><span className="d">—</span><span className="l">{s.losses}</span></div>
                    <div className={`RB ${s.result==='W'?'w':'l'}`}>{s.result==='W'?'WIN':'LOSS'}</div>
                    <span className="AR">{isOpen?'▲':'▼ DRAFT'}</span>
                  </div>
                </div>
                {isOpen&&(<>
                  {gc>1&&(<div className="GT">{s.games.map((gg:any,idx:number)=>(<button key={gg.id} className={`GTB ${gi===idx?'on':''}`} onClick={()=>setActiveGame(p=>({...p,[s.id]:idx}))}><div className="GDT" style={{background:gg.result==='W'?'#0ACF83':'#E84057'}}/>Game {idx+1}</button>))}</div>)}
                  <div className="DR">
                    <div className="DS BL">
                      <div className="DSH"><span className="DSN">{g.blueTeam}</span>{blueIsS2G&&<span className="UT">US</span>}<span className={`GR ${blueWin?'w':'l'}`}>{blueWin?'WIN':'LOSS'}</span></div>
                      {g.blueBans.length>0&&<div className="DSC"><div className="DLB">Bans</div><div className="CHS">{g.blueBans.map((c:string,i:number)=><div className="BW" key={i}><img src={champImg(c)} className="BI" alt={c} onError={(e:any)=>{e.target.src='/logo.png';}}/><span className="CHL">{c}</span></div>)}</div></div>}
                      <div className="DSC"><div className="DLB">Picks</div><div className="CHS">{g.bluePicks.length>0?g.bluePicks.map((c:string,i:number)=><div className="CH" key={i}><img src={champImg(c)} className="PI" alt={c} onError={(e:any)=>{e.target.src='/logo.png';}}/><span className="CHL">{c}</span></div>):<span className="ND">—</span>}</div></div>
                    </div>
                    <div className="DVC"><span className="DVT">VS</span></div>
                    <div className="DS RD">
                      <div className="DSH"><span className="DSN">{g.redTeam}</span>{!blueIsS2G&&<span className="UT">US</span>}<span className={`GR ${!blueWin?'w':'l'}`}>{!blueWin?'WIN':'LOSS'}</span></div>
                      {g.redBans.length>0&&<div className="DSC"><div className="DLB">Bans</div><div className="CHS">{g.redBans.map((c:string,i:number)=><div className="BW" key={i}><img src={champImg(c)} className="BI" alt={c} onError={(e:any)=>{e.target.src='/logo.png';}}/><span className="CHL">{c}</span></div>)}</div></div>}
                      <div className="DSC"><div className="DLB">Picks</div><div className="CHS">{g.redPicks.length>0?g.redPicks.map((c:string,i:number)=><div className="CH" key={i}><img src={champImg(c)} className="PI" alt={c} onError={(e:any)=>{e.target.src='/logo.png';}}/><span className="CHL">{c}</span></div>):<span className="ND">—</span>}</div></div>
                    </div>
                  </div>
                </>)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  </>);
}
