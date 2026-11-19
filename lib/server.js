import { createBlobStore } from './blob-store.js';
import { createHandlers } from './http.js';
import { createLeaderboard } from './leaderboard.js';

let service;

function getService() {
  if (service) return service;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  service = createLeaderboard(createBlobStore({
    token,
    prefix: process.env.OCTOTRIS_BLOB_PREFIX || ''
  }));
  return service;
}

const handlers = createHandlers(getService);

export const player = handlers.player;
export const score = handlers.score;
export const leaderboard = handlers.leaderboard;
