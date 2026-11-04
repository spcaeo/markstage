// Upload type detection from the bytes themselves (magic numbers). The file name and the Content-Type header are
// never trusted. Raster images and PDF documents are accepted; SVG (scriptable XML), HTML and the rest are refused.
// iPhone photos (HEIC) are recognised so they can be converted, or refused in plain words.

const starts = (buf, bytes, at = 0) => bytes.every((b, i) => buf[at + i] === b);
const ascii = (buf, at, len) => buf.subarray(at, at + len).toString('latin1');

export const TYPES = {
  'image/jpeg': { ext: 'jpg' },
  'image/png': { ext: 'png' },
  'image/gif': { ext: 'gif' },
  'image/webp': { ext: 'webp' },
  'image/avif': { ext: 'avif' },
  // a download (a brochure, a price list): stored as it is, never re-encoded or shown inline by the server
  'application/pdf': { ext: 'pdf', document: true },
};

const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'];

/** The image type of a buffer, or null. Also says when it looks like SVG/HTML so the message can be specific. */
export function sniff(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return { type: null };
  if (starts(buf, [0xff, 0xd8, 0xff])) return { type: 'image/jpeg' };
  if (starts(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { type: 'image/png' };
  if (ascii(buf, 0, 6) === 'GIF87a' || ascii(buf, 0, 6) === 'GIF89a') return { type: 'image/gif' };
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WEBP') return { type: 'image/webp' };
  if (ascii(buf, 4, 4) === 'ftyp' && ['avif', 'avis'].includes(ascii(buf, 8, 4))) return { type: 'image/avif' };
  if (ascii(buf, 4, 4) === 'ftyp' && HEIC_BRANDS.includes(ascii(buf, 8, 4))) return { type: null, heic: true };
  if (ascii(buf, 0, 5) === '%PDF-') return { type: 'application/pdf' };
  // skip a BOM and whitespace, then look for markup
  const head = buf.subarray(0, 1024).toString('utf8').replace(/^﻿/, '').trimStart().toLowerCase();
  if (head.startsWith('<?xml') || head.startsWith('<svg') || head.includes('<svg')) return { type: null, svg: true };
  if (head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<')) return { type: null, markup: true };
  return { type: null };
}

/** Width and height from the header bytes (enough for the media index when no codec is installed). */
export function dimensions(buf, type) {
  try {
    if (type === 'image/png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (type === 'image/gif') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (type === 'image/jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) return {};
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        i += 2 + len;
      }
    }
  } catch {
    // truncated header
  }
  return {};
}
