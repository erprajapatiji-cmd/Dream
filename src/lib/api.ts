const API_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ball-by-ball-api`;

export async function fetchMatches(apiKey: string) {
  const res = await fetch(`${API_BASE}/matches`, {
    headers: { "X-API-Key": apiKey },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  const data = await res.json();
  if (!data.matches) throw new Error("Unexpected response format");
  return data.matches;
}

export async function fetchMatchInnings(apiKey: string, matchId: string) {
  const res = await fetch(`${API_BASE}/matches/${matchId}/innings`, {
    headers: { "X-API-Key": apiKey },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  const data = await res.json();
  if (!data.match) throw new Error("Unexpected response format");
  return { match: data.match, innings: data.innings || [] };
}

export async function fetchInningsBalls(apiKey: string, matchId: string, inningsNo: number) {
  const res = await fetch(
    `${API_BASE}/matches/${matchId}/innings/${inningsNo}/balls`,
    { headers: { "X-API-Key": apiKey } }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  const data = await res.json();
  if (!data.balls) throw new Error("Unexpected response format");
  return data.balls;
}

export async function fetchMatchBalls(apiKey: string, matchId: string) {
  const res = await fetch(`${API_BASE}/matches/${matchId}/balls`, {
    headers: { "X-API-Key": apiKey },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  const data = await res.json();
  if (!data.balls) throw new Error("Unexpected response format");
  return data.balls;
}

export async function fetchPlayerMatches(apiKey: string, playerName: string) {
  const res = await fetch(`${API_BASE}/players/${encodeURIComponent(playerName)}/matches`, {
    headers: { "X-API-Key": apiKey },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  const data = await res.json();
  if (!data.matches) throw new Error("Unexpected response format");
  return data.matches;
}

export async function fetchPlayerStats(apiKey: string, playerName: string) {
  const res = await fetch(`${API_BASE}/players/${encodeURIComponent(playerName)}/stats`, {
    headers: { "X-API-Key": apiKey },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  const data = await res.json();
  if (!data.stats) throw new Error("Unexpected response format");
  return data.stats;
}

export async function fetchPlayerMatchBalls(apiKey: string, playerName: string, matchId: string) {
  const res = await fetch(`${API_BASE}/players/${encodeURIComponent(playerName)}/matches/${matchId}/balls`, {
    headers: { "X-API-Key": apiKey },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  const data = await res.json();
  if (!data.balls) throw new Error("Unexpected response format");
  return data.balls;
}
