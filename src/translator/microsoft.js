import { ProviderError, TranslationProvider } from './provider.js';

const AUTH_URL = 'https://edge.microsoft.com/translate/auth';
const API_URL = 'https://api-edge.cognitive.microsofttranslator.com';
const TOKEN_TTL_MS = 8 * 60 * 1000;
const MAX_TEXT_LENGTH = 50_000;
const MAX_REQUEST_TEXT_LENGTH = 50_000;
const MAX_RECOVERY_ATTEMPTS = 2;
const BASE_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 30_000;

const LANGUAGE_ALIASES = {
  zh: 'zh-Hans',
  'zh-CN': 'zh-Hans',
  'zh-TW': 'zh-Hant',
  no: 'nb',
  sr: 'sr-Cyrl',
};

function splitIntoChunks(items, size, maxTextLength = MAX_REQUEST_TEXT_LENGTH) {
  const chunks = [];
  let chunk = [];
  let textLength = 0;
  for (const item of items) {
    const nextLength = textLength + item.Text.length;
    if (chunk.length && (chunk.length >= size || nextLength > maxTextLength)) {
      chunks.push(chunk);
      chunk = [];
      textLength = 0;
    }
    chunk.push(item);
    textLength += item.Text.length;
  }
  if (chunk.length) chunks.push(chunk);
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

function getStatus(response) {
  const status = Number(response?.status);
  return Number.isFinite(status) ? status : 0;
}

function getHeader(response, name) {
  const normalizedName = name.toLowerCase();
  const headers = response?.headers;
  if (headers?.get) {
    const value = headers.get(name);
    if (value !== null && value !== undefined) return String(value);
  }
  if (headers && typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === normalizedName && value !== null && value !== undefined) return String(value);
    }
  }
  const rawHeaders = [response?.responseHeaders, typeof headers === 'string' ? headers : ''];
  for (const rawHeader of rawHeaders) {
    if (typeof rawHeader !== 'string') continue;
    for (const line of rawHeader.split(/\r?\n/)) {
      const separator = line.indexOf(':');
      if (separator === -1) continue;
      if (line.slice(0, separator).trim().toLowerCase() === normalizedName) return line.slice(separator + 1).trim();
    }
  }
  return '';
}

function parseRetryAfter(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : null;
}

function responseContext(response) {
  const responseText = typeof response?.responseText === 'string' ? response.responseText : '';
  let code = '';
  let serviceMessage = '';
  try {
    const payload = JSON.parse(responseText);
    const error = payload?.error || payload;
    if (error && typeof error === 'object') {
      code = error.code ?? error.errorCode ?? '';
      serviceMessage = error.message ?? error.errorMessage ?? '';
    }
  } catch {
    serviceMessage = responseText.trim();
  }
  return {
    status: getStatus(response),
    code: String(code || ''),
    serviceMessage: String(serviceMessage || '').replace(/\s+/g, ' ').slice(0, 500),
    retryAfterMs: parseRetryAfter(getHeader(response, 'retry-after')),
    responseText: responseText.slice(0, 2_000),
  };
}

function formatFailureMessage(prefix, context) {
  const details = [];
  if (context.status) details.push(`HTTP ${context.status}`);
  if (context.code) details.push(`错误码 ${context.code}`);
  if (context.serviceMessage) details.push(context.serviceMessage);
  if (context.retryAfterMs !== null) details.push(`Retry-After ${Math.ceil(context.retryAfterMs / 1000)} 秒`);
  return details.length ? `${prefix}（${details.join('；')}）` : prefix;
}

function toProviderError(prefix, response, cause) {
  const context = responseContext(response);
  return new ProviderError(formatFailureMessage(prefix, context), { ...context, cause });
}

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export class MicrosoftProvider extends TranslationProvider {
  constructor(request, { sleep: wait = sleep, now = () => Date.now() } = {}) {
    super();
    this.request = request;
    this.sleep = wait;
    this.now = now;
    this.token = null;
    this.tokenCreatedAt = 0;
    this.tokenPromise = null;
    this.requestQueue = Promise.resolve();
    this.nextAllowedAt = 0;
  }

  normalizeLanguage(language) {
    return LANGUAGE_ALIASES[language] || language;
  }

  async getToken(force = false, timeoutMs = 15_000) {
    if (!force && this.token && Date.now() - this.tokenCreatedAt < TOKEN_TTL_MS) return this.token;
    if (this.tokenPromise) return this.tokenPromise;
    this.tokenPromise = this.fetchToken(timeoutMs);
    try {
      return await this.tokenPromise;
    } finally {
      this.tokenPromise = null;
    }
  }

  async fetchToken(timeoutMs) {
    let response;
    try {
      response = await this.request({ method: 'GET', url: AUTH_URL, timeout: timeoutMs });
    } catch (cause) {
      throw toProviderError('微软翻译授权请求失败', cause?.response || cause, cause);
    }
    if (getStatus(response) !== 200 || !response?.responseText) {
      throw toProviderError('微软翻译授权失败', response);
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
      throw toProviderError('微软翻译网络请求失败', cause?.response || cause, cause);
    }
    const status = getStatus(response);
    if (status < 200 || status >= 300) {
      throw toProviderError('微软翻译请求失败', response);
    }
    try {
      return JSON.parse(response.responseText);
    } catch (cause) {
      throw toProviderError('微软翻译响应格式无效', response, cause);
    }
  }

  getRetryDelay(error, retryIndex) {
    const exponentialDelay = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * (2 ** retryIndex));
    if (error.retryAfterMs === null) return exponentialDelay;
    return Math.max(exponentialDelay, error.retryAfterMs);
  }

  extendCooldown(delayMs) {
    if (!Number.isFinite(delayMs) || delayMs <= 0) return;
    this.nextAllowedAt = Math.max(this.nextAllowedAt, this.now() + delayMs);
  }

  async enqueueRequest(operation) {
    const task = this.requestQueue.then(async () => {
      const cooldownMs = Math.max(0, this.nextAllowedAt - this.now());
      if (cooldownMs) await this.sleep(cooldownMs);
      return operation();
    });
    this.requestQueue = task.catch(() => undefined);
    return task;
  }

  requestWithRecovery(path, body, options) {
    return this.enqueueRequest(() => this.requestWithRecoveryInternal(path, body, options));
  }

  async requestWithRecoveryInternal(path, body, options) {
    let retryIndex = 0;
    let authorizationRetried = false;
    let forceToken = false;
    while (true) {
      try {
        return await this.perform(path, body, options, forceToken);
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error;
        if (error.isAuthorizationError && !authorizationRetried) {
          authorizationRetried = true;
          forceToken = true;
          continue;
        }
        if (!error.isRetryable) throw error;
        const delayMs = this.getRetryDelay(error, retryIndex);
        if (delayMs > MAX_RETRY_DELAY_MS) throw error;
        this.extendCooldown(delayMs);
        if (retryIndex >= MAX_RECOVERY_ATTEMPTS) throw error;
        retryIndex += 1;
        forceToken = false;
        await this.sleep(delayMs);
      }
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
