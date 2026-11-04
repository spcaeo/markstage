// XML-RPC, as Odoo speaks it (docs/API-INBOX.md "Odoo"): a call is a methodName and params; values are string, int,
// boolean, double, nil, array and struct. The answer is params (one value) or a fault {faultCode, faultString}.
// Only what Odoo's /xmlrpc/2/common and /xmlrpc/2/object need; no external dependency.

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unesc = (s) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e]));

/** One value as XML: a JS string, integer, boolean, number, null, array or plain object. */
export function valueXml(v) {
  if (v === null || v === undefined) return '<value><nil/></value>';
  if (typeof v === 'boolean') return `<value><boolean>${v ? 1 : 0}</boolean></value>`;
  if (typeof v === 'number') return Number.isInteger(v) ? `<value><int>${v}</int></value>` : `<value><double>${v}</double></value>`;
  if (typeof v === 'string') return `<value><string>${esc(v)}</string></value>`;
  if (Array.isArray(v)) return `<value><array><data>${v.map(valueXml).join('')}</data></array></value>`;
  if (typeof v === 'object') return `<value><struct>${Object.entries(v).map(([k, x]) => `<member><name>${esc(k)}</name>${valueXml(x)}</member>`).join('')}</struct></value>`;
  throw new TypeError(`XML-RPC cannot send a ${typeof v}.`);
}

/** A call as XML. */
export const callXml = (method, params) => `<?xml version="1.0"?>\n<methodCall><methodName>${esc(method)}</methodName><params>${params.map((p) => `<param>${valueXml(p)}</param>`).join('')}</params></methodCall>`;

/** A small XML reader for XML-RPC: elements, text, no attributes needed. Returns the root {name, kids, text}. */
function tree(xml) {
  const root = { name: '#root', kids: [], text: '' };
  const stack = [root];
  const re = /<\?[^]*?\?>|<!--[^]*?-->|<!\[CDATA\[([^]*?)\]\]>|<(\/?)([A-Za-z_][\w.:-]*)[^>]*?(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack.at(-1);
    if (m[1] !== undefined) top.text += m[1];
    else if (m[3]) {
      if (m[2]) {
        if (stack.length < 2 || top.name !== m[3]) throw new Error(`The answer is not well-formed XML (</${m[3]}>).`);
        stack.pop();
      } else {
        const node = { name: m[3], kids: [], text: '' };
        top.kids.push(node);
        if (!m[4]) stack.push(node);
      }
    } else if (m[5] !== undefined) top.text += unesc(m[5]);
  }
  if (stack.length !== 1) throw new Error('The answer is not well-formed XML (an element is not closed).');
  return root;
}

const kid = (n, name) => n?.kids.find((k) => k.name === name) ?? null;

/** A <value> node as JS. */
function readValue(n) {
  const t = n.kids[0];
  if (!t) return n.text; // a bare <value>text</value> is a string
  switch (t.name) {
    case 'string':
      return t.text;
    case 'int':
    case 'i4':
    case 'i8':
      return Number.parseInt(t.text.trim(), 10);
    case 'double':
      return Number(t.text.trim());
    case 'boolean':
      return t.text.trim() === '1';
    case 'nil':
      return null;
    case 'dateTime.iso8601':
    case 'base64':
      return t.text.trim();
    case 'array':
      return (kid(t, 'data')?.kids ?? []).filter((k) => k.name === 'value').map(readValue);
    case 'struct':
      return Object.fromEntries(t.kids.filter((k) => k.name === 'member').map((mm) => [kid(mm, 'name')?.text ?? '', readValue(kid(mm, 'value') ?? { kids: [], text: '' })]));
    default:
      throw new Error(`XML-RPC: an unknown value type <${t.name}>.`);
  }
}

/** A call's XML, read back (the mock server in the tests): {method, params}. */
export function readCall(xml) {
  const c = kid(tree(xml), 'methodCall');
  if (!c) throw new Error('Not an XML-RPC call.');
  const params = (kid(c, 'params')?.kids ?? []).filter((k) => k.name === 'param').map((p) => readValue(kid(p, 'value')));
  return { method: kid(c, 'methodName')?.text.trim() ?? '', params };
}

/** An answer as XML (the mock server): a value, or {fault: {faultCode, faultString}}. */
export const answerXml = (v, fault = null) =>
  fault
    ? `<?xml version="1.0"?>\n<methodResponse><fault>${valueXml(fault)}</fault></methodResponse>`
    : `<?xml version="1.0"?>\n<methodResponse><params><param>${valueXml(v)}</param></params></methodResponse>`;

/** An error from the far side: `fault` is Odoo's answer, else the HTTP or network problem. */
export class RpcError extends Error {
  constructor(message, { fault = null, status = null } = {}) {
    super(message);
    this.fault = fault;
    this.status = status;
  }
}

/** Read an answer: its value, or throw RpcError with the fault. */
export function readAnswer(xml) {
  const r = kid(tree(xml), 'methodResponse');
  if (!r) throw new RpcError('The answer is not an XML-RPC answer.');
  const f = kid(r, 'fault');
  if (f) {
    const fault = readValue(kid(f, 'value'));
    // Odoo puts a whole Python traceback in faultString: its last line says what went wrong
    const last = String(fault?.faultString ?? '').trim().split('\n').filter(Boolean).at(-1) ?? 'a fault';
    throw new RpcError(`Odoo refused it: ${last.slice(0, 300)}`, { fault });
  }
  const p = kid(kid(r, 'params'), 'param');
  if (!p) throw new RpcError('The answer has no value.');
  return readValue(kid(p, 'value'));
}

/** POST one call to `url`; resolves to its value. Times out after `timeoutMs`. */
export async function call(url, method, params, { fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
  let res;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body: callXml(method, params), signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  } catch (e) {
    throw new RpcError(e?.name === 'TimeoutError' ? `no answer within ${timeoutMs / 1000} s` : `could not reach it (${e?.cause?.code ?? e?.message ?? 'network'})`);
  }
  const text = await res.text();
  if (!res.ok) throw new RpcError(`it answered HTTP ${res.status}`, { status: res.status });
  return readAnswer(text);
}
