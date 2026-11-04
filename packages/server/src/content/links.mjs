// The link rewriter of a move (linkRewriter, movePairs, rewriteEntry) lives in core (@markstage/core/links), so the
// astro dev API's move rewrites links the same way. Without core installed, a move says so instead of starting.
const core = await import('@markstage/core/links').catch((e) => {
  if (e?.code === 'ERR_MODULE_NOT_FOUND' || e?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') return null;
  throw e;
});
const missing = () => {
  throw new Error('Moving an entry needs @markstage/core, which is not installed.');
};

export const movePairs = core?.movePairs ?? missing;
export const linkRewriter = core?.linkRewriter ?? missing;
export const rewriteEntry = core?.rewriteEntry ?? missing;
