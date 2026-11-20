import { del, get, list, put } from '@vercel/blob';

function cleanPrefix(prefix) {
  const value = String(prefix || '').replace(/^\/+|\/+$/g, '');
  if (!value) return '';
  if (!/^[a-zA-Z0-9/_-]+$/.test(value)) return '';
  return `${value}/`;
}

function alreadyExists(error) {
  const message = String(error && error.message || '');
  return /already exists/i.test(message) || /precondition failed/i.test(message);
}

async function readStream(stream) {
  if (!stream) return '';
  const response = new Response(stream);
  return response.text();
}

export function createBlobStore({ token, prefix = '' } = {}) {
  if (!token) throw new Error('Missing blob token');
  const root = cleanPrefix(prefix);
  const full = path => `${root}${String(path).replace(/^\/+/, '')}`;
  const options = { access: 'private', token, addRandomSuffix: false };

  return {
    async putIfAbsent(path, body) {
      try {
        await put(full(path), String(body), { ...options, allowOverwrite: false, contentType: 'application/json' });
        return true;
      } catch (error) {
        if (alreadyExists(error)) return false;
        throw error;
      }
    },
    async put(path, body) {
      await put(full(path), String(body), { ...options, allowOverwrite: true, contentType: 'application/json' });
    },
    async getJson(path) {
      const result = await get(full(path), { access: 'private', token, useCache: false });
      if (!result || result.statusCode !== 200 || !result.stream) return null;
      const text = await readStream(result.stream);
      if (!text) return null;
      return JSON.parse(text);
    },
    async list(prefixPath) {
      const found = [];
      let cursor;
      for (let page = 0; page < 20; page += 1) {
        const result = await list({ token, prefix: full(prefixPath), cursor, limit: 1000 });
        for (const blob of result.blobs) {
          let pathname = String(blob.pathname || '').replace(/^\/+/, '');
          if (root && pathname.startsWith(root)) pathname = pathname.slice(root.length);
          found.push({ pathname });
        }
        if (!result.hasMore) break;
        cursor = result.cursor;
      }
      return found;
    },
    async removeAll() {
      let cursor;
      do {
        const result = await list({ token, prefix: root, cursor, limit: 1000 });
        if (result.blobs.length) await del(result.blobs.map(blob => blob.url), { token });
        cursor = result.hasMore ? result.cursor : undefined;
      } while (cursor);
    }
  };
}
