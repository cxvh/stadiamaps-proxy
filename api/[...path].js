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

  // 修复路径切片逻辑，确保完整截取 /tiles/ 之后的所有内容
  const [rawUrl, search] = req.url.split('?');
  const tilesIndex = rawUrl.indexOf('/tiles/');
  
  if (tilesIndex === -1) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).send('Not Found');
    return;
  }

  const cleanPath = rawUrl.substring(tilesIndex);
  const target =
    `https://stadiamaps.com${cleanPath}` +
    (search ? `?${search}&api_key=` : '?api_key=') +
    encodeURIComponent(apiKey);

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