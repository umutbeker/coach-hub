'use client';

import { useRouter } from 'next/navigation';
import { TEAM_NAME, TEAM_LP_NAME } from '../../lib/team';
import { useEffect, useState } from 'react';

const CACHE_DURATIONS = { riot: 60*60*1000, pro: 30*60*1000, lp: 6*60*60*1000 };
const TIER_COLORS: Record<string, string> = {
  IRON:'#5B5A56',BRONZE:'#CD7F32',SILVER:'#A09B8C',GOLD:'#C89B3C',
  PLATINUM:'#0596AA',EMERALD:'#0ACF83',DIAMOND:'#576CBC',
  MASTER:'#9D48E0',GRANDMASTER:'#E84057',CHALLENGER:'#F4D03F',UNRANKED:'#3C3C41',
};

function isFresh(key: string, dur: number) { const t = localStorage.getItem(`${key}_time`); return t ? Date.now() - Number(t) < dur : false; }
function saveCache(key: string, data: any) { localStorage.setItem(key, JSON.stringify(data)); localStorage.setItem(`${key}_time`, String(Date.now())); }
function loadCache(key: string) { const d = localStorage.getItem(key); return d ? JSON.parse(d) : null; }

export default function PlayerDashboard() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [actualRole, setActualRole] = useState<string | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [proStats, setProStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'soloq'|'pro'|'fixture'>('soloq');
  const [fixture, setFixture] = useState<any>(null);
  const [fixtureLoading, setFixtureLoading] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<any>(null);
  const [scoutData, setScoutData] = useState<any>(null);
  const [scoutLoading, setScoutLoading] = useState(false);
  const [activeScoutGame, setActiveScoutGame] = useState<Record<string,number>>({});

  // ── ALL FETCH FUNCTIONS (unchanged) ──
  const fetchData = async (parsedUser: any) => {
    setLoading(true);
    const riotKey = `riot_${parsedUser.name}`, proKey = `pro_${parsedUser.name}`, lpKey = `lp_${parsedUser.name}`;
    try {
      let riotData = null;
      if (isFresh(riotKey, CACHE_DURATIONS.riot)) { riotData = loadCache(riotKey); }
      else { try { const res = await fetch('/api/data', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ playerName: parsedUser.name }) }); riotData = await res.json(); if (!riotData.error) saveCache(riotKey, riotData); } catch { riotData = loadCache(riotKey); } }
      setStats(riotData);
      let proData = null;
      if (isFresh(proKey, CACHE_DURATIONS.pro)) { proData = loadCache(proKey); }
      else { try { const res = await fetch('/api/pro', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ playerName: parsedUser.name }) }); proData = await res.json(); saveCache(proKey, proData); } catch { proData = loadCache(proKey); } }
      let lpData = null;
      if (isFresh(lpKey, CACHE_DURATIONS.lp)) { lpData = loadCache(lpKey); }
      else {
        try { const redisRes = await fetch(`/api/data?type=lp&player=${parsedUser.name}`); const redisData = await redisRes.json(); if (redisData.data?.cargoquery?.length > 0) { lpData = redisData.data; saveCache(lpKey, lpData); } else { throw new Error('empty'); } }
        catch { try { const lpParams = new URLSearchParams({ action:'cargoquery', tables:'ScoreboardPlayers', fields:'Champion,Kills,Deaths,Assists,PlayerWin,DateTime_UTC,Tournament,Team,TeamVs,CS,Gold,Side', where:`Name='${parsedUser.lpName ?? parsedUser.name}' AND Team='${TEAM_LP_NAME}'`, order_by:'DateTime_UTC DESC', limit:'50', format:'json', origin:'*' }); const res = await fetch(`https://lol.fandom.com/api.php?${lpParams}`); lpData = await res.json(); if (lpData.cargoquery?.length > 0) saveCache(lpKey, lpData); } catch { lpData = loadCache(lpKey); } }
      }
      if (lpData?.cargoquery?.length > 0) {
        const lpM = lpData.cargoquery.map((x: any) => x.title);
        let tK=0,tD=0,tA=0,tW=0,bW=0,bG=0,rW=0,rG=0,tCS=0,csG=0;
        const cM:Record<string,any>={},tM:Record<string,any>={},oM:Record<string,any>={},sM:Record<string,any>={};
        lpM.forEach((m:any,i:number)=>{const k=Number(m.Kills)||0,d=Number(m.Deaths)||0,a=Number(m.Assists)||0,win=m.PlayerWin==='Yes',cs=Number(m.CS)||0,side=m.Side||'',yr=(m['DateTime UTC']||m.DateTime_UTC||'').slice(0,4);tK+=k;tD+=d;tA+=a;if(win)tW++;if(cs>0){tCS+=cs;csG++;}if(side==='1'||side.toLowerCase()==='blue'){bG++;if(win)bW++;}else if(side==='2'||side.toLowerCase()==='red'){rG++;if(win)rW++;}if(yr){if(!sM[yr])sM[yr]={year:yr,games:0,wins:0,k:0,d:0,a:0};sM[yr].games++;sM[yr].k+=k;sM[yr].d+=d;sM[yr].a+=a;if(win)sM[yr].wins++;}if(!cM[m.Champion])cM[m.Champion]={name:m.Champion,games:0,wins:0,k:0,d:0,a:0};cM[m.Champion].games++;cM[m.Champion].k+=k;cM[m.Champion].d+=d;cM[m.Champion].a+=a;if(win)cM[m.Champion].wins++;const t=m.Tournament||'Other';if(!tM[t])tM[t]={name:t,games:0,wins:0,k:0,d:0,a:0};tM[t].games++;tM[t].k+=k;tM[t].d+=d;tM[t].a+=a;if(win)tM[t].wins++;const o=m.TeamVs||'';if(o){if(!oM[o])oM[o]={name:o,games:0,wins:0};oM[o].games++;if(win)oM[o].wins++;}if(proData?.lastMatches?.[i]){proData.lastMatches[i].champion=m.Champion||'—';proData.lastMatches[i].kda=`${k}/${d}/${a}`;}});
        setProStats({...proData,overallKda:((tK+tA)/(tD||1)).toFixed(2),overallWinRate:Math.round((tW/lpM.length)*100),totalProGames:lpM.length,proChampionStats:Object.values(cM).map((c:any)=>({name:c.name,games:c.games,wins:c.wins,winRate:Math.round((c.wins/c.games)*100),kda:((c.k+c.a)/(c.d||1)).toFixed(2)})).sort((a:any,b:any)=>b.games-a.games),tournamentStats:Object.values(tM).map((t:any)=>({name:t.name,games:t.games,winRate:Math.round((t.wins/t.games)*100),kda:((t.k+t.a)/(t.d||1)).toFixed(2)})).sort((a:any,b:any)=>b.games-a.games),opponentStats:Object.values(oM).map((o:any)=>({name:o.name,games:o.games,winRate:Math.round((o.wins/o.games)*100)})).sort((a:any,b:any)=>b.games-a.games).slice(0,6),seasonStats:Object.values(sM).map((s:any)=>({year:s.year,games:s.games,winRate:Math.round((s.wins/s.games)*100),kda:((s.k+s.a)/(s.d||1)).toFixed(2)})).sort((a:any,b:any)=>b.year-a.year),sideStats:{blue:{games:bG,winRate:bG>0?Math.round((bW/bG)*100):0},red:{games:rG,winRate:rG>0?Math.round((rW/rG)*100):0}},avgProCsPerGame:csG>0?Math.round(tCS/csG):0});
      } else { setProStats(proData); }
    } catch(e){console.error(e);} finally{setLoading(false);}
  };

  const CHAMP_MAP_LOCAL: Record<string,string> = {'Wukong':'MonkeyKing','Renata Glasc':'Renata',"K'Sante":'KSante','Nunu & Willump':'Nunu','Jarvan IV':'JarvanIV','Lee Sin':'LeeSin','Master Yi':'MasterYi','Miss Fortune':'MissFortune','Twisted Fate':'TwistedFate','Dr. Mundo':'DrMundo','Aurelion Sol':'AurelionSol',"Bel'Veth":'Belveth',"Cho'Gath":'Chogath',"Kai'Sa":'Kaisa',"Kha'Zix":'Khazix',"Kog'Maw":'KogMaw',"Vel'Koz":'Velkoz',"Rek'Sai":'RekSai','Xin Zhao':'XinZhao','Tahm Kench':'TahmKench','LeBlanc':'Leblanc'};
  const ci = (name: string) => { if (!name) return '/logo.png'; const key = CHAMP_MAP_LOCAL[name] ?? name.replace(/[\s'".]/g,''); return `https://ddragon.leagueoflegends.com/cdn/16.5.1/img/champion/${key}.png`; };

  const fetchScout = async (opponent: string, matchId: string, forceRefresh = false) => {
    const cacheKey = `scout_${matchId}`; if (!forceRefresh) { const cached = localStorage.getItem(cacheKey); if (cached) { setScoutData(JSON.parse(cached)); return; } }
    setScoutLoading(true);
    try {
      const TM: Record<string,string> = {'BIG':'Berlin International Gaming','The Otter Side':'Otter Side'}; const lp = TM[opponent] ?? opponent;
      const bp = (t:string) => new URLSearchParams({action:'cargoquery',tables:'ScoreboardPlayers',fields:'Champion,PlayerWin,DateTime_UTC,Tournament,Team,Name',where:`Team="${t}"`,order_by:'DateTime_UTC DESC',limit:'75',format:'json',origin:'*'});
      let res = await fetch(`https://lol.fandom.com/api.php?${bp(lp)}`); let data = await res.json();
      if (!data.cargoquery?.length) { const fp = new URLSearchParams({action:'cargoquery',tables:'ScoreboardPlayers',fields:'Champion,PlayerWin,DateTime_UTC,Tournament,Team,Name',where:`Team LIKE "%${lp.split(' ')[0]}%"`,order_by:'DateTime_UTC DESC',limit:'75',format:'json',origin:'*'}); res = await fetch(`https://lol.fandom.com/api.php?${fp}`); data = await res.json(); }
      if (!data.cargoquery?.length) { setScoutData({error:`No data for "${opponent}"`,opponent}); setScoutLoading(false); return; }
      const pm:Record<string,any>={}; data.cargoquery.forEach((item:any)=>{const m=item.title,name=m.Name||'?';if(!pm[name])pm[name]={name,champs:{},games:0,wins:0};pm[name].games++;if(m.PlayerWin==='Yes')pm[name].wins++;if(m.Champion){if(!pm[name].champs[m.Champion])pm[name].champs[m.Champion]={games:0,wins:0};pm[name].champs[m.Champion].games++;if(m.PlayerWin==='Yes')pm[name].champs[m.Champion].wins++;}});
      const players = Object.values(pm).map((p:any)=>({name:p.name,games:p.games,winRate:Math.round((p.wins/p.games)*100),topChamps:Object.entries(p.champs).map(([c,s]:any)=>({name:c,games:s.games,winRate:Math.round((s.wins/s.games)*100)})).sort((a,b)=>b.games-a.games).slice(0,5)})).sort((a,b)=>b.games-a.games);
      let recentMatches:any[]=[];
      try{const mp=new URLSearchParams({action:'cargoquery',tables:'ScoreboardPlayers=SP,PicksAndBansS7=PB',fields:['SP.PlayerWin','SP.DateTime_UTC','SP.Tournament','SP.Team','SP.TeamVs','SP.Side','SP.GameId','PB.Team1Ban1','PB.Team1Ban2','PB.Team1Ban3','PB.Team1Ban4','PB.Team1Ban5','PB.Team2Ban1','PB.Team2Ban2','PB.Team2Ban3','PB.Team2Ban4','PB.Team2Ban5','PB.Team1Pick1','PB.Team1Pick2','PB.Team1Pick3','PB.Team1Pick4','PB.Team1Pick5','PB.Team2Pick1','PB.Team2Pick2','PB.Team2Pick3','PB.Team2Pick4','PB.Team2Pick5'].join(','),join_on:'SP.GameId=PB.GameId',where:`SP.Team="${lp}"`,order_by:'SP.DateTime_UTC DESC',limit:'50',format:'json',origin:'*'});const mr=await fetch(`https://lol.fandom.com/api.php?${mp}`);const md=await mr.json();if(md.cargoquery?.length>0){const gm:Record<string,any>={};md.cargoquery.forEach((item:any)=>{const m=item.title,rd=(m['DateTime UTC']??m['DateTime_UTC']??'').split(' ')[0],gid=m.GameId||`${m.TeamVs}_${rd}`;if(!gm[gid]){const ib=m.Side==='1'||m.Side?.toLowerCase()==='blue';gm[gid]={id:gid,date:rd,tournament:m.Tournament||'',opponent:m.TeamVs||'?',result:m.PlayerWin==='Yes'?'W':'L',teamIsBlue:ib,blueBans:[m.Team1Ban1,m.Team1Ban2,m.Team1Ban3,m.Team1Ban4,m.Team1Ban5].filter(Boolean),redBans:[m.Team2Ban1,m.Team2Ban2,m.Team2Ban3,m.Team2Ban4,m.Team2Ban5].filter(Boolean),bluePicks:[m.Team1Pick1,m.Team1Pick2,m.Team1Pick3,m.Team1Pick4,m.Team1Pick5].filter(Boolean),redPicks:[m.Team2Pick1,m.Team2Pick2,m.Team2Pick3,m.Team2Pick4,m.Team2Pick5].filter(Boolean)};}});recentMatches=Object.values(gm).sort((a:any,b:any)=>b.date.localeCompare(a.date)).slice(0,5);}}catch{}
      const result={opponent,players,recentMatches,fetchedAt:Date.now()};localStorage.setItem(cacheKey,JSON.stringify(result));setScoutData(result);
    } catch { setScoutData({error:'Failed to fetch',opponent}); }
    setScoutLoading(false);
  };
  const handleMatchClick = (match:any) => { if(selectedMatch?.id===match.id){setSelectedMatch(null);setScoutData(null);return;} setSelectedMatch(match);setScoutData(null);fetchScout(match.opponent,match.id); };
  const fetchFixture = async () => { const ck='fixture_cache';const c=localStorage.getItem(ck);const ct=localStorage.getItem(`${ck}_time`);if(c&&ct&&Date.now()-Number(ct)<30*60*1000){setFixture(JSON.parse(c));return;}setFixtureLoading(true);try{const res=await fetch('/api/fixture');const data=await res.json();if(!data.error){setFixture(data);saveCache(ck,data);}}catch{}setFixtureLoading(false); };

  useEffect(() => {
    const u = localStorage.getItem('currentUser'); if (!u) { router.push('/'); return; }
    const p = JSON.parse(u); setActualRole(p.role);
    let target = p; const v = sessionStorage.getItem('viewingPlayer');
    if (p.role === 'coach' && v) target = JSON.parse(v); else sessionStorage.removeItem('viewingPlayer');
    setUser(target); fetchData(target); fetchFixture();
  }, [router]);

  const handleLogout = () => { localStorage.removeItem('currentUser'); sessionStorage.removeItem('viewingPlayer'); router.push('/'); };

  const tc = TIER_COLORS[stats?.tier || 'UNRANKED'];
  const streak = stats?.streak;
  const streakColor = streak?.type === 'W' ? '#0ACF83' : '#E84057';
  const streakLabel = streak?.count ? (streak.type==='W' ? `${streak.count} Win Streak` : `${streak.count} Loss Streak`) : '';
  const getDaysLeft = (d:number|null) => { if(d===null)return{color:'#5B5A56',label:'TBD'};if(d===0)return{color:'#E84057',label:'TODAY'};if(d===1)return{color:'#C89B3C',label:'TOMORROW'};if(d<=3)return{color:'#C89B3C',label:`${d} DAYS`};return{color:'#5B5A56',label:`${d} DAYS`}; };
  const totalUp = fixture?.tournaments?.reduce((a:number,t:any)=>a+t.matches.length,0)||0;

  if (!user) return <div style={{minHeight:'100vh',background:'#010A13',display:'flex',alignItems:'center',justifyContent:'center',color:'#C89B3C',fontWeight:700,fontFamily:'Barlow Condensed',fontSize:18}}>Loading...</div>;

  const wrColor = (wr:number) => wr>=60?'#0ACF83':wr>=50?'#C89B3C':'#E84057';

  return (<>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;900&family=Barlow:wght@300;400;500;600&display=swap');
      *{box-sizing:border-box;margin:0;padding:0;}body{background:#010A13;font-family:'Barlow',sans-serif;color:#A09B8C;}
      .R{min-height:100vh;padding:0;}

      /* Header */
      .H{display:flex;align-items:center;justify-content:space-between;padding:14px 32px;background:#091428;border-bottom:1px solid #1E2328;}
      .HL{display:flex;align-items:center;gap:14px;}
      .AV{width:48px;height:48px;border-radius:10px;border:2px solid;object-fit:cover;background:#0A1428;position:relative;overflow:hidden;}
      .AV img{width:100%;height:100%;object-fit:cover;}
      .PRO{position:absolute;bottom:-1px;right:-1px;background:#C89B3C;color:#010A13;font-size:7px;font-weight:800;padding:2px 5px;border-radius:3px 0 0 0;}
      .NM{font-family:'Barlow Condensed';font-weight:900;font-size:22px;text-transform:uppercase;color:#F0E6D2;letter-spacing:0.04em;}
      .NM em{color:#C89B3C;font-style:normal;font-weight:700;}
      .MT{display:flex;align-items:center;gap:8px;margin-top:3px;flex-wrap:wrap;}
      .RK{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:4px;font-family:'Barlow Condensed';font-weight:700;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;}
      .RID{font-size:10px;color:#5B5A56;}
      .STK{font-family:'Barlow Condensed';font-weight:700;font-size:11px;letter-spacing:0.08em;padding:3px 8px;border-radius:4px;border:1px solid;}
      .SYN{display:flex;align-items:center;gap:4px;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;}
      .SYD{width:5px;height:5px;border-radius:50%;animation:bk 1.5s infinite;}
      @keyframes bk{0%,100%{opacity:1}50%{opacity:0.3}}
      .HR{display:flex;align-items:center;gap:8px;}
      .BT{background:transparent;color:#5B5A56;border:1px solid #1E2328;padding:6px 14px;border-radius:4px;cursor:pointer;font-family:'Barlow Condensed';font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;transition:all 0.15s;display:flex;align-items:center;gap:5px;}
      .BT:hover{color:#F0E6D2;border-color:#C89B3C;}
      .BT.ac{color:#C89B3C;border-color:rgba(200,155,60,0.3);}
      .BT.go{color:#0ACF83;border-color:rgba(10,207,131,0.3);}
      .BT.pu{color:#9D48E0;border-color:rgba(157,72,224,0.3);}
      .S2G{font-size:10px;color:#3C3C41;letter-spacing:0.1em;text-transform:uppercase;}

      /* Tabs */
      .TB{display:flex;padding:0 32px;background:#091428;border-bottom:1px solid #1E2328;}
      .TT{font-family:'Barlow Condensed';font-weight:700;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#5B5A56;padding:11px 20px;cursor:pointer;border:none;background:none;border-bottom:2px solid transparent;margin-bottom:-1px;transition:all 0.15s;display:flex;align-items:center;gap:6px;}
      .TT.on{color:#C89B3C;border-bottom-color:#C89B3C;}
      .TT:hover:not(.on){color:#A09B8C;}
      .TC{font-size:9px;background:rgba(200,155,60,0.15);color:#C89B3C;padding:2px 6px;border-radius:8px;}

      /* Content */
      .CN{padding:24px 32px;}

      /* KPI Bar */
      .KP{display:grid;grid-template-columns:1.6fr 1fr 1fr 1fr;gap:12px;margin-bottom:24px;}
      .KC{background:#091428;border:1px solid #1E2328;border-radius:6px;padding:16px 20px;position:relative;overflow:hidden;}
      .KC::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;}
      .KC.gd::before{background:linear-gradient(90deg,#C89B3C,transparent);}
      .KC.pk::before{background:linear-gradient(90deg,#E84057,transparent);}
      .KL{font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#5B5A56;margin-bottom:6px;}
      .KV{font-family:'Barlow Condensed';font-weight:900;font-size:32px;line-height:1;color:#F0E6D2;}
      .KS{font-size:10px;color:#5B5A56;margin-top:4px;}
      .KS b{color:#A09B8C;font-weight:600;}

      /* Two column */
      .TW{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;}
      /* Panel */
      .PL{background:#091428;border:1px solid #1E2328;border-radius:6px;overflow:hidden;}
      .PH{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid #1E2328;}
      .PT{display:flex;align-items:center;gap:8px;}
      .PB{width:3px;height:14px;border-radius:2px;flex-shrink:0;}
      .PT span{font-family:'Barlow Condensed';font-weight:700;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:#A09B8C;}
      .PBD{font-size:9px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:3px 10px;border-radius:4px;}
      .PY{padding:14px 18px;}

      /* Champion row */
      .CR{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(30,35,40,0.4);}
      .CR:last-child{border-bottom:none;}
      .CM{width:34px;height:34px;border-radius:6px;flex-shrink:0;overflow:hidden;border:1px solid #1E2328;}
      .CM img{width:100%;height:100%;object-fit:cover;}
      .CI{flex:1;min-width:0;}
      .CName{font-size:12px;font-weight:600;color:#A09B8C;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .CBR{height:3px;background:#1E2328;border-radius:2px;overflow:hidden;}
      .CBF{height:100%;border-radius:2px;}
      .WD{display:flex;gap:2px;margin-top:3px;}
      .WDT{width:5px;height:5px;border-radius:2px;}
      .CS{display:flex;flex-direction:column;align-items:flex-end;gap:1px;flex-shrink:0;}
      .CWR{font-family:'Barlow Condensed';font-weight:800;font-size:14px;}
      .CKD{font-size:9px;color:#5B5A56;}
      .CG{font-size:9px;color:#3C3C41;}

      /* Match row */
      .MR{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(30,35,40,0.4);}
      .MR:last-child{border-bottom:none;}
      .MLB{width:3px;border-radius:2px;flex-shrink:0;align-self:stretch;min-height:36px;}
      .MI{flex:1;min-width:0;}
      .MTP{display:flex;align-items:center;gap:5px;margin-bottom:2px;}
      .MCN{font-size:12px;font-weight:600;color:#A09B8C;}
      .MBG{font-size:8px;font-weight:700;letter-spacing:0.06em;padding:1px 5px;border-radius:3px;}
      .MBG.w{background:rgba(10,207,131,0.1);color:#0ACF83;}
      .MBG.l{background:rgba(232,64,87,0.1);color:#E84057;}
      .MSC{font-family:'Barlow Condensed';font-weight:700;font-size:13px;color:#A09B8C;}
      .MSB{font-size:9px;color:#5B5A56;margin-top:1px;}
      .MTM{font-size:9px;color:#3C3C41;flex-shrink:0;}

      /* Stat grid */
      .SG{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;}
      .SB{background:rgba(30,35,40,0.3);border:1px solid #1E2328;border-radius:5px;padding:12px;text-align:center;}
      .SBL{font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#5B5A56;margin-bottom:4px;}
      .SBV{font-family:'Barlow Condensed';font-weight:900;font-size:22px;line-height:1;}
      .SBS{font-size:9px;color:#3C3C41;margin-top:3px;}

      /* Scroll */
      .SC{max-height:320px;overflow-y:auto;}
      .SC::-webkit-scrollbar{width:3px;}
      .SC::-webkit-scrollbar-thumb{background:#1E2328;border-radius:2px;}

      /* Side row */
      .SR{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(30,35,40,0.4);}
      .SR:last-child{border-bottom:none;}
      .OR{display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(30,35,40,0.4);}
      .OR:last-child{border-bottom:none;}

      /* Gap */
      .GP{display:flex;flex-direction:column;gap:16px;}

      /* Skeleton */
      .SK{background:rgba(30,35,40,0.5);border-radius:4px;animation:sh 1.5s infinite;}
      @keyframes sh{0%,100%{opacity:0.4}50%{opacity:0.8}}
      .EM{text-align:center;padding:24px;font-size:12px;color:#3C3C41;}

      /* Scout panel */
      .SP{padding:20px 24px;border-top:1px solid rgba(200,155,60,0.1);background:rgba(200,155,60,0.01);}
      .SHD{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;}
      .STI{font-family:'Barlow Condensed';font-weight:800;font-size:16px;text-transform:uppercase;color:#C89B3C;}
      .STI span{color:#5B5A56;font-size:11px;font-weight:600;margin-left:6px;text-transform:none;}
      .SRF{background:transparent;color:#5B5A56;border:1px solid #1E2328;padding:5px 12px;border-radius:4px;cursor:pointer;font-size:10px;font-weight:600;font-family:'Barlow';transition:all 0.15s;}
      .SRF:hover{color:#C89B3C;border-color:rgba(200,155,60,0.3);}
      .SGR{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;}
      .SCD{background:rgba(30,35,40,0.3);border:1px solid #1E2328;border-radius:5px;padding:14px 16px;}
      .SPN{font-family:'Barlow Condensed';font-weight:900;font-size:17px;text-transform:uppercase;color:#F0E6D2;margin-bottom:2px;}
      .SPG{font-size:10px;color:#5B5A56;margin-bottom:10px;}
      .SCC{display:flex;flex-direction:column;gap:7px;}
      .SCR{display:flex;align-items:center;gap:8px;}
      .SCI{width:34px;height:34px;border-radius:5px;object-fit:cover;border:1px solid #1E2328;flex-shrink:0;}
      .SCIn{flex:1;min-width:0;}
      .SCNm{font-size:11px;font-weight:600;color:#A09B8C;margin-bottom:2px;}
      .SCMt{font-size:9px;color:#5B5A56;margin-bottom:2px;}
      .SCWR{font-family:'Barlow Condensed';font-weight:800;font-size:14px;flex-shrink:0;}
      .SMT{margin-top:18px;border-top:1px solid #1E2328;padding-top:14px;}
      .SMTL{font-family:'Barlow Condensed';font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;color:#5B5A56;margin-bottom:10px;}
      .SMC{background:rgba(30,35,40,0.2);border:1px solid #1E2328;border-radius:5px;overflow:hidden;margin-bottom:6px;}
      .SMHD{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;cursor:pointer;transition:background 0.15s;}
      .SMHD:hover{background:rgba(30,35,40,0.3);}
      .SMMt{font-size:9px;color:#3C3C41;}
      .SMTm{font-family:'Barlow Condensed';font-weight:800;font-size:14px;display:flex;align-items:center;gap:5px;}
      .SMRt{display:flex;align-items:center;gap:5px;}
      .SRW{color:#0ACF83;background:rgba(10,207,131,0.08);border:1px solid rgba(10,207,131,0.15);font-family:'Barlow Condensed';font-weight:800;font-size:10px;padding:2px 7px;border-radius:3px;}
      .SRL{color:#E84057;background:rgba(232,64,87,0.08);border:1px solid rgba(232,64,87,0.15);font-family:'Barlow Condensed';font-weight:800;font-size:10px;padding:2px 7px;border-radius:3px;}
      .SMTg{font-size:8px;color:#3C3C41;}
      .SDR{padding:10px 14px;display:grid;grid-template-columns:1fr 14px 1fr;background:rgba(0,0,0,0.2);}
      .SDS{display:flex;flex-direction:column;gap:6px;}
      .SDH{font-family:'Barlow Condensed';font-weight:700;font-size:12px;text-transform:uppercase;padding-bottom:5px;border-bottom:2px solid;}
      .SBL2 .SDH{color:#0596AA;border-color:rgba(5,150,170,0.3);}
      .SRD .SDH{color:#E84057;border-color:rgba(232,64,87,0.3);}
      .SOT{background:#E84057;color:#fff;font-size:7px;padding:1px 4px;border-radius:2px;font-weight:800;margin-left:4px;}
      .SDSC{display:flex;flex-direction:column;gap:3px;}
      .SDL{font-size:8px;color:#3C3C41;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;}
      .SDRW{display:flex;gap:4px;flex-wrap:wrap;}
      .SDWR{display:flex;flex-direction:column;align-items:center;gap:1px;}
      .SDLN{font-size:6px;color:#3C3C41;max-width:38px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .SDBI{width:28px;height:28px;border-radius:3px;border:1px solid #1E2328;object-fit:cover;}
      .SDPI{width:38px;height:38px;border-radius:5px;border:2px solid rgba(30,35,40,0.6);object-fit:cover;}
      .SLd{text-align:center;padding:24px;color:#C89B3C;font-family:'Barlow Condensed';font-size:14px;font-weight:700;}
      .SEr{text-align:center;padding:24px;color:#5B5A56;font-size:12px;}

      /* Fixture */
      .FW{display:flex;flex-direction:column;gap:16px;}
      .FBK{background:#091428;border:1px solid #1E2328;border-radius:6px;overflow:hidden;}
      .FHD{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid #1E2328;}
      .FDT{width:8px;height:8px;border-radius:50%;background:#C89B3C;flex-shrink:0;}
      .FNM{font-family:'Barlow Condensed';font-weight:800;font-size:16px;text-transform:uppercase;color:#F0E6D2;}
      .FCT{margin-left:auto;font-size:10px;color:#5B5A56;}
      .FMR{display:flex;align-items:center;padding:12px 18px;border-bottom:1px solid rgba(30,35,40,0.4);cursor:pointer;transition:background 0.15s;}
      .FMR:last-of-type{border-bottom:none;}.FMR:hover{background:rgba(200,155,60,0.02);}
      .FMR.sl{background:rgba(200,155,60,0.03);border-left:3px solid rgba(200,155,60,0.5);}
      .FMD{min-width:120px;}.FMDV{font-family:'Barlow Condensed';font-weight:700;font-size:14px;color:#A09B8C;}.FMDT{font-size:10px;color:#3C3C41;}
      .FMT{flex:1;display:flex;align-items:center;justify-content:center;gap:12px;}
      .FMS{font-family:'Barlow Condensed';font-weight:800;font-size:18px;color:#C89B3C;text-transform:uppercase;}
      .FMV{font-size:10px;color:#3C3C41;letter-spacing:0.15em;}
      .FMO{font-family:'Barlow Condensed';font-weight:800;font-size:18px;color:#A09B8C;text-transform:uppercase;transition:color 0.15s;}
      .FMR:hover .FMO,.FMR.sl .FMO{color:#E84057;}
      .FMRt{display:flex;align-items:center;gap:6px;min-width:160px;justify-content:flex-end;}
      .FDB{background:rgba(157,72,224,0.08);color:#9D48E0;border:1px solid rgba(157,72,224,0.2);padding:4px 10px;border-radius:4px;cursor:pointer;font-family:'Barlow Condensed';font-size:10px;font-weight:700;transition:all 0.15s;}
      .FDB:hover{background:rgba(157,72,224,0.15);}
      .FBO{font-size:10px;color:#5B5A56;font-weight:700;}
      .FDY{font-family:'Barlow Condensed';font-weight:800;font-size:11px;}
      .FHI{font-size:8px;color:#3C3C41;}
    `}</style>

    <div className="R">
      {/* HEADER */}
      <div className="H">
        <div className="HL">
          <div style={{position:'relative'}}>
            <div className="AV" style={{borderColor:tc}}>
              {user.image ? <img src={user.image} alt="" onError={(e:any)=>{e.target.style.display='none';}}/> : <span style={{fontFamily:'Barlow Condensed',fontWeight:900,fontSize:15,color:'#F0E6D2'}}>{user.name?.slice(0,2).toUpperCase()}</span>}
            </div>
            <div className="PRO">PRO</div>
          </div>
          <div>
            <div className="NM">{user.name} <em>Dashboard</em></div>
            <div className="MT">
              {!loading && stats?.rank && <div className="RK" style={{background:`${tc}15`,border:`1px solid ${tc}30`,color:tc}}><div style={{width:5,height:5,borderRadius:'50%',background:tc}}/>{stats.tier} {stats.rank} · {stats.lp} LP</div>}
              <span className="RID">{user.riotId}</span>
              {!loading && streak?.count > 1 && <div className="STK" style={{color:streakColor,borderColor:`${streakColor}40`,background:`${streakColor}10`}}>{streakLabel}</div>}
              {!loading ? <div className="SYN" style={{color:'#0ACF83'}}><div className="SYD" style={{background:'#0ACF83'}}/>Synced</div> : <div className="SYN" style={{color:'#C89B3C'}}><div className="SYD" style={{background:'#C89B3C'}}/>Loading</div>}
            </div>
          </div>
        </div>
        <div className="HR">
          {actualRole==='coach'&&<button className="BT go" onClick={()=>{sessionStorage.removeItem('viewingPlayer');router.push('/coach');}}>← Coach Panel</button>}
          <button className="BT ac" onClick={()=>router.push('/matches')}>⚔ Match History</button>
          <button className="BT pu" onClick={()=>router.push('/draft')}>📋 Draft</button>
          <span className="S2G">{TEAM_NAME}</span>
          <button className="BT" onClick={handleLogout}>Logout</button>
        </div>
      </div>

      {/* TABS */}
      <div className="TB">
        <button className={`TT ${activeTab==='soloq'?'on':''}`} onClick={()=>setActiveTab('soloq')}>SoloQ Analysis</button>
        <button className={`TT ${activeTab==='pro'?'on':''}`} onClick={()=>setActiveTab('pro')}>Pro Stage</button>
        <button className={`TT ${activeTab==='fixture'?'on':''}`} onClick={()=>setActiveTab('fixture')}>Schedule{totalUp>0&&<span className="TC">{totalUp}</span>}</button>
      </div>

      <div className="CN">
        {/* KPI BAR (shown in both soloq and pro) */}
        <div className="KP">
          <div className="KC gd"><div className="KL">Current Rank</div>{loading?<div className="SK" style={{height:32,width:140}}/>:<><div className="KV" style={{color:tc}}>{stats?.tier||'N/A'}</div><div className="KS"><b>{stats?.rank}</b> · {stats?.lp} LP</div></>}</div>
          <div className="KC"><div className="KL">Season WR</div>{loading?<div className="SK" style={{height:32,width:80}}/>:<><div className="KV">{stats?.overallWinRate||'—'}</div><div className="KS"><b>{stats?.wins}W</b> {stats?.losses}L</div></>}</div>
          <div className="KC gd"><div className="KL">This Week</div>{loading?<div className="SK" style={{height:32,width:60}}/>:<><div className="KV" style={{color:'#C89B3C'}}>{stats?.weeklyGames??'—'}</div><div className="KS">games · <b>WR {stats?.weeklyWinRate||'—'}</b></div></>}</div>
          <div className="KC pk"><div className="KL">Last 20 Games</div>{loading?<div className="SK" style={{height:32,width:80}}/>:<><div className="KV" style={{color:'#E84057'}}>{stats?.recentWinRate||'—'}</div><div className="KS">{stats?.recentGames} games analyzed</div></>}</div>
        </div>

        {/* ─── SOLOQ TAB ─── */}
        {activeTab==='soloq'&&(
          <div className="GP">
            <div className="TW">
              {/* Form */}
              <div className="PL">
                <div className="PH"><div className="PT"><div className="PB" style={{background:'#9D48E0'}}/><span>Last 20 Games Form</span></div>{!loading&&stats?.recentMatches?.length>0&&<span style={{fontSize:10,color:'#5B5A56'}}>{stats.recentMatches.filter((m:any)=>m.result==='Galibiyet').length}W {stats.recentMatches.filter((m:any)=>m.result!=='Galibiyet').length}L</span>}</div>
                <div className="PY">{loading?<div className="SK" style={{height:60}}/>:<>
                  <div style={{display:'flex',gap:3,marginBottom:14,flexWrap:'wrap'}}>{stats?.recentMatches?.map((m:any,i:number)=>(<div key={i} style={{width:20,height:20,borderRadius:4,background:m.result==='Galibiyet'?'rgba(10,207,131,0.15)':'rgba(232,64,87,0.12)',border:`1px solid ${m.result==='Galibiyet'?'rgba(10,207,131,0.3)':'rgba(232,64,87,0.25)'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:700,fontFamily:'Barlow Condensed',color:m.result==='Galibiyet'?'#0ACF83':'#E84057'}}>{m.result==='Galibiyet'?'W':'L'}</div>))}</div>
                  <div style={{fontSize:9,color:'#5B5A56',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:6}}>KDA Trend</div>
                  <div style={{display:'flex',gap:2,alignItems:'flex-end',height:36}}>{stats?.recentMatches?.slice().reverse().map((m:any,i:number)=>{const kda=parseFloat(m.kda),h=Math.max(4,Math.min(36,(kda/10)*36));const c=kda>=4?'#0ACF83':kda>=2?'#C89B3C':'#E84057';return<div key={i} style={{width:'100%',height:h,background:c,opacity:0.6,borderRadius:2}} title={`KDA: ${m.kda}`}/>})}</div>
                </>}</div>
              </div>
              {/* Metrics */}
              <div className="PL">
                <div className="PH"><div className="PT"><div className="PB" style={{background:'#C89B3C'}}/><span>Metrics</span></div></div>
                <div className="PY">{loading?<div className="SG">{[1,2,3,4,5,6].map(i=><div key={i} className="SK" style={{height:52}}/>)}</div>:
                  <div className="SG">
                    <div className="SB"><div className="SBL">Gold @15</div><div className="SBV" style={{color:(stats?.avgGoldDiff15||0)>=0?'#0ACF83':'#E84057'}}>{(stats?.avgGoldDiff15||0)>=0?'+':''}{stats?.avgGoldDiff15||0}</div><div className="SBS">avg diff</div></div>
                    <div className="SB"><div className="SBL">CS @15</div><div className="SBV" style={{color:parseFloat(stats?.avgCsDiff15||'0')>=0?'#0ACF83':'#E84057'}}>{parseFloat(stats?.avgCsDiff15||'0')>=0?'+':''}{stats?.avgCsDiff15||0}</div><div className="SBS">avg diff</div></div>
                    <div className="SB"><div className="SBL">Multi Kill</div><div className="SBV" style={{color:'#C89B3C'}}>{(stats?.multiKills?.doubles||0)+(stats?.multiKills?.triples||0)+(stats?.multiKills?.quadras||0)+(stats?.multiKills?.pentas||0)}</div><div className="SBS">{stats?.multiKills?.pentas>0?`${stats.multiKills.pentas} penta!`:`${stats?.multiKills?.quadras||0} quadra`}</div></div>
                    <div className="SB"><div className="SBL">Dragons/G</div><div className="SBV" style={{color:'#E84057'}}>{stats?.avgDragons||0}</div><div className="SBS">avg</div></div>
                    <div className="SB"><div className="SBL">Barons/G</div><div className="SBV" style={{color:'#9D48E0'}}>{stats?.avgBarons||0}</div><div className="SBS">avg</div></div>
                    <div className="SB"><div className="SBL">Wards/G</div><div className="SBV" style={{color:'#0596AA'}}>{stats?.avgWardsPlaced||0}</div><div className="SBS">{stats?.avgControlWards||0} control</div></div>
                  </div>
                }</div>
              </div>
            </div>
            <div className="TW">
              {/* Champion Pool */}
              <div className="PL">
                <div className="PH"><div className="PT"><div className="PB" style={{background:'#C89B3C'}}/><span>Champion Pool</span></div><span className="PBD" style={{background:'rgba(200,155,60,0.06)',color:'#C89B3C',border:'1px solid rgba(200,155,60,0.12)'}}>Last 20 Games</span></div>
                <div className="PY">{loading?[1,2,3,4,5].map(i=><div key={i} className="SK" style={{height:40,marginBottom:8}}/>):
                  stats?.championStats?.length>0?stats.championStats.map((ch:any,i:number)=>{const wr=parseInt(ch.winRate),bc=wrColor(wr);return(
                    <div className="CR" key={i}><div className="CM"><img src={`https://ddragon.leagueoflegends.com/cdn/16.5.1/img/champion/${ch.name}.png`} alt="" onError={(e:any)=>{e.target.src='/logo.png';}}/></div><div className="CI"><div className="CName">{ch.name}</div><div className="CBR"><div className="CBF" style={{width:`${wr}%`,background:bc}}/></div>{ch.history&&<div className="WD">{ch.history.map((r:string,j:number)=><div key={j} className="WDT" style={{background:r==='W'?'rgba(10,207,131,0.6)':'rgba(232,64,87,0.5)'}}/>)}</div>}</div><div className="CS"><span className="CWR" style={{color:bc}}>{ch.winRate}</span><span className="CKD">{ch.kda} KDA</span><span className="CG">{ch.games}G</span></div></div>
                  );}):(<div className="EM">No data</div>)}</div>
              </div>
              {/* Recent Games */}
              <div className="PL">
                <div className="PH"><div className="PT"><div className="PB" style={{background:'#E84057'}}/><span>Recent Games</span></div><span className="PBD" style={{background:'rgba(232,64,87,0.06)',color:'#E84057',border:'1px solid rgba(232,64,87,0.12)'}}>SoloQ Ranked</span></div>
                <div className="PY SC">{loading?[1,2,3,4,5].map(i=><div key={i} className="SK" style={{height:48,marginBottom:8}}/>):
                  stats?.recentMatches?.length>0?stats.recentMatches.map((m:any,i:number)=>(
                    <div className="MR" key={i}><div className="MLB" style={{background:m.result==='Galibiyet'?'#0ACF83':'#E84057'}}/><div className="CM"><img src={`https://ddragon.leagueoflegends.com/cdn/16.5.1/img/champion/${m.champion}.png`} alt="" onError={(e:any)=>{e.target.src='/logo.png';}}/></div><div className="MI"><div className="MTP"><span className="MCN">{m.champion}</span><span className={`MBG ${m.result==='Galibiyet'?'w':'l'}`}>{m.result==='Galibiyet'?'WIN':'LOSS'}</span></div><div className="MSC">{m.kills}/{m.deaths}/{m.assists}</div><div className="MSB">{m.kda} KDA · {m.csPerMin} CS/min · {m.duration}</div></div><span className="MTM">{m.time}</span></div>
                  )):(<div className="EM">No match data</div>)}</div>
              </div>
            </div>
          </div>
        )}

        {/* ─── PRO TAB ─── */}
        {activeTab==='pro'&&(
          <div className="GP">
            <div className="KP" style={{gridTemplateColumns:'1fr 1fr 1fr 1fr'}}>
              <div className="KC"><div className="KL">Season KDA</div><div className="KV" style={{fontSize:28}}>{proStats?.overallKda||'—'}</div></div>
              <div className="KC pk"><div className="KL">Pro WR</div><div className="KV" style={{fontSize:28,color:'#E84057'}}>{proStats?.overallWinRate!=null?`${proStats.overallWinRate}%`:proStats?.winRate||'—'}</div></div>
              <div className="KC gd"><div className="KL">Total Games</div><div className="KV" style={{fontSize:28,color:'#C89B3C'}}>{proStats?.totalProGames||proStats?.lastMatches?.length||'—'}</div></div>
              <div className="KC"><div className="KL">Pro CS/Game</div><div className="KV" style={{fontSize:28,color:'#0596AA'}}>{proStats?.avgProCsPerGame||'—'}</div></div>
            </div>
            <div className="TW">
              <div className="GP">
                {/* Pro Champ Pool */}
                <div className="PL">
                  <div className="PH"><div className="PT"><div className="PB" style={{background:'#C89B3C'}}/><span>Pro Champion Pool</span></div></div>
                  <div className="PY">{loading?[1,2,3,4].map(i=><div key={i} className="SK" style={{height:38,marginBottom:8}}/>):
                    proStats?.proChampionStats?.length>0?proStats.proChampionStats.slice(0,6).map((ch:any,i:number)=>{const bc=wrColor(ch.winRate);return(
                      <div className="CR" key={i}><div className="CM"><img src={`https://ddragon.leagueoflegends.com/cdn/16.5.1/img/champion/${ch.name.replace(/\s+/g,'')}.png`} alt="" onError={(e:any)=>{e.target.src='/logo.png';}}/></div><div className="CI"><div className="CName">{ch.name}</div><div className="CBR"><div className="CBF" style={{width:`${ch.winRate}%`,background:bc}}/></div></div><div className="CS"><span className="CWR" style={{color:bc}}>{ch.winRate}%</span><span className="CKD">{ch.kda} KDA</span><span className="CG">{ch.games}G</span></div></div>
                    );}):(<div className="EM">No data</div>)}</div>
                </div>
                {/* Side Stats */}
                {proStats?.sideStats&&(proStats.sideStats.blue.games>0||proStats.sideStats.red.games>0)&&(
                  <div className="PL"><div className="PH"><div className="PT"><div className="PB" style={{background:'#0596AA'}}/><span>Blue / Red Side</span></div></div>
                    <div className="PY">{['blue','red'].map(side=>{const s=proStats.sideStats[side],c=side==='blue'?'#0596AA':'#E84057';return(
                      <div className="SR" key={side}><div style={{width:8,height:8,borderRadius:'50%',background:c,flexShrink:0}}/><div style={{flex:1}}><div style={{fontSize:12,fontWeight:600,color:'#A09B8C',marginBottom:4}}>{side==='blue'?'Blue Side':'Red Side'}</div><div className="CBR"><div className="CBF" style={{width:`${s.winRate}%`,background:c}}/></div></div><div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:1}}><span style={{fontFamily:'Barlow Condensed',fontWeight:700,fontSize:14,color:c}}>{s.winRate}%</span><span style={{fontSize:9,color:'#5B5A56'}}>{s.games}G</span></div></div>
                    );})}</div>
                  </div>
                )}
                {/* Season */}
                {proStats?.seasonStats?.length>0&&(
                  <div className="PL"><div className="PH"><div className="PT"><div className="PB" style={{background:'#9D48E0'}}/><span>Season Comparison</span></div></div>
                    <div className="PY">{proStats.seasonStats.slice(0,4).map((s:any,i:number)=>(
                      <div className="SR" key={i}><span style={{fontFamily:'Barlow Condensed',fontWeight:700,fontSize:14,color:'#5B5A56',minWidth:36}}>{s.year}</span><div style={{flex:1}}><div className="CBR"><div className="CBF" style={{width:`${s.winRate}%`,background:wrColor(s.winRate)}}/></div></div><div style={{display:'flex',gap:10,flexShrink:0}}><span style={{fontSize:11,fontWeight:700,color:wrColor(s.winRate)}}>{s.winRate}%</span><span style={{fontSize:9,color:'#5B5A56'}}>{s.kda} KDA</span><span style={{fontSize:9,color:'#3C3C41'}}>{s.games}G</span></div></div>
                    ))}</div>
                  </div>
                )}
              </div>
              <div className="GP">
                {/* Tournament */}
                {proStats?.tournamentStats?.length>0&&(
                  <div className="PL"><div className="PH"><div className="PT"><div className="PB" style={{background:'#9D48E0'}}/><span>By Tournament</span></div></div>
                    <div className="PY">{proStats.tournamentStats.slice(0,5).map((t:any,i:number)=>{const bc=wrColor(t.winRate);return(
                      <div className="CR" key={i} style={{gap:8}}><div style={{flex:1,minWidth:0}}><div className="CName" style={{marginBottom:4}}>{t.name}</div><div className="CBR"><div className="CBF" style={{width:`${t.winRate}%`,background:bc}}/></div></div><div style={{display:'flex',gap:8,flexShrink:0,alignItems:'center'}}><span style={{fontSize:11,fontWeight:700,color:bc}}>{t.winRate}%</span><span style={{fontSize:9,color:'#5B5A56'}}>{t.kda} KDA</span><span style={{fontSize:9,color:'#3C3C41'}}>{t.games}G</span></div></div>
                    );})}</div>
                  </div>
                )}
                {/* Opponents */}
                {proStats?.opponentStats?.length>0&&(
                  <div className="PL"><div className="PH"><div className="PT"><div className="PB" style={{background:'#E84057'}}/><span>Opponent Analysis</span></div></div>
                    <div className="PY">{proStats.opponentStats.map((o:any,i:number)=>(
                      <div className="OR" key={i}><span style={{fontSize:12,fontWeight:600,color:'#A09B8C',flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{o.name}</span><div style={{display:'flex',gap:8,alignItems:'center',flexShrink:0}}><span style={{fontSize:11,fontWeight:700,color:wrColor(o.winRate)}}>{o.winRate}%</span><span style={{fontSize:9,color:'#3C3C41'}}>{o.games}G</span></div></div>
                    ))}</div>
                  </div>
                )}
                {/* Recent Official */}
                <div className="PL">
                  <div className="PH"><div className="PT"><div className="PB" style={{background:'#E84057'}}/><span>Recent Official Games</span></div><span className="PBD" style={{background:'rgba(232,64,87,0.06)',color:'#E84057',border:'1px solid rgba(232,64,87,0.12)'}}>{proStats?.lastMatches?.length||0} Games</span></div>
                  <div className="PY SC">{loading?[1,2,3,4].map(i=><div key={i} className="SK" style={{height:48,marginBottom:8}}/>):
                    proStats?.lastMatches?.length>0?proStats.lastMatches.map((m:any,i:number)=>(
                      <div className="MR" key={i}><div className="MLB" style={{background:m.result==='GALİBİYET'?'#0ACF83':'#E84057'}}/><div className="CM"><img src={`https://ddragon.leagueoflegends.com/cdn/16.5.1/img/champion/${(m.champion||'').replace(/\s+/g,'')}.png`} alt="" onError={(e:any)=>{e.target.src='/logo.png';}}/></div><div className="MI"><div className="MTP"><span className="MCN">{m.opponent}</span><span className={`MBG ${m.result==='GALİBİYET'?'w':'l'}`}>{m.result==='GALİBİYET'?'WIN':'LOSS'}</span></div><div style={{fontSize:10,color:'#5B5A56',marginTop:1}}>{m.champion!=='—'&&m.champion}{m.kda!=='—'&&` · KDA: ${m.kda}`}</div><div className="MSB">{m.tournament}</div></div><span className="MTM">{m.date}</span></div>
                    )):(<div className="EM">No match data</div>)}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── FIXTURE TAB ─── */}
        {activeTab==='fixture'&&(
          <div className="FW">
            {fixtureLoading?<div className="SLd">Loading schedule...</div>:!fixture||fixture.error?<div className="EM">Schedule unavailable</div>:fixture.tournaments?.length===0?<div className="EM">No upcoming matches</div>
            :fixture.tournaments.map((t:any)=>(
              <div key={t.id} className="FBK">
                <div className="FHD"><div className="FDT"/><div className="FNM">{t.name}</div><div className="FCT">{t.matches.length} Matches</div></div>
                {t.matches.map((m:any)=>{const db=getDaysLeft(m.daysLeft),isSel=selectedMatch?.id===m.id;return(
                  <div key={m.id}>
                    <div className={`FMR ${isSel?'sl':''}`} onClick={()=>handleMatchClick(m)}>
                      <div className="FMD"><div className="FMDV">{m.date}</div><div className="FMDT">{m.time}</div></div>
                      <div className="FMT"><span className="FMS">{TEAM_NAME}</span><span className="FMV">VS</span><span className="FMO">{m.opponent}</span></div>
                      <div className="FMRt">
                        <span className="FHI">{isSel?'▲':'▼'}</span>
                        <button className="FDB" onClick={(e)=>{e.stopPropagation();router.push('/draft');}}>Draft</button>
                        <span className="FBO">{m.matchType}</span>
                        <span className="FDY" style={{color:db.color}}>{db.label}</span>
                      </div>
                    </div>
                    {isSel&&(
                      <div className="SP">
                        <div className="SHD"><div className="STI">⬥ {m.opponent}<span>recent pro picks</span></div><button className="SRF" onClick={(e)=>{e.stopPropagation();fetchScout(m.opponent,m.id,true);}}>↻ Refresh</button></div>
                        {scoutLoading?<div className="SLd">Fetching...</div>:scoutData?.error?<div className="SEr">{scoutData.error}</div>:scoutData?.players?.length>0?(
                          <div className="SGR">{scoutData.players.map((pl:any)=>(
                            <div key={pl.name} className="SCD"><div className="SPN">{pl.name}</div><div className="SPG">{pl.games} games · {pl.winRate}% WR</div>
                              <div className="SCC">{pl.topChamps.map((ch:any)=>{const wr=ch.winRate,col=wrColor(wr);return(
                                <div key={ch.name} className="SCR"><img src={ci(ch.name)} className="SCI" alt={ch.name} onError={(e:any)=>{e.target.src='/logo.png';}}/><div className="SCIn"><div className="SCNm">{ch.name}</div><div className="SCMt">{ch.games} games</div><div className="CBR"><div className="CBF" style={{width:`${wr}%`,background:col}}/></div></div><span className="SCWR" style={{color:col}}>{wr}%</span></div>
                              );})}</div>
                            </div>
                          ))}</div>
                        ):null}
                        {scoutData?.recentMatches?.length>0&&(
                          <div className="SMT"><div className="SMTL">Last {scoutData.recentMatches.length} Games</div>
                            {scoutData.recentMatches.map((gm:any)=>{const gk=`sg_${gm.id}`,go=(activeScoutGame[gk]??0)===1,bio=gm.teamIsBlue;return(
                              <div key={gm.id} className="SMC">
                                <div className="SMHD" onClick={()=>setActiveScoutGame(p=>({...p,[gk]:go?0:1}))}>
                                  <div><div className="SMMt">{gm.tournament} · {gm.date}</div><div className="SMTm"><span style={{color:bio?'#0596AA':'#E84057'}}>{m.opponent}</span><span style={{color:'#3C3C41',fontSize:10}}>vs</span><span style={{color:'#5B5A56'}}>{gm.opponent}</span></div></div>
                                  <div className="SMRt"><span className={gm.result==='W'?'SRW':'SRL'}>{gm.result==='W'?'W':'L'}</span><span className="SMTg">{go?'▲':'▼'}</span></div>
                                </div>
                                {go&&<div className="SDR">
                                  <div className="SDS SBL2"><div className="SDH">{bio?m.opponent:gm.opponent}{bio&&<span className="SOT">OPP</span>}</div>
                                    {gm.blueBans.length>0&&<div className="SDSC"><div className="SDL">Bans</div><div className="SDRW">{gm.blueBans.map((c:string,i:number)=><div className="SDWR" key={i}><img src={ci(c)} className="SDBI" alt={c} onError={(e:any)=>{e.target.src='/logo.png';}}/><span className="SDLN">{c}</span></div>)}</div></div>}
                                    <div className="SDSC"><div className="SDL">Picks</div><div className="SDRW">{gm.bluePicks.length>0?gm.bluePicks.map((c:string,i:number)=><div className="SDWR" key={i}><img src={ci(c)} className="SDPI" alt={c} onError={(e:any)=>{e.target.src='/logo.png';}}/><span className="SDLN">{c}</span></div>):<span style={{fontSize:9,color:'#3C3C41'}}>—</span>}</div></div>
                                  </div>
                                  <div style={{display:'flex',justifyContent:'center',paddingTop:6}}><span style={{fontSize:7,color:'#1E2328',fontFamily:'Barlow Condensed',fontWeight:900}}>VS</span></div>
                                  <div className="SDS SRD"><div className="SDH">{!bio?m.opponent:gm.opponent}{!bio&&<span className="SOT">OPP</span>}</div>
                                    {gm.redBans.length>0&&<div className="SDSC"><div className="SDL">Bans</div><div className="SDRW">{gm.redBans.map((c:string,i:number)=><div className="SDWR" key={i}><img src={ci(c)} className="SDBI" alt={c} onError={(e:any)=>{e.target.src='/logo.png';}}/><span className="SDLN">{c}</span></div>)}</div></div>}
                                    <div className="SDSC"><div className="SDL">Picks</div><div className="SDRW">{gm.redPicks.length>0?gm.redPicks.map((c:string,i:number)=><div className="SDWR" key={i}><img src={ci(c)} className="SDPI" alt={c} onError={(e:any)=>{e.target.src='/logo.png';}}/><span className="SDLN">{c}</span></div>):<span style={{fontSize:9,color:'#3C3C41'}}>—</span>}</div></div>
                                  </div>
                                </div>}
                              </div>);})}</div>
                        )}
                      </div>
                    )}
                  </div>
                );})}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  </>);
}
