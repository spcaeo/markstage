export interface CspProblem { kind: 'handler' | 'style-attr' | 'javascript-url'; tag: string; attr: string; message: string }
export interface CspNeeds { script: string[]; style: string[]; scriptOrigins: string[]; styleOrigins: string[]; problems: CspProblem[] }
/** "'sha256-…'" for an inline script or style (UTF-8, exact text). */
export function cspHash(text: string): string;
/** What the inline code of an HTML text needs from the page's Content-Security-Policy. */
export function cspHashes(html: string): CspNeeds;
/** The policy with those added to script-src and style-src (never next to a bare 'unsafe-inline'). */
export function withCspSources(policy: string, needs: Partial<CspNeeds>): string;
