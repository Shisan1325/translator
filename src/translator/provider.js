export class ProviderError extends Error {
  constructor(message, {
    status = 0,
    code = '',
    serviceMessage = '',
    retryAfterMs = null,
    responseText = '',
    cause,
  } = {}) {
    super(message, { cause });
    this.name = 'ProviderError';
    this.status = Number.isFinite(Number(status)) ? Number(status) : 0;
    this.code = code ? String(code) : '';
    this.serviceMessage = serviceMessage ? String(serviceMessage) : '';
    this.retryAfterMs = Number.isFinite(retryAfterMs) && retryAfterMs >= 0 ? retryAfterMs : null;
    this.responseText = responseText ? String(responseText) : '';
  }

  get isAuthorizationError() {
    return this.status === 401 || this.status === 403;
  }

  get isRetryable() {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

export class TranslationProvider {
  async translate() {
    throw new Error('Provider 必须实现 translate()');
  }

  async translateBatch() {
    throw new Error('Provider 必须实现 translateBatch()');
  }

  async detect() {
    throw new Error('Provider 必须实现 detect()');
  }
}
