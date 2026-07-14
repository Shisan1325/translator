export const DEFAULT_SETTINGS = Object.freeze({
  sourceLanguage: 'auto',
  targetLanguage: 'zh-Hans',
  autoTranslate: false,
  siteAutoTranslatePreferences: {},
  translateDynamic: true,
  showSelectionButton: true,
  cacheEnabled: true,
  batchSize: 50,
  timeoutMs: 15_000,
  toolbarPosition: null,
  toolbarMode: 'expanded',
  toolbarEdgeRestoreMode: 'expanded',
  toolbarEdgeCenterY: null,
  toolbarCollapsed: false,
});

export const LANGUAGE_OPTIONS = [
  ['auto', '自动检测'],
  ['zh-Hans', '简体中文'],
  ['zh-Hant', '繁體中文'],
  ['en', 'English'],
  ['ja', '日本語'],
  ['ko', '한국어'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['es', 'Español'],
  ['ru', 'Русский'],
];

export function normalizeHostname(value) {
  const input = String(value || '').trim().toLowerCase();
  if (!input) return '';
  try {
    return new URL(input.includes('://') ? input : `https://${input}`).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function getSiteAutoTranslatePreference(hostname, preferences = {}) {
  const current = normalizeHostname(hostname);
  if (!current || typeof preferences !== 'object') return undefined;
  const segments = current.split('.');
  for (let index = 0; index < segments.length; index += 1) {
    const preference = preferences[segments.slice(index).join('.')];
    if (typeof preference === 'boolean') return preference;
  }
  return undefined;
}

export function shouldAutoTranslateSite(hostname, settings) {
  const preference = getSiteAutoTranslatePreference(hostname, settings.siteAutoTranslatePreferences);
  return preference === undefined ? settings.autoTranslate : preference;
}

export function normalizeSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key in value) settings[key] = value[key];
  }
  settings.batchSize = Math.min(100, Math.max(1, Number(settings.batchSize) || DEFAULT_SETTINGS.batchSize));
  settings.timeoutMs = Math.min(60_000, Math.max(3_000, Number(settings.timeoutMs) || DEFAULT_SETTINGS.timeoutMs));
  for (const key of ['autoTranslate', 'translateDynamic', 'showSelectionButton', 'cacheEnabled']) {
    settings[key] = Boolean(settings[key]);
  }
  settings.sourceLanguage = String(settings.sourceLanguage || 'auto');
  settings.targetLanguage = String(settings.targetLanguage || DEFAULT_SETTINGS.targetLanguage);
  const preferences = value.siteAutoTranslatePreferences && typeof value.siteAutoTranslatePreferences === 'object'
    ? value.siteAutoTranslatePreferences
    : {};
  settings.siteAutoTranslatePreferences = {};
  for (const [hostname, enabled] of Object.entries(preferences)) {
    const normalizedHostname = normalizeHostname(hostname);
    if (normalizedHostname && typeof enabled === 'boolean') settings.siteAutoTranslatePreferences[normalizedHostname] = enabled;
  }
  const legacyBlacklist = Array.isArray(value.autoTranslateBlacklist)
    ? value.autoTranslateBlacklist
    : String(value.autoTranslateBlacklist || '').split(/[\n,]/);
  for (const hostname of legacyBlacklist) {
    const normalizedHostname = normalizeHostname(hostname);
    if (normalizedHostname && !(normalizedHostname in settings.siteAutoTranslatePreferences)) {
      settings.siteAutoTranslatePreferences[normalizedHostname] = false;
    }
  }
  const validModes = new Set(['expanded', 'collapsed', 'edge-left', 'edge-right']);
  settings.toolbarMode = validModes.has(value.toolbarMode)
    ? value.toolbarMode
    : value.toolbarHidden || value.toolbarEdgeHiddenV2
      ? 'collapsed'
      : settings.toolbarCollapsed ? 'collapsed' : 'expanded';
  settings.toolbarCollapsed = settings.toolbarMode === 'collapsed';
  settings.toolbarEdgeRestoreMode = ['expanded', 'collapsed'].includes(settings.toolbarEdgeRestoreMode)
    ? settings.toolbarEdgeRestoreMode
    : 'expanded';
  settings.toolbarEdgeCenterY = settings.toolbarEdgeCenterY !== null
    && settings.toolbarEdgeCenterY !== ''
    && Number.isFinite(Number(settings.toolbarEdgeCenterY))
    ? Number(settings.toolbarEdgeCenterY)
    : null;
  if (settings.toolbarPosition && Number.isFinite(Number(settings.toolbarPosition.left)) && Number.isFinite(Number(settings.toolbarPosition.top))) {
    settings.toolbarPosition = { left: Number(settings.toolbarPosition.left), top: Number(settings.toolbarPosition.top) };
  } else {
    settings.toolbarPosition = null;
  }
  return settings;
}
