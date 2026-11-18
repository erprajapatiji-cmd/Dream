const API_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ball-by-ball-api`;

export interface MatchFilters {
  format?: string;
  season?: string;
  team?: string;
  date_from?: string;
  date_to?: string;
  search?: string;
  page?: number;
  limit?: number;
  [key: string]: string | number | undefined;
}

export interface PlayerFilters {
  match_id?: string;
  format?: string;
  season?: string;
  team?: string;
  date_from?: string;
  date_to?: string;
  [key: string]: string | number | undefined;
}

function buildQuery(filters: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchMatches(apiKey: string, filters?: MatchFilters) {
  const qs = filters ? buildQuery(filters) : "";
  const res = await fetch(`${API_BASE}/matches${qs}`, {
    headers: { "X-API-Key": apiKey },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  const data = await res.json();
  if (!data.matches) throw new Error("Unexpected response format");
  return { matches: data.matches as unknown[], pagination: data.pagination };
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

export async function fetchPlayerMatches(apiKey: string, playerName: string, filters?: PlayerFilters) {
  const qs = filters ? buildQuery(filters) : "";
  const res = await fetch(`${API_BASE}/players/${encodeURIComponent(playerName)}/matches${qs}`, {
    headers: { "X-API-Key": apiKey },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  const data = await res.json();
  if (!data.matches) throw new Error("Unexpected response format");
  return { matches: data.matches, filters: data.filters };
}

export async function fetchPlayerStats(apiKey: string, playerName: string, filters?: PlayerFilters) {
  const qs = filters ? buildQuery(filters) : "";
  const res = await fetch(`${API_BASE}/players/${encodeURIComponent(playerName)}/stats${qs}`, {
    headers: { "X-API-Key": apiKey },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  const data = await res.json();
  if (!data.stats) throw new Error("Unexpected response format");
  return { stats: data.stats, filters: data.filters };
}

export async function fetchPlayerMatchBalls(apiKey: string, playerName: string, matchId: string, limit?: number, offset?: number) {
  const qs = buildQuery({ limit, offset });
  const res = await fetch(`${API_BASE}/players/${encodeURIComponent(playerName)}/matches/${matchId}/balls${qs}`, {
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
