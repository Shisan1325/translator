import { describe, expect, it, vi } from 'vitest';
import { SettingsStore } from '../src/utils/storage.js';

describe('SettingsStore', () => {
  it('按顺序基于最新设置合并异步更新，并立即启动第一项写入', async () => {
    let releaseFirstWrite;
    const writes = [];
    const api = {
      getValue: vi.fn(async (key) => key === 'translator.settings.v2'
        ? { toolbarMode: 'expanded', autoTranslate: false }
        : undefined),
      setValue: vi.fn((key, value) => {
        if (key !== 'translator.settings.v2') return undefined;
        writes.push(value);
        if (writes.length === 1) return new Promise((resolve) => { releaseFirstWrite = resolve; });
        return undefined;
      }),
    };
    const store = new SettingsStore(api);
    await store.load();

    const hideAtEdge = store.update((current) => ({ ...current, toolbarMode: 'edge-right' }));
    expect(api.setValue).toHaveBeenCalledTimes(1);
    const enableAutoTranslate = store.update((current) => ({ ...current, autoTranslate: true }));

    releaseFirstWrite();
    await expect(Promise.all([hideAtEdge, enableAutoTranslate])).resolves.toEqual([
      expect.objectContaining({ toolbarMode: 'edge-right', autoTranslate: false }),
      expect.objectContaining({ toolbarMode: 'edge-right', autoTranslate: true }),
    ]);
    expect(writes).toEqual([
      expect.objectContaining({ toolbarMode: 'edge-right', autoTranslate: false }),
      expect.objectContaining({ toolbarMode: 'edge-right', autoTranslate: true }),
    ]);
  });

  it('首次加载时将 v1 设置迁移至 v2，并在损坏值时回退默认设置', async () => {
    const api = {
      getValue: vi.fn(async (key) => ({
        'translator.settings.v2': undefined,
        'translator.settings.v1': { toolbarMode: 'edge-left' },
      })[key]),
      setValue: vi.fn(),
    };
    const store = new SettingsStore(api);

    await expect(store.load()).resolves.toMatchObject({ toolbarMode: 'edge-left' });
    expect(api.setValue).toHaveBeenCalledWith('translator.settings.v2', expect.objectContaining({ toolbarMode: 'edge-left' }));

    const corruptedApi = {
      getValue: vi.fn(async (key) => ({
        'translator.settings.v2': 'invalid',
        'translator.settings.v1': null,
      })[key]),
      setValue: vi.fn(),
    };
    const corruptedStore = new SettingsStore(corruptedApi);
    await expect(corruptedStore.load()).resolves.toMatchObject({ toolbarMode: 'expanded' });
    expect(corruptedApi.setValue).toHaveBeenCalledWith('translator.settings.backup', expect.any(String));
  });
});
