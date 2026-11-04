// The virtual modules the Astro package's client.mjs answers (virtualPlugin), for the type check.
declare module 'virtual:markstage/release' {
  const release: { version: string; commit: string | null; build: number | null; builtAt: string | null; timeZone: string; line: string };
  export default release;
}
