'use client';

import { useRouter } from 'next/navigation';
import { TEAM_NAME } from '../../lib/team';
import { useEffect, useState } from 'react';
import { USERS } from '@/lib/users';

const TIER_COLORS: Record<string, string> = {
  IRON:'#5B5A56',BRONZE:'#CD7F32',SILVER:'#A09B8C',GOLD:'#C89B3C',
  PLATINUM:'#0596AA',EMERALD:'#0ACF83',DIAMOND:'#576CBC',
  MASTER:'#9D48E0',GRANDMASTER:'#E84057',CHALLENGER:'#F4D03F',UNRANKED:'#3C3C41',
};
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const SMART_CACHE_LIMIT = 60 * 60 * 1000;
const CHAMP_MAP: Record<string, string> = {
  'Wukong':'MonkeyKing','Renata Glasc':'Renata',"K'Sante":'KSante','Nunu & Willump':'Nunu','Jarvan IV':'JarvanIV','Lee Sin':'LeeSin','Master Yi':'MasterYi','Miss Fortune':'MissFortune','Twisted Fate':'TwistedFate','Dr. Mundo':'DrMundo','Aurelion Sol':'AurelionSol',"Bel'Veth":'Belveth',"Cho'Gath":'Chogath',"Kai'Sa":'Kaisa',"Kha'Zix":'Khazix',"Kog'Maw":'KogMaw',"Vel'Koz":'Velkoz',"Rek'Sai":'RekSai','Xin Zhao':'XinZhao','Tahm Kench':'TahmKench','LeBlanc':'Leblanc',
};
function champImg(name: string) { if (!name) return '/logo.png'; const key = CHAMP_MAP[name] ?? name.replace(/[\s'".]/g,''); return `https://ddragon.leagueoflegends.com/cdn/16.5.1/img/champion/${key}.png`; }

export default function CoachDashboard() {
  const router = useRouter();
  const [coach, setCoach] = useState<any>(null);
  const [teamStats, setTeamStats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingPlayerName, setLoadingPlayerName] = useState('');
  const [activeTab, setActiveTab] = useState<'roster'|'fixture'>('roster');
  const [fixture, setFixture] = useState<any>(null);
  const [fixtureLoading, setFixtureLoading] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<any>(null);
  const [manualOpp, setManualOpp] = useState('');
  const [savedOpp, setSavedOpp] = useState<string|null>(null);
  const [scoutData, setScoutData] = useState<any>(null);
  const [scoutLoading, setScoutLoading] = useState(false);
  const [activeScoutGame, setActiveScoutGame] = useState<Record<string,number>>({});

  // ── FETCH FUNCTIONS (unchanged) ──
  const fetchTeamData = async (isManualClick = false) => {
    setRefreshing(true); if (!isManualClick) setLoading(true);
    const players = USERS.filter(u => u.role === 'player'); const loadedData: any[] = [];
    for (const player of players) {
      const cacheKey = `coach_riot_${player.name}`; const timeStr = localStorage.getItem(`${cacheKey}_time`); const cachedStr = localStorage.getItem(cacheKey);
      const needsFetch = !(cachedStr && timeStr && Date.now() - Number(timeStr) < SMART_CACHE_LIMIT);
      try {
        if (!needsFetch) { setLoadingPlayerName(`${player.name} (Cached)`); loadedData.push({ ...player, stats: JSON.parse(cachedStr!) }); setTeamStats([...loadedData]); await delay(200); }
        else { setLoadingPlayerName(`${player.name}...`); const res = await fetch('/api/data', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ playerName: player.name }) }); const data = await res.json(); if (!data.error) { localStorage.setItem(cacheKey, JSON.stringify(data)); localStorage.setItem(`${cacheKey}_time`, String(Date.now())); } loadedData.push({ ...player, stats: data }); setTeamStats([...loadedData]); await delay(6000); }
      } catch { loadedData.push({ ...player, stats: { error: true } }); setTeamStats([...loadedData]); }
    }
    setLoading(false); setRefreshing(false); setLoadingPlayerName('');
  };
  const fetchFixture = async () => {
    const cacheKey = 'fixture_cache'; const cached = localStorage.getItem(cacheKey); const cacheTime = localStorage.getItem(`${cacheKey}_time`);
    if (cached && cacheTime && Date.now() - Number(cacheTime) < 30*60*1000) { setFixture(JSON.parse(cached)); return; }
    setFixtureLoading(true);
    try { const res = await fetch('/api/fixture'); const data = await res.json(); if (!data.error) { setFixture(data); localStorage.setItem(cacheKey, JSON.stringify(data)); localStorage.setItem(`${cacheKey}_time`, String(Date.now())); } } catch {}
    setFixtureLoading(false);
  };
  const fetchScout = async (opponent: string, matchId: string, forceRefresh = false) => {
    const cacheKey = `scout_${matchId}`; if (!forceRefresh) { const cached = localStorage.getItem(cacheKey); if (cached) { setScoutData(JSON.parse(cached)); return; } }
    setScoutLoading(true);
    try {
      const TM: Record<string,string> = { 'BIG':'Berlin International Gaming', 'The Otter Side':'Otter Side' }; const lpTeamName = TM[opponent] ?? opponent;
      const bp = (t: string) => new URLSearchParams({ action:'cargoquery', tables:'ScoreboardPlayers', fields:'Champion,PlayerWin,DateTime_UTC,Tournament,Team,Name', where:`Team="${t}"`, order_by:'DateTime_UTC DESC', limit:'75', format:'json', origin:'*' });
      let res = await fetch(`https://lol.fandom.com/api.php?${bp(lpTeamName)}`); let data = await res.json();
      if (!data.cargoquery?.length) { const fw = lpTeamName.split(' ')[0]; const fp = new URLSearchParams({ action:'cargoquery', tables:'ScoreboardPlayers', fields:'Champion,PlayerWin,DateTime_UTC,Tournament,Team,Name', where:`Team LIKE "%${fw}%"`, order_by:'DateTime_UTC DESC', limit:'75', format:'json', origin:'*' }); res = await fetch(`https://lol.fandom.com/api.php?${fp}`); data = await res.json(); }
      if (!data.cargoquery?.length) { setScoutData({ error:`"${opponent}" verisi bulunamadı`, opponent }); setScoutLoading(false); return; }
      const pm: Record<string,any> = {}; data.cargoquery.forEach((item: any) => { const m = item.title, name = m.Name||'?'; if (!pm[name]) pm[name]={name,champs:{},games:0,wins:0}; pm[name].games++; if (m.PlayerWin==='Yes') pm[name].wins++; if (m.Champion) { if (!pm[name].champs[m.Champion]) pm[name].champs[m.Champion]={games:0,wins:0}; pm[name].champs[m.Champion].games++; if (m.PlayerWin==='Yes') pm[name].champs[m.Champion].wins++; } });
      const players = Object.values(pm).map((p:any)=>({name:p.name,games:p.games,winRate:Math.round((p.wins/p.games)*100),topChamps:Object.entries(p.champs).map(([c,s]:any)=>({name:c,games:s.games,winRate:Math.round((s.wins/s.games)*100)})).sort((a,b)=>b.games-a.games).slice(0,5)})).sort((a,b)=>b.games-a.games);
      let recentMatches: any[] = [];
      try { const mp = new URLSearchParams({ action:'cargoquery', tables:'ScoreboardPlayers=SP,PicksAndBansS7=PB', fields:['SP.PlayerWin','SP.DateTime_UTC','SP.Tournament','SP.Team','SP.TeamVs','SP.Side','SP.GameId','PB.Team1Ban1','PB.Team1Ban2','PB.Team1Ban3','PB.Team1Ban4','PB.Team1Ban5','PB.Team2Ban1','PB.Team2Ban2','PB.Team2Ban3','PB.Team2Ban4','PB.Team2Ban5','PB.Team1Pick1','PB.Team1Pick2','PB.Team1Pick3','PB.Team1Pick4','PB.Team1Pick5','PB.Team2Pick1','PB.Team2Pick2','PB.Team2Pick3','PB.Team2Pick4','PB.Team2Pick5'].join(','), join_on:'SP.GameId=PB.GameId', where:`SP.Team="${lpTeamName}"`, order_by:'SP.DateTime_UTC DESC', limit:'50', format:'json', origin:'*' });
        const mr = await fetch(`https://lol.fandom.com/api.php?${mp}`); const md = await mr.json();
        if (md.cargoquery?.length>0) { const gm: Record<string,any>={}; md.cargoquery.forEach((item:any)=>{const m=item.title,rd=(m['DateTime UTC']??m['DateTime_UTC']??'').split(' ')[0],gid=m.GameId||`${m.TeamVs}_${rd}`;if(!gm[gid]){const ib=m.Side==='1'||m.Side?.toLowerCase()==='blue';gm[gid]={id:gid,date:rd,tournament:m.Tournament||'',opponent:m.TeamVs||'?',result:m.PlayerWin==='Yes'?'W':'L',teamIsBlue:ib,blueBans:[m.Team1Ban1,m.Team1Ban2,m.Team1Ban3,m.Team1Ban4,m.Team1Ban5].filter(Boolean),redBans:[m.Team2Ban1,m.Team2Ban2,m.Team2Ban3,m.Team2Ban4,m.Team2Ban5].filter(Boolean),bluePicks:[m.Team1Pick1,m.Team1Pick2,m.Team1Pick3,m.Team1Pick4,m.Team1Pick5].filter(Boolean),redPicks:[m.Team2Pick1,m.Team2Pick2,m.Team2Pick3,m.Team2Pick4,m.Team2Pick5].filter(Boolean)};}});recentMatches=Object.values(gm).sort((a:any,b:any)=>b.date.localeCompare(a.date)).slice(0,5);}
      } catch {}
      const result={opponent,players,recentMatches,fetchedAt:Date.now()}; localStorage.setItem(cacheKey,JSON.stringify(result)); setScoutData(result);
    } catch { setScoutData({error:'Veri çekilemedi',opponent}); }
    setScoutLoading(false);
  };
  useEffect(() => {
    const u = localStorage.getItem('currentUser'); if (!u) { router.push('/'); return; } const p = JSON.parse(u); if (p.role !== 'coach') { router.push('/player'); return; }
    setCoach(p); fetchTeamData(); fetchFixture();
    fetch('/api/draft').then(r=>r.json()).then(d=>{ if(d?.opponent) setSavedOpp(d.opponent); }).catch(()=>{});
    Object.keys(localStorage).filter(k=>k.startsWith('scout_')).forEach(key=>{try{const d=JSON.parse(localStorage.getItem(key)||'{}');if(d.fetchedAt&&Date.now()-d.fetchedAt>8*24*60*60*1000)localStorage.removeItem(key);}catch{localStorage.removeItem(key);}});
  }, [router]);
  // Fikstürde olmayan rakip (ör. PandaScore'a girmemiş eleme maçı) elle girilir.
  // Draft odası da bu değeri kullansın diye Redis'e yazılıp Pusher ile yayılıyor.
  const saveOpponent = async (name: string|null) => {
    setSavedOpp(name);
    try { await fetch('/api/draft', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'SET_OPPONENT', payload:{ opponent: name ?? '' }, userName: coach?.name }) }); } catch {}
  };
  const submitManualOpp = async () => {
    const name = manualOpp.trim(); if (!name) return;
    await saveOpponent(name); setManualOpp('');
    const m = { id:`manual_${name}`, opponent:name };
    setSelectedMatch(m); setScoutData(null); fetchScout(name, m.id);
  };
  const clearManualOpp = async () => {
    if (selectedMatch?.id===`manual_${savedOpp}`) { setSelectedMatch(null); setScoutData(null); }
    await saveOpponent(null);
  };
  const handleMatchClick = (match: any) => { if (selectedMatch?.id===match.id){setSelectedMatch(null);setScoutData(null);return;} setSelectedMatch(match);setScoutData(null);fetchScout(match.opponent,match.id); };

  // ── HELPERS ──
  const getDisciplineFlags = (stats: any) => { if (!stats||stats.error) return [{type:'err',msg:'Veri bekleniyor'}]; const f=[],w=stats.weeklyGames||0; if(w<7)f.push({type:'bad',msg:`${w} oyun · yetersiz`});else if(w<14)f.push({type:'mid',msg:`${w} oyun · normal`});else f.push({type:'ok',msg:`${w} oyun · iyi`}); if(stats.recentWinRate&&parseFloat(stats.recentWinRate)<50)f.push({type:'bad',msg:`Son WR %${parseFloat(stats.recentWinRate)}`});else if(stats.recentWinRate&&parseFloat(stats.recentWinRate)>=60)f.push({type:'ok',msg:`Son WR %${parseFloat(stats.recentWinRate)}`}); return f; };
  const getRecentChampions = (rm: any[]) => { if(!rm?.length)return[]; const m:Record<string,{g:number,w:number}>={}; rm.forEach(r=>{if(!m[r.champion])m[r.champion]={g:0,w:0};m[r.champion].g++;if(r.result==='Galibiyet')m[r.champion].w++;}); return Object.entries(m).map(([n,d])=>({name:n,games:d.g,winRate:Math.round((d.w/d.g)*100)})).sort((a,b)=>b.games-a.games); };
  // d<0 = maç oynanmış. Negatif gün sayısını olduğu gibi basmak ("-20 GÜN")
  // geçmiş maçı yaklaşan maç gibi gösteriyordu.
  const getDaysLeftBadge = (d: number|null) => { if(d===null)return{color:'#5B5A56',label:'TBD'}; if(d<0)return{color:'#4A4A4A',label:`${-d} GÜN ÖNCE · OYNANDI`}; if(d===0)return{color:'#E84057',label:'BUGÜN'}; if(d===1)return{color:'#C89B3C',label:'YARIN'}; if(d<=3)return{color:'#C89B3C',label:`${d} GÜN`}; return{color:'#5B5A56',label:`${d} GÜN`}; };

  // ── TEAM OVERVIEW DATA ──
  const getTeamChampPool = () => {
    const pool: Record<string, {games:number,wins:number,players:Set<string>}> = {};
    teamStats.forEach(p => {
      const rm = p.stats?.recentMatches;
      if (!rm?.length) return;
      rm.forEach((m:any) => {
        if (!m.champion) return;
        if (!pool[m.champion]) pool[m.champion] = {games:0,wins:0,players:new Set()};
        pool[m.champion].games++;
        if (m.result==='Galibiyet') pool[m.champion].wins++;
        pool[m.champion].players.add(p.name);
      });
    });
    return Object.entries(pool)
      .map(([name,d])=>({name,games:d.games,wins:d.wins,winRate:Math.round((d.wins/d.games)*100),playerCount:d.players.size,players:Array.from(d.players)}))
      .sort((a,b)=>b.games-a.games).slice(0,15);
  };

  const getPlayerComparison = () => {
    return teamStats.map(p => ({
      name: p.name,
      image: p.image,
      tier: p.stats?.tier || 'UNRANKED',
      rank: p.stats?.rank || '',
      lp: p.stats?.lp || 0,
      weekly: p.stats?.weeklyGames || 0,
      winRate: p.stats?.overallWinRate ? parseFloat(p.stats.overallWinRate) : 0,
      recentWR: p.stats?.recentWinRate ? parseFloat(p.stats.recentWinRate) : 0,
    })).sort((a,b) => b.lp - a.lp);
  };

  if (!coach) return <div style={{minHeight:'100vh',background:'#010A13',display:'flex',alignItems:'center',justifyContent:'center',color:'#C89B3C',fontWeight:700,fontFamily:'Barlow Condensed',fontSize:18}}>Bağlanıyor...</div>;

  const totalUp=fixture?.tournaments?.reduce((a:number,t:any)=>a+t.matches.length,0)||0;
  const totalG=teamStats.reduce((a,p)=>a+(p.stats?.weeklyGames||0),0);
  const vWR=teamStats.filter(p=>p.stats?.overallWinRate);
  const avgWR=vWR.length>0?Math.round(vWR.reduce((a,p)=>a+parseFloat(p.stats.overallWinRate),0)/vWR.length):0;
  const champPool = getTeamChampPool();
  const comparison = getPlayerComparison();

  return (<>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;900&family=Barlow:wght@300;400;500;600&display=swap');
      *{box-sizing:border-box;margin:0;padding:0;}body{background:#010A13;font-family:'Barlow',sans-serif;color:#A09B8C;}
      .R{min-height:100vh;padding:30px 40px;overflow-y:auto;}

      .H{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;}
      .HL{display:flex;align-items:baseline;gap:16px;}
      .LG{font-family:'Barlow Condensed';font-weight:900;font-size:26px;letter-spacing:0.06em;text-transform:uppercase;color:#F0E6D2;}
      .LG em{color:#C89B3C;font-style:normal;}
      .HS{font-size:12px;color:#5B5A56;letter-spacing:0.08em;text-transform:uppercase;font-weight:600;}
      .HR{display:flex;align-items:center;gap:8px;}
      .HB{background:transparent;color:#5B5A56;border:1px solid #1E2328;padding:7px 16px;border-radius:4px;cursor:pointer;font-family:'Barlow Condensed';font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;transition:all 0.15s;}
      .HB:hover{color:#F0E6D2;border-color:#C89B3C;}.HB.ac{color:#C89B3C;border-color:rgba(200,155,60,0.3);}.HB.ac:hover{background:rgba(200,155,60,0.08);}
      .HSt{font-size:11px;color:#3C3C41;margin-right:8px;}

      .KB{display:flex;align-items:stretch;background:#091428;border:1px solid #1E2328;border-radius:6px;margin-bottom:24px;overflow:hidden;}
      .KI{flex:1;display:flex;align-items:center;gap:14px;padding:18px 24px;border-right:1px solid #1E2328;}.KI:last-child{border-right:none;}
      .KV{font-family:'Barlow Condensed';font-weight:900;font-size:32px;color:#F0E6D2;line-height:1;}
      .KL{font-size:11px;color:#5B5A56;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;line-height:1.4;}

      .TB{display:flex;margin-bottom:24px;border-bottom:1px solid #1E2328;}
      .TT{font-family:'Barlow Condensed';font-weight:700;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;color:#5B5A56;padding:12px 22px;cursor:pointer;border:none;background:none;border-bottom:2px solid transparent;margin-bottom:-1px;transition:all 0.15s;}
      .TT.on{color:#C89B3C;border-bottom-color:#C89B3C;}.TT:hover:not(.on){color:#A09B8C;}
      .TC{font-size:9px;background:rgba(200,155,60,0.15);color:#C89B3C;padding:2px 6px;border-radius:8px;margin-left:6px;}

      .PG{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-bottom:40px;}
      .PC{background:#091428;border:1px solid #1E2328;border-radius:8px;padding:16px;display:flex;flex-direction:column;gap:10px;cursor:pointer;transition:all 0.2s;align-items:center;text-align:center;}
      .PC:hover{border-color:rgba(200,155,60,0.25);transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,0.4);}
      .PT{display:flex;flex-direction:column;align-items:center;gap:6px;width:100%;}
      .PU{display:flex;flex-direction:column;align-items:center;gap:8px;}
      .PA{width:56px;height:56px;border-radius:8px;border:2px solid;object-fit:cover;background:#0A1428;}
      .PN{font-family:'Barlow Condensed';font-weight:900;font-size:22px;text-transform:uppercase;color:#F0E6D2;line-height:1.1;}
      .PR{font-size:10px;color:#5B5A56;margin-top:1px;}
      .PK{text-align:center;margin-top:2px;}.PLP{font-family:'Barlow Condensed';font-weight:900;font-size:22px;line-height:1;}
      .PTR{font-size:10px;color:#5B5A56;text-transform:uppercase;margin-top:1px;}

      .PSR{display:flex;gap:6px;width:100%;}
      .PS{flex:1;background:rgba(30,35,40,0.4);border:1px solid rgba(30,35,40,0.6);border-radius:5px;padding:8px 10px;display:flex;flex-direction:column;align-items:center;gap:4px;}
      .PSL{font-size:9px;color:#5B5A56;letter-spacing:0.06em;text-transform:uppercase;font-weight:700;}
      .PSV{font-family:'Barlow Condensed';font-weight:900;font-size:20px;color:#F0E6D2;line-height:1;}
      .BD{font-family:'Barlow Condensed';font-weight:800;font-size:10px;letter-spacing:0.06em;padding:3px 8px;border-radius:3px;text-transform:uppercase;}
      .BD.bad{color:#E84057;background:rgba(232,64,87,0.1);border:1px solid rgba(232,64,87,0.15);}
      .BD.mid{color:#C89B3C;background:rgba(200,155,60,0.1);border:1px solid rgba(200,155,60,0.15);}
      .BD.ok{color:#0ACF83;background:rgba(10,207,131,0.1);border:1px solid rgba(10,207,131,0.15);}

      .PF{display:flex;flex-direction:column;gap:3px;width:100%;align-items:center;}
      .FF{font-size:11px;font-weight:500;display:flex;align-items:center;gap:5px;color:#5B5A56;}
      .FF::before{content:'';width:4px;height:4px;border-radius:50%;flex-shrink:0;}
      .FF.bad{color:#E84057;}.FF.bad::before{background:#E84057;}
      .FF.mid{color:#C89B3C;}.FF.mid::before{background:#C89B3C;}
      .FF.ok{color:#0ACF83;}.FF.ok::before{background:#0ACF83;}
      .FF.err{color:#5B5A56;}.FF.err::before{background:#5B5A56;}

      .CL{display:flex;flex-direction:column;gap:4px;width:100%;}
      .CI{display:flex;align-items:center;gap:6px;background:rgba(30,35,40,0.4);padding:4px 8px 4px 4px;border-radius:5px;border:1px solid rgba(30,35,40,0.6);width:100%;}
      .CI img{width:26px;height:26px;border-radius:4px;object-fit:cover;flex-shrink:0;}
      .CI-name{font-size:10px;color:#A09B8C;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .CW{font-family:'Barlow Condensed';font-weight:700;font-size:13px;margin-left:auto;}
      .CGm{font-size:8px;color:#5B5A56;margin-left:3px;flex-shrink:0;}
      .FM{display:flex;gap:2px;height:4px;margin-top:auto;width:100%;}
      .FD{flex:1;border-radius:2px;}

      /* ── TEAM OVERVIEW SECTIONS ── */
      .sec-title{font-family:'Barlow Condensed';font-weight:900;font-size:16px;text-transform:uppercase;letter-spacing:0.08em;color:#C89B3C;margin-bottom:16px;display:flex;align-items:center;gap:8px;}
      .sec-title span{color:#5B5A56;font-size:12px;font-weight:600;text-transform:none;letter-spacing:0;}
      .overview-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:32px;}
      .overview-full{margin-bottom:32px;}

      /* Comparison Table */
      .cmp-table{width:100%;border-collapse:collapse;background:#091428;border:1px solid #1E2328;border-radius:8px;overflow:hidden;}
      .cmp-table th{font-family:'Barlow Condensed';font-weight:700;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#5B5A56;padding:12px 16px;text-align:left;border-bottom:1px solid #1E2328;background:#091428;}
      .cmp-table th.r{text-align:right;}
      .cmp-table td{padding:12px 16px;border-bottom:1px solid rgba(30,35,40,0.4);font-size:13px;vertical-align:middle;}
      .cmp-table tr:last-child td{border-bottom:none;}
      .cmp-table tr:hover td{background:rgba(200,155,60,0.02);}
      .cmp-player{display:flex;align-items:center;gap:10px;}
      .cmp-av{width:32px;height:32px;border-radius:6px;border:2px solid;object-fit:cover;}
      .cmp-name{font-family:'Barlow Condensed';font-weight:800;font-size:16px;text-transform:uppercase;color:#F0E6D2;}
      .cmp-val{font-family:'Barlow Condensed';font-weight:800;font-size:16px;text-align:right;}
      .cmp-sub{font-size:10px;color:#5B5A56;text-align:right;}
      .cmp-bar-wrap{width:80px;height:4px;background:#1E2328;border-radius:2px;overflow:hidden;display:inline-block;vertical-align:middle;margin-left:8px;}
      .cmp-bar-fill{height:100%;border-radius:2px;}

      /* Champion Pool */
      .pool-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;}
      .pool-item{background:#091428;border:1px solid #1E2328;border-radius:6px;padding:10px 12px;display:flex;align-items:center;gap:10px;transition:border-color 0.15s;}
      .pool-item:hover{border-color:rgba(200,155,60,0.2);}
      .pool-img{width:40px;height:40px;border-radius:6px;object-fit:cover;border:1px solid #1E2328;}
      .pool-info{flex:1;min-width:0;}
      .pool-name{font-family:'Barlow Condensed';font-weight:700;font-size:14px;color:#F0E6D2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .pool-meta{font-size:10px;color:#5B5A56;margin-top:1px;}
      .pool-wr{font-family:'Barlow Condensed';font-weight:900;font-size:18px;flex-shrink:0;}
      .pool-players{font-size:9px;color:#3C3C41;margin-top:3px;}

      /* Activity Chart */
      .act-wrap{background:#091428;border:1px solid #1E2328;border-radius:8px;padding:20px;}
      .act-bars{display:flex;align-items:flex-end;gap:3px;height:120px;}
      .act-col{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;}
      .act-bar{width:100%;border-radius:3px 3px 0 0;min-height:2px;transition:height 0.3s;}
      .act-label{font-size:9px;color:#5B5A56;font-weight:600;}
      .act-val{font-family:'Barlow Condensed';font-weight:700;font-size:11px;color:#A09B8C;}
      .act-legend{display:flex;gap:16px;margin-top:12px;padding-top:10px;border-top:1px solid #1E2328;}
      .act-leg-item{display:flex;align-items:center;gap:6px;font-size:11px;color:#5B5A56;}
      .act-leg-dot{width:8px;height:8px;border-radius:2px;}

      /* ── FIXTURE (same as before but bigger) ── */
      .FW{display:flex;flex-direction:column;gap:18px;}
      .TBk{background:#091428;border:1px solid #1E2328;border-radius:8px;overflow:hidden;}
      .TH{display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid #1E2328;}
      .TDt{width:8px;height:8px;border-radius:50%;background:#C89B3C;flex-shrink:0;}
      .TNm{font-family:'Barlow Condensed';font-weight:800;font-size:17px;text-transform:uppercase;color:#F0E6D2;}
      .TSr{font-size:11px;color:#5B5A56;margin-left:6px;}
      .TCn{margin-left:auto;font-size:11px;color:#5B5A56;}
      .MR{display:flex;align-items:center;padding:14px 20px;border-bottom:1px solid rgba(30,35,40,0.4);cursor:pointer;transition:background 0.15s;}
      .MR:last-of-type{border-bottom:none;}.MR:hover{background:rgba(200,155,60,0.02);}
      .MR.sl{background:rgba(200,155,60,0.03);border-left:3px solid rgba(200,155,60,0.5);}
      .MD{min-width:130px;}.MDV{font-family:'Barlow Condensed';font-weight:700;font-size:15px;color:#A09B8C;}.MDT{font-size:11px;color:#3C3C41;}
      .MT{flex:1;display:flex;align-items:center;justify-content:center;gap:14px;}
      .MS{font-family:'Barlow Condensed';font-weight:800;font-size:20px;color:#C89B3C;text-transform:uppercase;}
      .MV{font-size:11px;color:#3C3C41;letter-spacing:0.15em;}
      .MO{font-family:'Barlow Condensed';font-weight:800;font-size:20px;color:#A09B8C;text-transform:uppercase;transition:color 0.15s;}
      .MR:hover .MO,.MR.sl .MO{color:#E84057;}
      .MRt{display:flex;align-items:center;gap:8px;min-width:180px;justify-content:flex-end;}
      .MDB{background:rgba(157,72,224,0.08);color:#9D48E0;border:1px solid rgba(157,72,224,0.2);padding:5px 12px;border-radius:4px;cursor:pointer;font-family:'Barlow Condensed';font-size:11px;font-weight:700;transition:all 0.15s;}
      .MDB:hover{background:rgba(157,72,224,0.15);}
      .MBO{font-size:11px;color:#5B5A56;font-weight:700;}.MDy{font-family:'Barlow Condensed';font-weight:800;font-size:12px;}.MHi{font-size:9px;color:#3C3C41;}

      /* Scout panel (bigger) */
      .SP{padding:22px 24px;border-top:1px solid rgba(200,155,60,0.1);background:rgba(200,155,60,0.01);}
      .SH{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;}
      .STi{font-family:'Barlow Condensed';font-weight:800;font-size:17px;text-transform:uppercase;color:#C89B3C;}
      .STi span{color:#5B5A56;font-size:12px;font-weight:600;margin-left:6px;text-transform:none;}
      .SRf{background:transparent;color:#5B5A56;border:1px solid #1E2328;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;font-family:'Barlow';transition:all 0.15s;}
      .SRf:hover{color:#C89B3C;border-color:rgba(200,155,60,0.3);}
      .SG{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;}
      .SC{background:rgba(30,35,40,0.3);border:1px solid #1E2328;border-radius:6px;padding:16px 18px;}
      .SCN{font-family:'Barlow Condensed';font-weight:900;font-size:18px;text-transform:uppercase;color:#F0E6D2;margin-bottom:2px;}
      .SCG{font-size:11px;color:#5B5A56;margin-bottom:10px;}
      .SCC{display:flex;flex-direction:column;gap:8px;}
      .SCR{display:flex;align-items:center;gap:10px;}
      .SCI{width:38px;height:38px;border-radius:6px;border:1px solid #1E2328;flex-shrink:0;object-fit:cover;}
      .SCIn{flex:1;min-width:0;}.SCNm{font-size:12px;font-weight:600;color:#A09B8C;margin-bottom:2px;}
      .SCMt{font-size:10px;color:#5B5A56;margin-bottom:3px;}.SCBr{height:3px;background:#1E2328;border-radius:1px;overflow:hidden;}.SCFl{height:100%;border-radius:1px;}
      .SCWR{font-family:'Barlow Condensed';font-weight:800;font-size:15px;flex-shrink:0;}
      .SM{margin-top:20px;border-top:1px solid #1E2328;padding-top:16px;}
      .SMT{font-family:'Barlow Condensed';font-weight:800;font-size:13px;text-transform:uppercase;letter-spacing:0.1em;color:#5B5A56;margin-bottom:12px;}
      .SML{display:flex;flex-direction:column;gap:8px;}
      .SMC{background:rgba(30,35,40,0.2);border:1px solid #1E2328;border-radius:6px;overflow:hidden;}
      .SMH{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;cursor:pointer;transition:background 0.15s;}.SMH:hover{background:rgba(30,35,40,0.3);}
      .SMMt{font-size:10px;color:#3C3C41;}.SMTm{font-family:'Barlow Condensed';font-weight:800;font-size:15px;display:flex;align-items:center;gap:6px;}
      .SMVs{color:#3C3C41;font-size:10px;}.SMOp{color:#5B5A56;}
      .SMRt{display:flex;align-items:center;gap:6px;}
      .SRW{color:#0ACF83;background:rgba(10,207,131,0.08);border:1px solid rgba(10,207,131,0.15);font-family:'Barlow Condensed';font-weight:800;font-size:11px;padding:3px 8px;border-radius:3px;}
      .SRL{color:#E84057;background:rgba(232,64,87,0.08);border:1px solid rgba(232,64,87,0.15);font-family:'Barlow Condensed';font-weight:800;font-size:11px;padding:3px 8px;border-radius:3px;}
      .SMTg{font-size:9px;color:#3C3C41;}
      .SDr{padding:12px 16px;display:grid;grid-template-columns:1fr 16px 1fr;background:rgba(0,0,0,0.2);}
      .SDs{display:flex;flex-direction:column;gap:8px;}
      .SDH{font-family:'Barlow Condensed';font-weight:700;font-size:13px;text-transform:uppercase;padding-bottom:6px;border-bottom:2px solid;}
      .SBl .SDH{color:#0596AA;border-color:rgba(5,150,170,0.3);}.SRd .SDH{color:#E84057;border-color:rgba(232,64,87,0.3);}
      .SOT{background:#E84057;color:#fff;font-size:7px;padding:1px 4px;border-radius:2px;font-weight:800;margin-left:4px;}
      .SDSc{display:flex;flex-direction:column;gap:4px;}.SDL{font-size:9px;color:#3C3C41;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;}
      .SDRw{display:flex;gap:4px;flex-wrap:wrap;}.SDWr{display:flex;flex-direction:column;align-items:center;gap:1px;}
      .SDLn{font-size:7px;color:#3C3C41;max-width:40px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .SBI{width:30px;height:30px;border-radius:4px;border:1px solid #1E2328;object-fit:cover;}
      .SPI{width:42px;height:42px;border-radius:6px;border:2px solid rgba(30,35,40,0.6);object-fit:cover;}
      .SDVc{display:flex;justify-content:center;padding-top:8px;}
      .SLd{text-align:center;padding:30px;color:#C89B3C;font-family:'Barlow Condensed';font-size:15px;font-weight:700;}
      .SEr{text-align:center;padding:30px;color:#5B5A56;font-size:12px;}.Em{text-align:center;padding:40px;color:#3C3C41;font-size:13px;}
      .MOB{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px;}
      .MOI{flex:1;min-width:200px;background:#0A1428;border:1px solid #1E2328;color:#CDBE91;padding:9px 12px;font-size:12px;border-radius:2px;outline:none;font-family:inherit;}
      .MOI:focus{border-color:#C89B3C;}
      .MOI::placeholder{color:#3C3C41;}
      .MOS{background:#C89B3C;color:#010A13;border:none;padding:9px 16px;font-size:11px;font-weight:700;letter-spacing:0.05em;cursor:pointer;border-radius:2px;font-family:inherit;text-transform:uppercase;}
      .MOS:hover{background:#D9AE4E;}
      .MOC{background:transparent;color:#5B5A56;border:1px solid #1E2328;padding:9px 12px;font-size:11px;cursor:pointer;border-radius:2px;font-family:inherit;}
      .MOC:hover{color:#E84057;border-color:#E84057;}
    `}</style>

    <div className="R">
      <div className="H">
        <div className="HL"><div className="LG">{TEAM_NAME} <em>Command Center</em></div><span className="HS">Koç Paneli</span></div>
        <div className="HR">
          {loadingPlayerName&&<span className="HSt">{loadingPlayerName}</span>}
          <button className="HB" onClick={()=>router.push('/matches')}>⚔ Maçlar</button>
          <button className="HB ac" onClick={()=>router.push('/draft')}>📋 Draft</button>
          <button className="HB" onClick={()=>{localStorage.removeItem('currentUser');router.push('/');}}>Çıkış</button>
        </div>
      </div>

      <div className="KB">
        <div className="KI"><div className="KV">{totalG}</div><div className="KL">Haftalık<br/>SoloQ</div></div>
        <div className="KI"><div className="KV" style={{color:'#0ACF83'}}>{avgWR}%</div><div className="KL">Takım Ort.<br/>Win Rate</div></div>
        <div className="KI"><div className="KV" style={{color:'#C89B3C'}}>{USERS.filter(u=>u.role==='player').length}</div><div className="KL">Aktif<br/>Oyuncu</div></div>
        <div className="KI"><div className="KV" style={{fontSize:22,color:'#5B5A56'}}>{new Date().toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})}</div><div className="KL">Son<br/>Tarama</div></div>
      </div>

      <div className="TB">
        <button className={`TT ${activeTab==='roster'?'on':''}`} onClick={()=>setActiveTab('roster')}>Kadro</button>
        <button className={`TT ${activeTab==='fixture'?'on':''}`} onClick={()=>setActiveTab('fixture')}>Takvim{totalUp>0&&<span className="TC">{totalUp}</span>}</button>
      </div>

      {activeTab==='roster'&&(<>
        {/* PLAYER CARDS */}
        <div className="PG">
          {teamStats.map((p,i) => {
            const s=p.stats,tc=TIER_COLORS[s?.tier||'UNRANKED'],fl=getDisciplineFlags(s),rc=getRecentChampions(s?.recentMatches),w=s?.weeklyGames||0;
            const bc=w<7?'bad':w<14?'mid':'ok',bt=w<7?'DÜŞÜK':w<14?'NORMAL':'İYİ';
            return (
              <div key={i} className="PC" onClick={()=>handlePlayerClick(p)}>
                <div className="PT">
                  <div className="PU">
                    <img src={p.image} className="PA" style={{borderColor:tc}} alt="" onError={(e:any)=>{e.target.src='/logo.png';}}/>
                    <div><div className="PN">{p.name}</div><div className="PR">{p.riotId}</div></div>
                  </div>
                  {s&&!s.error&&s.tier?<div className="PK"><div className="PLP" style={{color:tc}}>{s.lp} LP</div><div className="PTR">{s.tier} {s.rank}</div></div>:<div className="PTR" style={{color:'#E84057'}}>Bekleniyor</div>}
                </div>
                <div className="PSR">
                  <div className="PS"><div className="PSL">Hafta</div><div className="PSV">{w}</div><span className={`BD ${bc}`}>{bt}</span></div>
                  <div className="PS"><div className="PSL">Son WR</div><div className="PSV">{s?.recentWinRate||'—'}</div></div>
                </div>
                <div className="PF">{fl.map((f:any,idx:number)=><span key={idx} className={`FF ${f.type}`}>{f.msg}</span>)}</div>
                {rc.length>0&&<div className="CL">{rc.slice(0,5).map((c,idx)=>{const col=c.winRate>=60?'#0ACF83':c.winRate>=50?'#C89B3C':'#E84057';return(<div key={idx} className="CI"><img src={`https://ddragon.leagueoflegends.com/cdn/16.5.1/img/champion/${c.name.replace(/\s+/g,'')}.png`} alt={c.name} onError={(e:any)=>{e.target.style.display='none';}}/><span className="CI-name">{c.name}</span><span className="CW" style={{color:col}}>{c.winRate}%</span><span className="CGm">{c.games}G</span></div>);})}</div>}
                {s?.recentMatches?.length>0&&<div className="FM">{s.recentMatches.slice(0,15).map((m:any,idx:number)=><div key={idx} className="FD" style={{background:m.result==='Galibiyet'?'#0ACF83':'#E84057'}}/>)}</div>}
              </div>
            );
          })}
        </div>

        {/* ── TEAM OVERVIEW ── */}
        {teamStats.length > 0 && (<>

          {/* PLAYER COMPARISON TABLE */}
          <div className="overview-full">
            <div className="sec-title">⬥ Oyuncu Karşılaştırma <span>LP, WR, Aktivite</span></div>
            <table className="cmp-table">
              <thead><tr><th>Oyuncu</th><th className="r">LP</th><th className="r">Genel WR</th><th className="r">Son WR</th><th className="r">Haftalık</th></tr></thead>
              <tbody>
                {comparison.map((p,i)=>{
                  const tc=TIER_COLORS[p.tier];
                  const wrCol=p.winRate>=55?'#0ACF83':p.winRate>=50?'#C89B3C':'#E84057';
                  const rwCol=p.recentWR>=55?'#0ACF83':p.recentWR>=50?'#C89B3C':'#E84057';
                  const wCol=p.weekly>=14?'#0ACF83':p.weekly>=7?'#C89B3C':'#E84057';
                  return (
                    <tr key={i}>
                      <td><div className="cmp-player"><img src={p.image} className="cmp-av" style={{borderColor:tc}} alt="" onError={(e:any)=>{e.target.src='/logo.png';}}/><div><div className="cmp-name">{p.name}</div><div style={{fontSize:10,color:'#5B5A56'}}>{p.tier} {p.rank}</div></div></div></td>
                      <td><div className="cmp-val" style={{color:tc}}>{p.lp}</div></td>
                      <td><div className="cmp-val" style={{color:wrCol}}>{p.winRate}%</div><div className="cmp-bar-wrap"><div className="cmp-bar-fill" style={{width:`${p.winRate}%`,background:wrCol}}/></div></td>
                      <td><div className="cmp-val" style={{color:rwCol}}>{p.recentWR}%</div></td>
                      <td><div className="cmp-val" style={{color:wCol}}>{p.weekly}</div><div className="cmp-sub">{p.weekly<7?'düşük':p.weekly<14?'normal':'iyi'}</div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="overview-grid">
            {/* CHAMPION POOL */}
            <div>
              <div className="sec-title">⬥ Takım Champion Pool <span>bu hafta</span></div>
              <div className="pool-grid">
                {champPool.map((c,i) => {
                  const col=c.winRate>=60?'#0ACF83':c.winRate>=50?'#C89B3C':'#E84057';
                  return (
                    <div key={i} className="pool-item">
                      <img src={champImg(c.name)} className="pool-img" alt={c.name} onError={(e:any)=>{e.target.src='/logo.png';}}/>
                      <div className="pool-info">
                        <div className="pool-name">{c.name}</div>
                        <div className="pool-meta">{c.games} maç · {c.playerCount} oyuncu</div>
                        <div className="pool-players">{c.players.join(', ')}</div>
                      </div>
                      <div className="pool-wr" style={{color:col}}>{c.winRate}%</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* WEEKLY ACTIVITY */}
            <div>
              <div className="sec-title">⬥ Haftalık Aktivite <span>oyuncu başına</span></div>
              <div className="act-wrap">
                <div className="act-bars">
                  {teamStats.map((p,i) => {
                    const w=p.stats?.weeklyGames||0;
                    const maxW=Math.max(...teamStats.map(x=>x.stats?.weeklyGames||0),1);
                    const h=Math.max((w/maxW)*100,3);
                    const col=w>=14?'#0ACF83':w>=7?'#C89B3C':'#E84057';
                    return (
                      <div key={i} className="act-col">
                        <div className="act-val">{w}</div>
                        <div className="act-bar" style={{height:`${h}%`,background:col}}/>
                        <div className="act-label">{p.name?.substring(0,5)}</div>
                      </div>
                    );
                  })}
                </div>
                <div className="act-legend">
                  <div className="act-leg-item"><div className="act-leg-dot" style={{background:'#0ACF83'}}/> 14+ iyi</div>
                  <div className="act-leg-item"><div className="act-leg-dot" style={{background:'#C89B3C'}}/> 7-13 normal</div>
                  <div className="act-leg-item"><div className="act-leg-dot" style={{background:'#E84057'}}/> &lt;7 düşük</div>
                </div>
              </div>
            </div>
          </div>

        </>)}
      </>)}

      {activeTab==='fixture'&&(()=>{
        // Manuel rakip, mevcut scout arayüzünü olduğu gibi kullanabilmek için
        // sentetik bir turnuva olarak listenin başına ekleniyor.
        const manualBlock = savedOpp ? [{ id:'manual', name:'Manuel Rakip', serie:'', league:'',
          matches:[{ id:`manual_${savedOpp}`, opponent:savedOpp, date:'Tarih girilmedi', time:'—',
                     daysLeft:null, matchType:'—', isPast:false, isLive:false }] }] : [];
        const tournaments = [...manualBlock, ...((fixture&&!fixture.error&&fixture.tournaments)||[])];
        return (
        <div className="FW">
          <div className="MOB">
            <input className="MOI" value={manualOpp} onChange={e=>setManualOpp(e.target.value)}
              onKeyDown={e=>{if(e.key==='Enter')submitManualOpp();}}
              placeholder="Fikstürde olmayan rakip — Leaguepedia takım adı" />
            <button className="MOS" onClick={submitManualOpp}>Analiz Et</button>
            {savedOpp&&<button className="MOC" onClick={clearManualOpp}>Temizle ({savedOpp})</button>}
          </div>
          {fixtureLoading?<div className="SLd">Yükleniyor...</div>:tournaments.length===0?<div className="Em">Yaklaşan maç yok — rakibi elle girebilirsin</div>
          :tournaments.map((t:any)=>(
            <div key={t.id} className="TBk">
              <div className="TH"><div className="TDt"/><div className="TNm">{t.name}{t.serie&&<span className="TSr">· {t.serie}</span>}</div><div className="TCn">{t.matches.length} maç</div></div>
              {t.matches.map((m:any)=>{const db=getDaysLeftBadge(m.daysLeft),isSel=selectedMatch?.id===m.id;return(
                <div key={m.id}>
                  <div className={`MR ${isSel?'sl':''}`} onClick={()=>handleMatchClick(m)}>
                    <div className="MD"><div className="MDV">{m.date}</div><div className="MDT">{m.time}</div></div>
                    <div className="MT"><span className="MS">{TEAM_NAME}</span><span className="MV">VS</span><span className="MO">{m.opponent}</span></div>
                    <div className="MRt">
                      <button className="MDB" onClick={(e)=>{e.stopPropagation();router.push('/draft');}}>Draft</button>
                      <span className="MBO">{m.matchType}</span>
                      <span className="MDy" style={{color:db.color}}>{db.label}</span>
                      <span className="MHi">{isSel?'▲':'▼'}</span>
                    </div>
                  </div>
                  {isSel&&(
                    <div className="SP">
                      <div className="SH"><div className="STi">⬥ {m.opponent}<span>rakip analizi</span></div><button className="SRf" onClick={(e)=>{e.stopPropagation();fetchScout(m.opponent,m.id,true);}}>↻ Yenile</button></div>
                      {scoutLoading?<div className="SLd">Çekiliyor...</div>:scoutData?.error?<div className="SEr">{scoutData.error}</div>:scoutData?.players?.length>0?(
                        <div className="SG">{scoutData.players.map((pl:any)=>(
                          <div key={pl.name} className="SC"><div className="SCN">{pl.name}</div><div className="SCG">{pl.games} maç · %{pl.winRate} WR</div>
                            <div className="SCC">{pl.topChamps.map((ch:any)=>{const wr=ch.winRate,col=wr>=60?'#0ACF83':wr>=50?'#C89B3C':'#E84057';return(
                              <div key={ch.name} className="SCR"><img src={champImg(ch.name)} className="SCI" alt={ch.name} onError={(e:any)=>{e.target.src='/logo.png';}}/><div className="SCIn"><div className="SCNm">{ch.name}</div><div className="SCMt">{ch.games} maç</div><div className="SCBr"><div className="SCFl" style={{width:`${wr}%`,background:col}}/></div></div><span className="SCWR" style={{color:col}}>{wr}%</span></div>
                            );})}</div>
                          </div>
                        ))}</div>
                      ):null}
                      {scoutData?.recentMatches?.length>0&&(
                        <div className="SM"><div className="SMT">Son {scoutData.recentMatches.length} Maç</div><div className="SML">{scoutData.recentMatches.map((gm:any)=>{
                          const gk=`sg_${gm.id}`,go=(activeScoutGame[gk]??0)===1,bio=gm.teamIsBlue;return(
                          <div key={gm.id} className="SMC">
                            <div className="SMH" onClick={()=>setActiveScoutGame(pr=>({...pr,[gk]:go?0:1}))}>
                              <div><div className="SMMt">{gm.tournament} · {gm.date}</div><div className="SMTm"><span style={{color:bio?'#0596AA':'#E84057'}}>{m.opponent}</span><span className="SMVs">vs</span><span className="SMOp">{gm.opponent}</span></div></div>
                              <div className="SMRt"><span className={gm.result==='W'?'SRW':'SRL'}>{gm.result==='W'?'W':'L'}</span><span className="SMTg">{go?'▲':'▼'}</span></div>
                            </div>
                            {go&&<div className="SDr">
                              <div className="SDs SBl"><div className="SDH">{bio?m.opponent:gm.opponent}{bio&&<span className="SOT">OPP</span>}</div>
                                {gm.blueBans.length>0&&<div className="SDSc"><div className="SDL">Bans</div><div className="SDRw">{gm.blueBans.map((c:string,i:number)=><div className="SDWr" key={i}><img src={champImg(c)} className="SBI" alt={c} onError={(e:any)=>{e.target.src='/logo.png';}}/><span className="SDLn">{c}</span></div>)}</div></div>}
                                <div className="SDSc"><div className="SDL">Picks</div><div className="SDRw">{gm.bluePicks.length>0?gm.bluePicks.map((c:string,i:number)=><div className="SDWr" key={i}><img src={champImg(c)} className="SPI" alt={c} onError={(e:any)=>{e.target.src='/logo.png';}}/><span className="SDLn">{c}</span></div>):<span style={{fontSize:10,color:'#3C3C41'}}>—</span>}</div></div>
                              </div>
                              <div className="SDVc"><span style={{fontSize:8,color:'#1E2328',fontFamily:'Barlow Condensed',fontWeight:900}}>VS</span></div>
                              <div className="SDs SRd"><div className="SDH">{!bio?m.opponent:gm.opponent}{!bio&&<span className="SOT">OPP</span>}</div>
                                {gm.redBans.length>0&&<div className="SDSc"><div className="SDL">Bans</div><div className="SDRw">{gm.redBans.map((c:string,i:number)=><div className="SDWr" key={i}><img src={champImg(c)} className="SBI" alt={c} onError={(e:any)=>{e.target.src='/logo.png';}}/><span className="SDLn">{c}</span></div>)}</div></div>}
                                <div className="SDSc"><div className="SDL">Picks</div><div className="SDRw">{gm.redPicks.length>0?gm.redPicks.map((c:string,i:number)=><div className="SDWr" key={i}><img src={champImg(c)} className="SPI" alt={c} onError={(e:any)=>{e.target.src='/logo.png';}}/><span className="SDLn">{c}</span></div>):<span style={{fontSize:10,color:'#3C3C41'}}>—</span>}</div></div>
                              </div>
                            </div>}
                          </div>);})}</div></div>
                      )}
                    </div>
                  )}
                </div>
              );})}
            </div>
          ))}
        </div>
        );
      })()}
    </div>
  </>);
  function handlePlayerClick(playerObj: any) { sessionStorage.setItem('viewingPlayer', JSON.stringify(playerObj)); router.push('/player'); }
}
