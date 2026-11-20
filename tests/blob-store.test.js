import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createBlobStore } from '../lib/blob-store.js';
import { createLeaderboard } from '../lib/leaderboard.js';

function loadEnv() {
  try {
    const text = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    for (const line of text.split('\n')) {
      const match = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
    }
  } catch {
    // Local blob checks are skipped when the token file is absent.
  }
}

loadEnv();

test('private blob store saves a score that a second player can read', async (t) => {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    t.skip('BLOB_READ_WRITE_TOKEN is not available in this environment');
    return;
  }
  const prefix = `verify/${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
  const store = createBlobStore({ token, prefix });
  const service = createLeaderboard(store);
  try {
    const first = await service.register({ nickname: 'Phone One', ip: '198.51.100.10' });
    const second = await service.register({ nickname: 'Phone Two', ip: '198.51.100.20' });
    await service.submit({ octavioId: first.octavioId, score: 2200, lines: 8, level: 1, ip: '198.51.100.10' });
    await service.submit({ octavioId: second.octavioId, score: 1800, lines: 6, level: 1, ip: '198.51.100.20' });
    let board;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      board = await service.leaderboard('all');
      if (board.rows.length === 2) break;
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    assert.deepEqual(board.rows.map(row => [row.nickname, row.score]), [
      ['Phone One', 2200],
      ['Phone Two', 1800]
    ]);
    assert.equal(JSON.stringify(board).includes(first.octavioId), false);
    assert.equal(JSON.stringify(board).includes(second.octavioId), false);
    assert.equal(board.rows[0].maskedId, first.maskedId);
  } finally {
    await store.removeAll();
  }
});
