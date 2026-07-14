const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

export class IncrementalObserver {
  constructor(onRoots, { debounceMs = 500 } = {}) {
    this.onRoots = onRoots;
    this.debounceMs = debounceMs;
    this.observer = null;
    this.root = null;
    this.pendingRoots = new Set();
    this.pendingRemovedRoots = new Set();
    this.timer = null;
    this.flushScheduled = false;
    this.onVisibilityEvent = (event) => {
      this.addRoot(event.target);
      this.scheduleFlush();
    };
  }

  start(root = document.body) {
    this.stop();
    this.root = root;
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') this.addRoot(mutation.target.parentElement || mutation.target);
        if (mutation.type === 'attributes') {
          this.addRoot(mutation.target);
          if (mutation.attributeName === 'aria-expanded' || mutation.attributeName === 'aria-controls' || mutation.attributeName === 'aria-owns') {
            this.addAriaControlledRoots(mutation.target);
          }
        }
        for (const node of mutation.addedNodes) {
          this.addRoot(node);
        }
        for (const node of mutation.removedNodes) {
          this.addRemovedRoot(node);
        }
      }
      this.scheduleFlush();
    });
    this.observer.observe(root, {
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'class', 'style', 'hidden', 'inert', 'aria-hidden', 'aria-expanded', 'aria-controls', 'aria-owns',
        'open', 'data-state', 'data-open', 'data-expanded', 'data-visible',
      ],
      subtree: true,
    });
    root.addEventListener('transitionend', this.onVisibilityEvent, true);
    root.addEventListener('animationend', this.onVisibilityEvent, true);
    root.addEventListener('toggle', this.onVisibilityEvent, true);
  }

  addRoot(node) {
    if (node?.nodeType === TEXT_NODE) node = node.parentElement;
    if (node?.nodeType === ELEMENT_NODE) this.pendingRoots.add(node);
  }

  addRemovedRoot(node) {
    if (node?.nodeType === TEXT_NODE || node?.nodeType === ELEMENT_NODE) this.pendingRemovedRoots.add(node);
  }

  addAriaControlledRoots(element) {
    const ids = [element.getAttribute?.('aria-controls'), element.getAttribute?.('aria-owns')]
      .filter(Boolean)
      .flatMap((value) => value.trim().split(/\s+/));
    for (const id of ids) this.addRoot(element.ownerDocument?.getElementById(id));
  }

  scheduleFlush() {
    if (!this.pendingRoots.size && !this.pendingRemovedRoots.size) return;
    if (this.debounceMs > 0) {
      if (this.timer) clearTimeout(this.timer);
      this.flushScheduled = true;
      this.timer = setTimeout(() => this.flush(), this.debounceMs);
      return;
    }
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => this.flush());
  }

  flush() {
    this.timer = null;
    this.flushScheduled = false;
    const roots = this.compactRoots(this.pendingRoots);
    const removedRoots = this.compactRoots(this.pendingRemovedRoots);
    this.pendingRoots.clear();
    this.pendingRemovedRoots.clear();
    if (roots.length || removedRoots.length) this.onRoots(roots, removedRoots);
  }

  compactRoots(roots) {
    const nodes = [...roots];
    return nodes.filter((node) => !nodes.some((other) => other !== node && other.contains?.(node)));
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.flushScheduled = false;
    this.pendingRoots.clear();
    this.pendingRemovedRoots.clear();
    this.observer?.disconnect();
    this.observer = null;
    this.root?.removeEventListener('transitionend', this.onVisibilityEvent, true);
    this.root?.removeEventListener('animationend', this.onVisibilityEvent, true);
    this.root?.removeEventListener('toggle', this.onVisibilityEvent, true);
    this.root = null;
  }
}
