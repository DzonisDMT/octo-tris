import { leaderboard } from '../lib/server.js';

export default function handler(req, res) {
  return leaderboard(req, res);
}
