// /app/api/badges/route.ts
// "New since you last looked" counts for the nav.
//   ?player=NAME   notes tagged with that player (a player's own feed)
//   ?coach=1       every note, plus scrims logged by someone else
//   &review=<ms>   last time this viewer opened Review
//   &games=<ms>    last time this viewer opened Games
// The "last looked" times live in the viewer's browser; this only counts.
import { NextResponse } from 'next/server';
import { KEYS, all, allAcross } from '../../../lib/store';
import type { ScrimGame, Vod, VodNote } from '../../../lib/hub';

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const player = sp.get('player');
  const coach = sp.get('coach') === '1';
  const me = sp.get('me') ?? '';
  const reviewSince = Number(sp.get('review')) || Date.now();
  const gamesSince = Number(sp.get('games')) || Date.now();

  const vods = await all<Vod>(KEYS.vods);
  const notes = await allAcross<VodNote>(vods.map(v => KEYS.notes(v.id)));
  const review = notes.filter(n =>
    n.createdAt > reviewSince
    && n.author !== me   // your own notes aren't news to you
    && (coach || (player && n.players.some(p => p.toLowerCase() === player.toLowerCase()))),
  ).length;

  let games = 0;
  if (coach) {
    const scrims = await all<ScrimGame>(KEYS.scrims);
    games = scrims.filter(g => g.createdAt > gamesSince && g.createdBy !== me).length;
  }

  return NextResponse.json({ review, games });
}
