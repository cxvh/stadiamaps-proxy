export default async function handler(req, res) {
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

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).send('Upstream request failed');
  }
}
