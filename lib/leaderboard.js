import { createHash } from 'node:crypto';

// Global OCTO-TRIS board.
// Daily scores start at 00:00 UTC. Weekly scores start Monday 00:00 UTC.
// Older scores stay on the all-time board; the weekly tab is a window, not a delete.

function ipKey(ip) {
  return createHash('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 20);
}

export class LeaderboardError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'LeaderboardError';
    this.status = status;
  }
}

const ID_RE = /^OCTO-[A-Z0-9]{5}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const SCORE_PATH_RE = /^scores\/(\d{4})\/(\d{2})\/(\d{2})\/(\d+)_(\d{7})_(\d{5})_(\d{4})_(OCTO-[A-Z0-9]{5}-[A-Z0-9]{4}-[A-Z0-9]{4})$/;

export function cleanNickname(value) {
  const name = String(value ?? '').trim().replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, ' ').slice(0, 16);
  if (!name) throw new LeaderboardError('Enter a nickname using letters, numbers, spaces, _ or -.');
  return name;
}

export function cleanOctavioId(value) {
  if (value == null || value === '') return null;
  const id = String(value).trim().toUpperCase();
  if (!ID_RE.test(id)) throw new LeaderboardError('That Octavio ID does not look right. Play a game to create a new one.');
  return id;
}

export function maskOctavioId(id) {
  return String(id).slice(0, 9) + '…' + String(id).slice(-4);
}

export function maxPlausibleScore(lines) {
  if (lines <= 0) return 4000;
  return Math.min(1000000, 8000 + lines * 2000 + lines * lines * 6);
}

export function assertPlausible({ score, lines, level }) {
  if (!Number.isInteger(score) || !Number.isInteger(lines) || !Number.isInteger(level)) {
    throw new LeaderboardError('That score could not be saved.');
  }
  if (score < 1 || score > 1000000 || lines < 0 || lines > 5000 || level < 1 || level > 500) {
    throw new LeaderboardError('That score could not be saved.');
  }
  if (level !== 1 + Math.floor(lines / 10)) throw new LeaderboardError('That score could not be saved.');
  if (score > maxPlausibleScore(lines)) throw new LeaderboardError('That score could not be saved.');
}

export function periodStart(period, now) {
  const t = new Date(now);
  if (Number.isNaN(t.getTime())) throw new LeaderboardError('Choose daily, weekly, or all time.');
  if (period === 'all') return null;
  const midnight = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  if (period === 'daily') return midnight;
  if (period === 'weekly') {
    const sinceMonday = (t.getUTCDay() + 6) % 7;
    midnight.setUTCDate(midnight.getUTCDate() - sinceMonday);
    return midnight;
  }
  throw new LeaderboardError('Choose daily, weekly, or all time.');
}

export function resetLabel(period) {
  if (period === 'daily') return 'Day resets 00:00 UTC';
  if (period === 'weekly') return 'Week resets Monday 00:00 UTC';
  if (period === 'all') return 'All time, no reset';
  throw new LeaderboardError('Choose daily, weekly, or all time.');
}

function dayKey(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

export function scorePath(date, score, lines, level, id) {
  const pad = (n, w) => String(n).padStart(w, '0');
  return `scores/${dayKey(date)}/${date.getTime()}_${pad(score, 7)}_${pad(lines, 5)}_${pad(level, 4)}_${id}`;
}

export function parseScorePath(pathname) {
  const match = SCORE_PATH_RE.exec(pathname);
  if (!match) return null;
  return {
    createdAt: Number(match[4]),
    score: Number(match[5]),
    lines: Number(match[6]),
    level: Number(match[7]),
    octavioId: match[8]
  };
}

function dayPrefixes(period, now) {
  if (period === 'all') return ['scores/'];
  const start = periodStart(period, now);
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const prefixes = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) prefixes.push(`scores/${dayKey(new Date(t))}/`);
  return prefixes;
}

function newOctavioId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `OCTO-${hex.slice(0, 5)}-${hex.slice(5, 9)}-${hex.slice(9, 13)}`;
}

function playerPath(id) {
  return `players/${id}`;
}

function hourStamp(date) {
  return date.toISOString().slice(0, 13);
}

export function createMemoryStore() {
  const files = new Map();
  return {
    async putIfAbsent(path, body) {
      if (files.has(path)) return false;
      files.set(path, String(body));
      return true;
    },
    async put(path, body) {
      files.set(path, String(body));
    },
    async getJson(path) {
      const body = files.get(path);
      if (!body) return null;
      return JSON.parse(body);
    },
    async list(prefix) {
      return [...files.keys()].filter(path => path.startsWith(prefix)).map(pathname => ({ pathname }));
    }
  };
}

