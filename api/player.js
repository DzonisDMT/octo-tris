import { player } from '../lib/server.js';

export default function handler(req, res) {
  return player(req, res);
}
