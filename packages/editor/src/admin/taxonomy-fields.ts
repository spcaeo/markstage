// Which fields the Categories and tags screen offers (taxonomy.ts): only the ones the site config declares as a
// taxonomy, that is a Post settings field of type `tags` (categories, tags) or a plain `select` (a category with
// fixed choices), never a select that points at another collection (a topic, an author), a date, an order or any
// other shared value. A site whose collections declare no settings at all falls back to the server's list fields.
import type { CollectionInfo } from '../runtime';

export interface TaxonomyField {
  /** the frontmatter key (what the server's taxonomy routes take) */
  name: string;
  /** what people see on the tab */
  label: string;
}

/** The server's view of a field (api.BulkField's shape, the parts used here). */
export interface ServerField {
  name: string;
  kind: 'list' | 'text' | 'number' | 'boolean';
}

export function taxonomyFields(collections: Pick<CollectionInfo, 'settings'>[], serverFields: ServerField[]): TaxonomyField[] {
  const declared = collections.some((c) => c.settings?.length);
  if (!declared) return serverFields.filter((f) => f.kind === 'list').map((f) => ({ name: f.name, label: f.name }));
  const out = new Map<string, TaxonomyField>();
  for (const c of collections) {
    for (const s of c.settings ?? []) {
      if (s.type === 'tags' || (s.type === 'select' && !s.from)) {
        if (!out.has(s.key)) out.set(s.key, { name: s.key, label: s.label });
      }
    }
  }
  return [...out.values()];
}