export function createLeaderboard(store, options = {}) {
  const now = options.now || (() => new Date());
  const scoreGapMs = options.scoreGapMs || 8000;
  const scoresPerHour = options.scoresPerHour || 30;
  const scoresPerIpHour = options.scoresPerIpHour || 60;
  const registersPerIpHour = options.registersPerIpHour || 12;

  async function countPrefix(prefix) {
    const items = await store.list(prefix);
    return items.length;
  }

  async function assertUnder(prefix, limit, message) {
    if (await countPrefix(prefix) >= limit) throw new LeaderboardError(message, 429);
  }

  async function mark(prefix) {
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    await store.putIfAbsent(`${prefix}${stamp}`, '{}');
  }

  async function register({ nickname, octavioId, ip }) {
    const name = cleanNickname(nickname);
    const requested = cleanOctavioId(octavioId);
    const addr = ipKey(ip);
    if (requested) {
      const existing = await store.getJson(playerPath(requested));
      if (existing) {
        await store.put(playerPath(requested), JSON.stringify({ ...existing, nickname: name }));
        return publicPlayer(requested, name);
      }
      await assertUnder(`ratelimit/register/${addr}/${hourStamp(now())}/`, registersPerIpHour, 'Too many new players from this network. Try again in a little while.');
      const created = await store.putIfAbsent(playerPath(requested), JSON.stringify({ nickname: name, createdAt: now().toISOString() }));
      if (!created) {
        const again = await store.getJson(playerPath(requested));
        if (again) await store.put(playerPath(requested), JSON.stringify({ ...again, nickname: name }));
      } else {
        await mark(`ratelimit/register/${addr}/${hourStamp(now())}/`);
      }
      return publicPlayer(requested, name);
    }
    await assertUnder(`ratelimit/register/${addr}/${hourStamp(now())}/`, registersPerIpHour, 'Too many new players from this network. Try again in a little while.');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = newOctavioId();
      const created = await store.putIfAbsent(playerPath(id), JSON.stringify({ nickname: name, createdAt: now().toISOString() }));
      if (!created) continue;
      await mark(`ratelimit/register/${addr}/${hourStamp(now())}/`);
      return publicPlayer(id, name);
    }
    throw new LeaderboardError('The global leaderboard is unavailable right now.', 503);
  }

  async function submit({ octavioId, score, lines, level, ip }) {
    const id = cleanOctavioId(octavioId);
    if (!id) throw new LeaderboardError('Play a game to create your Octavio ID, then send the score again.');
    const player = await store.getJson(playerPath(id));
    if (!player) throw new LeaderboardError('Play a game to create your Octavio ID, then send the score again.');
    const entry = {
      score: normalizeInt(score),
      lines: normalizeInt(lines),
      level: normalizeInt(level)
    };
    assertPlausible(entry);
    const at = now();
    const addr = ipKey(ip);
    const hour = hourStamp(at);
    await assertUnder(`ratelimit/score-hour/${id}/${hour}/`, scoresPerHour, 'Too many scores from this player. Try again in a little while.');
    await assertUnder(`ratelimit/score-ip/${addr}/${hour}/`, scoresPerIpHour, 'Too many scores from this network. Try again in a little while.');
    const slot = Math.floor(at.getTime() / scoreGapMs);
    const reserved = await store.putIfAbsent(`ratelimit/score-gap/${id}/${slot}`, '{}');
    if (!reserved) throw new LeaderboardError('Please wait a few seconds before sending another score.', 429);
    await store.put(scorePath(at, entry.score, entry.lines, entry.level, id), JSON.stringify({
      score: entry.score,
      lines: entry.lines,
      level: entry.level,
      createdAt: at.toISOString()
    }));
    await mark(`ratelimit/score-hour/${id}/${hour}/`);
    await mark(`ratelimit/score-ip/${addr}/${hour}/`);
    return { ok: true, maskedId: maskOctavioId(id), score: entry.score };
  }

  async function leaderboard(period) {
    const at = now();
    const label = resetLabel(period);
    const start = periodStart(period, at);
    const entries = [];
    for (const prefix of dayPrefixes(period, at)) {
      const blobs = await store.list(prefix);
      for (const blob of blobs) {
        const parsed = parseScorePath(blob.pathname);
        if (!parsed) continue;
        if (start && parsed.createdAt < start.getTime()) continue;
        entries.push(parsed);
      }
    }
    const best = new Map();
    for (const entry of entries) {
      const prev = best.get(entry.octavioId);
      if (!prev || entry.score > prev.score || (entry.score === prev.score && entry.createdAt < prev.createdAt)) best.set(entry.octavioId, entry);
    }
    const ranked = [...best.values()].sort((a, b) => b.score - a.score || a.createdAt - b.createdAt).slice(0, 20);
    const rows = await Promise.all(ranked.map(async (entry, index) => {
      const player = await store.getJson(playerPath(entry.octavioId));
      return {
        place: index + 1,
        nickname: player && player.nickname ? player.nickname : 'Player',
        maskedId: maskOctavioId(entry.octavioId),
        score: entry.score
      };
    }));
    return { period, reset: label, rows };
  }

  return { register, submit, leaderboard };
}

function publicPlayer(id, nickname) {
  return { octavioId: id, nickname, maskedId: maskOctavioId(id) };
}

function normalizeInt(value) {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
  throw new LeaderboardError('That score could not be saved.');
}
