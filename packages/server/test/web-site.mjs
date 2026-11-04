// A small web site on loopback for the fetch tests: each path answers with {status, type, body, headers, delay} (or a
// function of the request that returns one). `hits` lists every path asked for, so a test can show that a refused
// address was never contacted.
import http from 'node:http';

export async function startWebSite(routes) {
  const hits = [];
  const server = http.createServer(async (req, res) => {
    hits.push(req.url);
    let r = routes[req.url.split('?')[0]] ?? routes[req.url] ?? { status: 404, type: 'text/plain', body: 'not here' };
    if (typeof r === 'function') r = await r(req);
    if (r.delay) await new Promise((ok) => setTimeout(ok, r.delay));
    res.writeHead(r.status ?? 200, { 'Content-Type': r.type ?? 'text/html; charset=utf-8', ...(r.headers ?? {}) });
    res.end(r.body ?? '');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const { port } = server.address();
  return {
    port,
    base: `http://127.0.0.1:${port}`,
    hits,
    // the test seam: this site's own address is reachable, nothing else on loopback is
    outbound: { allow: (ip, p) => ip === '127.0.0.1' && p === port },
    close: () => new Promise((ok) => {
      server.closeAllConnections?.();
      server.close(ok);
    }),
  };
}
