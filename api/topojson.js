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

// 支持的瓦片集及其上游最大缩放级别(超过后走 overzoom 裁剪)
const TILESETS = {
  global_landcover_v1: { maxzoom: 7 },
};
const TILE_RE = /^(\w+)\/(\d+)\/(\d+)\/(\d+)\.topojson$/;

// ---- overzoom 裁剪:将祖先瓦片几何按请求瓦片的经纬度范围裁剪(Sutherland–Hodgman) ----

function tileBBox(z, x, y) {
  const n = Math.pow(2, z);
  const lonMin = (x / n) * 360 - 180;
  const lonMax = ((x + 1) / n) * 360 - 180;
  const lat = (t) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * t) / n))) * 180) / Math.PI;
  return [lonMin, lat(y + 1), lonMax, lat(y)]; // [minX, minY, maxX, maxY]
}

function intersectEdge(prev, cur, axis, bound) {
  const t = (bound - prev[axis]) / (cur[axis] - prev[axis]);
  const p = [prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])];
  p[axis] = bound;
  return p;
}

function clipRing(ring, bbox) {
  const [xmin, ymin, xmax, ymax] = bbox;
  const planes = [
    { axis: 0, bound: xmin, inside: (p) => p[0] >= xmin },
    { axis: 0, bound: xmax, inside: (p) => p[0] <= xmax },
    { axis: 1, bound: ymin, inside: (p) => p[1] >= ymin },
    { axis: 1, bound: ymax, inside: (p) => p[1] <= ymax },
  ];
  let output = ring;
  for (const plane of planes) {
    if (output.length < 2) return [];
    const input = output;
    output = [];
    for (let i = 0; i < input.length; i++) {
      const prev = input[(i + input.length - 1) % input.length];
      const cur = input[i];
      const prevIn = plane.inside(prev);
      const curIn = plane.inside(cur);
      if (curIn !== prevIn) output.push(intersectEdge(prev, cur, plane.axis, plane.bound));
      if (curIn) output.push(cur);
    }
  }
  return output;
}

function clipPolygon(polygon, bbox) {
  const exterior = clipRing(polygon[0], bbox);
  if (exterior.length < 4) return null;
  const clipped = [exterior];
  for (let h = 1; h < polygon.length; h++) {
    const hole = clipRing(polygon[h], bbox);
    if (hole.length >= 4) clipped.push(hole);
  }
  return clipped;
}

function clipGeometry(geom, bbox) {
  switch (geom.type) {
    case 'Polygon': {
      const poly = clipPolygon(geom.coordinates, bbox);
      return poly ? { type: 'Polygon', coordinates: poly } : null;
    }
    case 'MultiPolygon': {
      const polys = geom.coordinates
        .map((p) => clipPolygon(p, bbox))
        .filter(Boolean);
      return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null;
    }
    case 'LineString':
    case 'MultiLineString':
      // landcover 只有面,线类型原样保留(由客户端视口裁剪)
      return geom;
    default:
      return geom;
  }
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

  // rewrite(/data/:path*) 会把路径放入 ?path=;直访函数时(本地调试)从 URL 中取
  let pathParam = (req.query && req.query.path) || '';
  if (!pathParam) {
    const m = req.url.split('?')[0].match(/^\/api\/topojson\/(.+)$/);
    if (m) pathParam = m[1];
  }

  const matched = TILE_RE.exec(decodeURIComponent(pathParam));
  if (!matched || !TILESETS[matched[1]]) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).send('Not Found, expected /data/{tileset}/{z}/{x}/{y}.topojson');
    return;
  }

  const [, tileset, zStr, xStr, yStr] = matched;
  const z = Number(zStr);
  const x = Number(xStr);
  const y = Number(yStr);
  const conf = TILESETS[tileset];

  // 超过上游 maxzoom 时取祖先瓦片 + 裁剪(overzoom)
  let fz = z;
  let fx = x;
  let fy = y;
  if (z > conf.maxzoom) {
    const scale = Math.pow(2, z - conf.maxzoom);
    fz = conf.maxzoom;
    fx = Math.floor(x / scale);
    fy = Math.floor(y / scale);
  }

  const apiKey = process.env.STADIAMAPS_MAP_KEY;
  const target = `https://tiles.stadiamaps.com/data/${tileset}/${fz}/${fx}/${fy}.pbf${
    apiKey ? `?api_key=${encodeURIComponent(apiKey)}` : ''
  }`;

  const respond = (status, body, cacheable) => {
    if (cacheable) {
      res.setHeader(
        'Cache-Control',
        'public, max-age=31536000, s-maxage=31536000, stale-while-revalidate=604800'
      );
    } else {
      res.setHeader('Cache-Control', 'no-store');
    }
    res.status(status).send(body);
  };

  try {
    const upstream = await fetch(target, {
      headers: { 'User-Agent': req.headers['user-agent'] || 'stadiamaps-proxy' },
    });

    if (!upstream.ok) {
      console.error(`upstream ${upstream.status} for ${tileset}/${fz}/${fx}/${fy}`);
      respond(upstream.status, 'Upstream request failed: HTTP ' + upstream.status, false);
      return;
    }

    const buf = Buffer.from(await upstream.arrayBuffer());

    // 空瓦片(204 或空 body)返回空 TopoJSON,避免解析报错
    if (buf.length === 0) {
      respond(200, JSON.stringify({ type: 'Topology', objects: {} }), true);
      return;
    }

    // PBF(MVT) -> GeoJSON(按图层分组),overzoom 时裁剪到请求瓦片范围
    const tile = new VectorTile(new Pbf(buf));
    const bbox = z > conf.maxzoom ? tileBBox(z, x, y) : null;
    const geojsonLayers = {};
    for (const layerName of Object.keys(tile.layers)) {
      const layer = tile.layers[layerName];
      const features = [];
      for (let i = 0; i < layer.length; i++) {
        try {
          let feature = layer.feature(i).toGeoJSON(fx, fy, fz);
          if (bbox) {
            const clipped = clipGeometry(feature.geometry, bbox);
            if (!clipped) continue;
            feature = { type: 'Feature', properties: feature.properties, geometry: clipped };
          }
          features.push(feature);
        } catch (e) {
          // 单个要素解析失败时跳过,不拖垮整个瓦片
          console.error(`feature skipped: ${layerName}[${i}]: ${e && e.message}`);
        }
      }
      geojsonLayers[layerName] = { type: 'FeatureCollection', features };
    }

    // GeoJSON -> TopoJSON
    const topo = topology(geojsonLayers);

    respond(200, JSON.stringify(topo), true);
  } catch (error) {
    console.error('topojson convert failed:', error && (error.stack || error.message));
    respond(502, 'Convert failed: ' + ((error && error.message) || String(error)), false);
  }
};

// 允许最长 60s 执行(大瓦片解码转换耗时可能超过默认值)
module.exports.config = { maxDuration: 60 };
