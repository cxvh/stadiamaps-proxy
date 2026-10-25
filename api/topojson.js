const { VectorTile } = require('@mapbox/vector-tile');
const Pbf = require('pbf');
const { topology } = require('topojson-server');

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

// 支持的瓦片集(z/x/y 已在正则中校验)
const TILE_RE = /^(global_landcover_v1)\/(\d+)\/(\d+)\/(\d+)\.topojson$/;

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

  // rewrite(/data/:path*) 会把路径放入 ?path=;直访函数时(本地调试)从 URL 中取
  let pathParam = (req.query && req.query.path) || '';
  if (!pathParam) {
    const m = req.url.split('?')[0].match(/^\/api\/topojson\/(.+)$/);
    if (m) pathParam = m[1];
  }

  const matched = TILE_RE.exec(decodeURIComponent(pathParam));
  if (!matched) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).send('Not Found, expected /data/{tileset}/{z}/{x}/{y}.topojson');
    return;
  }

  const [, tileset, z, x, y] = matched;
  const apiKey = process.env.STADIAMAPS_MAP_KEY;
  const target = `https://tiles.stadiamaps.com/data/${tileset}/${z}/${x}/${y}.pbf${
    apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : ''
  }`;

  try {
    const upstream = await fetch(target, {
      headers: { 'User-Agent': req.headers['user-agent'] || 'stadiamaps-proxy' },
    });

    if (!upstream.ok) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(upstream.status).send('Upstream request failed');
      return;
    }

    const buf = Buffer.from(await upstream.arrayBuffer());

    // 空瓦片(204 或空 body)返回空 TopoJSON,避免解析报错
    if (buf.length === 0) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Cache-Control',
        'public, max-age=31536000, s-maxage=31536000, stale-while-revalidate=604800'
      );
      res.send(JSON.stringify({ type: 'Topology', objects: {} }));
      return;
    }

    // PBF(MVT) -> GeoJSON(按图层分组)
    const tile = new VectorTile(new Pbf(buf));
    const geojsonLayers = {};
    for (const layerName of Object.keys(tile.layers)) {
      const layer = tile.layers[layerName];
      const features = [];
      for (let i = 0; i < layer.length; i++) {
        features.push(layer.feature(i).toGeoJSON(Number(x), Number(y), Number(z)));
      }
      geojsonLayers[layerName] = { type: 'FeatureCollection', features };
    }

    // GeoJSON -> TopoJSON
    const topo = topology(geojsonLayers);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Cache-Control',
      'public, max-age=31536000, s-maxage=31536000, stale-while-revalidate=604800'
    );
    res.send(JSON.stringify(topo));
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).send('Upstream request failed');
  }
};
