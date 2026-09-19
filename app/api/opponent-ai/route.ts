// /app/api/opponent-ai/route.ts
// Five-point pre-match brief on an opponent, written by Gemini from the stats
// the Prep page has already computed. The page sends numbers, not raw
// Leaguepedia rows, so the prompt stays small and the model can't invent data
// it wasn't given.
import { NextResponse } from 'next/server';
import { TEAM_NAME } from '../../../lib/team';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

const SYSTEM = `You are the analyst for the League of Legends team ${TEAM_NAME}.
You write a short pre-match brief about an opponent for the coach and players.
Use ONLY the data provided. If the sample is small (under 8 games), say so once.
Be concrete: name champions, sides and players. No generic advice.
Write in English.`;

export async function POST(request: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ error: 'GEMINI_API_KEY is not set' }, { status: 500 });

  const b = await request.json().catch(() => null);
  if (!b?.opponent || !b?.stats) return NextResponse.json({ error: 'opponent and stats required' }, { status: 400 });

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM }] },
      contents: [{ parts: [{ text: `Opponent: ${b.opponent}\n\nData:\n${JSON.stringify(b.stats)}` }] }],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            headline: { type: 'string', description: 'One sentence: how this team plays. Max 20 words.' },
            points: {
              type: 'array',
              description: 'Exactly 5 points',
              items: {
                type: 'object',
                properties: {
                  kind: { type: 'string', enum: ['ban', 'watch', 'exploit', 'draft', 'player'] },
                  text: { type: 'string', description: 'Max 25 words' },
                },
                required: ['kind', 'text'],
              },
            },
            sampleWarning: { type: 'string', description: 'Empty if the sample is fine' },
          },
          required: ['headline', 'points'],
        },
      },
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    console.error('[opponent-ai] Gemini', res.status, t.slice(0, 300));
    return NextResponse.json(
      { error: res.status === 429 ? 'AI is rate limited — try again in 30 seconds.' : `AI error (${res.status})` },
      { status: 502 },
    );
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
  try {
    return NextResponse.json({ success: true, brief: JSON.parse(text) });
  } catch {
    return NextResponse.json({ error: 'AI returned an unreadable answer' }, { status: 502 });
  }
}
