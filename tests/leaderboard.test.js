import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createHandlers } from '../lib/http.js';
import {
  createLeaderboard,
  createMemoryStore,
  maskOctavioId,
  periodStart
} from '../lib/leaderboard.js';

const KEPT_ID = 'OCTO-4CD23-BF3B-9AS2';

function boardAt(startMs) {
  let nowMs = startMs;
  const store = createMemoryStore();
  const service = createLeaderboard(store, { now: () => new Date(nowMs), legacyScores: [] });
  return {
    service,
    set(ms) { nowMs = ms; }
  };
}

function response() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

async function call(handler, { method = 'GET', url = '/', body, headers = {} } = {}) {
  const req = { method, url, headers, body };
  const res = response();
  await handler(req, res);
  return res;
}

test('weekly window opens Monday 00:00 UTC and daily opens 00:00 UTC', () => {
  const monday = new Date('2026-11-16T00:00:00.000Z');
  assert.equal(periodStart('weekly', monday).toISOString(), '2026-11-16T00:00:00.000Z');
  assert.equal(periodStart('weekly', new Date('2026-11-19T21:30:00.000Z')).toISOString(), '2026-11-16T00:00:00.000Z');
  assert.equal(periodStart('weekly', new Date('2026-11-15T23:59:59.999Z')).toISOString(), '2026-11-09T00:00:00.000Z');
  assert.equal(periodStart('daily', new Date('2026-11-19T21:30:00.000Z')).toISOString(), '2026-11-19T00:00:00.000Z');
  assert.equal(periodStart('all', monday), null);
});

test('public rows mask the Octavio ID and keep one best score per player', async () => {
  const { service, set } = boardAt(Date.parse('2026-11-19T12:00:00.000Z'));
  const adomas = await service.register({ nickname: 'Adomas!!!', octavioId: KEPT_ID, ip: 'phone-a' });
  assert.equal(adomas.octavioId, KEPT_ID);
  assert.equal(adomas.nickname, 'Adomas');
  assert.equal(adomas.maskedId, maskOctavioId(KEPT_ID));
  assert.equal(maskOctavioId(KEPT_ID), 'OCTO-4CD2…9AS2');
  await service.submit({ octavioId: KEPT_ID, score: 1200, lines: 4, level: 1, ip: 'phone-a' });
  set(Date.parse('2026-11-19T12:01:00.000Z'));
  await service.submit({ octavioId: KEPT_ID, score: 800, lines: 2, level: 1, ip: 'phone-a' });
  const other = await service.register({ nickname: 'Mina', ip: 'phone-b' });
  set(Date.parse('2026-11-19T12:02:00.000Z'));
  await service.submit({ octavioId: other.octavioId, score: 5000, lines: 10, level: 2, ip: 'phone-b' });
  await service.register({ nickname: 'Adomas K', octavioId: KEPT_ID, ip: 'phone-a' });
  const board = await service.leaderboard('daily');
  assert.equal(board.reset, 'Day resets 00:00 UTC');
  assert.deepEqual(board.rows.map(row => [row.nickname, row.score, row.maskedId]), [
    ['Mina', 5000, other.maskedId],
    ['Adomas K', 1200, 'OCTO-4CD2…9AS2']
  ]);
  assert.equal(JSON.stringify(board).includes(KEPT_ID), false);
  assert.equal(JSON.stringify(board).includes(other.octavioId), false);
});

test('Monday 00:00 UTC starts a new week without deleting older scores', async () => {
  const { service, set } = boardAt(Date.parse('2026-11-15T23:30:00.000Z'));
  const player = await service.register({ nickname: 'Sunday', ip: 'phone-a' });
  await service.submit({ octavioId: player.octavioId, score: 2000, lines: 8, level: 1, ip: 'phone-a' });
  set(Date.parse('2026-11-16T00:00:00.000Z'));
  await service.submit({ octavioId: player.octavioId, score: 1500, lines: 6, level: 1, ip: 'phone-a' });
  const week = await service.leaderboard('weekly');
  const day = await service.leaderboard('daily');
  const all = await service.leaderboard('all');
  assert.equal(week.reset, 'Week resets Monday 00:00 UTC');
  assert.deepEqual(week.rows.map(row => row.score), [1500]);
  assert.deepEqual(day.rows.map(row => row.score), [1500]);
  assert.deepEqual(all.rows.map(row => row.score), [2000]);
  assert.equal(all.reset, 'All time, no reset');
});

