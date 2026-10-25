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
  // /tilezen/vector/v1/all/{z}/{x}/{y}.topojson 经 rewrite 进入,?nextzen={z}/{x}/{y}.topojson
  if (!isAllowed(req)) return res.status(403).end();
  const [z, x, y] = String((req.query && req.query.nextzen) || '').split('/');
  if (!z || !x || !y) return res.status(404).end();

  const key = 'uZNs91nMR-muUTP99MyBSg';
  const upstream = await fetch(
    `https://tile.nextzen.org/tilezen/vector/v1/all/${z}/${x}/${y.replace(/\.topojson$/, '')}.topojson?api_key=${encodeURIComponent(key)}`,
    { headers: { Referer: 'https://openlayers.org/', Origin: 'https://openlayers.org' } }
  );

  res.status(upstream.status);
  const ct = upstream.headers.get('content-type');
  if (ct) res.setHeader('Content-Type', ct);
  res.send(Buffer.from(await upstream.arrayBuffer()));
//  res.send(`https://tile.nextzen.org/tilezen/vector/v1/all/${z}/${x}/${y.replace(/\.topojson$/, '')}.topojson?api_key=${encodeURIComponent(key)}`);
};
