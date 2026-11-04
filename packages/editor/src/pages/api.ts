// The API calls the page editor makes beyond api.ts: the collection's field schema and the JSON save (a list of
// changes, docs/API.md "Save"). Through api.ts's request(): same base, CSRF token, 401 and errors (ApiError: 409 =
// changed elsewhere, with its version).
import { ApiError, request } from '../api';
import type { Change, Field } from './types';

const enc = encodeURIComponent;

/** The entry schema of a collection (core's descriptor), or null when the server has none. */
export async function getSchema(collection: string): Promise<Field | null> {
  try {
    const r = await request<{ entry?: Field }>(`collections/${enc(collection)}/schema`);
    return r.entry ?? null;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 405)) return null;
    throw err;
  }
}

export const saveChanges = (collection: string, id: string, changes: Change[], version: string) =>
  request<{ ok: true; version: string; changedBlocks: number }>(`collections/${enc(collection)}/entries/${enc(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ version, changes }),
  });
