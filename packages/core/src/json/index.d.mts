// Types for @markstage/core/json (the JSON entry engine and the schema descriptor, schema.mjs).

export type Field =
  | { type: 'text'; label?: string; description?: string; multiline?: boolean; rich?: boolean }
  | { type: 'number'; label?: string; description?: string; integer?: boolean }
  | { type: 'checkbox'; label?: string; description?: string; default?: boolean }
  | { type: 'select'; label?: string; description?: string; options: { label: string; value: string }[]; default?: string }
  | { type: 'relationship'; label?: string; description?: string; collection?: string }
  | { type: 'image'; label?: string; description?: string; directory?: string }
  | { type: 'url' | 'date' | 'datetime'; label?: string; description?: string }
  | { type: 'object'; label?: string; description?: string; role?: 'image' | 'link' | string; fields: Record<string, Field> }
  | { type: 'array'; label?: string; description?: string; item: Field }
  | {
      type: 'conditional';
      label?: string;
      description?: string;
      discriminant: Field;
      values: Record<string, Field>;
      storage?: { discriminant: string; value: string };
    }
  | { type: 'slug'; label?: string; description?: string; stored?: boolean }
  | { type: 'content' | 'ignored'; label?: string; description?: string }
  | { type: 'custom'; label?: string; description?: string; default?: unknown };

export type BindKind = 'text' | 'rich' | 'image' | 'link' | 'list';
export type PathSegment = string | number;

export interface CollectionSchema {
  label?: string;
  path: string;
  format: string;
  slugField?: string;
  entry: Field;
}

export interface Schema {
  version: 1;
  source: string;
  collections: Record<string, CollectionSchema>;
  singletons: Record<string, CollectionSchema>;
}

export interface Policy {
  omit?: (value: unknown, field: Field) => boolean;
}

export const SCHEMA_VERSION: 1;
export function fieldAt(root: Field | undefined, path: string | PathSegment[], value?: unknown): Field | undefined;
export function bindingKind(field: Field | undefined): BindKind | undefined;
export function keyOrder(field: Field | undefined): string[] | undefined;
export function defaultValue(field: Field | undefined, branch?: string): unknown;
export function normalize(value: unknown, field: Field | undefined, policy?: Policy): unknown;
export function toPath(path: string | PathSegment[]): PathSegment[];
export function pathString(path: PathSegment[]): string;
export function isWithin(path: string | PathSegment[], prefix: string | PathSegment[]): boolean;

export class JsonSyntaxError extends Error {
  offset: number;
  line: number;
  column: number;
}

export class JsonEntry {
  static parse(text: string, options?: { schema?: Field; policy?: Policy }): JsonEntry;
  readonly text: string;
  /** the entry's data */
  readonly value: unknown;
  readonly changed: boolean;
  field(path: string | PathSegment[]): Field | undefined;
  get(path: string | PathSegment[]): unknown;
  has(path: string | PathSegment[]): boolean;
  set(path: string | PathSegment[], value: unknown): this;
  remove(path: string | PathSegment[]): this;
  insert(path: string | PathSegment[], index: number, value: unknown): this;
  push(path: string | PathSegment[], value: unknown): this;
  move(path: string | PathSegment[], from: number, to: number): this;
  duplicate(path: string | PathSegment[], index: number): this;
}

export function parseTree(text: string): unknown;
export function nodeValue(node: unknown): unknown;
export const DEFAULT_STYLE: Readonly<{ newline: string; indent: string; colon: string; pretty: boolean; finalNewline: boolean }>;
export function detectStyle(text: string, root?: unknown): typeof DEFAULT_STYLE;
export function serialize(value: unknown, style?: typeof DEFAULT_STYLE, base?: string): string;
