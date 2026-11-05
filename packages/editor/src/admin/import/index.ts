// Import a site (editors and above), docs/IMPORT.md: a WordPress, Ghost or Prismic site in one step. Every state is
// in the URL:
//   #/import                                         where it comes from, and the imports made before
//   #/import?source=wordpress|ghost|prismic&from=file|api   its export file, or its API's details
//   #/import/<rid>?show=entries|media|review|redirects&q=&kind=   the plan (a dry run), the run, then its report
// The server reads the source, plans (writing nothing), and runs it as a job; see start.ts and plan.ts.
import type { ScreenCtx } from '../../host';
import { el, isEditorPlus, page, state, whoami } from '../ui';
import type { Product } from './api';
import { planView, type PlanView } from './plan';
import { chooseSource, sourceForm } from './start';
import './import.css';
import { PRODUCT } from './words';

const PRODUCTS = ['wordpress', 'ghost', 'prismic'];

export function mountImport(host: HTMLElement, ctx: ScreenCtx) {
  const p = page(host, 'Import a site', 'Bring a whole site over from WordPress, Ghost or Prismic: its posts and pages, images and files, authors, categories and tags, with the old addresses sent to the new pages. You see the full plan before anything is written.');
  p.root.classList.add('ms-imp');
  const setHead = (title: string, intro: string) => {
    p.head.querySelector('.ms-adm-title')!.textContent = title;
    const i = p.head.querySelector('.ms-adm-intro');
    if (i) i.textContent = intro;
    ctx.setTitle(title);
  };
  let view: PlanView | null = null;
  let alive = true;

  async function draw(): Promise<void> {
    p.body.replaceChildren(state('loading', 'Loading…'));
    if (!isEditorPlus(await whoami())) return void p.body.replaceChildren(state('denied', 'Not available to you', 'Editors, administrators and the owner import sites.'));
    if (!alive) return;
    const rid = ctx.args[0];
    if (rid) {
      view = planView(p.body, p.actions, p.bar, ctx, rid, setHead);
      return;
    }
    const source = ctx.params().get('source');
    p.actions.replaceChildren();
    p.bar.hidden = true;
    if (source && PRODUCTS.includes(source)) {
      setHead(`Import from ${PRODUCT[source as Product]}`, 'Nothing is written until you have seen the plan and chosen to run it.');
      const back = el('a.ms-adm-rowlink', { href: '#/import' }, 'Another source');
      back.addEventListener('click', (e) => {
        e.preventDefault();
        ctx.go({ params: { source: null, from: null } }, true);
      });
      p.actions.append(back);
      sourceForm(p.body, ctx, source as Product);
    } else {
      setHead('Import a site', 'Bring a whole site over from WordPress, Ghost or Prismic. You see the full plan before anything is written.');
      chooseSource(p.body, ctx);
    }
  }

  void draw();
  return {
    update: () => (view ? view.update() : void draw()),
    destroy: () => {
      alive = false;
      view?.destroy();
    },
  };
}
