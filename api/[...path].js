// 域名白名单：可用环境变量 ALLOWED_DOMAINS 覆盖，逗号分隔，支持 *.example.com
const DEFAULT_DOMAINS = '*.cnb.run,*.cxvh.com,*.allapi.cc';
const ALLOWED = (process.env.ALLOWED_DOMAINS || DEFAULT_DOMAINS)
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function isAllowed(req) {
  const raw = req.headers.origin || req.headers.referer || '';
  if (!raw) return false; // 无来源头（直接打开、curl 等）一律拒绝
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

export default async function handler(req, res) {
  // CORS 头已由 vercel.json 的 headers 在边缘层统一添加，这里只处理预检
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

  // 路径和参数原样透传，只追加 api_key
  const [path, search] = req.url.split('?');
  const target =
    `https://tiles.stadiamaps.com${path.replace(/^\/api(?=\/)/, '')}` +
    (search ? `?${search}&api_key=` : '?api_key=') +
    encodeURIComponent(apiKey);

  try {
    const upstream = await fetch(target, {
      headers: { 'User-Agent': req.headers['user-agent'] || 'stadiamaps-proxy' },
    });
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);

    // 成功的瓦片走 Vercel 边缘缓存 + 浏览器缓存；失败不缓存
    if (upstream.ok) {
      res.setHeader(
        'Cache-Control',
        'public, max-age=31536000, s-maxage=31536000, stale-while-revalidate=604800'
      );
    } else {
      res.setHeader('Cache-Control', 'no-store');
    }

    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).send('Upstream request failed');
  }
}
