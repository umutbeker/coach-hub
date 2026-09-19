// /app/draft/AIDraftAssistant.tsx
// Canlı Draft Koçu — Chat tarzı, conversational, Redis persist
'use client';

import { useState, useEffect, useRef } from 'react';

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

interface AIMessage {
  analysis: string;
  banRecommendations: Array<{ champion: string; reason: string; confidence: number; targetPlayer?: string }>;
  pickRecommendations: Array<{ champion: string; role: string; reason: string; confidence: number; synergyWith?: string[]; counters?: string[] }>;
  warnings: string[];
  draftStrategy: string;
  nextStepAdvice?: string;
  _phase?: string;
  _timestamp?: number;
  _ourPicks?: string[];
  _theirPicks?: string[];
}

interface Props {
  draft: any;
  scoutData: any;
  soloqData: Record<string, any>;
  onPlaceChampion?: (champion: string, side: 'blue' | 'red', type: 'pick' | 'ban', index: number) => void;
  userName?: string;
}

export default function AIDraftAssistant({ draft, scoutData, soloqData, onPlaceChampion, userName }: Props) {
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [side, setSide] = useState<'blue' | 'red'>('blue');
  const [metaStatus, setMetaStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [metaGames, setMetaGames] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);

  const loadingTexts = ['Draft analiz ediliyor...', 'Rakip pool inceleniyor...', 'Synergy hesaplanıyor...', 'Strateji oluşturuluyor...'];
  const [loadingIdx, setLoadingIdx] = useState(0);

  // Redis'den kayıtlı mesajları yükle
  useEffect(() => {
    if (!loadedRef.current && draft?.aiResult) {
      loadedRef.current = true;
      const saved = draft.aiResult;
      if (saved.messages) setMessages(saved.messages);
      if (saved.side) setSide(saved.side);
    }
  }, [draft]);

  // Meta veriyi yükle
  useEffect(() => { loadMeta(); }, []);

  const loadMeta = async () => {
    setMetaStatus('loading');
    try {
      const res = await fetch('/api/draft-meta');
      const data = await res.json();
      if (data.success && data.data) { setMetaStatus('ready'); setMetaGames(data.data.totalGames || 0); }
      else setMetaStatus('error');
    } catch { setMetaStatus('error'); }
  };

  // Loading animation
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (loading) { interval = setInterval(() => setLoadingIdx(p => (p + 1) % loadingTexts.length), 2000); }
    return () => clearInterval(interval);
  }, [loading]);

  // Auto-scroll on new message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const analyze = async () => {
    setLoading(true);
    setError(null);
    setLoadingIdx(0);

    try {
      const draftWithSoloq = { ...draft, soloq: soloqData };

      const res = await fetch('/api/draft-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftState: draftWithSoloq,
          scoutData,
          side,
          conversationHistory: messages.slice(-3), // Son 3 mesajı context olarak gönder
        }),
      });

      const data = await res.json();

      if (data.error) {
        setError(data.error);
      } else if (data.result) {
        const newMessages = [...messages, data.result];
        setMessages(newMessages);

        // Redis'e kaydet
        try {
          await fetch('/api/draft', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'SET_AI_RESULT',
              payload: { messages: newMessages, side, timestamp: Date.now() },
              userName: userName || 'AI Asistan',
            }),
          });
        } catch {}
      }
    } catch (e: any) {
      setError(e.message || 'Bağlantı hatası');
    }
    setLoading(false);
  };

  const clearChat = async () => {
    setMessages([]);
    try {
      await fetch('/api/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'SET_AI_RESULT', payload: null, userName: userName || 'AI' }),
      });
    } catch {}
  };

  const handleApplyBan = (champion: string) => {
    if (!onPlaceChampion || !draft) return;
    const bans = side === 'blue' ? draft.bans.blue : draft.bans.red;
    const emptyIdx = bans.findIndex((b: string) => !b);
    if (emptyIdx !== -1) onPlaceChampion(champion, side, 'ban', emptyIdx);
  };

  const handleApplyPick = (champion: string, role: string) => {
    if (!onPlaceChampion || !draft) return;
    const roleMap: Record<string, number> = { top: 0, jungle: 1, mid: 2, adc: 3, support: 4 };
    const idx = roleMap[role] ?? -1;
    if (idx !== -1) {
      const picks = side === 'blue' ? draft.picks.blue : draft.picks.red;
      if (!picks[idx]) onPlaceChampion(champion, side, 'pick', idx);
    }
  };

  const confColor = (c: number) => c >= 8 ? '#0ACF83' : c >= 6 ? '#C89B3C' : c >= 4 ? '#E8A33C' : '#E84057';
  const roleIcon: Record<string, string> = { top: '🗡️', jungle: '🌿', mid: '⚡', adc: '🏹', support: '🛡️' };
  const scoutReady = scoutData && scoutData.players?.length > 0;

  return (
    <>
      <style>{`
        .ai-w{display:flex;flex-direction:column;height:100%;background:#010A13;position:relative;overflow:hidden;}

        /* Top bar - fixed height */
        .ai-top{height:42px;padding:0 14px;background:#091428;border-bottom:1px solid #1E2328;display:flex;align-items:center;gap:10px;flex-shrink:0;}
        .ai-logo{font-family:'Barlow Condensed';font-weight:900;font-size:15px;text-transform:uppercase;letter-spacing:0.08em;color:#C89B3C;display:flex;align-items:center;gap:6px;}
        .ai-logo-ico{font-size:18px;}
        .ai-badge{font-size:7px;background:rgba(200,155,60,0.15);color:#C89B3C;border:1px solid rgba(200,155,60,0.3);border-radius:3px;padding:1px 5px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;}
        .ai-side{background:#0A1428;border:1px solid #1E2328;border-radius:4px;color:#F0E6D2;font-family:'Barlow Condensed';font-size:11px;font-weight:700;padding:5px 8px;cursor:pointer;outline:none;appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%235B5A56'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 6px center;padding-right:20px;}
        .ai-side:focus{border-color:#C89B3C;}
        .ai-side option{background:#0A1428;color:#F0E6D2;}
        .ai-dots{display:flex;align-items:center;gap:8px;margin-left:auto;font-size:9px;color:#5B5A56;}
        .ai-dot{width:5px;height:5px;border-radius:50%;}
        .d-ok{background:#0ACF83;}
        .d-no{background:#E84057;}
        .d-ld{background:#C89B3C;animation:dotpulse 1.5s infinite;}
        @keyframes dotpulse{0%,100%{opacity:1}50%{opacity:0.3}}
        .ai-clr{background:none;border:1px solid #1E2328;color:#5B5A56;border-radius:3px;padding:3px 8px;cursor:pointer;font-size:8px;font-family:'Barlow Condensed';font-weight:700;letter-spacing:0.08em;text-transform:uppercase;transition:all 0.15s;}
        .ai-clr:hover{color:#E84057;border-color:rgba(232,64,87,0.3);}

        /* Chat area */
        .ai-chat{position:absolute;top:42px;bottom:48px;left:0;right:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:12px 14px;display:flex;flex-direction:column;gap:14px;}
        .ai-chat::-webkit-scrollbar{width:3px;}
        .ai-chat::-webkit-scrollbar-track{background:#010A13;}
        .ai-chat::-webkit-scrollbar-thumb{background:#1E2328;border-radius:2px;}

        /* Message bubble */
        .ai-msg{background:rgba(9,20,40,0.8);border:1px solid #1E2328;border-radius:8px;overflow:hidden;animation:msgIn 0.35s ease-out;flex-shrink:0;}
        @keyframes msgIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}

        .ai-msg-hdr{display:flex;align-items:center;gap:8px;padding:8px 12px;background:rgba(200,155,60,0.03);border-bottom:1px solid rgba(30,35,40,0.5);}
        .ai-msg-phase{font-family:'Barlow Condensed';font-weight:700;font-size:10px;color:#5B5A56;letter-spacing:0.06em;text-transform:uppercase;}
        .ai-msg-time{font-size:8px;color:#3C3C41;margin-left:auto;}

        .ai-msg-body{padding:10px 12px;display:flex;flex-direction:column;gap:10px;}

        /* Analysis bubble */
        .ai-an{font-size:12px;color:#A09B8C;line-height:1.6;}

        /* Strategy */
        .ai-str{background:rgba(5,150,170,0.04);border:1px solid rgba(5,150,170,0.12);border-radius:5px;padding:8px 10px;font-size:11px;color:#0596AA;line-height:1.5;}
        .ai-str-lbl{font-family:'Barlow Condensed';font-weight:800;font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:#0596AA;margin-bottom:3px;opacity:0.7;}

        /* Next step */
        .ai-nxt{background:rgba(200,155,60,0.04);border:1px solid rgba(200,155,60,0.12);border-radius:5px;padding:8px 10px;font-size:11px;color:#C89B3C;line-height:1.5;}
        .ai-nxt-lbl{font-family:'Barlow Condensed';font-weight:800;font-size:9px;letter-spacing:0.1em;text-transform:uppercase;color:#C89B3C;margin-bottom:3px;opacity:0.7;}

        /* Section label */
        .ai-sl{font-family:'Barlow Condensed';font-weight:800;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#5B5A56;display:flex;align-items:center;gap:6px;}
        .ai-sl-line{flex:1;height:1px;background:#1E2328;}

        /* Recommendation row */
        .ai-rec{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(30,35,40,0.3);}
        .ai-rec:last-child{border-bottom:none;}
        .ai-rec-img{width:36px;height:36px;border-radius:5px;object-fit:cover;border:1.5px solid #1E2328;flex-shrink:0;}
        .ai-rec-mid{flex:1;min-width:0;}
        .ai-rec-nm{font-family:'Barlow Condensed';font-weight:900;font-size:14px;text-transform:uppercase;color:#F0E6D2;letter-spacing:0.03em;}
        .ai-rec-rs{font-size:10px;color:#8C8C8C;margin-top:1px;line-height:1.3;}
        .ai-rec-tgt{font-size:9px;color:#E84057;font-weight:600;}
        .ai-rec-role{font-size:8px;background:rgba(200,155,60,0.1);color:#C89B3C;border:1px solid rgba(200,155,60,0.2);border-radius:2px;padding:0 4px;font-family:'Barlow Condensed';font-weight:700;letter-spacing:0.08em;text-transform:uppercase;}
        .ai-rec-conf{font-family:'Barlow Condensed';font-weight:900;font-size:18px;flex-shrink:0;min-width:24px;text-align:right;}
        .ai-rec-apply{background:none;border:1px solid #1E2328;color:#5B5A56;border-radius:3px;padding:2px 6px;cursor:pointer;font-size:8px;font-family:'Barlow Condensed';font-weight:700;text-transform:uppercase;transition:all 0.12s;flex-shrink:0;}
        .ai-rec-apply:hover{color:#C89B3C;border-color:rgba(200,155,60,0.3);}

        .ai-tags{display:flex;gap:3px;flex-wrap:wrap;margin-top:2px;}
        .ai-tg{font-size:8px;padding:1px 5px;border-radius:2px;font-weight:600;}
        .ai-tg-s{background:rgba(10,207,131,0.06);color:#0ACF83;border:1px solid rgba(10,207,131,0.12);}
        .ai-tg-c{background:rgba(232,64,87,0.06);color:#E84057;border:1px solid rgba(232,64,87,0.12);}

        /* Warnings */
        .ai-wrn{font-size:10px;color:#A09B8C;padding:2px 0;display:flex;gap:5px;}
        .ai-wrn-b{color:#E84057;flex-shrink:0;}

        /* Bottom bar */
        .ai-btm{position:absolute;bottom:0;left:0;right:0;height:48px;padding:0 14px;background:#091428;border-top:1px solid #1E2328;display:flex;align-items:center;gap:8px;}
        .ai-go{background:linear-gradient(135deg,#C89B3C,#785A28);color:#010A13;border:none;border-radius:5px;padding:10px 24px;font-family:'Barlow Condensed';font-weight:900;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;transition:all 0.2s;display:flex;align-items:center;gap:6px;flex:1;justify-content:center;}
        .ai-go:hover{background:linear-gradient(135deg,#F0E6D2,#C89B3C);box-shadow:0 0 20px rgba(200,155,60,0.25);}
        .ai-go:disabled{opacity:0.35;cursor:not-allowed;box-shadow:none;}
        .ai-go:active:not(:disabled){transform:scale(0.98);}
        .ai-spin{width:14px;height:14px;border:2px solid rgba(1,10,19,0.3);border-top-color:#010A13;border-radius:50%;animation:aispin 0.7s linear infinite;}
        @keyframes aispin{to{transform:rotate(360deg)}}
        .ai-btm-hint{font-size:9px;color:#3C3C41;text-align:center;}

        /* Loading bubble */
        .ai-loading-msg{background:rgba(9,20,40,0.6);border:1px solid #1E2328;border-radius:8px;padding:16px;display:flex;align-items:center;gap:12px;animation:msgIn 0.3s ease-out;}
        .ai-ld-spin{width:28px;height:28px;border:2.5px solid #1E2328;border-top-color:#C89B3C;border-radius:50%;animation:aispin 0.7s linear infinite;flex-shrink:0;}
        .ai-ld-txt{font-family:'Barlow Condensed';font-size:12px;color:#C89B3C;letter-spacing:0.04em;}

        /* Empty state */
        .ai-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:40px 20px;text-align:center;}
        .ai-empty-ico{font-size:40px;opacity:0.25;}
        .ai-empty-t{font-family:'Barlow Condensed';font-weight:800;font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#5B5A56;}
        .ai-empty-d{font-size:10px;color:#3C3C41;max-width:260px;line-height:1.6;}

        /* Error */
        .ai-err{background:rgba(232,64,87,0.04);border:1px solid rgba(232,64,87,0.12);border-radius:6px;padding:10px 12px;margin:0;font-size:11px;color:#E84057;animation:msgIn 0.3s ease-out;}
      `}</style>

      <div className="ai-w">
        {/* Top Bar */}
        <div className="ai-top">
          <div className="ai-logo">
            <span className="ai-logo-ico">🤖</span>
            Draft Koçu
            <span className="ai-badge">Live</span>
          </div>

          <select className="ai-side" value={side} onChange={e => setSide(e.target.value as 'blue' | 'red')}>
            <option value="blue">🔵 Blue Side</option>
            <option value="red">🔴 Red Side</option>
          </select>

          <div className="ai-dots">
            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span className={`ai-dot ${scoutReady ? 'd-ok' : 'd-no'}`} />Scout</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span className={`ai-dot ${metaStatus === 'ready' ? 'd-ok' : metaStatus === 'loading' ? 'd-ld' : 'd-no'}`} />Meta{metaStatus === 'ready' ? ` (${metaGames})` : ''}</span>
            {metaStatus !== 'loading' && <span onClick={loadMeta} style={{ cursor: 'pointer', color: '#C89B3C' }}>↻</span>}
          </div>

          {messages.length > 0 && <button className="ai-clr" onClick={clearChat}>Temizle</button>}
        </div>

        {/* Chat Area */}
        <div className="ai-chat" ref={scrollRef}>
          {messages.length === 0 && !loading && !error && (
            <div className="ai-empty">
              <div className="ai-empty-ico">🤖</div>
              <div className="ai-empty-t">Draft Koçu Hazır</div>
              <div className="ai-empty-d">
                Side'ını seç ve "Analiz Et" bas. Draft değiştikçe tekrar bas — koç güncel duruma göre yeni öneriler verecek.
                {!scoutReady && <span style={{ display: 'block', marginTop: 6, color: '#E84057' }}>⚠ Scout verisi yüklenmemiş.</span>}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className="ai-msg">
              <div className="ai-msg-hdr">
                <span className="ai-msg-phase">{msg._phase || `Analiz #${i + 1}`}</span>
                {msg._timestamp && <span className="ai-msg-time">{new Date(msg._timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>}
              </div>
              <div className="ai-msg-body">
                {/* Analysis */}
                <div className="ai-an">{msg.analysis}</div>

                {/* Strategy */}
                {msg.draftStrategy && (
                  <div className="ai-str">
                    <div className="ai-str-lbl">🎯 Strateji</div>
                    {msg.draftStrategy}
                  </div>
                )}

                {/* Ban Recommendations */}
                {msg.banRecommendations?.length > 0 && (
                  <div>
                    <div className="ai-sl">🚫 Ban<div className="ai-sl-line" /></div>
                    {msg.banRecommendations.map((ban, j) => (
                      <div key={j} className="ai-rec">
                        <img src={champImg(ban.champion)} className="ai-rec-img" alt={ban.champion} style={{ borderColor: 'rgba(232,64,87,0.25)' }} onError={(e: any) => { e.target.src = '/logo.png'; }} />
                        <div className="ai-rec-mid">
                          <div className="ai-rec-nm">{ban.champion}</div>
                          <div className="ai-rec-rs">{ban.reason}</div>
                          {ban.targetPlayer && <div className="ai-rec-tgt">vs {ban.targetPlayer}</div>}
                        </div>
                        <div className="ai-rec-conf" style={{ color: confColor(ban.confidence) }}>{ban.confidence}</div>
                        {onPlaceChampion && <button className="ai-rec-apply" onClick={() => handleApplyBan(ban.champion)}>Ban</button>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Pick Recommendations */}
                {msg.pickRecommendations?.length > 0 && (
                  <div>
                    <div className="ai-sl">✓ Pick<div className="ai-sl-line" /></div>
                    {msg.pickRecommendations.map((pick, j) => (
                      <div key={j} className="ai-rec">
                        <img src={champImg(pick.champion)} className="ai-rec-img" alt={pick.champion} style={{ borderColor: 'rgba(5,150,170,0.25)' }} onError={(e: any) => { e.target.src = '/logo.png'; }} />
                        <div className="ai-rec-mid">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span className="ai-rec-nm">{pick.champion}</span>
                            <span className="ai-rec-role">{roleIcon[pick.role] || ''} {pick.role}</span>
                          </div>
                          <div className="ai-rec-rs">{pick.reason}</div>
                          <div className="ai-tags">
                            {pick.synergyWith?.map((s, k) => <span key={k} className="ai-tg ai-tg-s">+{s}</span>)}
                            {pick.counters?.map((c, k) => <span key={k} className="ai-tg ai-tg-c">▼{c}</span>)}
                          </div>
                        </div>
                        <div className="ai-rec-conf" style={{ color: confColor(pick.confidence) }}>{pick.confidence}</div>
                        {onPlaceChampion && <button className="ai-rec-apply" onClick={() => handleApplyPick(pick.champion, pick.role)}>Pick</button>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Next Step Advice */}
                {msg.nextStepAdvice && (
                  <div className="ai-nxt">
                    <div className="ai-nxt-lbl">→ Sonraki Adım</div>
                    {msg.nextStepAdvice}
                  </div>
                )}

                {/* Warnings */}
                {msg.warnings?.length > 0 && (
                  <div>
                    {msg.warnings.map((w, j) => (
                      <div key={j} className="ai-wrn"><span className="ai-wrn-b">⚠</span>{w}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Loading bubble */}
          {loading && (
            <div className="ai-loading-msg">
              <div className="ai-ld-spin" />
              <div className="ai-ld-txt">{loadingTexts[loadingIdx]}</div>
            </div>
          )}

          {/* Error */}
          {error && <div className="ai-err">⚠ {error}</div>}
        </div>

        {/* Bottom Bar */}
        <div className="ai-btm">
          <button className="ai-go" onClick={analyze} disabled={loading}>
            {loading ? <><div className="ai-spin" /> Düşünüyor...</> : messages.length === 0 ? <>⚡ İlk Analiz</> : <>⚡ Güncelle</>}
          </button>
        </div>
      </div>
    </>
  );
}
