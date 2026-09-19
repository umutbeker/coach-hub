// /app/api/draft-ai/route.ts
// Canlı Draft Koçu — Gemini 2.5 Flash
import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const META_KEY = 'draft:meta';

const SYSTEM_PROMPT = `Sen Ozarox Esports'un profesyonel LoL draft koçusun.

META ŞAMPİYON = ÇOK OYNANAN ŞAMPİYON. Bu en önemli kural:
- Bir şampiyon meta ise PRO SAHNESDE ÇOK PICK'LENİR (yüksek pick sayısı + yüksek presence)
- 5-6 maç oynanıp %75 WR olan şampiyon META DEĞİLDİR, sadece az sample size
- 15+ maç oynanıp %55 WR olan şampiyon META'DIR çünkü herkes alıyor ve hala kazanıyor
- ÖNCELİK: pick sayısı > presence > WR. WR tek başına bir şey ifade etmez

PICK ÖNCELİK SIRASI:
1. EN ÇOK PICK'LENEN şampiyonlar = meta (herkes alıyorsa güçlüdür)
2. First pick'te R1 verisinde en çok alınan şampiyonları öner (FLEX/OP)
3. First pick'te ASLA support/niche/az oynanan şampiyon önerme
4. Late pick'te R3 verisinde çok alınan counter şampiyonları öner
5. Az oynanan ama yüksek WR şampiyonları SADECE "ek not" olarak belirt, asıl öneri yapma

BAN KARARI:
- Rakip oynuyor + meta'da çok pick'leniyor = BANLA
- Rakip oynuyor ama meta'da az alınıyor = banlama (zaten zayıf)
- Rakip oynamıyor = banlama (meta'da güçlü olsa bile)

RAKİP TAHMİNİ:
- Rakibin pool'una ve meta'ya bakarak sonraki hamlelerini tahmin et
- "Rakip büyük ihtimalle X alacak çünkü pool'unda var ve meta'da güçlü" gibi
- warnings'te rakibin yapabileceği tehlikeli hamleleri belirt

FORMAT:
- Türkçe, kısa ve öz
- Ban 3, Pick 3
- reason MAX 12 kelime
- analysis MAX 2 cümle
- draftStrategy MAX 1 cümle
- warnings MAX 2 madde (rakibin olası tehlikeli hamleleri)
- nextStepAdvice MAX 2 cümle (sonraki adımda ne yapmalıyız + rakip ne yapabilir)

JSON formatında yanıtla.`;

