/// <reference types="vite/client" />
// The preview agent's entry: the screen checks (device/agent.ts, which starts itself from its script tag) and,
// when the pages editor has one, its in-page agent (pages/agent.ts, registered with onRequest), and the section
// gallery's (gallery/agent.ts). Built into
// dist/preview-agent.js (scripts/build-agent.mjs); in dev the Astro integration imports it and calls listen().
export { listen, onRequest, post } from './device/agent';
import.meta.glob(['./pages/agent.ts', './gallery/agent.ts'], { eager: true });
