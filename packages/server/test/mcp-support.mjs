// The MCP tests' client (test/mcp*.test.mjs): JSON-RPC to POST <api>/mcp with a bearer token, as an agent sends it
// (no Origin, no cookie), and a token made in a test person's browser session. Test tokens are made here.

/** A token of these scopes for the person behind `who` (a session client): the secret. */
export async function mcpToken(who, scopes = ['mcp:read'], name = 'Test agent') {
  const r = await who.post('/me/tokens', { name, scopes, days: 1 });
  if (r.status !== 201) throw new Error(`token: ${r.status} ${r.text}`);
  return r.json.secret;
}

/** An MCP client: rpc(method, params) -> {status, json, headers}; tool(name, args) -> the result's structuredContent. */
export function mcpClient(base, secret, { origin, headers = {} } = {}) {
  let n = 0;
  const send = async (body, extra = {}) => {
    const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers, ...extra };
    if (secret) h.Authorization = `Bearer ${secret}`;
    if (origin) h.Origin = origin;
    const res = await fetch(`${base}/markstage/api/mcp`, { method: 'POST', headers: h, body: typeof body === 'string' ? body : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, text, headers: res.headers };
  };
  const rpc = (method, params, extra) => send({ jsonrpc: '2.0', id: ++n, method, ...(params === undefined ? {} : { params }) }, extra);
  /** A tool's answer: {ok, data, text, error?} (isError: ok false, data the error). */
  const tool = async (name, args = {}) => {
    const r = await rpc('tools/call', { name, arguments: args });
    if (r.status !== 200) return { ok: false, status: r.status, data: r.json, text: r.text };
    if (r.json.error) return { ok: false, rpcError: r.json.error, data: null, text: r.text };
    const res = r.json.result;
    return { ok: !res.isError, data: res.structuredContent, text: res.content?.[0]?.text, raw: r.text };
  };
  return { send, rpc, tool };
}
