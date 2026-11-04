// A multipart/form-data body (what a browser's FormData sends): {fields: {name: text}, files: [{name, filename, type,
// data}]}. Only what the Library's import needs: no nested parts, no transfer encodings other than binary.
import { badRequest } from '../util.mjs';

export function parseMultipart(body, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(String(contentType ?? ''));
  if (!/^multipart\/form-data/i.test(String(contentType ?? '')) || !m) throw badRequest('Send the file as multipart/form-data.');
  const boundary = Buffer.from(`--${(m[1] ?? m[2]).trim()}`);
  const fields = {};
  const files = [];
  let at = body.indexOf(boundary);
  if (at < 0) throw badRequest('The form data has no parts.');
  for (;;) {
    let start = at + boundary.length;
    if (body.subarray(start, start + 2).toString() === '--') break;
    if (body.subarray(start, start + 2).toString() === '\r\n') start += 2;
    const next = body.indexOf(boundary, start);
    if (next < 0) throw badRequest('The form data ends early.');
    const part = body.subarray(start, next - 2);
    const split = part.indexOf('\r\n\r\n');
    if (split < 0) throw badRequest('A form part has no headers.');
    const head = part.subarray(0, split).toString('utf8');
    const data = part.subarray(split + 4);
    const disp = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(head)?.[1] ?? '';
    const name = /\bname="([^"]*)"/i.exec(disp)?.[1];
    const filename = /\bfilename="([^"]*)"/i.exec(disp)?.[1];
    const type = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim() ?? null;
    if (name !== undefined) {
      if (filename !== undefined) files.push({ name, filename, type, data });
      else fields[name] = data.toString('utf8');
    }
    at = next;
  }
  return { fields, files };
}
