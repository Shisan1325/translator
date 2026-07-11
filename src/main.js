import { createI18n } from './i18n/index.js';
import { normalizeHostname, shouldAutoTranslateSite } from './config/defaults.js';
import { MemoryTranslationCache } from './utils/cache.js';
import { createGmApi } from './utils/gm.js';
import { whenIdle } from './utils/idle.js';
import { SettingsStore } from './utils/storage.js';
import { MicrosoftProvider } from './translator/microsoft.js';
import { TranslationController } from './translator/controller.js';
import { createUiRoot } from './ui/root.js';
import { Toolbar } from './ui/toolbar.js';
import { Toast } from './ui/toast.js';
import { Dialog, openSettings } from './ui/dialog.js';
import { TranslationInputPopup } from './selection/popup.js';
import { getSelectedText, SelectionTranslator } from './selection/selection.js';

async function bootstrap() {
  // MVP 不处理 iframe 内容；此保护可避免子框架中重复初始化整套 UI。
  if (window.self !== window.top) return;
  if (document.contentType?.includes('xml')) return;
  const t = createI18n();
  const api = createGmApi();
  const settingsStore = new SettingsStore(api);
  let settings = await settingsStore.load();
  const { root } = createUiRoot();
  const toast = new Toast(root);
  const dialog = new Dialog(root);
  const provider = new MicrosoftProvider((details) => api.request(details));
  let toolbar;
  const controller = new TranslationController({
    provider,
    cache: new MemoryTranslationCache(),
    getSettings: () => settings,
    onProgress: (count) => toast.show(t('translated', { count })),
    onError: (error) => console.error('[translator-userscript]', error),
  });
  const popup = new TranslationInputPopup(root, t, toast, {
    getSettings: () => settings,
    translate: (text, overrides) => controller.translateText(text, overrides),
  });

  const runPage = async () => {
    toast.show(t('translating'), { duration: 60_000 });
    try {
      await controller.translatePage();
    } catch (error) {
      console.error('[translator-userscript]', error);
    }
  };
  const runVisible = async () => {
    toast.show(t('translating'), { duration: 60_000 });
    try {
      await controller.translateVisible();
    } catch (error) {
      console.error('[translator-userscript]', error);
    }
  };
  const restore = () => {
    const count = controller.restore();
    toast.show(t('restored', { count }));
  };
  const siteHostname = normalizeHostname(location.hostname);
  const isSiteAutoTranslateEnabled = () => shouldAutoTranslateSite(siteHostname, settings);
  const applySiteAutoTranslateChange = async (previousEnabled) => {
    const enabled = isSiteAutoTranslateEnabled();
    if (enabled === previousEnabled) return;
    if (enabled) await runPage();
    else restore();
  };
  const saveSettings = async (next) => {
    const previousEnabled = isSiteAutoTranslateEnabled();
    settings = await settingsStore.save(next);
    controller.refreshDynamicObserver();
    toolbar?.setSiteAutoTranslateEnabled(isSiteAutoTranslateEnabled());
    await applySiteAutoTranslateChange(previousEnabled);
  };
  const showSettings = () => openSettings(dialog, t, settings, saveSettings);
  const openInput = () => popup.open();
  const setSiteAutoTranslate = async (enabled) => {
    const previousEnabled = isSiteAutoTranslateEnabled();
    settings = await settingsStore.save({
      ...settings,
      siteAutoTranslatePreferences: { ...settings.siteAutoTranslatePreferences, [siteHostname]: enabled },
    });
    toolbar?.setSiteAutoTranslateEnabled(isSiteAutoTranslateEnabled());
    toast.show(t(enabled ? 'siteAutoTranslateEnabled' : 'siteAutoTranslateDisabled'));
    await applySiteAutoTranslateChange(previousEnabled);
  };
  const runSelection = () => {
    const text = getSelectedText();
    if (!text) {
      toast.show(t('noSelection'));
      return;
    }
    popup.open({ text, autoTranslate: true });
  };
  const saveToolbarState = (patch) => {
    const next = { ...settings, ...patch };
    return settingsStore.save(next).then((saved) => {
      settings = saved;
      return saved;
    });
  };

  toolbar = new Toolbar(root, t, {
    translatePage: runPage,
    translateVisible: runVisible,
    openInput,
    restore,
    openSettings: showSettings,
    onToggleSiteAutoTranslate: setSiteAutoTranslate,
  }, {
    position: settings.toolbarPosition,
    mode: settings.toolbarMode,
    edgeRestoreMode: settings.toolbarEdgeRestoreMode,
    edgeCenterY: settings.toolbarEdgeCenterY,
    collapsed: settings.toolbarCollapsed,
    autoTranslateForSite: isSiteAutoTranslateEnabled(),
    onStateChange: saveToolbarState,
  });
  new SelectionTranslator(root, {
    getSettings: () => settings,
    onOpen: (text) => popup.open({ text, autoTranslate: true }),
    onNewSelection: () => popup.close(),
    t,
  });

  api.registerMenuCommand(t('menuTranslatePage'), runPage);
  api.registerMenuCommand(t('menuTranslateSelection'), runSelection);
  api.registerMenuCommand(t('translateVisible'), runVisible);
  api.registerMenuCommand(t('inputTranslate'), openInput);
  api.registerMenuCommand(t('restore'), restore);
  api.registerMenuCommand(t('settings'), showSettings);

  if (isSiteAutoTranslateEnabled()) {
    await whenIdle();
    runPage();
  }
}

bootstrap().catch((error) => console.error('[translator-userscript]', error));
