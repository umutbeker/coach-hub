// /app/draft/page.tsx — GÜNCELLENMIŞ (AI Asistan tab eklendi)
// 
// DEĞİŞİKLİKLER:
// 1. import AIDraftAssistant eklendi (satır 5)
// 2. centerTab type'ına 'ai' eklendi (satır 48)
// 3. center-tabs bölümüne 3. tab eklendi (satır ~285)
// 4. AI tab content bölümü eklendi (satır ~340)
// 5. placeChampion fonksiyonu AIDraftAssistant'a prop olarak geçildi
//
// Geri kalan tüm kod AYNI — sadece bu 5 değişiklik yapıldı.

'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Pusher from 'pusher-js';
import StrategyMap from './StrategyMap';
import AIDraftAssistant from './AIDraftAssistant';  // ← YENİ IMPORT

const CHAMP_MAP: Record<string, string> = {
  'Wukong': 'MonkeyKing', 'Renata Glasc': 'Renata', "K'Sante": 'KSante',
  'Nunu & Willump': 'Nunu', 'Jarvan IV': 'JarvanIV', 'Lee Sin': 'LeeSin',
  'Master Yi': 'MasterYi', 'Miss Fortune': 'MissFortune', 'Twisted Fate': 'TwistedFate',
  'Dr. Mundo': 'DrMundo', 'Aurelion Sol': 'AurelionSol', "Bel'Veth": 'Belveth',
  "Cho'Gath": 'Chogath', "Kai'Sa": 'Kaisa', "Kha'Zix": 'Khazix',
  "Kog'Maw": 'KogMaw', "Vel'Koz": 'Velkoz', "Rek'Sai": 'RekSai',
  'Xin Zhao': 'XinZhao', 'Tahm Kench': 'TahmKench',
};

