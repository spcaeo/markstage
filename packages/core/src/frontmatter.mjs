// YAML frontmatter of a Markdown entry: read it as an object (writing it surgically comes with the settings drawer).
import YAML from 'yaml';

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

/** The frontmatter as an object ({} when there is none). Throws on invalid YAML. */
export function readFrontmatter(text) {
  const m = FRONT.exec(text);
  if (!m) return {};
  const data = YAML.parse(m[1]);
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

/** The Markdown body after the frontmatter. */
export const bodyOf = (text) => text.replace(FRONT, '');

/** True when the text starts with a frontmatter block. */
export const hasFrontmatter = (text) => FRONT.test(text);
