import { describe, expect, it } from 'vitest';
import { MemoryTranslationCache } from '../src/utils/cache.js';

describe('MemoryTranslationCache', () => {
  it('按翻译源、语言和原文隔离缓存', () => {
    const cache = new MemoryTranslationCache();
    const input = { sourceLanguage: 'auto', targetLanguage: 'zh-Hans', text: 'hello' };
    cache.set(input, '你好');
    expect(cache.get(input)).toBe('你好');
    expect(cache.get({ ...input, targetLanguage: 'en' })).toBeUndefined();
    expect(cache.get({ ...input, text: 'Hello' })).toBeUndefined();
  });

  it('超过上限时淘汰最久未使用的翻译', () => {
    const cache = new MemoryTranslationCache(2);
    const base = { sourceLanguage: 'auto', targetLanguage: 'zh-Hans' };
    cache.set({ ...base, text: 'one' }, '一');
    cache.set({ ...base, text: 'two' }, '二');
    cache.get({ ...base, text: 'one' });
    cache.set({ ...base, text: 'three' }, '三');

    expect(cache.get({ ...base, text: 'one' })).toBe('一');
    expect(cache.get({ ...base, text: 'two' })).toBeUndefined();
    expect(cache.get({ ...base, text: 'three' })).toBe('三');
  });
});
