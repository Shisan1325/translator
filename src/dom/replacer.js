export class TextReplacer {
  constructor() {
    this.records = new WeakMap();
    this.nodes = new Set();
  }

  sourceFor(node) {
    const record = this.records.get(node);
    if (!record) return node.nodeValue;
    if (node.nodeValue === record.translated) return record.original;
    this.records.delete(node);
    this.nodes.delete(node);
    return node.nodeValue;
  }

  isOwnTranslation(node) {
    const record = this.records.get(node);
    return Boolean(record && node.nodeValue === record.translated);
  }

  forget(node) {
    this.records.delete(node);
    this.nodes.delete(node);
  }

  forgetTree(root) {
    if (root?.nodeType === 3) {
      this.forget(root);
      return;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) this.forget(node);
  }

  pruneDisconnected() {
    for (const node of this.nodes) {
      if (!node.isConnected) this.forget(node);
    }
  }

  apply(node, translated) {
    const original = this.sourceFor(node);
    if (typeof original !== 'string' || node.nodeValue !== original && !this.records.has(node)) return false;
    node.nodeValue = translated;
    this.records.set(node, { original, translated });
    this.nodes.add(node);
    return true;
  }

  restoreAll() {
    let restored = 0;
    for (const node of this.nodes) {
      const record = this.records.get(node);
      if (!record || !node.isConnected) {
        this.forget(node);
        continue;
      }
      if (node.nodeValue === record.translated) {
        node.nodeValue = record.original;
        restored += 1;
      }
      this.forget(node);
    }
    return restored;
  }
}
