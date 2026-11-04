// The Translations screen (#/translations, screen.ts): what each region still needs in its own words. Reached from
// the More menu, and only on a site whose locales take a title or description of their own.
import { registerScreen } from '../host';
import '../styles/translations.css';
import { mountTranslations } from './screen';

registerScreen({ name: 'translations', label: 'Languages', icon: 'globe', nav: 'main', group: 'site', menuLabel: 'Languages', mount: mountTranslations });
