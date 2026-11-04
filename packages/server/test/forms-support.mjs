// The contact form shared by the form tests: shaped like a real site's one (name, email, phone, service, budget and the rest).
import http from 'node:http';

export const SITE = 'www.example.test';
export const CONTACT_CONFIG = `export default {
  siteName: 'Example Co',
  siteUrl: 'https://${SITE}',
  collections: [{ id: 'posts', label: 'Posts', format: 'md', dir: 'src/content/blog', hasStatus: true, url: '/blog/{id}/' }],
  forms: {
    contact: {
      label: 'Contact',
      fields: {
        name: { label: 'Name', required: true, max: 100 },
        email: { label: 'Email', type: 'email', required: true },
        number: { label: 'Phone', type: 'tel', required: true },
        comment: { label: 'Message', type: 'textarea', required: true, min: 14 },
        service_type: { label: 'Service type', max: 100 },
        how_soon: { label: 'How soon', max: 50 },
        approx_budget: { label: 'Budget', max: 50 },
      },
      meta: { page: 'pageUrl', referrer: 'referrerURL', landing: 'landingURL', referringDomain: 'referrerDomain', utmSource: 'u_source', utmMedium: 'u_medium' },
      service: 'service_type',
      honeypot: 'hp_website',
      started: 'started',
      thanks: '/thank-you/',
      message: 'Data stored successfully',
      reply: { subject: 'Thank you for reaching out', text: 'Hi {name},\\n\\nThanks for contacting {siteName}. We will be in touch within 48 hours.' },
      team: { subject: 'Inquiry from {name} from {siteName} website' },
    },
  },
};
`;

/** POST to the site host (node:http: fetch cannot set Host). Returns {status, headers, json, text}. */
export function sitePost(port, p, body, { origin = `https://${SITE}`, host = SITE, headers = {} } = {}) {
  const payload = typeof body === 'string' ? body : new URLSearchParams(body).toString();
  const h = { Host: host, 'Content-Type': typeof body === 'string' && body.startsWith('{') ? 'application/json' : 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(payload), Accept: 'application/json', ...headers };
  if (origin) h.Origin = origin;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode, headers: res.headers, json, text });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}
