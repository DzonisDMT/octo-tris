import { score } from '../lib/server.js';

export default function handler(req, res) {
  return score(req, res);
}
