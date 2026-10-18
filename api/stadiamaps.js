const DEFAULT_DOMAINS = '*.cnb.run,*.cxvh.com,*.allapi.cc';
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

  const apiKey = process.env.STADIAMAPS;
  if (!apiKey) {
    res.status(500).send('Missing STADIAMAPS environment variable');
    return;
  }

  // Vercel rewrite 后 req.url 仍是原始路径(如 /tiles/stamen_toner/2/0/2.png),
  // 函数自身被挂在 /api/stadiamaps。路径清洗兼容两种情况:
  // 1. rewrite 后的请求:/tiles/...
  // 2. 直访函数(本地调试):/api/stadiamaps/...
  const [rawUrl, search = ''] = req.url.split('?');

  let cleanPath = rawUrl;
  if (cleanPath.startsWith('/api')) {
    cleanPath = cleanPath.substring(4);
  }
  if (!cleanPath.startsWith('/tiles')) {
    cleanPath = '/tiles' + cleanPath;
  }

  // 客户端可能传入 api_key,统一覆盖为环境变量里的 key(保留其它透传参数)
  const params = new URLSearchParams(search);
  params.delete('api_key');
  params.set('api_key', apiKey);
  const target = `https://tiles.stadiamaps.com${cleanPath}?${params.toString()}`;

  try {
    const upstream = await fetch(target, {
      headers: { 'User-Agent': req.headers['user-agent'] || 'stadiamaps-proxy' },
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
