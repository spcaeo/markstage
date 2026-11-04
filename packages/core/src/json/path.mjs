// Field paths. Written as dotted text ("sections.3.value.heading", the form field bindings carry) or as an array
// (["sections", 3, "value", "heading"], needed when a key itself contains a dot). A segment of digits is an array
// index. Keys are never interpreted any other way: no wildcards, no "..", no prototype keys.

/** @typedef {(string|number)[]} PathArray */

const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * @param {string | PathArray} path
 * @returns {PathArray}
 */
export function toPath(path) {
  const parts = Array.isArray(path) ? path : path === '' ? [] : String(path).split('.');
  return parts.map((p) => {
    if (typeof p === 'number') {
      if (!Number.isInteger(p) || p < 0) throw new Error(`bad path index ${p}`);
      return p;
    }
    if (p === '') throw new Error(`empty segment in path "${Array.isArray(path) ? path.join('.') : path}"`);
    if (FORBIDDEN.has(p)) throw new Error(`forbidden path segment "${p}"`);
    return /^(0|[1-9]\d*)$/.test(p) ? Number(p) : p;
  });
}

/**
 * Dotted form of a path (the form `data-ms-field` carries).
 * @param {string | PathArray} path
 */
export function pathString(path) {
  return toPath(path).join('.');
}

/** True when `prefix` is `path` or one of its ancestors. */
export function isWithin(path, prefix) {
  const a = toPath(path);
  const b = toPath(prefix);
  return b.length <= a.length && b.every((s, i) => s === a[i]);
}
