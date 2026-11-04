// Tables as Markdown renders them: a <table> (in a scrolling wrapper so a wide one fits the canvas). A block pack can
// give its own view (the site's table box) through `tableView`.
import type { Node as PMNode } from '@tiptap/pm/model';
import type { NodeView, ViewMutationRecord } from '@tiptap/pm/view';

export class TableView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;

  constructor(public node: PMNode) {
    this.dom = document.createElement('div');
    this.dom.className = 'ms-table';
    const table = this.dom.appendChild(document.createElement('table'));
    this.contentDOM = table.appendChild(document.createElement('tbody'));
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    return true;
  }

  ignoreMutation(m: ViewMutationRecord) {
    return !this.contentDOM.contains(m.target as Node);
  }
}