export async function POST(request: Request) {
  try {
    if (!GEMINI_API_KEY) {
      return NextResponse.json({ error: 'GEMINI_API_KEY eksik.' }, { status: 500 });
    }

    const body = await request.json();
    const { draftState, scoutData, side, conversationHistory } = body;

    // ── Meta veri oku ──
    let metaData: any = null;
    try {
      const cached = await redis.get(META_KEY);
      if (cached) metaData = typeof cached === 'string' ? JSON.parse(cached) : cached;
    } catch {}

    // ── Draft durumunu analiz et ──
    const ourSide = side === 'blue' ? 'blue' : 'red';
    const theirSide = side === 'blue' ? 'red' : 'blue';
    const ourPicks = (draftState?.picks?.[ourSide] || []).filter(Boolean);
    const theirPicks = (draftState?.picks?.[theirSide] || []).filter(Boolean);
    const ourBans = (draftState?.bans?.[ourSide] || []).filter(Boolean);
    const theirBans = (draftState?.bans?.[theirSide] || []).filter(Boolean);
    const allBans = [...ourBans, ...theirBans];
    const allPicks = [...ourPicks, ...theirPicks];
    const unavailable = [...allBans, ...allPicks];

    const ourBansLeft = 5 - ourBans.length;
    const ourPicksLeft = 5 - ourPicks.length;

    // Faz belirle
    let currentPhase = '';
    const totalBans = allBans.length;
    const totalPicks = allPicks.length;
    if (totalBans < 6 && totalPicks === 0) currentPhase = '1. Ban Fazı';
    else if (totalBans >= 6 && totalPicks < 6) currentPhase = 'Pick Fazı';
    else if (totalPicks >= 3 && totalBans < 10) currentPhase = '2. Ban Fazı';
    else if (totalBans >= 10) currentPhase = 'Son Pick\'ler';
    else currentPhase = 'Draft devam ediyor';

    // Meta'dan şampiyonların rol bilgisini al
    const champRoleInfo = (name: string): string => {
      if (!metaData?.champions) return '';
      const champ = metaData.champions.find((c: any) => c.name === name);
      if (!champ?.roles?.length) return '';
      return champ.roles.map((r: any) => `${r.role}(${r.games}m %${r.winRate})`).join('/');
    };

    // ── Prompt oluştur ──
    let userMessage = '';

    userMessage += `## DURUM\n`;
    userMessage += `Biz: ${side === 'blue' ? 'BLUE SIDE (ilk pick)' : 'RED SIDE (counter-pick)'}\n`;
    userMessage += `Faz: ${currentPhase}\n`;
    userMessage += `Bizim kalan ban: ${ourBansLeft} | Kalan pick: ${ourPicksLeft}\n\n`;

    userMessage += `## DRAFT BOARD\n`;
    userMessage += `Bizim pick'ler: ${ourPicks.length > 0 ? ourPicks.map((p: string) => `${p} [${champRoleInfo(p)}]`).join(', ') : 'henüz yok'}\n`;
    userMessage += `Rakip pick'ler: ${theirPicks.length > 0 ? theirPicks.map((p: string) => `${p} [${champRoleInfo(p)}]`).join(', ') : 'henüz yok'}\n`;
    userMessage += `Bizim banlar: ${ourBans.length > 0 ? ourBans.join(', ') : 'yok'}\n`;
    userMessage += `Rakip banlar: ${theirBans.length > 0 ? theirBans.join(', ') : 'yok'}\n`;
    userMessage += `\nKULLANILAMAZ: ${unavailable.length > 0 ? unavailable.join(', ') : 'yok'}\n\n`;

    // Durum bilgisi
    if (ourBansLeft === 0 && ourPicksLeft === 0) {
      userMessage += `⚠ DRAFT'IMIZ TAMAMLANDI. Ban/pick önerme, sadece analiz ve strateji ver.\n\n`;
    } else if (ourBansLeft === 0) {
      userMessage += `⚠ BAN HAKKIMIZ BİTTİ — ban önerme! Sadece pick öner.\n\n`;
    } else if (ourPicksLeft === 0) {
      userMessage += `⚠ TÜM PİCK'LERİMİZ TAMAM — pick önerme! Sadece ban öner.\n\n`;
    }

    // Önceki konuşma context'i
    if (conversationHistory && conversationHistory.length > 0) {
      userMessage += `## ÖNCEKİ ANALİZLER (context)\n`;
      conversationHistory.slice(-3).forEach((msg: any, i: number) => {
        userMessage += `Analiz ${i + 1}: ${msg.analysis || ''}\n`;
        if (msg.banRecommendations?.length > 0) {
          userMessage += `  Ban önerileri: ${msg.banRecommendations.map((b: any) => b.champion).join(', ')}\n`;
        }
        if (msg.pickRecommendations?.length > 0) {
          userMessage += `  Pick önerileri: ${msg.pickRecommendations.map((p: any) => p.champion).join(', ')}\n`;
        }
      });
      userMessage += `\nDraft değişti, önceki önerileri güncelle. Zaten alınmış/banlanmış şampiyonları tekrar önerme.\n\n`;
    }

    // Rakip scout
    if (scoutData) {
      userMessage += `## RAKİP: ${scoutData.opponent}\n`;
      if (scoutData.players?.length > 0) {
        scoutData.players.forEach((player: any) => {
          userMessage += `${player.name} (%${player.winRate} WR, ${player.games} maç): `;
          if (player.topChamps?.length > 0) {
            userMessage += player.topChamps.map((ch: any) => `${ch.name}(${ch.games}m %${ch.winRate})`).join(', ');
          }
          userMessage += '\n';
        });
      }
      if (scoutData.recentMatches?.length > 0) {
        userMessage += '\nSon maçlar: ';
        scoutData.recentMatches.slice(0, 3).forEach((m: any) => {
          const picks = m.teamIsBlue ? m.bluePicks : m.redPicks;
          userMessage += `${m.result} vs ${m.opponent} [${picks?.join(',')}] `;
        });
      }
      userMessage += '\n\n';
    }

    // SoloQ
    if (draftState?.soloq && Object.keys(draftState.soloq).length > 0) {
      userMessage += '## SOLOQ\n';
      Object.entries(draftState.soloq).forEach(([name, data]: [string, any]) => {
        if (data && !data.error) {
          userMessage += `${name}: ${data.tier} ${data.rank} — `;
          if (data.topChamps?.length > 0) {
            userMessage += data.topChamps.slice(0, 3).map((c: any) => `${c.name}(%${c.winRate})`).join(', ');
          }
          userMessage += '\n';
        }
      });
      userMessage += '\n';
    }

    // Pro meta
    if (metaData) {
      userMessage += `## PRO META (${metaData.totalGames} maç, LEC/EMEA — son 30 maç)\n`;
      if (metaData.topBanned?.length > 0) {
        userMessage += 'Çok banlanan: ' + metaData.topBanned.slice(0, 8).map((c: any) => `${c.name}(${c.bans}b %${c.banRate})`).join(', ') + '\n';
      }
      if (metaData.topPicked?.length > 0) {
        userMessage += 'Çok pick (META BUNLAR): ' + metaData.topPicked.slice(0, 10).map((c: any) => {
          const roles = c.roles?.map((r: any) => r.role).join('/') || '?';
          return `${c.name}(${c.picks}p %${c.winRate}WR ${roles}${c.isFlex?' FLEX':''})`;
        }).join(', ') + '\n';
      }
      if (metaData.firstPickPriority?.length > 0) {
        userMessage += 'FIRST PICK öncelik: ' + metaData.firstPickPriority.slice(0, 8).map((c: any) => `${c.name}(R1:${c.firstPick} ${c.primaryRole}${c.isFlex?' FLEX':''})`).join(', ') + '\n';
      }
      if (metaData.latePickPriority?.length > 0) {
        userMessage += 'LATE PICK (counter): ' + metaData.latePickPriority.slice(0, 8).map((c: any) => `${c.name}(R3:${c.lastPick} ${c.primaryRole})`).join(', ') + '\n';
      }
      if (metaData.flexPicks?.length > 0) {
        userMessage += 'FLEX pick\'ler: ' + metaData.flexPicks.slice(0, 8).map((c: any) => {
          const roles = c.roles?.map((r: any) => `${r.role}:${r.games}m`).join('/') || '';
          return `${c.name}(${roles})`;
        }).join(', ') + '\n';
      }
      if (metaData.topSynergy?.length > 0) {
        userMessage += 'Synergy ikililer: ' + metaData.topSynergy.slice(0, 8).map((s: any) => `${s.pair}(${s.games}m %${s.winRate}WR)`).join(', ') + '\n';
      }
      userMessage += '\nMETA = ÇOK OYNANAN. Az oynanan ama yüksek WR = meta değil, önerme.\n\n';
    }

    // Son talimat
    userMessage += '## SENDEN BEKLENENLER\n';

    if (ourPicks.length > 0) {
      userMessage += `Bizim pick'ler: ${ourPicks.map((p: string) => `${p}[${champRoleInfo(p)}]`).join(', ')}. Synergy ve comp düşün.\n`;
    }
    if (theirPicks.length > 0) {
      userMessage += `Rakip pick'ler: ${theirPicks.map((p: string) => `${p}[${champRoleInfo(p)}]`).join(', ')}. Counter ve rakibin comp planını tahmin et.\n`;
    }

    userMessage += `
KRİTİK:
1. Ban hakkımız ${ourBansLeft} — ${ourBansLeft === 0 ? 'BAN ÖNERME!' : `${ourBansLeft} ban öner`}
2. Pick hakkımız ${ourPicksLeft} — ${ourPicksLeft === 0 ? 'PICK ÖNERME!' : `${ourPicksLeft} pick öner`}
3. Her pick'in hangi ROL için olduğunu belirt (meta role verisine bak, slot değil)
4. Flex pick'lerin flex olduğunu ve hangi rollerde oynanabileceğini belirt
5. Rakibin bir sonraki hamlesini TAHMİN ET (pool + meta bakarak)
6. warnings = rakibin yapabileceği tehlikeli hamleler
7. KULLANILAMAZ listesindeki şampiyonları ASLA önerme

JSON formatında yanıtla.`;

    // ── Gemini API ──
    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent`;

    const geminiResponse = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY! },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ parts: [{ text: userMessage }] }],
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'object',
            properties: {
              analysis: { type: 'string', description: 'Mevcut draft durumunun kısa analizi, MAX 2 cümle' },
              banRecommendations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    champion: { type: 'string' },
                    reason: { type: 'string', description: 'MAX 12 kelime' },
                    confidence: { type: 'integer' },
                    targetPlayer: { type: 'string' }
                  },
                  required: ['champion', 'reason', 'confidence']
                }
              },
              pickRecommendations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    champion: { type: 'string' },
                    role: { type: 'string', enum: ['top', 'jungle', 'mid', 'adc', 'support'] },
                    reason: { type: 'string', description: 'MAX 12 kelime' },
                    confidence: { type: 'integer' },
                    synergyWith: { type: 'array', items: { type: 'string' } },
                    counters: { type: 'array', items: { type: 'string' } }
                  },
                  required: ['champion', 'role', 'reason', 'confidence']
                }
              },
              warnings: { type: 'array', items: { type: 'string' } },
              draftStrategy: { type: 'string', description: 'MAX 1 cümle' },
              nextStepAdvice: { type: 'string', description: 'Bir sonraki adımda ne yapmalıyız, MAX 2 cümle' }
            },
            required: ['analysis', 'banRecommendations', 'pickRecommendations', 'draftStrategy']
          }
        }
      }),
    });

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      console.error('[draft-ai] Gemini hata:', geminiResponse.status, errText);
      let errMsg = `Gemini hatası (${geminiResponse.status}).`;
      if (geminiResponse.status === 429) errMsg = 'Rate limit — 30 saniye bekle.';
      try { const j = JSON.parse(errText); if (j.error?.message) errMsg += ' ' + j.error.message; } catch {}
      return NextResponse.json({ error: errMsg }, { status: 500 });
    }

    const geminiData = await geminiResponse.json();
    const textContent = geminiData.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';

    if (!textContent) {
      return NextResponse.json({ error: 'AI yanıt vermedi' }, { status: 500 });
    }

    let aiResult;
    try {
      aiResult = JSON.parse(textContent.replace(/```json\s*|```\s*/g, '').trim());
    } catch {
      aiResult = { analysis: textContent, banRecommendations: [], pickRecommendations: [], warnings: [], draftStrategy: '', nextStepAdvice: '' };
    }

    // Faz bilgisini ekle
    aiResult._phase = currentPhase;
    aiResult._timestamp = Date.now();
    aiResult._ourPicks = ourPicks;
    aiResult._theirPicks = theirPicks;

    return NextResponse.json({ success: true, result: aiResult, timestamp: Date.now() });
  } catch (e: any) {
    console.error('[draft-ai] hata:', e);
    return NextResponse.json({ error: e.message || 'AI hatası' }, { status: 500 });
  }
}
