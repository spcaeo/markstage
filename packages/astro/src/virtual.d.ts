// The modules the integration generates for page.astro.
declare module 'virtual:markstage/meta' {
  const meta: { lang: string; siteName: string; favicon: string | null; preload: string[] };
  export default meta;
}
declare module 'virtual:markstage/page-data' {
  const pageData: () => Record<string, unknown> | Promise<Record<string, unknown>>;
  export default pageData;
}
declare module 'virtual:markstage/client' {}