function champImg(name: string) {
  if (!name) return '/logo.png';
  const key = CHAMP_MAP[name] ?? name.replace(/[\s'".]/g, '');
  return `https://ddragon.leagueoflegends.com/cdn/16.5.1/img/champion/${key}.png`;
}
function champSplash(name: string) {
  if (!name) return '';
  const key = CHAMP_MAP[name] ?? name.replace(/[\s'".]/g, '');
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${key}_0.jpg`;
}

const ALL_CHAMPIONS = [
  'Aatrox','Ahri','Akali','Akshan','Alistar','Ambessa','Amumu','Anivia','Annie','Aphelios',
  'Ashe','Aurelion Sol','Aurora','Azir','Bard',"Bel'Veth",'Blitzcrank','Brand','Braum','Briar',
  'Caitlyn','Camille','Cassiopeia',"Cho'Gath",'Corki','Darius','Diana','Dr. Mundo','Draven','Ekko',
  'Elise','Evelynn','Ezreal','Fiddlesticks','Fiora','Fizz','Galio','Gangplank','Garen','Gnar',
  'Gragas','Graves','Gwen','Hecarim','Heimerdinger','Hwei','Illaoi','Irelia','Ivern','Janna',
  'Jarvan IV','Jax','Jayce','Jhin','Jinx',"Kai'Sa",'Kalista','Karma','Karthus','Kassadin',
  'Katarina','Kayle','Kayn',"Kha'Zix",'Kindred',"Kog'Maw","K'Sante",'LeBlanc','Lee Sin','Leona',
  'Lillia','Lissandra','Lucian','Lulu','Lux','Malphite','Malzahar','Maokai','Master Yi',
  'Miss Fortune','Mordekaiser','Morgana','Naafiri','Nami','Nasus','Nautilus','Neeko','Nidalee',
  'Nilah','Nocturne','Nunu & Willump','Olaf','Orianna','Ornn','Pantheon','Poppy','Pyke',
  'Qiyana','Quinn','Rakan','Rammus',"Rek'Sai",'Rell','Renata Glasc','Renekton','Rengar','Riven',
  'Rumble','Ryze','Samira','Sejuani','Senna','Seraphine','Sett','Shaco','Shen','Shyvana',
  'Singed','Sion','Sivir','Skarner','Smolder','Sona','Soraka','Swain','Sylas','Syndra',
  'Tahm Kench','Taliyah','Talon','Taric','Teemo','Thresh','Tristana','Trundle','Tryndamere',
  'Twisted Fate','Twitch','Udyr','Urgot','Varus','Vayne',"Vel'Koz",'Vex','Vi','Viego','Viktor',
  'Vladimir','Volibear','Warwick','Wukong','Xayah','Xerath','Xin Zhao','Yasuo','Yone','Yorick',
  'Yunara','Yuumi','Zac','Zed','Zeri','Ziggs','Zilean','Zoe','Zyra','Zaahen','Mel',
].sort();

const TEAM_NAME_MAP: Record<string, string> = {
  'BIG': 'Berlin International Gaming',
  'The Otter Side': 'Otter Side',
};

type SelectionState =
  | { mode: 'slot'; side: 'blue'|'red'; type: 'pick'|'ban'; index: number }
  | { mode: 'champ'; champion: string }
  | null;

export default function DraftPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [draft, setDraft] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [lastUpdate, setLastUpdate] = useState('');
  const [opponent, setOpponent] = useState<string | null>(null);
  const [scoutData, setScoutData] = useState<any>(null);
  const [scoutLoading, setScoutLoading] = useState(false);
  const [activeScoutTab, setActiveScoutTab] = useState<'players' | 'matches'>('players');
  const [expandedGame, setExpandedGame] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionState>(null);
  const [soloqInputs, setSoloqInputs] = useState<Record<string, string>>({});
  const [soloqData, setSoloqData] = useState<Record<string, any>>({});
  const [soloqLoading, setSoloqLoading] = useState<Record<string, boolean>>({});
  const [centerTab, setCenterTab] = useState<'scout'|'strategy'|'ai'>('scout');  // ← 'ai' EKLENDİ
  const [strategyData, setStrategyData] = useState<any>(null);
  const lastLocalChange = useRef(0);
  const pusherRef = useRef<any>(null);

  const filteredChamps = ALL_CHAMPIONS.filter(c =>
    c.toLowerCase().includes(search.toLowerCase())
  );

  function getEmptyDraft() {
    return {
      picks: { blue: ['','','','',''], red: ['','','','',''] },
      bans: { blue: ['','','','',''], red: ['','','','',''] },
      teamNames: { blue: 'Ozarox Esports', red: 'Rakip' },
    };
  }

  const loadDraft = async () => {
    const res = await fetch('/api/draft');
    const data = await res.json();
    setDraft(data);
    if (data.soloq && Object.keys(data.soloq).length > 0) setSoloqData(data.soloq);
    if (data.strategy) setStrategyData(data.strategy);
  };

  const updateDraft = async (action: string, payload: any) => {
    const userName = user?.name || 'Bilinmiyor';
    lastLocalChange.current = Date.now();
    setDraft((prev: any) => {
      if (!prev) return prev;
      const next = JSON.parse(JSON.stringify(prev));
      if (action === 'SET_PICK') next.picks[payload.side][payload.index] = payload.champion;
      if (action === 'SET_BAN') next.bans[payload.side][payload.index] = payload.champion;
      if (action === 'SET_TEAM_NAME') next.teamNames[payload.side] = payload.name;
      if (action === 'RESET') return getEmptyDraft();
      return next;
    });
    await fetch('/api/draft', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload, userName }),
    });
  };

  const swapSlots = (
    srcSide: 'blue'|'red', srcType: 'pick'|'ban', srcIndex: number,
    dstSide: 'blue'|'red', dstType: 'pick'|'ban', dstIndex: number
  ) => {
    if (srcSide === dstSide && srcType === dstType && srcIndex === dstIndex) return;
    const userName = user?.name || 'Bilinmiyor';
    lastLocalChange.current = Date.now();
    setDraft((prev: any) => {
      if (!prev) return prev;
      const next = JSON.parse(JSON.stringify(prev));
      const srcKey = srcType === 'pick' ? 'picks' : 'bans';
      const dstKey = dstType === 'pick' ? 'picks' : 'bans';
      const srcChamp: string = next[srcKey][srcSide][srcIndex] || '';
      const dstChamp: string = next[dstKey][dstSide][dstIndex] || '';
      next[srcKey][srcSide][srcIndex] = dstChamp;
      next[dstKey][dstSide][dstIndex] = srcChamp;
      fetch('/api/draft', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ action: srcType==='pick'?'SET_PICK':'SET_BAN', payload:{side:srcSide,index:srcIndex,champion:dstChamp}, userName }) });
      fetch('/api/draft', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ action: dstType==='pick'?'SET_PICK':'SET_BAN', payload:{side:dstSide,index:dstIndex,champion:srcChamp}, userName }) });
      return next;
    });
  };

  const placeChampion = (champion: string, side: 'blue'|'red', type: 'pick'|'ban', index: number) => {
    lastLocalChange.current = Date.now();
    updateDraft(type === 'pick' ? 'SET_PICK' : 'SET_BAN', { side, index, champion });
  };

  const saveStrategy = async (data: any) => {
    setStrategyData(data);
    lastLocalChange.current = Date.now();
    const userName = user?.name || 'Bilinmiyor';
    await fetch('/api/draft', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'SET_STRATEGY', payload: data, userName }),
    });
  };

  const fetchSoloQ = async (playerName: string, riotId: string) => {
    if (!riotId.includes('#')) return;
    setSoloqLoading(p => ({ ...p, [playerName]: true }));
    try {
      const res = await fetch('/api/riot-lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ riotId }) });
      const data = await res.json();
      if (!data.error) {
        await fetch('/api/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'SET_SOLOQ', payload: { playerName, data }, userName: user?.name || 'Bilinmiyor' }) });
        setSoloqData(p => ({ ...p, [playerName]: data }));
      } else { setSoloqData(p => ({ ...p, [playerName]: { error: data.error } })); }
    } catch (e) { setSoloqData(p => ({ ...p, [playerName]: { error: 'Bağlantı hatası' } })); }
    setSoloqLoading(p => ({ ...p, [playerName]: false }));
  };

  const fetchNextOpponent = async () => {
    try {
      const cached = localStorage.getItem('fixture_cache');
      const cacheTime = localStorage.getItem('fixture_cache_time');
      let data = null;
      if (cached && cacheTime && Date.now() - Number(cacheTime) < 30 * 60 * 1000) { data = JSON.parse(cached); }
      else { const res = await fetch('/api/fixture'); data = await res.json(); if (!data.error) { localStorage.setItem('fixture_cache', JSON.stringify(data)); localStorage.setItem('fixture_cache_time', String(Date.now())); } }
      if (data?.tournaments?.length > 0) {
        const allMatches = data.tournaments.flatMap((t: any) => t.matches);
        const upcoming = allMatches.filter((m: any) => m.daysLeft !== null && m.daysLeft >= 0);
        if (upcoming.length > 0) { upcoming.sort((a: any, b: any) => (a.daysLeft ?? 99) - (b.daysLeft ?? 99)); const opp = upcoming[0].opponent; setOpponent(opp); return opp; }
      }
    } catch (e) {} return null;
  };

  const fetchScout = async (opp: string) => {
    const cacheKey = `scout_draft_${opp}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) { setScoutData(JSON.parse(cached)); return; }
    setScoutLoading(true);
    try { const redisRes = await fetch('/api/data?type=scout'); const redisData = await redisRes.json();
      if (redisData.data?.opponent === opp && redisData.data?.players?.length > 0) { localStorage.setItem(cacheKey, JSON.stringify(redisData.data)); setScoutData(redisData.data); setScoutLoading(false); return; }
    } catch {}
    try {
      const lpName = TEAM_NAME_MAP[opp] ?? opp;
      const p1 = new URLSearchParams({ action: 'cargoquery', tables: 'ScoreboardPlayers', fields: 'Champion,PlayerWin,DateTime_UTC,Tournament,Team,Name', where: `Team="${lpName}"`, order_by: 'DateTime_UTC DESC', limit: '75', format: 'json', origin: '*' });
      const r1 = await fetch(`https://lol.fandom.com/api.php?${p1}`); const d1 = await r1.json();
      const p2 = new URLSearchParams({ action: 'cargoquery', tables: 'ScoreboardPlayers=SP,PicksAndBansS7=PB',
        fields: ['SP.PlayerWin','SP.DateTime_UTC','SP.Tournament','SP.Team','SP.TeamVs','SP.Side','SP.GameId','PB.Team1Ban1','PB.Team1Ban2','PB.Team1Ban3','PB.Team1Ban4','PB.Team1Ban5','PB.Team2Ban1','PB.Team2Ban2','PB.Team2Ban3','PB.Team2Ban4','PB.Team2Ban5','PB.Team1Pick1','PB.Team1Pick2','PB.Team1Pick3','PB.Team1Pick4','PB.Team1Pick5','PB.Team2Pick1','PB.Team2Pick2','PB.Team2Pick3','PB.Team2Pick4','PB.Team2Pick5'].join(','),
        join_on: 'SP.GameId=PB.GameId', where: `SP.Team="${lpName}"`, order_by: 'SP.DateTime_UTC DESC', limit: '50', format: 'json', origin: '*' });
      const r2 = await fetch(`https://lol.fandom.com/api.php?${p2}`); const d2 = await r2.json();
      const playerMap: Record<string, any> = {};
      if (d1.cargoquery?.length > 0) { d1.cargoquery.forEach((item: any) => { const m = item.title; const name = m.Name || 'Bilinmiyor'; if (!playerMap[name]) playerMap[name] = { name, champs: {}, games: 0, wins: 0 }; playerMap[name].games++; if (m.PlayerWin === 'Yes') playerMap[name].wins++; if (m.Champion) { if (!playerMap[name].champs[m.Champion]) playerMap[name].champs[m.Champion] = { games: 0, wins: 0 }; playerMap[name].champs[m.Champion].games++; if (m.PlayerWin === 'Yes') playerMap[name].champs[m.Champion].wins++; } }); }
      const players = Object.values(playerMap).map((p: any) => ({ name: p.name, games: p.games, winRate: Math.round((p.wins / p.games) * 100), topChamps: Object.entries(p.champs).map(([c, s]: any) => ({ name: c, games: s.games, winRate: Math.round((s.wins / s.games) * 100) })).sort((a, b) => b.games - a.games).slice(0, 5) })).sort((a, b) => b.games - a.games);
      let recentMatches: any[] = [];
      if (d2.cargoquery?.length > 0) { const gameMap: Record<string, any> = {}; d2.cargoquery.forEach((item: any) => { const m = item.title; const rawDate = (m['DateTime UTC'] ?? m['DateTime_UTC'] ?? '').split(' ')[0]; const gid = m.GameId || `${m.TeamVs}_${rawDate}`; if (!gameMap[gid]) { const isBlueSide = m.Side === '1' || m.Side?.toLowerCase() === 'blue'; gameMap[gid] = { id: gid, date: rawDate, tournament: m.Tournament || '', opponent: m.TeamVs || '?', result: m.PlayerWin === 'Yes' ? 'W' : 'L', teamIsBlue: isBlueSide, blueBans: [m.Team1Ban1,m.Team1Ban2,m.Team1Ban3,m.Team1Ban4,m.Team1Ban5].filter(Boolean), redBans: [m.Team2Ban1,m.Team2Ban2,m.Team2Ban3,m.Team2Ban4,m.Team2Ban5].filter(Boolean), bluePicks: [m.Team1Pick1,m.Team1Pick2,m.Team1Pick3,m.Team1Pick4,m.Team1Pick5].filter(Boolean), redPicks: [m.Team2Pick1,m.Team2Pick2,m.Team2Pick3,m.Team2Pick4,m.Team2Pick5].filter(Boolean) }; } }); recentMatches = Object.values(gameMap).sort((a: any, b: any) => b.date.localeCompare(a.date)).slice(0, 5); }
      const result = { opponent: opp, players, recentMatches, fetchedAt: Date.now() };
      localStorage.setItem(cacheKey, JSON.stringify(result)); setScoutData(result);
    } catch (e) { console.error('Scout hata:', e); }
    setScoutLoading(false);
  };

  useEffect(() => {
    const loggedInUser = localStorage.getItem('currentUser');
    if (!loggedInUser) { router.push('/'); return; }
    setUser(JSON.parse(loggedInUser));
    loadDraft();
    fetchNextOpponent().then(opp => { if (opp) fetchScout(opp); });
    const pusher = new Pusher(process.env.NEXT_PUBLIC_PUSHER_KEY!, { cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER! });
    pusherRef.current = pusher;
    const channel = pusher.subscribe('draft-channel');
    channel.bind('draft-updated', (data: any) => {
      const timeSinceLocal = Date.now() - lastLocalChange.current;
      if (timeSinceLocal < 1500) { setLastUpdate(data.userName); if (data.draft?.soloq) setSoloqData(data.draft.soloq); return; }
      setDraft(data.draft); setLastUpdate(data.userName);
      if (data.draft?.soloq) setSoloqData(data.draft.soloq);
      if (data.draft?.strategy) setStrategyData(data.draft.strategy);
    });
    return () => { channel.unbind_all(); pusher.unsubscribe('draft-channel'); pusher.disconnect(); };
  }, [router]);

  // Click handlers
  const handleSlotClick = (side: 'blue'|'red', type: 'pick'|'ban', index: number) => {
    if (!selection) { setSelection({ mode: 'slot', side, type, index }); return; }
    if (selection.mode === 'champ') { placeChampion(selection.champion, side, type, index); setSelection(null); return; }
    if (selection.mode === 'slot') {
      if (selection.side === side && selection.type === type && selection.index === index) { setSelection(null); return; }
      swapSlots(selection.side, selection.type, selection.index, side, type, index); setSelection(null); return;
    }
  };
  const handleChampClick = (champ: string) => {
    if (!selection) { setSelection({ mode: 'champ', champion: champ }); return; }
    if (selection.mode === 'champ') { if (selection.champion === champ) setSelection(null); else setSelection({ mode: 'champ', champion: champ }); return; }
    if (selection.mode === 'slot') { placeChampion(champ, selection.side, selection.type, selection.index); setSelection(null); return; }
  };
  const clearSlot = (side: 'blue'|'red', type: 'pick'|'ban', index: number) => {
    updateDraft(type === 'pick' ? 'SET_PICK' : 'SET_BAN', { side, index, champion: '' }); setSelection(null);
  };

  if (!draft) return (
    <div style={{ minHeight:'100vh',background:'#010A13',display:'flex',alignItems:'center',justifyContent:'center',color:'#C89B3C',fontFamily:'Barlow Condensed',fontSize:20,fontWeight:700 }}>
      Yükleniyor...
    </div>
  );

  const usedChamps = [...draft.picks.blue,...draft.picks.red,...draft.bans.blue,...draft.bans.red].filter(Boolean);
  const isSlotSel = (s: 'blue'|'red', t: 'pick'|'ban', i: number) =>
    selection?.mode === 'slot' && selection.side === s && selection.type === t && selection.index === i;
  const isChampPending = (c: string) => selection?.mode === 'champ' && selection.champion === c;
  const POS = ['TOP','JNG','MID','BOT','SUP'];

  const BanSlot = ({ side, index }: { side: 'blue'|'red', index: number }) => {
    const champ = draft.bans[side][index];
    return (
      <div className={`ban-s ${champ?'has':''} ${isSlotSel(side,'ban',index)?'sel':''} ${side}`}
        onClick={()=>handleSlotClick(side,'ban',index)}
        onContextMenu={e=>{e.preventDefault();if(champ)clearSlot(side,'ban',index);}}>
        {champ ? <img src={champImg(champ)} alt={champ} onError={(e:any)=>{e.target.src='/logo.png';}}/> : <span className="ban-x">✕</span>}
        {champ && <div className="ban-line"/>}
      </div>
    );
  };

  const PickSlot = ({ side, index }: { side: 'blue'|'red', index: number }) => {
    const champ = draft.picks[side][index];
    const sel = isSlotSel(side,'pick',index);
    const isBlue = side === 'blue';
    return (
      <div className={`pick-s ${isBlue?'blue':'red'} ${champ?'has':''} ${sel?'sel':''}`}
        onClick={()=>handleSlotClick(side,'pick',index)}
        onContextMenu={e=>{e.preventDefault();if(champ)clearSlot(side,'pick',index);}}>
        {champ ? (
          <>
            <div className="pick-splash" style={{backgroundImage:`url(${champSplash(champ)})`}}/>
            <div className={`pick-grad ${isBlue?'gb':'gr'}`}/>
          </>
        ) : (
          <div className="pick-empty"><div className={`pick-eb ${isBlue?'ebb':'ebr'}`}/></div>
        )}
        <div className={`pick-info ${isBlue?'pi-b':'pi-r'}`}>
          <span className="pick-pos">{POS[index]}</span>
          {champ && <span className="pick-name">{champ.toUpperCase()}</span>}
        </div>
        {sel && <div className={`pick-glow ${isBlue?'gl-b':'gl-r'}`}/>}
      </div>
    );
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;900&family=Barlow:wght@300;400;500;600&display=swap');
        html,body,#__next{height:100%;margin:0;padding:0;}
        *{box-sizing:border-box;}
        body{background:#010A13;font-family:'Barlow',sans-serif;color:#A09B8C;overflow:hidden;}
        .root{height:100vh;display:flex;flex-direction:column;background:#010A13;}

        .hdr{display:flex;align-items:center;justify-content:space-between;padding:0 20px;
          background:linear-gradient(180deg,#091428,#0A1428);flex-shrink:0;height:44px;border-bottom:1px solid #1E2328;}
        .hdr-l{display:flex;align-items:center;gap:12px;}
        .logo{font-family:'Barlow Condensed';font-weight:900;font-size:18px;text-transform:uppercase;letter-spacing:0.08em;color:#C8AA6E;}
        .logo em{color:#F0E6D2;font-style:normal;}
        .vs-chip{display:flex;align-items:center;gap:8px;background:rgba(200,170,110,0.06);border:1px solid rgba(200,170,110,0.15);border-radius:4px;padding:4px 12px;font-family:'Barlow Condensed';font-size:12px;font-weight:700;letter-spacing:0.06em;color:#A09B8C;}
        .vs-chip .opp{color:#C89B3C;}
        .hdr-r{display:flex;align-items:center;gap:10px;}
        .ldot{width:6px;height:6px;border-radius:50%;background:#C89B3C;animation:pulse 2s infinite;margin-right:3px;}
        @keyframes pulse{0%,100%{opacity:1;box-shadow:0 0 4px #C89B3C}50%{opacity:0.4;box-shadow:none}}
        .ltxt{font-size:10px;color:#C89B3C;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;font-family:'Barlow Condensed';}
        .upd{font-size:9px;color:#3C3C41;}
        .btn{background:rgba(200,170,110,0.08);color:#A09B8C;border:1px solid #1E2328;padding:5px 14px;border-radius:3px;cursor:pointer;font-family:'Barlow Condensed';font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;transition:all 0.15s;}
        .btn:hover{background:rgba(200,170,110,0.15);color:#F0E6D2;border-color:#C89B3C;}
        .btn-d{color:#E84057;border-color:rgba(232,64,87,0.3);}
        .btn-d:hover{background:rgba(232,64,87,0.12);border-color:#E84057;}

        .ban-bar{display:flex;align-items:center;justify-content:center;padding:12px 20px;
          background:#091428;border-bottom:1px solid #1E2328;flex-shrink:0;gap:0;}
        .ban-sec{display:flex;align-items:center;gap:6px;}
        .ban-div{width:2px;height:48px;background:#1E2328;margin:0 10px;}
        .ban-vs{font-family:'Barlow Condensed';font-weight:900;font-size:12px;letter-spacing:0.2em;color:#3C3C41;margin:0 24px;text-transform:uppercase;}
        .ban-s{width:76px;height:76px;border:1.5px solid #1E2328;position:relative;overflow:hidden;cursor:pointer;transition:all 0.15s;display:flex;align-items:center;justify-content:center;background:#0A1428;}
        .ban-s.blue{clip-path:polygon(10px 0,100% 0,100% 100%,0 100%,0 10px);}
        .ban-s.red{clip-path:polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%);}
        .ban-s:hover{border-color:#5B5A56;}
        .ban-s.sel{border-color:#C89B3C !important;box-shadow:0 0 12px rgba(200,155,60,0.3);}
        .ban-s img{width:100%;height:100%;object-fit:cover;}
        .ban-line{position:absolute;top:0;left:0;width:141%;height:2px;background:#E84057;transform:rotate(45deg);transform-origin:top left;opacity:0.8;}
        .ban-x{font-size:10px;color:#3C3C41;}

        .main{display:grid;grid-template-columns:240px 1fr 240px;flex:1;min-height:0;overflow:hidden;height:0;}
        .picks-col{display:flex;flex-direction:column;overflow:hidden;}

        .pick-s{position:relative;flex:1;cursor:pointer;overflow:hidden;transition:all 0.15s;border-bottom:1px solid rgba(30,35,40,0.4);}
        .pick-s:last-child{border-bottom:none;}
        .pick-s:hover .pick-splash{transform:scale(1.05);}
        .pick-splash{position:absolute;inset:0;background-size:cover;background-position:center 20%;transition:transform 0.4s ease;}
        .pick-grad{position:absolute;inset:0;}
        .gb{background:linear-gradient(90deg,rgba(5,150,170,0.06) 0%,transparent 35%,rgba(1,10,19,0.95) 100%);}
        .gr{background:linear-gradient(-90deg,rgba(232,64,87,0.06) 0%,transparent 35%,rgba(1,10,19,0.95) 100%);}
        .pick-empty{position:absolute;inset:0;background:#0A0E13;display:flex;align-items:center;justify-content:center;}
        .pick-eb{position:absolute;inset:4px;border:1px dashed rgba(30,35,40,0.6);}
        .ebb{border-color:rgba(5,150,170,0.15);}
        .ebr{border-color:rgba(232,64,87,0.15);}
        .pick-info{position:absolute;bottom:0;left:0;right:0;padding:8px 12px;z-index:2;display:flex;flex-direction:column;gap:1px;
          background:linear-gradient(0deg,rgba(1,10,19,0.9),transparent);}
        .pi-b{align-items:flex-end;text-align:right;}
        .pi-r{align-items:flex-start;text-align:left;}
        .pick-pos{font-family:'Barlow Condensed';font-weight:700;font-size:9px;letter-spacing:0.15em;color:#5B5A56;text-transform:uppercase;}
        .pick-name{font-family:'Barlow Condensed';font-weight:900;font-size:15px;letter-spacing:0.04em;color:#C8AA6E;text-transform:uppercase;text-shadow:0 1px 8px rgba(0,0,0,0.8);}
        .pick-glow{position:absolute;inset:0;z-index:3;pointer-events:none;}
        .gl-b{border-left:3px solid #0596AA;box-shadow:inset 4px 0 20px rgba(5,150,170,0.15);}
        .gl-r{border-right:3px solid #E84057;box-shadow:inset -4px 0 20px rgba(232,64,87,0.15);}
        .pick-s.sel .pick-eb{border-color:#C89B3C;border-style:solid;opacity:1;animation:sp 1.5s infinite;}
        @keyframes sp{0%,100%{box-shadow:inset 0 0 15px rgba(200,155,60,0.08)}50%{box-shadow:inset 0 0 25px rgba(200,155,60,0.2)}}

        .center{display:flex;flex-direction:column;border-left:1px solid #1E2328;border-right:1px solid #1E2328;overflow:hidden;background:#010A13;min-height:0;height:100%;}

        /* Center tabs */
        .center-tabs{display:flex;background:#091428;border-bottom:1px solid #1E2328;flex-shrink:0;}
        .center-tab{flex:1;font-family:'Barlow Condensed';font-weight:700;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#5B5A56;padding:9px 0;cursor:pointer;border:none;background:none;border-bottom:2px solid transparent;text-align:center;transition:all 0.15s;}
        .center-tab.on{color:#C89B3C;border-bottom-color:#C89B3C;}
        .center-tab:hover:not(.on){color:#A09B8C;}

        .scout-top{flex-shrink:0;background:#091428;border-bottom:1px solid #1E2328;}
        .scout-tb{display:flex;align-items:center;justify-content:space-between;padding:8px 14px 0;}
        .scout-opp{font-family:'Barlow Condensed';font-weight:900;font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#C89B3C;display:flex;align-items:center;gap:6px;}
        .scout-tabs{display:flex;padding:0 10px;}
        .st{font-family:'Barlow Condensed';font-weight:700;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#5B5A56;padding:7px 12px;cursor:pointer;border:none;background:none;border-bottom:2px solid transparent;margin-bottom:-1px;transition:all 0.15s;}
        .st.on{color:#C89B3C;border-bottom-color:#C89B3C;}
        .scout-body{flex:1;overflow-y:auto;padding:10px 12px;min-height:0;}
        .scout-body::-webkit-scrollbar{width:3px;}
        .scout-body::-webkit-scrollbar-track{background:#010A13;}
        .scout-body::-webkit-scrollbar-thumb{background:#1E2328;}

        .p-card{background:rgba(30,35,40,0.3);border:1px solid #1E2328;border-radius:4px;padding:10px 12px;margin-bottom:8px;}
        .p-name{font-family:'Barlow Condensed';font-weight:900;font-size:18px;text-transform:uppercase;color:#F0E6D2;margin-bottom:4px;}
        .p-meta{font-size:11px;color:#5B5A56;margin-bottom:6px;}
        .c-row{display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:1px solid rgba(30,35,40,0.5);}
        .c-row:last-child{border-bottom:none;}
        .c-icon{width:38px;height:38px;border-radius:4px;object-fit:cover;border:1px solid #1E2328;flex-shrink:0;}
        .c-info{flex:1;min-width:0;}
        .c-nm{font-size:13px;font-weight:600;color:#A09B8C;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .c-gm{font-size:10px;color:#5B5A56;margin-top:2px;}
        .c-bar{height:2px;background:#1E2328;border-radius:1px;margin-top:3px;overflow:hidden;}
        .c-fill{height:100%;border-radius:1px;}
        .c-wr{font-family:'Barlow Condensed';font-weight:800;font-size:16px;flex-shrink:0;min-width:36px;text-align:right;}

        .p-inner{display:grid;grid-template-columns:1fr 1fr;gap:0;max-height:220px;}
        .p-left{padding:0;border-right:1px solid #1E2328;overflow-y:auto;max-height:220px;}
        .p-right{padding:8px 10px;display:flex;flex-direction:column;gap:5px;overflow-y:auto;max-height:220px;}
        .sq-iw{display:flex;gap:4px;margin-bottom:6px;}
        .sq-inp{flex:1;background:#0A1428;border:1px solid #1E2328;border-radius:3px;padding:4px 7px;color:#F0E6D2;font-family:'Barlow';font-size:10px;outline:none;min-width:0;}
        .sq-inp:focus{border-color:#C89B3C;}
        .sq-btn{background:rgba(200,155,60,0.1);color:#C89B3C;border:1px solid rgba(200,155,60,0.3);border-radius:3px;padding:4px 8px;cursor:pointer;font-size:10px;font-weight:700;font-family:'Barlow';transition:all 0.15s;flex-shrink:0;}
        .sq-btn:hover{background:rgba(200,155,60,0.2);}
        .sq-rank{font-family:'Barlow Condensed';font-weight:800;font-size:16px;margin-bottom:4px;}
        .sq-empty{font-size:9px;color:#3C3C41;text-align:center;padding:16px 0;font-style:italic;}
        .sq-err{font-size:9px;color:#E84057;text-align:center;padding:8px 0;}
        .sq-load{font-size:9px;color:#C89B3C;text-align:center;padding:16px 0;animation:pulse 1.5s infinite;}
        .sq-cl{display:flex;flex-direction:column;}
        .p-left::-webkit-scrollbar,.p-right::-webkit-scrollbar{width:2px;}
        .p-left::-webkit-scrollbar-thumb,.p-right::-webkit-scrollbar-thumb{background:#1E2328;}
        .sq-cr{display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:1px solid rgba(30,35,40,0.5);}
        .sq-cr:last-child{border-bottom:none;}
        .sq-ci{width:32px;height:32px;border-radius:4px;object-fit:cover;flex-shrink:0;border:1px solid #1E2328;}
        .sq-cs{display:flex;flex-direction:column;gap:1px;flex:1;min-width:0;}
        .sq-kda{font-family:'Barlow Condensed';font-size:15px;font-weight:700;color:#A09B8C;}
        .sq-sub{font-size:11px;color:#5B5A56;margin-top:1px;}
        .sq-cwr{font-family:'Barlow Condensed';font-weight:800;font-size:17px;flex-shrink:0;}

        .m-card{background:rgba(30,35,40,0.2);border:1px solid #1E2328;border-radius:4px;margin-bottom:6px;overflow:hidden;}
        .m-hdr{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;cursor:pointer;transition:background 0.15s;}
        .m-hdr:hover{background:rgba(30,35,40,0.4);}
        .m-meta{font-size:9px;color:#3C3C41;}
        .m-teams{font-family:'Barlow Condensed';font-weight:700;font-size:15px;color:#A09B8C;margin-top:2px;}
        .res-w{color:#0ACF83;background:rgba(10,207,131,0.08);border:1px solid rgba(10,207,131,0.2);font-family:'Barlow Condensed';font-weight:800;font-size:10px;padding:2px 8px;border-radius:3px;}
        .res-l{color:#E84057;background:rgba(232,64,87,0.08);border:1px solid rgba(232,64,87,0.2);font-family:'Barlow Condensed';font-weight:800;font-size:10px;padding:2px 8px;border-radius:3px;}
        .m-draft{padding:12px 14px;background:rgba(0,0,0,0.3);display:grid;grid-template-columns:1fr 1fr;gap:12px;}
        .m-sl{font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;}
        .m-imgs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;}
        .mi-p{width:40px;height:40px;border-radius:4px;object-fit:cover;border:1px solid #1E2328;}
        .mi-b{width:32px;height:32px;border-radius:3px;object-fit:cover;border:1px solid #1E2328;filter:grayscale(0.5) brightness(0.6);}

        .picker{flex-shrink:0;border-top:1px solid #1E2328;background:#091428;padding:6px 8px;display:flex;flex-direction:column;gap:5px;height:300px;}
        .srch-w{position:relative;flex-shrink:0;}
        .srch-i{width:100%;background:#0A1428;border:1px solid #1E2328;border-radius:3px;padding:6px 10px 6px 28px;color:#F0E6D2;font-family:'Barlow';font-size:11px;outline:none;}
        .srch-i:focus{border-color:#C89B3C;}
        .srch-ic{position:absolute;left:9px;top:50%;transform:translateY(-50%);font-size:11px;color:#3C3C41;}
        .cgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(58px,1fr));gap:3px;overflow-y:auto;flex:1;align-content:start;}
        .cgrid::-webkit-scrollbar{width:3px;}
        .cgrid::-webkit-scrollbar-track{background:#091428;}
        .cgrid::-webkit-scrollbar-thumb{background:#1E2328;}
        .cb{display:flex;flex-direction:column;align-items:center;gap:1px;padding:2px;border-radius:3px;cursor:pointer;border:1.5px solid transparent;transition:all 0.12s;user-select:none;}
        .cb:hover{background:rgba(200,170,110,0.06);border-color:rgba(200,170,110,0.15);}
        .cb.used{opacity:0.12;cursor:not-allowed;filter:grayscale(1);}
        .cb.pend{background:rgba(200,155,60,0.12);border-color:#C89B3C !important;box-shadow:0 0 10px rgba(200,155,60,0.15);}
        .cb img{width:48px;height:48px;border-radius:4px;object-fit:cover;pointer-events:none;}
        .cb span{font-size:8px;color:#5B5A56;text-align:center;pointer-events:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;line-height:1.2;margin-top:1px;}
        .ld-s{text-align:center;padding:20px;color:#3C3C41;font-size:11px;}

        /* Strategy tab fills center */
        .strategy-wrap{flex:1;overflow:hidden;display:flex;flex-direction:column;}

        /* AI tab fills center */
        .ai-tab-wrap{flex:1;overflow:hidden;display:flex;flex-direction:column;min-height:0;height:0;}
      `}</style>

      <div className="root">
        <div className="hdr">
          <div className="hdr-l">
            <button className="btn" onClick={() => router.back()}>← GERİ</button>
            <div className="logo">Ozarox <em>DRAFT</em></div>
            {opponent && <div className="vs-chip">Ozarox <span style={{color:'#3C3C41',margin:'0 4px'}}>VS</span> <span className="opp">{opponent}</span></div>}
          </div>
          <div className="hdr-r">
            {lastUpdate && <span className="upd">{lastUpdate} güncelledi</span>}
            <div style={{display:'flex',alignItems:'center'}}><div className="ldot"/><span className="ltxt">Canlı</span></div>
            <button className="btn btn-d" onClick={() => { if(confirm('Sıfırlansın mı?')) { updateDraft('RESET',{}); setSelection(null); } }}>↺ Sıfırla</button>
          </div>
        </div>

        <div className="ban-bar">
          <div className="ban-sec">{[0,1,2].map(i=><BanSlot key={i} side="blue" index={i}/>)}<div className="ban-div"/>{[3,4].map(i=><BanSlot key={i} side="blue" index={i}/>)}</div>
          <div className="ban-vs">BANS</div>
          <div className="ban-sec">{[0,1,2].map(i=><BanSlot key={i} side="red" index={i}/>)}<div className="ban-div"/>{[3,4].map(i=><BanSlot key={i} side="red" index={i}/>)}</div>
        </div>

        <div className="main">
          <div className="picks-col">{[0,1,2,3,4].map(i => <PickSlot key={i} side="blue" index={i}/>)}</div>

          <div className="center">
            {/* ─── CENTER TABS: Scout / Strategy / AI ─── */}
            <div className="center-tabs">
              <button className={`center-tab ${centerTab==='scout'?'on':''}`} onClick={()=>setCenterTab('scout')}>🔍 Rakip Scout</button>
              <button className={`center-tab ${centerTab==='strategy'?'on':''}`} onClick={()=>setCenterTab('strategy')}>🗺 Strateji</button>
              <button className={`center-tab ${centerTab==='ai'?'on':''}`} onClick={()=>setCenterTab('ai')}>🤖 AI Asistan</button>
            </div>

            {centerTab === 'scout' ? (
              <>
                <div className="scout-top">
                  <div className="scout-tb">
                    {opponent ? <div className="scout-opp">⬥ {opponent} <span style={{fontSize:9,color:'#5B5A56',fontWeight:600,letterSpacing:'0.05em',textTransform:'none'}}>· rakip analizi</span></div>
                      : <div style={{fontSize:10,color:'#3C3C41',padding:'8px 0'}}>Rakip bekleniyor...</div>}
                    <button className="btn" style={{fontSize:10,padding:'3px 8px'}} onClick={()=>{if(opponent){localStorage.removeItem(`scout_draft_${opponent}`);fetchScout(opponent);}}}>↻</button>
                  </div>
                  <div className="scout-tabs">
                    <button className={`st ${activeScoutTab==='players'?'on':''}`} onClick={()=>setActiveScoutTab('players')}>Oyuncular</button>
                    <button className={`st ${activeScoutTab==='matches'?'on':''}`} onClick={()=>setActiveScoutTab('matches')}>Son Maçlar</button>
                  </div>
                </div>
                <div className="scout-body">
                  {scoutLoading ? <div className="ld-s">Veri çekiliyor...</div>
                    : !scoutData ? <div className="ld-s">Rakip verisi bekleniyor</div>
                    : activeScoutTab === 'players'
                      ? scoutData.players?.map((player: any) => (
                          <div key={player.name} className="p-card">
                            <div className="p-name">{player.name}</div>
                            <div className="p-inner">
                              <div className="p-left">
                                <div className="p-meta" style={{padding:'6px 10px 4px'}}>{player.games} maç · %{player.winRate} WR</div>
                                <div style={{padding:'0 10px 8px'}}>
                                  {player.topChamps.map((ch: any) => {
                                    const wr = ch.winRate; const color = wr>=60?'#0ACF83':wr>=50?'#C89B3C':'#E84057';
                                    return (<div key={ch.name} className="c-row">
                                      <img src={champImg(ch.name)} className="c-icon" alt={ch.name} onError={(e:any)=>{e.target.src='/logo.png';}}/>
                                      <div className="c-info"><div className="c-nm">{ch.name}</div><div className="c-gm">{ch.games} maç</div><div className="c-bar"><div className="c-fill" style={{width:`${wr}%`,background:color}}/></div></div>
                                      <span className="c-wr" style={{color}}>{wr}%</span>
                                    </div>);
                                  })}
                                </div>
                              </div>
                              <div className="p-right">
                                <div className="sq-iw">
                                  <input className="sq-inp" placeholder="RiotID#TAG" value={soloqInputs[player.name] ?? ''} onChange={e => setSoloqInputs(p => ({ ...p, [player.name]: e.target.value }))} onKeyDown={e => e.key === 'Enter' && fetchSoloQ(player.name, soloqInputs[player.name] ?? '')}/>
                                  <button className="sq-btn" onClick={() => fetchSoloQ(player.name, soloqInputs[player.name] ?? '')} disabled={soloqLoading[player.name]}>{soloqLoading[player.name] ? '...' : '→'}</button>
                                </div>
                                {soloqLoading[player.name] ? <div className="sq-load">Çekiliyor...</div>
                                : soloqData[player.name]?.error ? <div className="sq-err">{soloqData[player.name].error}</div>
                                : soloqData[player.name] ? (() => {
                                  const sq = soloqData[player.name];
                                  const tc: Record<string,string> = {CHALLENGER:'#F4D03F',GRANDMASTER:'#E84057',MASTER:'#9D48E0',DIAMOND:'#576CBC',EMERALD:'#0ACF83',PLATINUM:'#0596AA',GOLD:'#C89B3C',SILVER:'#A09B8C',BRONZE:'#CD7F32',IRON:'#5B5A56',UNRANKED:'#3C3C41'};
                                  return (<>
                                    <div className="sq-rank" style={{color:tc[sq.tier]||'#A09B8C'}}>{sq.tier} {sq.rank} · {sq.lp} LP</div>
                                    <div style={{fontSize:8,color:'#3C3C41',marginBottom:6}}>{sq.wins}W {sq.losses}L · %{sq.winRate} WR</div>
                                    {sq.topChamps?.length > 0 && <div className="sq-cl">{sq.topChamps.map((c: any, i: number) => {
                                      const wr=c.winRate; const col=wr>=60?'#0ACF83':wr>=50?'#C89B3C':'#E84057';
                                      return (<div key={i} className="sq-cr"><img src={champImg(c.name)} className="sq-ci" alt={c.name} onError={(e:any)=>{e.target.src='/logo.png';}}/><div className="sq-cs"><span className="sq-kda">{c.kda} KDA</span><span className="sq-sub">{c.games} maç · %{c.winRate} WR</span></div><span className="sq-cwr" style={{color:col}}>{wr}%</span></div>);
                                    })}</div>}
                                  </>);
                                })() : <div className="sq-empty">Riot ID gir ve → bas</div>}
                              </div>
                            </div>
                          </div>
                        ))
                      : scoutData.recentMatches?.map((gm: any) => {
                          const isOpen = expandedGame === gm.id;
                          return (<div key={gm.id} className="m-card">
                            <div className="m-hdr" onClick={()=>setExpandedGame(isOpen?null:gm.id)}>
                              <div><div className="m-meta">{gm.tournament} · {gm.date}</div><div className="m-teams">{opponent} vs {gm.opponent}</div></div>
                              <div style={{display:'flex',alignItems:'center',gap:6}}><span className={gm.result==='W'?'res-w':'res-l'}>{gm.result==='W'?'GALİBİYET':'MAĞLUBİYET'}</span><span style={{fontSize:9,color:'#3C3C41'}}>{isOpen?'▲':'▼'}</span></div>
                            </div>
                            {isOpen && <div className="m-draft">
                              <div><div className="m-sl" style={{color:'#0596AA'}}>Blue {gm.teamIsBlue && <>— <span style={{color:'#C89B3C'}}>{opponent}</span></>}</div><div className="m-imgs">{gm.blueBans.map((c:string,i:number)=><img key={i} src={champImg(c)} className="mi-b" title={c} alt={c} onError={(e:any)=>{e.target.src='/logo.png';}}/>)}</div><div className="m-imgs">{gm.bluePicks.map((c:string,i:number)=><img key={i} src={champImg(c)} className="mi-p" title={c} alt={c} onError={(e:any)=>{e.target.src='/logo.png';}}/>)}</div></div>
                              <div><div className="m-sl" style={{color:'#E84057'}}>Red {!gm.teamIsBlue && <>— <span style={{color:'#C89B3C'}}>{opponent}</span></>}</div><div className="m-imgs">{gm.redBans.map((c:string,i:number)=><img key={i} src={champImg(c)} className="mi-b" title={c} alt={c} onError={(e:any)=>{e.target.src='/logo.png';}}/>)}</div><div className="m-imgs">{gm.redPicks.map((c:string,i:number)=><img key={i} src={champImg(c)} className="mi-p" title={c} alt={c} onError={(e:any)=>{e.target.src='/logo.png';}}/>)}</div></div>
                            </div>}
                          </div>);
                        })}
                </div>
                <div className="picker">
                  <div className="srch-w"><span className="srch-ic">⬥</span><input className="srch-i" placeholder="Şampiyon ara..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
                  <div className="cgrid">
                    {filteredChamps.map(champ => {
                      const isUsed = usedChamps.includes(champ);
                      return (<div key={champ} className={`cb ${isUsed?'used':''} ${isChampPending(champ)?'pend':''}`} onClick={()=>!isUsed&&handleChampClick(champ)}>
                        <img src={champImg(champ)} alt={champ} onError={(e:any)=>{e.target.src='/logo.png';}}/><span>{champ}</span>
                      </div>);
                    })}
                  </div>
                </div>
              </>
            ) : centerTab === 'strategy' ? (
              /* STRATEGY MAP TAB */
              <div className="strategy-wrap">
                <StrategyMap
                  initialData={strategyData}
                  onSave={saveStrategy}
                  userName={user?.name}
                />
              </div>
            ) : (
              /* ─── AI DRAFT ASSISTANT TAB ─── */
              <div className="ai-tab-wrap">
                <AIDraftAssistant
                  draft={draft}
                  scoutData={scoutData}
                  soloqData={soloqData}
                  onPlaceChampion={placeChampion}
                  userName={user?.name}
                />
              </div>
            )}
          </div>

          <div className="picks-col">{[0,1,2,3,4].map(i => <PickSlot key={i} side="red" index={i}/>)}</div>
        </div>
      </div>
    </>
  );
}
