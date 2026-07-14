export class MemoryTranslationCache {
  constructor(maxEntries = 2_000) {
    this.entries = new Map();
    this.maxEntries = maxEntries;
  }

  key({ sourceLanguage, targetLanguage, text }) {
    return JSON.stringify([sourceLanguage, targetLanguage, text]);
  }

  get(input) {
    const key = this.key(input);
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(input, value) {
    const key = this.key(input);
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
  }

  clear() {
    this.entries.clear();
  }
}
