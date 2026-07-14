import { describe, expect, it, vi } from 'vitest';
import { TranslationInputPopup } from '../src/selection/popup.js';

const t = (key) => key;

describe('TranslationInputPopup', () => {
  it('提供输入、源语言、目标语言与自动翻译结果', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const translate = vi.fn().mockResolvedValue('translated text');
    const popup = new TranslationInputPopup(root, t, { show: () => {} }, {
      getSettings: () => ({ sourceLanguage: 'auto', targetLanguage: 'zh-Hans' }), translate,
    });
    popup.open({ text: 'original text', autoTranslate: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(root.querySelector('.tr-overlay')).not.toBeNull();
    expect(root.querySelector('.tr-translation-input').value).toBe('original text');
    expect(root.querySelectorAll('.tr-combobox')).toHaveLength(2);
    expect(root.querySelector('.tr-translation-languages')).not.toBeNull();
    expect(popup.copyButton.querySelector('svg')).not.toBeNull();
    expect(translate).toHaveBeenCalledWith('original text', { sourceLanguage: 'auto', targetLanguage: 'zh-Hans' });
    expect(root.textContent).toContain('translated text');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(root.querySelector('.tr-overlay')).toBeNull();
    root.remove();
  });

  it('Enter 翻译，Shift+Enter 保持为输入换行快捷键', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const translate = vi.fn().mockResolvedValue('done');
    const popup = new TranslationInputPopup(root, t, { show: () => {} }, {
      getSettings: () => ({ sourceLanguage: 'auto', targetLanguage: 'zh-Hans' }), translate,
    });
    popup.open({ text: 'hello' });
    expect(popup.result.dataset.state).toBe('placeholder');
    expect(popup.copyButton.disabled).toBe(true);
    popup.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
    expect(translate).not.toHaveBeenCalled();
    popup.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(translate).toHaveBeenCalledOnce();
    expect(popup.result.dataset.state).toBe('translated');
    expect(popup.copyButton.disabled).toBe(false);
    popup.close();
    root.remove();
  });

  it('滚动时保持弹窗，点击遮罩空白处才关闭', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const popup = new TranslationInputPopup(root, t, { show: () => {} }, {
      getSettings: () => ({ sourceLanguage: 'auto', targetLanguage: 'zh-Hans' }), translate: vi.fn(),
    });
    popup.open();
    window.dispatchEvent(new Event('scroll'));
    expect(root.querySelector('.tr-overlay')).not.toBeNull();
    root.querySelector('.tr-overlay').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(root.querySelector('.tr-overlay')).toBeNull();
    root.remove();
  });

  it('弹窗关闭后忽略尚未完成的自动翻译结果', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    let resolve;
    const popup = new TranslationInputPopup(root, t, { show: () => {} }, {
      getSettings: () => ({ sourceLanguage: 'auto', targetLanguage: 'zh-Hans' }),
      translate: () => new Promise((done) => { resolve = done; }),
    });
    popup.open({ text: 'original' });
    const pending = popup.run();
    popup.close();
    resolve('late result');
    await expect(pending).resolves.toBeUndefined();
    expect(root.querySelector('.tr-overlay')).toBeNull();
    root.remove();
  });

  it('旧会话完成不会解除新会话的翻译锁', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const resolvers = new Map();
    const translate = vi.fn((text) => new Promise((resolve) => resolvers.set(text, resolve)));
    const popup = new TranslationInputPopup(root, t, { show: () => {} }, {
      getSettings: () => ({ sourceLanguage: 'auto', targetLanguage: 'zh-Hans' }), translate,
    });

    popup.open({ text: 'first' });
    const first = popup.run();
    popup.close();
    popup.open({ text: 'second' });
    const second = popup.run();
    resolvers.get('first')('第一个译文');
    await Promise.resolve();
    await Promise.resolve();
    popup.run();
    expect(translate).toHaveBeenCalledTimes(2);
    resolvers.get('second')('第二个译文');
    await Promise.all([first, second]);
    popup.close();
    root.remove();
  });

  it('翻译失败时显示具体错误提示', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const toast = { show: vi.fn() };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const popup = new TranslationInputPopup(root, t, toast, {
      getSettings: () => ({ sourceLanguage: 'auto', targetLanguage: 'zh-Hans' }),
      translate: vi.fn().mockRejectedValue(new Error('微软翻译请求失败（HTTP 429）')),
    });

    popup.open({ text: 'hello' });
    await popup.run();

    expect(toast.show).toHaveBeenCalledWith('error', { duration: 8_000 });
    popup.close();
    consoleError.mockRestore();
    root.remove();
  });
});
