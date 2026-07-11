import { ProviderError, TranslationProvider } from './provider.js';

const AUTH_URL = 'https://edge.microsoft.com/translate/auth';
const API_URL = 'https://api-edge.cognitive.microsofttranslator.com';
const TOKEN_TTL_MS = 8 * 60 * 1000;
const MAX_TEXT_LENGTH = 50_000;

const LANGUAGE_ALIASES = {
  zh: 'zh-Hans',
  'zh-CN': 'zh-Hans',
  'zh-TW': 'zh-Hant',
  no: 'nb',
  sr: 'sr-Cyrl',
};

function splitIntoChunks(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function splitText(text) {
  if (text.length <= MAX_TEXT_LENGTH) return [text];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + MAX_TEXT_LENGTH, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

export class MicrosoftProvider extends TranslationProvider {
  constructor(request) {
    super();
    this.request = request;
    this.token = null;
    this.tokenCreatedAt = 0;
  }

  normalizeLanguage(language) {
    return LANGUAGE_ALIASES[language] || language;
  }

  async getToken(force = false, timeoutMs = 15_000) {
    if (!force && this.token && Date.now() - this.tokenCreatedAt < TOKEN_TTL_MS) return this.token;
    let response;
    try {
      response = await this.request({ method: 'GET', url: AUTH_URL, timeout: timeoutMs });
    } catch (cause) {
      throw new ProviderError('微软翻译授权请求失败', { status: cause?.status || 0, cause });
    }
    if (response.status !== 200 || !response.responseText) {
      throw new ProviderError('微软翻译授权失败', { status: response.status || 0 });
    }
    this.token = response.responseText;
    this.tokenCreatedAt = Date.now();
    return this.token;
  }

  async perform(path, body, options, forceToken = false) {
    const token = await this.getToken(forceToken, options.timeoutMs);
    let response;
    try {
      response = await this.request({
        method: 'POST',
        url: `${API_URL}${path}`,
        timeout: options.timeoutMs,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        data: JSON.stringify(body),
      });
    } catch (cause) {
      throw new ProviderError('微软翻译网络请求失败', { status: cause?.status || 0, cause });
    }
    if (response.status < 200 || response.status >= 300) {
      throw new ProviderError('微软翻译请求失败', { status: response.status || 0 });
    }
    try {
      return JSON.parse(response.responseText);
    } catch (cause) {
      throw new ProviderError('微软翻译响应格式无效', { status: response.status || 0, cause });
    }
  }

  async requestWithRecovery(path, body, options) {
    try {
      return await this.perform(path, body, options);
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      if (error.isAuthorizationError) return this.perform(path, body, options, true);
      if (error.isRetryable) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return this.perform(path, body, options);
      }
      throw error;
    }
  }

  async translate(text, options) {
    const [result] = await this.translateBatch([text], options);
    return result;
  }

  async translateBatch(texts, options) {
    if (!texts.length) return [];
    const target = this.normalizeLanguage(options.targetLanguage);
    const source = options.sourceLanguage === 'auto' ? '' : `&from=${encodeURIComponent(this.normalizeLanguage(options.sourceLanguage))}`;
    const path = `/translate?api-version=3.0&to=${encodeURIComponent(target)}${source}`;
    const segments = texts.flatMap((text, index) => splitText(text).map((Text) => ({ index, Text })));
    const result = Array(texts.length).fill('');
    for (const chunk of splitIntoChunks(segments, Math.min(100, Math.max(1, options.batchSize || 50)))) {
      const data = await this.requestWithRecovery(path, chunk.map(({ Text }) => ({ Text })), options);
      if (!Array.isArray(data) || data.length !== chunk.length) throw new ProviderError('微软翻译返回条目数不匹配');
      for (let index = 0; index < data.length; index += 1) {
        const item = data[index];
        const translated = item?.translations?.[0]?.text;
        if (typeof translated !== 'string') throw new ProviderError('微软翻译缺少译文');
        result[chunk[index].index] += translated;
      }
    }
    return result;
  }

  async detect(text, options = {}) {
    const data = await this.requestWithRecovery('/detect?api-version=3.0', [{ Text: text }], options);
    const language = data?.[0]?.language;
    if (!language) throw new ProviderError('微软语言检测失败');
    return language;
  }
}
