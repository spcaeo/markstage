// The section gallery (#/gallery/<collection>, screen.ts): every section type and variation drawn alone by the
// site's own components through the preview. Not in the navigation: the Library links to it.
import { registerScreen } from '../host';
import '../styles/gallery.css';
import { mountGallery } from './screen';

registerScreen({ name: 'gallery', label: 'Section gallery', icon: 'sections', nav: null, group: 'tools', mount: mountGallery });
