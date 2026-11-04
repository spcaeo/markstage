// The Library (#/library, screen.ts): page templates, sections and snippets in one place, kept by the Markstage
// server. In the rail, since writers reach for it often; on a page it also opens beside the canvas (panel.ts).
import { registerScreen } from '../host';
import '../styles/reusable.css';
import '../styles/snippets.css';
import { mountLibrary } from './screen';

registerScreen({ name: 'library', label: 'Reusable sections', icon: 'blocks', nav: 'main', menuLabel: 'Reusable sections', mount: mountLibrary });
