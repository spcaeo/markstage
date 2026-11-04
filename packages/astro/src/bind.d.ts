// Types for bind.mjs (field bindings for the Markstage editor).
export type BindKind = 'text' | 'rich' | 'image' | 'link' | 'list';
export type Binding = { 'data-ms-field'?: string; 'data-ms-kind'?: BindKind };
export declare const KINDS: readonly BindKind[];
export declare function editing(): boolean;
export declare function bind(path: string | false | null | undefined, kind?: BindKind): Binding;
export declare function fieldPath(...parts: (string | number | null | undefined)[]): string;
export interface Binder {
  (sub: string | number, kind?: BindKind): Binding;
  on: boolean;
  path(...parts: (string | number | undefined)[]): string;
  field(sub: string | number): string | undefined;
  kind(kind?: BindKind): BindKind | undefined;
  format(format: string): string | undefined;
}
export declare function binder(base: string): Binder;
export declare function bindSection(index: number): { 'data-ms-section'?: string };
export declare function sectionBinder(index: number): Binder;
