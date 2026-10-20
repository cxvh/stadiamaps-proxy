const DEFAULT_DOMAINS = '*.cnb.run,*.cxvh.com';
const ALLOWED = (process.env.ALLOWED_DOMAINS || DEFAULT_DOMAINS)
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function isAllowed(req) {
  const raw = req.headers.origin || req.headers.referer || '';
  if (!raw) return false;
  let host;
  try {
    host = new URL(raw).hostname;
  } catch {
    return false;
  }
  return ALLOWED.some((p) =>
    p.startsWith('*.') ? host === p.slice(2) || host.endsWith(p.slice(1)) : host === p
  );
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (!isAllowed(req)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(403).send('Forbidden');
    return;
  }

  const apiKey = process.env.THUNDERFOREST_MAP_KEY;
  if (!apiKey) {
    res.status(500).send('Missing THUNDERFOREST_MAP_KEY environment variable');
    return;
  }

  // Vercel rewrite 后 req.url 仍是原始路径,如 /c/cycle/9/264/182.png
  // 路径格式:{a|b|c}/{mapType}/{z}/{x}/{y}.png
  const [rawUrl, search = ''] = req.url.split('?');

  const parts = rawUrl.split('/').filter(Boolean);
  if (parts.length < 2) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).send('Bad Request: path must be /{a|b|c}/{mapType}/{z}/{x}/{y}.png');
    return;
  }

  const sub = parts[0].toLowerCase();
  if (!['a', 'b', 'c'].includes(sub)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).send('Bad Request: sub must be one of a, b, c');
    return;
  }

  const restPath = parts.slice(1).join('/');

  // 客户端可能传入 apikey,统一覆盖为环境变量里的 key(保留其它透传参数)
  const params = new URLSearchParams(search);
  params.delete('apikey');
  params.set('apikey', apiKey);
  const target = `https://${sub}.tile.thunderforest.com/${restPath}?${params.toString()}`;

  try {
    const upstream = await fetch(target, {
      headers: { 'User-Agent': req.headers['user-agent'] || 'thunderforest-proxy' },
    });

    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);

    if (upstream.ok) {
      res.setHeader(
        'Cache-Control',
        'public, max-age=31536000, s-maxage=31536000, stale-while-revalidate=604800'
      );
    } else {
      res.setHeader('Cache-Control', 'no-store');
    }

    const arrayBuffer = await upstream.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).send('Upstream request failed');
  }
};
