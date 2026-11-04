// Node views of the core atoms: HTML the converter kept as written (a block, shown rendered, its source edited in
// the panel; or a piece inside a line). A click selects the whole atom. Markdown images: image.ts.
// The HTML is drawn cleaned (canvas-shell/dom.ts cleanHtml): no script, frame, meta, style, form or event handler
// reaches the editor's document, nothing positioned leaves its box, and its links never navigate (holdLinks); the
// saved source is kept as written.
import { assetUrl } from '../assets';
import { cleanHtml, holdLinks } from '../canvas-shell/dom';
import { BoxView, el } from './base';

export abstract class AtomView extends BoxView {
  ignoreMutation() {
    return true;
  }
  stopEvent(_e: Event): boolean {
    return false;
  }
}

/** HTML the converter does not model: shown rendered; its source is edited in the panel. */
export class RawHtmlView extends AtomView {
  dom = el('div', 'ms-raw');
  private html = '';
  constructor(...a: ConstructorParameters<typeof BoxView>) {
    super(...a);
    holdLinks(this.dom);
    this.render();
  }
  render() {
    if (this.html === this.node.attrs.html) return;
    this.html = this.node.attrs.html ?? '';
    this.dom.replaceChildren(cleanHtml(this.html));
  }
}

/** `![alt](src "title")` kept as written inside a line (a logo in a table cell): the site renders it as an image. */
const MD_IMAGE = /^!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)$/;

export class RawInlineView extends AtomView {
  dom = el('span', 'ms-raw-inline');
  constructor(...a: ConstructorParameters<typeof BoxView>) {
    super(...a);
    holdLinks(this.dom);
    this.render();
  }
  render() {
    const html = this.node.attrs.html ?? '';
    this.dom.classList.remove('ms-raw-inline--code');
    this.dom.title = 'HTML kept as written';
    const md = MD_IMAGE.exec(html.trim());
    if (md) {
      const img = el('img');
      img.src = assetUrl(md[2]);
      img.alt = md[1];
      if (md[3]) img.title = md[3];
      this.dom.replaceChildren(img);
      this.dom.title = 'Image kept as written';
      return;
    }
    this.dom.replaceChildren(cleanHtml(html, document, { inline: true }));
    // a piece of HTML with nothing to show (an opening or closing tag on its own) is shown as its source
    if (!this.dom.textContent?.trim() && !this.dom.querySelector('img, svg, br')) {
      this.dom.textContent = html;
      this.dom.classList.add('ms-raw-inline--code');
    }
  }
}
