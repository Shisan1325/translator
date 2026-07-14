import { scanTextNodesInIdle } from '../dom/walker.js';
import { TextReplacer } from '../dom/replacer.js';
import { IncrementalObserver } from '../dom/observer.js';

export class TranslationController {
  constructor({ provider, cache, getSettings, onProgress = () => {}, onError = () => {} }) {
    this.provider = provider;
    this.cache = cache;
    this.getSettings = getSettings;
    this.onProgress = onProgress;
    this.onError = onError;
    this.replacer = new TextReplacer();
    this.queue = Promise.resolve();
    this.dynamicRoots = new Set();
    this.dynamicTask = null;
    this.enabled = false;
    this.generation = 0;
    this.observer = new IncrementalObserver((roots, removedRoots) => this.translateDynamicRoots(roots, removedRoots));
  }

  async translatePage() {
    const generation = ++this.generation;
    this.enabled = true;
    if (this.getSettings().translateDynamic) this.observer.start(document.body);
    return this.translateRoot(document.body, { visibleOnly: false, generation });
  }

  async translateVisible() {
    const generation = ++this.generation;
    this.enabled = true;
    if (this.getSettings().translateDynamic) this.observer.start(document.body);
    return this.translateRoot(document.body, { visibleOnly: true, generation });
  }

  async translateRoot(root, { visibleOnly, generation }) {
    const pending = new Map();
    let translated = 0;
    const flush = async () => {
      if (!pending.size || generation !== this.generation) return;
      const nodes = [...pending.values()].flat();
      pending.clear();
      translated += await this.enqueueNodes(nodes, generation);
    };
    await scanTextNodesInIdle(root, this.getSettings(), {
      visibleOnly,
      onChunk: async (nodes) => {
        if (generation !== this.generation) return;
        for (const node of nodes) {
          const source = this.replacer.sourceFor(node);
          if (!source?.trim()) continue;
          const list = pending.get(source) || [];
          list.push(node);
          pending.set(source, list);
        }
        if (pending.size >= this.getSettings().batchSize) await flush();
      },
    });
    await flush();
    return translated;
  }

  enqueueNodes(nodes, generation = this.generation) {
    const task = this.queue.then(() => generation === this.generation ? this.translateNodes(nodes, generation) : 0);
    // 队列本身必须在失败后继续可用；但手动翻译调用者仍应收到真实错误，
    // 而不是把请求失败误报成“没有可翻译文本”。
    this.queue = task.catch(() => 0);
    return task;
  }

  async translateNodes(nodes, generation = this.generation) {
    const settings = this.getSettings();
    const byText = new Map();
    for (const node of nodes) {
      if (!node.isConnected) continue;
      const text = this.replacer.sourceFor(node);
      if (!text?.trim()) continue;
      const matching = byText.get(text) || [];
      matching.push(node);
      byText.set(text, matching);
    }
    const texts = [...byText.keys()];
    if (!texts.length) return 0;
    const translated = new Map();
    const missing = [];
    for (const text of texts) {
      const input = { sourceLanguage: settings.sourceLanguage, targetLanguage: settings.targetLanguage, text };
      const cached = settings.cacheEnabled ? this.cache.get(input) : undefined;
      if (cached !== undefined) translated.set(text, cached);
      else missing.push(text);
    }
    if (missing.length) {
      const results = await this.provider.translateBatch(missing, settings);
      if (generation !== this.generation) return 0;
      missing.forEach((text, index) => {
        const value = results[index];
        translated.set(text, value);
        if (settings.cacheEnabled) this.cache.set({ sourceLanguage: settings.sourceLanguage, targetLanguage: settings.targetLanguage, text }, value);
      });
    }
    let count = 0;
    for (const [text, matching] of byText) {
      for (const node of matching) {
        if (generation === this.generation && node.isConnected && this.replacer.sourceFor(node) === text && this.replacer.apply(node, translated.get(text))) count += 1;
      }
    }
    if (count) this.onProgress(count);
    return count;
  }

  async translateText(text, overrides = {}) {
    const settings = { ...this.getSettings(), ...overrides };
    const input = { sourceLanguage: settings.sourceLanguage, targetLanguage: settings.targetLanguage, text };
    const cached = settings.cacheEnabled ? this.cache.get(input) : undefined;
    if (cached !== undefined) return cached;
    const translated = await this.provider.translate(text, settings);
    if (settings.cacheEnabled) this.cache.set(input, translated);
    return translated;
  }

  translateDynamicRoots(roots, removedRoots = []) {
    for (const root of removedRoots) {
      if (!root.isConnected) this.replacer.forgetTree(root);
    }
    this.replacer.pruneDisconnected();
    if (!this.enabled || !this.getSettings().translateDynamic) return;
    for (const root of roots) {
      if (!root || (root.nodeType === Node.TEXT_NODE && this.replacer.isOwnTranslation(root))) continue;
      this.dynamicRoots.add(root);
    }
    if (!this.dynamicRoots.size) {
      this.replacer.pruneDisconnected();
      return;
    }
    return this.scheduleDynamicTranslation();
  }

  scheduleDynamicTranslation() {
    if (this.dynamicTask) return this.dynamicTask;
    const task = this.queue.then(async () => {
      const generation = this.generation;
      if (!this.enabled || !this.getSettings().translateDynamic) return 0;
      const pendingRoots = this.compactDynamicRoots([...this.dynamicRoots]);
      this.dynamicRoots.clear();
      if (generation !== this.generation) return 0;
      const nodes = [];
      for (const root of pendingRoots) {
        if (root.nodeType !== Node.TEXT_NODE && !root.isConnected) continue;
        await scanTextNodesInIdle(root, this.getSettings(), {
          onChunk: async (chunk) => nodes.push(...chunk.filter((node) => !this.replacer.isOwnTranslation(node))),
        });
      }
      if (generation !== this.generation) return 0;
      const translated = await this.translateNodes(nodes, generation);
      this.replacer.pruneDisconnected();
      return translated;
    });
    this.dynamicTask = task;
    this.queue = task.catch((error) => {
      this.onError(error);
      return 0;
    });
    task.then(
      () => this.finishDynamicTranslation(),
      () => this.finishDynamicTranslation(),
    );
    return task;
  }

  finishDynamicTranslation() {
    this.dynamicTask = null;
    if (this.enabled && this.getSettings().translateDynamic && this.dynamicRoots.size) this.scheduleDynamicTranslation();
  }

  compactDynamicRoots(roots) {
    return roots.filter((root) => !roots.some((other) => other !== root && other.contains?.(root)));
  }

  restore() {
    this.generation += 1;
    this.enabled = false;
    this.dynamicRoots.clear();
    this.observer.stop();
    return this.replacer.restoreAll();
  }

  refreshDynamicObserver() {
    if (!this.enabled) return;
    if (this.getSettings().translateDynamic) {
      if (!this.observer.observer) this.observer.start(document.body);
    }
    else {
      this.dynamicRoots.clear();
      this.observer.stop();
    }
  }
}
