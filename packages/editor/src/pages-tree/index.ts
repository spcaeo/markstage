// The Page tree (#/tree/<collection>): the site's pages by address, reordered on the order component (tree.ts).
import { registerScreen } from '../host';
import '../styles/pages-tree.css';
import { mountTree } from './tree';

registerScreen({ name: 'tree', label: 'Page tree', icon: 'layers', nav: 'main', menuLabel: 'Page tree', roles: ['owner', 'administrator', 'editor'], mount: mountTree });
