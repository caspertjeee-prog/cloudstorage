import { Redis } from '@upstash/redis';

export default async function handler(req, res) {
  // Read and sanitize env vars at request time
  let url   = (process.env.UPSTASH_REDIS_REST_URL || '').trim();
  let token = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();

  // If someone pasted with quotes, strip them
  if (url.startsWith('"') && url.endsWith('"'))  url   = url.slice(1, -1);
  if (token.startsWith('"') && token.endsWith('"')) token = token.slice(1, -1);

  if (!url || !token || !url.startsWith('https://')) {
    return res.status(500).json({
      error: 'Missing/invalid UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN'
    });
  }

  const redis = new Redis({ url, token });

  // (Optional) CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { id } = req.query;
  const key = `note:${id}`;

  try {
    if (req.method === 'GET') {
      const value = await redis.get(key);
      return res.status(200).json(value || { title: '', body: '' });
    }
    if (req.method === 'PUT') {
      const { title = '', body = '' } = JSON.parse(req.body || '{}');
      const safe = {
        title: String(title).slice(0, 120),
        body:  String(body).slice(0, 10000),
        updatedAt: Date.now(),
      };
      await redis.set(key, safe);
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'DELETE') {
      await redis.del(key);
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET,PUT,DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
