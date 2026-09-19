import { NextResponse } from "next/server";

const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000;

export async function POST(req: Request) {
  try {
    const { playerName } = await req.json();
    if (!playerName) {
      return NextResponse.json({ error: "playerName gerekli" }, { status: 400 });
    }

    const cached = cache.get(playerName);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json(cached.data);
    }

    const API_KEY = process.env.PANDASCORE_API_KEY;
    const headers = {
      "Authorization": `Bearer ${API_KEY}`,
      "Accept": "application/json",
    };

    // Oyuncuyu bul
    const playerRes = await fetch(
      `https://api.pandascore.co/lol/players?search[name]=${encodeURIComponent(playerName)}&per_page=1`,
      { headers }
    );
    const players = await playerRes.json();

    if (!players?.length) {
      return NextResponse.json({ overallKda: "N/A", winRate: "0%", lastMatches: [], proChampionStats: [] });
    }

    const teamId = players[0].current_team?.id;

    // Maçları çek
    const matchesRes = await fetch(
      `https://api.pandascore.co/lol/matches/past?filter[opponent_id]=${teamId}&per_page=10&sort=-scheduled_at`,
      { headers }
    );
    const matches = await matchesRes.json();

    if (!Array.isArray(matches) || matches.length === 0) {
      return NextResponse.json({ overallKda: "N/A", winRate: "0%", lastMatches: [], proChampionStats: [] });
    }

    let wins = 0;
    const lastMatches = matches.map((match: any) => {
      const win = match.winner_id === teamId;
      if (win) wins++;

      const opponent = match.opponents
        ?.find((o: any) => o.opponent?.id !== teamId)
        ?.opponent?.name || "Unknown";

      return {
        opponent,
        result: win ? "GALİBİYET" : "MAĞLUBİYET",
        champion: "—",
        kda: "—",
        tournament: match.tournament?.name || match.league?.name || match.serie?.name || "TCL",
        date: match.scheduled_at?.split("T")[0] || "",
      };
    });

    const result = {
      overallKda: "—",
      winRate: `${Math.round((wins / lastMatches.length) * 100)}%`,
      lastMatches,
      proChampionStats: [],
    };

    cache.set(playerName, { data: result, timestamp: Date.now() });
    return NextResponse.json(result);

  } catch (err: any) {
    console.error("PandaScore error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}