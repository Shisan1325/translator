import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, getSiteAutoTranslatePreference, normalizeSettings, shouldAutoTranslateSite } from '../src/config/defaults.js';
import { Dialog, openSettings } from '../src/ui/dialog.js';

const t = (key, values = {}) => key.replace(/\{(\w+)\}/g, (_, name) => values[name] || '');

describe('设置页', () => {
  it('仅展示微软翻译可用的设置，并保存填写的值', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const dialog = new Dialog(root);
    let saved;
    openSettings(dialog, t, DEFAULT_SETTINGS, async (value) => { saved = value; });

    expect(root.querySelector('.tr-combobox')).not.toBeNull();
    expect(root.querySelector('.tr-textarea')).toBeNull();
    expect(root.textContent).not.toContain('translateCode');
    root.querySelector('.tr-primary').click();
    await Promise.resolve();

    expect(saved).toMatchObject({
      sourceLanguage: DEFAULT_SETTINGS.sourceLanguage,
      targetLanguage: DEFAULT_SETTINGS.targetLanguage,
    });
    expect(saved).not.toHaveProperty('translateCode');
    root.remove();
  });

  it('按网站偏好覆盖全局自动翻译默认值，并迁移旧黑名单', () => {
    const settings = normalizeSettings({
      autoTranslate: true,
      siteAutoTranslatePreferences: { 'docs.example.org': true },
      autoTranslateBlacklist: 'https://www.example.com/path\nnews.example.org',
    });
    expect(settings.siteAutoTranslatePreferences).toEqual({
      'docs.example.org': true,
      'example.com': false,
      'news.example.org': false,
    });
    expect(getSiteAutoTranslatePreference('www.example.com', settings.siteAutoTranslatePreferences)).toBe(false);
    expect(getSiteAutoTranslatePreference('docs.example.com', settings.siteAutoTranslatePreferences)).toBe(false);
    expect(shouldAutoTranslateSite('example.com', settings)).toBe(false);
    expect(shouldAutoTranslateSite('docs.example.org', settings)).toBe(true);
    expect(shouldAutoTranslateSite('unconfigured.example', settings)).toBe(true);
  });

  it('损坏设置会回退默认值，并支持单段主机名偏好', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('invalid')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(42)).toEqual(DEFAULT_SETTINGS);
    expect(getSiteAutoTranslatePreference('localhost', { localhost: true })).toBe(true);
    expect(getSiteAutoTranslatePreference('127.0.0.1', { '127.0.0.1': false })).toBe(false);
  });
});
