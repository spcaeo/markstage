// The Translations screen (#/translations, screen.ts): what each region still needs in its own words. Reached from
// the More menu, and only on a site whose locales take a title or description of their own. From it, Translate the
// site (#/translate, site.ts): an AI draft of every entry in one region, for people to review.
import { registerScreen } from '../host';
import '../styles/translations.css';
import { mountTranslations } from './screen';
import { mountTranslateSite } from './site';

registerScreen({ name: 'translations', label: 'Languages', icon: 'globe', nav: 'main', group: 'site', menuLabel: 'Languages', mount: mountTranslations });
registerScreen({ name: 'translate', label: 'Translate the site', icon: 'globe', nav: null, mount: mountTranslateSite });
