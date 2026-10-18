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

module.exports = async function handler(req, res) {
  // 1. 处理预检请求
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // 2. 安全防盗链白名单校验
  if (!isAllowed(req)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(403).send('Forbidden');
    return;
  }

  // 3. 读取 Vercel 后台设置的环境变量
  const apiKey = process.env.STADIAMAPS;
  if (!apiKey) {
    res.status(500).send('Missing STADIAMAPS environment variable');
    return;
  }

  // 4. ✨ 核心路径清洗：无论内部路由如何变，只截取 /tiles/ 及其后面的部分
  const [rawUrl, search] = req.url.split('?');
  let cleanPath = rawUrl;
  
  if (rawUrl.includes('/tiles/')) {
    cleanPath = '/tiles/' + rawUrl.split('/tiles/')[1];
  } else {
    // 兜底逻辑：如果找不到 /tiles/，则尝试去掉开头的 /api
    cleanPath = rawUrl.replace(/^\/api/, '');
    if (!cleanPath.startsWith('/tiles')) {
      cleanPath = '/tiles' + cleanPath;
    }
  }

  // 5. 组装最终的上游 Stadia Maps 真实瓦片地址并带上 API Key
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

    // 6. ✨ 边缘 CDN 缓存 + 浏览器本地双重强缓存
    if (upstream.ok) {
      res.setHeader(
        'Cache-Control',
        'public, max-age=31536000, s-maxage=31536000, stale-while-revalidate=604800'
      );
    } else {
      res.setHeader('Cache-Control', 'no-store');
    }

    // 7. 返回图片二进制流
    const arrayBuffer = await upstream.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).send('Upstream request failed');
  }
};