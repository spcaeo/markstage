// The editor as the server serves it in the end-to-end tests: the shell's styles (in the order the astro integration
// loads them; build-editor.mjs refuses to build when one is missing), start() with the test site's client config
// (from build-editor.mjs), and so the admin screens (src/admin/**), which the shell imports itself.
import '../../editor/src/styles/chrome.css';
import '../../editor/src/styles/status.css';
import '../../editor/src/styles/canvas.css';
import '../../editor/src/styles/settings.css';
import '../../editor/src/styles/device.css';
import '../../editor/src/styles/host.css';
import '../../editor/src/styles/image.css';
// @ts-expect-error: provided by build-editor.mjs
import config from 'virtual:markstage-e2e/config';
import { start } from '../../editor/src/index';

start({ config, packs: [], markdown: [] });
