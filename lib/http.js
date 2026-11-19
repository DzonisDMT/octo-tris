import { LeaderboardError } from './leaderboard.js';

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(status).json(body);
    return;
  }
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

export function clientIp(req) {
  const headers = req.headers || {};
  const real = headers['x-real-ip'];
  if (real) return String(Array.isArray(real) ? real[0] : real).split(',')[0].trim() || 'unknown';
  const forwarded = headers['x-forwarded-for'];
  const value = Array.isArray(forwarded) ? forwarded.join(',') : String(forwarded || '');
  const parts = value.split(',').map(part => part.trim()).filter(Boolean);
  if (parts.length) return parts[parts.length - 1];
  return req.socket && req.socket.remoteAddress || 'unknown';
}

async function readRaw(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const text = await readRaw(req);
  if (!text) return {};
  if (text.length > 4000) throw new LeaderboardError('That request was too large.', 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new LeaderboardError('The leaderboard could not read that request.');
  }
}

function periodFrom(req) {
  if (req.query && req.query.period) return String(req.query.period);
  try {
    return new URL(req.url || '/', 'http://localhost').searchParams.get('period') || 'daily';
  } catch {
    return 'daily';
  }
}

export function createHandlers(getService) {
  async function run(req, res, action) {
    try {
      const service = await getService();
      if (!service) {
        send(res, 503, { message: 'The global leaderboard is not set up yet.' });
        return;
      }
      if (action === 'leaderboard') {
        if (req.method !== 'GET') {
          send(res, 405, { message: 'That action is not available.' });
          return;
        }
        send(res, 200, await service.leaderboard(periodFrom(req)));
        return;
      }
      if (req.method !== 'POST') {
        send(res, 405, { message: 'That action is not available.' });
        return;
      }
      const body = await readBody(req);
      const ip = clientIp(req);
      if (action === 'player') {
        send(res, 200, await service.register({ nickname: body.nickname, octavioId: body.octavioId, ip }));
        return;
      }
      send(res, 200, await service.submit({
        octavioId: body.octavioId,
        score: body.score,
        lines: body.lines,
        level: body.level,
        ip
      }));
    } catch (error) {
      const status = error && error.status ? error.status : 500;
      const message = error && error.status ? error.message : 'The global leaderboard is unavailable right now.';
      send(res, status, { message });
    }
  }

  return {
    player: (req, res) => run(req, res, 'player'),
    score: (req, res) => run(req, res, 'score'),
    leaderboard: (req, res) => run(req, res, 'leaderboard')
  };
}
