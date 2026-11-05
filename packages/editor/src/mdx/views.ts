// How the code parts of an MDX file are drawn on the canvas (nodes.ts): a quiet line for the imports and exports, a
// card for each component (its name and settings; for a container, its text, which is typed in as usual), a small
// token for code inside a line. None of the code can be typed into: it is the site's, kept as written.
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import { ic } from '../icons';
import { AtomView } from '../views/core';
import { BoxView, chrome, el } from '../views/base';
import { codeWords, componentName, propText, type Prop } from './model';
import '../styles/mdx.css';

/** The head of a component card: an icon, the name, its settings, and that the code is kept. */
function cardHead(node: PMNode): HTMLElement {
  const head = chrome('div', 'ms-mdx-card__head');
  head.dataset.msUi = '';
  const name = el('span', 'ms-mdx-card__name');
  name.textContent = componentName(node.attrs);
  const props = el('span', 'ms-mdx-card__props');
  props.textContent = ((node.attrs.props ?? []) as Prop[]).map(propText).join('  ');
  const lock = el('span', 'ms-mdx-card__lock', `${ic('lock', 12)}<span>Component</span>`);
  lock.title = 'Part of the site’s code: kept as written. Click the card for its settings.';
  head.append(el('span', 'ms-mdx-card__icon', ic('blocks', 14)), name, props, lock);
  return head;
}

/** A component whose children are not edited here: its card, with the inside shown as written. */
export class ComponentView extends AtomView {
  dom = el('div', 'ms-mdx-card');
  constructor(...a: ConstructorParameters<typeof BoxView>) {
    super(...a);
    this.dom.contentEditable = 'false';
    this.render();
  }
  render() {
    const source = String(this.node.attrs.source ?? '');
    const parts: HTMLElement[] = [cardHead(this.node)];
    // a component with something inside (not <X />): the inside, read-only
    if (!/\/>\s*$/.test(source)) {
      const pre = el('pre', 'ms-mdx-card__src');
      pre.textContent = source;
      parts.push(pre);
    }
    this.dom.dataset.msMdx = 'component';
    this.dom.dataset.name = componentName(this.node.attrs);
    this.dom.replaceChildren(...parts);
  }
}

/** A component holding text: its card, the text typed in as anywhere else. */
export class ContainerView extends BoxView {
  dom = el('div', 'ms-mdx-card ms-mdx-card--holds');
  contentDOM = el('div', 'ms-mdx-card__body');
  private head: HTMLElement | null = null;
  constructor(...a: ConstructorParameters<typeof BoxView>) {
    super(...a);
    this.dom.dataset.msMdx = 'container';
    this.dom.append(this.contentDOM);
    this.render();
  }
  render() {
    const head = cardHead(this.node);
    // a click on the head selects the component (its settings open); a click in its text types there
    head.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const pos = this.getPos();
      if (pos === undefined) return;
      this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
      this.view.focus();
    });
    if (this.head) this.head.replaceWith(head);
    else this.dom.prepend(head);
    this.head = head;
    this.dom.dataset.name = componentName(this.node.attrs);
  }
}

/** Imports, exports, an {expression} on its own line, or a part kept whole: a quiet locked line. */
export class CodeView extends AtomView {
  dom = el('div', 'ms-mdx-code');
  constructor(...a: ConstructorParameters<typeof BoxView>) {
    super(...a);
    this.dom.contentEditable = 'false';
    this.render();
  }
  render() {
    const kind = String(this.node.attrs.kind ?? 'expression');
    const source = String(this.node.attrs.source ?? '');
    this.dom.dataset.msMdx = kind;
    const line = el('span', 'ms-mdx-code__words', `${ic('lock', 12)}<span></span>`);
    line.querySelector('span')!.textContent = codeWords(kind, source);
    const parts: HTMLElement[] = [line];
    if (kind !== 'esm') {
      const pre = el('pre', 'ms-mdx-code__src');
      pre.textContent = source;
      parts.push(pre);
    }
    this.dom.replaceChildren(...parts);
  }
}

/** JSX or an {expression} inside a line: one token, kept as written. */
export class InlineView extends AtomView {
  dom = el('span', 'ms-mdx-inline');
  constructor(...a: ConstructorParameters<typeof BoxView>) {
    super(...a);
    this.dom.contentEditable = 'false';
    this.render();
  }
  render() {
    const source = String(this.node.attrs.source ?? '');
    this.dom.textContent = source.length > 60 ? `${source.slice(0, 57)}…` : source;
    this.dom.title = this.node.attrs.name ? `The ${this.node.attrs.name} component: code, kept as written` : 'Code, kept as written';
  }
}
