import type { DocNode } from './index';

interface Converter {
  mdToDoc(text: string): { frontmatter: string; doc: DocNode };
  docToMd(doc: DocNode, originalText?: string, opts?: { preserve?: boolean }): string;
  printBlock(node: DocNode, ctx?: { prev?: DocNode }): string;
  splitFrontmatter(text: string): { frontmatter: string; body: string };
}

export interface MatrixResult {
  name: string;
  ok: boolean;
  problems: string[];
  /** e.g. list markers changed so two lists stay apart */
  notes: string[];
}

/** The paragraph text the matrix inserts. */
export const MATRIX_TEXT: string;
/** Problems of an unedited save ([] when it gives back the file byte for byte). */
export function roundTrip(md: Converter, text: string): string[];
/** Insert, delete and move a top-level block at the start, middle and end; delete every block; type into an empty body. */
export function editMatrix(md: Converter, text: string): MatrixResult[];