test('rejects impossible scores and spaces out submissions', async () => {
  const origin = 1_700_000_000_000;
  const { service, set } = boardAt(origin);
  const player = await service.register({ nickname: 'Grinder', ip: 'phone-a' });
  await assert.rejects(
    () => service.submit({ octavioId: player.octavioId, score: 500000, lines: 1, level: 1, ip: 'phone-a' }),
    /could not be saved/
  );
  await assert.rejects(
    () => service.submit({ octavioId: player.octavioId, score: 100, lines: 10, level: 1, ip: 'phone-a' }),
    /could not be saved/
  );
  await service.submit({ octavioId: player.octavioId, score: 100, lines: 0, level: 1, ip: 'phone-a' });
  set(origin + 1000);
  await assert.rejects(
    () => service.submit({ octavioId: player.octavioId, score: 120, lines: 0, level: 1, ip: 'phone-a' }),
    /wait a few seconds/
  );
  set(origin + 8000);
  await service.submit({ octavioId: player.octavioId, score: 140, lines: 0, level: 1, ip: 'phone-a' });
  const board = await service.leaderboard('all');
  assert.deepEqual(board.rows.map(row => row.score), [140]);
});

test('http api hides ids, reports setup errors, and reads a raw body', async () => {
  const { service } = boardAt(Date.parse('2026-11-19T18:00:00.000Z'));
  const handlers = createHandlers(() => service);
  const created = await call(handlers.player, {
    method: 'POST',
    body: JSON.stringify({ nickname: 'Adomas', octavioId: KEPT_ID }),
    headers: { 'x-forwarded-for': '1.1.1.1, 10.0.0.8' }
  });
  assert.equal(created.statusCode, 200);
  assert.equal(created.body.octavioId, KEPT_ID);
  const saved = await call(handlers.score, {
    method: 'POST',
    body: { octavioId: KEPT_ID, score: 400, lines: 1, level: 1 },
    headers: { 'x-real-ip': '203.0.113.9' }
  });
  assert.equal(saved.statusCode, 200);
  const listed = await call(handlers.leaderboard, { url: '/api/leaderboard?period=weekly' });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.headers['cache-control'], 'no-store');
  assert.equal(JSON.stringify(listed.body).includes(KEPT_ID), false);
  assert.equal(listed.body.rows[0].maskedId, 'OCTO-4CD2…9AS2');
  assert.equal(listed.body.reset, 'Week resets Monday 00:00 UTC');
  const missing = await call(createHandlers(() => null).leaderboard, { url: '/api/leaderboard?period=daily' });
  assert.equal(missing.statusCode, 503);
  assert.equal(missing.body.message, 'The global leaderboard is not set up yet.');
  const wrong = await call(handlers.score, { method: 'GET' });
  assert.equal(wrong.statusCode, 405);
});

test('the game page no longer calls the dead Supabase host', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal(html.includes('supabase.co'), false);
  assert.equal(html.includes('sb_publishable'), false);
  assert.equal(html.includes('v0.6.3'), true);
  assert.equal(html.includes('Week resets Monday 00:00 UTC'), true);
  assert.equal(html.includes("msg==='Load failed'"), true);
  assert.equal(html.includes('/api/score'), true);
  assert.equal(html.includes('/api/leaderboard'), true);
  assert.equal(html.includes('/api/player'), true);
});

test('all-time board keeps legacy scores, merges them by masked ID, and daily/weekly ignore old ones', async () => {
  let nowMs = Date.parse('2026-11-27T10:00:00.000Z');
  const legacyScores = [
    { nickname: 'Pol', maskedId: 'OCTO-9169…D592', score: 57235, lines: 86, level: 9, createdAt: '2026-11-05T04:53:19Z' },
    { nickname: 'Adomas', maskedId: maskOctavioId(KEPT_ID), score: 3605, lines: 15, level: 2, createdAt: '2026-11-04T19:30:44Z' }
  ];
  const service = createLeaderboard(createMemoryStore(), { now: () => new Date(nowMs), legacyScores });
  let all = await service.leaderboard('all');
  assert.deepEqual(all.rows.map(r => [r.nickname, r.score]), [['Pol', 57235], ['Adomas', 3605]]);
  assert.deepEqual((await service.leaderboard('daily')).rows, []);
  assert.deepEqual((await service.leaderboard('weekly')).rows, []);
  await service.register({ nickname: 'Adomas', octavioId: KEPT_ID, ip: 'phone-a' });
  nowMs += 60000;
  await service.submit({ octavioId: KEPT_ID, score: 5698, lines: 20, level: 3, ip: 'phone-a' });
  all = await service.leaderboard('all');
  assert.deepEqual(all.rows.map(r => [r.nickname, r.score]), [['Pol', 57235], ['Adomas', 5698]]);
  assert.deepEqual((await service.leaderboard('daily')).rows.map(r => r.score), [5698]);
});
