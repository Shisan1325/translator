import { normalizeSettings } from '../config/defaults.js';

const SETTINGS_KEY_V2 = 'translator.settings.v2';
const SETTINGS_KEY_V1 = 'translator.settings.v1';
const BACKUP_KEY = 'translator.settings.backup';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export class SettingsStore {
  constructor(api) {
    this.api = api;
    this.currentSettings = null;
    this.pendingUpdates = [];
    this.isSaving = false;
  }

  async load() {
    const v2 = await this.readSafe(SETTINGS_KEY_V2);
    if (isPlainObject(v2)) {
      this.currentSettings = normalizeSettings(v2);
      return this.currentSettings;
    }
    if (v2 !== undefined) await this.backupCorrupted('v2', v2);

    const v1 = await this.readSafe(SETTINGS_KEY_V1);
    if (isPlainObject(v1)) {
      const settings = normalizeSettings(v1);
      await this.api.setValue(SETTINGS_KEY_V2, settings);
      this.currentSettings = settings;
      return settings;
    }
    if (v1 !== undefined) await this.backupCorrupted('v1', v1);

    this.currentSettings = normalizeSettings({});
    return this.currentSettings;
  }

  async save(settings) {
    return this.update(() => settings);
  }

  update(updater) {
    if (typeof updater !== 'function') throw new TypeError('Settings updater must be a function');
    const update = new Promise((resolve, reject) => {
      this.pendingUpdates.push({ updater, resolve, reject });
    });
    void this.flushUpdates();
    return update;
  }

  async flushUpdates() {
    if (this.isSaving) return;
    this.isSaving = true;
    while (this.pendingUpdates.length) {
      const { updater, resolve, reject } = this.pendingUpdates.shift();
      try {
        const current = this.currentSettings || await this.load();
        const next = normalizeSettings(updater(current));
        await this.api.setValue(SETTINGS_KEY_V2, next);
        this.currentSettings = next;
        resolve(next);
      } catch (error) {
        reject(error);
      }
    }
    this.isSaving = false;
  }

  async readSafe(key) {
    try {
      return await this.api.getValue(key, undefined);
    } catch (error) {
      console.error('[translator-userscript]', `读取设置 ${key} 失败`, error);
      return undefined;
    }
  }

  async backupCorrupted(source, value) {
    try {
      await this.api.setValue(BACKUP_KEY, JSON.stringify({ source, value, at: Date.now() }));
    } catch (error) {
      console.error('[translator-userscript]', '备份损坏设置值失败', error);
    }
  }
}
