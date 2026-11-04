// A stand-in Odoo for the tests (test/odoo.test.mjs, e2e/inbox-odoo.e2e.mjs): XML-RPC on 127.0.0.1 as Odoo answers
// it, never a real one. It knows a few records, keeps every call and lead it is sent, and can be made to fail
// (mode 'down': HTTP 502; 'fault': an Odoo fault whose words hold the sign-in's email).
import assert from 'node:assert/strict';
import http from 'node:http';
import { answerXml, readCall } from '../src/forms/xmlrpc.mjs';

/** A stand-in Odoo: the records the old theme looked up, every call it was sent, and a switch to make it fail. */
export async function fakeOdoo({ db, email, password }, port = 0) {
  const o = { calls: [], leads: [], mode: 'ok', sources: { 'Example Website': 7 }, countries: { CA: 38 }, states: { Ontario: 512 } };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const send = (status, xml) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'text/xml');
        res.end(xml);
      };
      if (o.mode === 'down') return send(502, '<html>Bad gateway</html>');
      const c = readCall(body);
      o.calls.push({ path: req.url, ...c });
      if (o.mode === 'fault') return send(200, answerXml(null, { faultCode: 1, faultString: `Traceback (most recent call last):\n  File "odoo/http.py"\nodoo.exceptions.ValidationError: The database is busy, try later (for ${email})` }));
      if (req.url === '/xmlrpc/2/common' && c.method === 'authenticate') {
        const ok = c.params[0] === db && c.params[1] === email && c.params[2] === password;
        return send(200, answerXml(ok ? 42 : false));
      }
      if (req.url !== '/xmlrpc/2/object' || c.method !== 'execute_kw') return send(200, answerXml(null, { faultCode: 2, faultString: 'no such method' }));
      const [d, uid, pw, model, method, args] = c.params;
      if (d !== db || uid !== 42 || pw !== password) return send(200, answerXml(null, { faultCode: 3, faultString: 'odoo.exceptions.AccessDenied: Access Denied' }));
      if (method === 'search') {
        const [[field, op, value]] = args[0];
        const table = { 'utm.source': o.sources, 'res.country': o.countries, 'res.country.state': o.states }[model];
        assert.equal(op, '=');
        assert.equal(field, { 'utm.source': 'name', 'res.country': 'code', 'res.country.state': 'name' }[model]);
        return send(200, answerXml(table && value in table ? [table[value]] : []));
      }
      if (model === 'crm.lead' && method === 'create') {
        o.leads.push(args[0]);
        return send(200, answerXml(1000 + o.leads.length));
      }
      return send(200, answerXml(null, { faultCode: 2, faultString: `no ${model}.${method}` }));
    });
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  o.url = `http://127.0.0.1:${server.address().port}`;
  o.close = () => new Promise((r) => server.close(r));
  return o;
}
