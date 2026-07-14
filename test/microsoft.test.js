import { describe, expect, it } from 'vitest';
import { MicrosoftProvider } from '../src/translator/microsoft.js';
import { ProviderError } from '../src/translator/provider.js';

const options = { sourceLanguage: 'auto', targetLanguage: 'zh-Hans', batchSize: 50, timeoutMs: 1000 };

describe('MicrosoftProvider', () => {
  it('获取令牌后批量翻译文本', async () => {
    const requests = [];
    const provider = new MicrosoftProvider(async (details) => {
      requests.push(details);
      if (details.url.includes('/auth')) return { status: 200, responseText: 'token-a' };
      return { status: 200, responseText: JSON.stringify([{ translations: [{ text: '你好' }] }, { translations: [{ text: '世界' }] }]) };
    });
    await expect(provider.translateBatch(['hello', 'world'], options)).resolves.toEqual(['你好', '世界']);
    expect(requests).toHaveLength(2);
    expect(requests[1].url).toContain('to=zh-Hans');
    expect(JSON.parse(requests[1].data)).toEqual([{ Text: 'hello' }, { Text: 'world' }]);
  });

  it('鉴权失败时刷新令牌并只重试一次', async () => {
    let call = 0;
    const provider = new MicrosoftProvider(async (details) => {
      call += 1;
      if (details.url.includes('/auth')) return { status: 200, responseText: `token-${call}` };
      if (call === 2) return { status: 401, responseText: '' };
      return { status: 200, responseText: JSON.stringify([{ translations: [{ text: '你好' }] }]) };
    });
    await expect(provider.translate('hello', options)).resolves.toBe('你好');
    expect(call).toBe(4);
  });

  it('合并并发令牌请求，并按总文本长度拆分批次', async () => {
    let authorizationCalls = 0;
    const translateBodies = [];
    const provider = new MicrosoftProvider(async (details) => {
      if (details.url.includes('/auth')) {
        authorizationCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { status: 200, responseText: 'token' };
      }
      const body = JSON.parse(details.data);
      translateBodies.push(body);
      return { status: 200, responseText: JSON.stringify(body.map(() => ({ translations: [{ text: '译文' }] }))) };
    });

    await Promise.all([
      provider.translate('first', options),
      provider.translate('second', options),
    ]);
    expect(authorizationCalls).toBe(1);

    await provider.translateBatch(['a'.repeat(30_000), 'b'.repeat(30_000)], options);
    const longTextBodies = translateBodies.filter((body) => body.some(({ Text }) => Text.length === 30_000));
    expect(longTextBodies).toHaveLength(2);
    expect(longTextBodies.every((body) => body.reduce((total, { Text }) => total + Text.length, 0) <= 50_000)).toBe(true);
  });

  it('遵守 Retry-After 后重试限流请求', async () => {
    const delays = [];
    let translateCalls = 0;
    const provider = new MicrosoftProvider(async (details) => {
      if (details.url.includes('/auth')) return { status: 200, responseText: 'token' };
      translateCalls += 1;
      if (translateCalls === 1) {
        return {
          status: 429,
          responseHeaders: 'Retry-After: 2\r\n',
          responseText: JSON.stringify({ error: { code: 429001, message: 'Request limit exceeded.' } }),
        };
      }
      return { status: 200, responseText: JSON.stringify([{ translations: [{ text: '你好' }] }]) };
    }, { sleep: async (delayMs) => delays.push(delayMs) });

    await expect(provider.translate('hello', options)).resolves.toBe('你好');
    expect(translateCalls).toBe(2);
    expect(delays).toEqual([2_000]);
  });

  it.each([
    ['网络错误', () => { throw Object.assign(new Error('网络中断'), { status: 0 }); }],
    ['请求超时', () => ({ status: 408, responseText: 'Request Timeout' })],
    ['服务端错误', () => ({ status: 503, responseText: 'Service Unavailable' })],
  ])('%s 后有限退避并重试', async (_name, firstFailure) => {
    const delays = [];
    let translateCalls = 0;
    const provider = new MicrosoftProvider(async (details) => {
      if (details.url.includes('/auth')) return { status: 200, responseText: 'token' };
      translateCalls += 1;
      if (translateCalls === 1) return firstFailure();
      return { status: 200, responseText: JSON.stringify([{ translations: [{ text: '你好' }] }]) };
    }, { sleep: async (delayMs) => delays.push(delayMs) });

    await expect(provider.translate('hello', options)).resolves.toBe('你好');
    expect(translateCalls).toBe(2);
    expect(delays).toEqual([500]);
  });

  it('不因过长的 Retry-After 无限等待', async () => {
    const delays = [];
    let translateCalls = 0;
    const provider = new MicrosoftProvider(async (details) => {
      if (details.url.includes('/auth')) return { status: 200, responseText: 'token' };
      translateCalls += 1;
      return {
        status: 429,
        responseHeaders: 'Retry-After: 31\r\n',
        responseText: JSON.stringify({ error: { code: 429001, message: 'Request limit exceeded.' } }),
      };
    }, { sleep: async (delayMs) => delays.push(delayMs) });

    await expect(provider.translate('hello', options)).rejects.toMatchObject({ status: 429, retryAfterMs: 31_000 });
    expect(translateCalls).toBe(1);
    expect(delays).toEqual([]);
  });

  it('超长 Retry-After 不会阻塞后续翻译请求', async () => {
    const delays = [];
    let translateCalls = 0;
    const provider = new MicrosoftProvider(async (details) => {
      if (details.url.includes('/auth')) return { status: 200, responseText: 'token' };
      translateCalls += 1;
      if (translateCalls === 1) {
        return {
          status: 429,
          responseHeaders: 'Retry-After: 86400\r\n',
          responseText: JSON.stringify({ error: { code: 429001, message: 'Request limit exceeded.' } }),
        };
      }
      return { status: 200, responseText: JSON.stringify([{ translations: [{ text: '你好' }] }]) };
    }, { sleep: async (delayMs) => delays.push(delayMs) });

    await expect(provider.translate('first', options)).rejects.toMatchObject({ status: 429, retryAfterMs: 86_400_000 });
    await expect(provider.translate('second', options)).resolves.toBe('你好');

    expect(delays).toEqual([]);
    expect(translateCalls).toBe(2);
  });

  it('串行化所有翻译请求，避免跨入口并发 POST', async () => {
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const provider = new MicrosoftProvider(async (details) => {
      if (details.url.includes('/auth')) return { status: 200, responseText: 'token' };
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeRequests -= 1;
      const body = JSON.parse(details.data);
      return { status: 200, responseText: JSON.stringify(body.map(() => ({ translations: [{ text: '你好' }] }))) };
    });

    await Promise.all([
      provider.translate('first', options),
      provider.translate('second', options),
      provider.translate('third', options),
    ]);

    expect(maxActiveRequests).toBe(1);
  });

  it('429 的共享冷却会阻止后续请求提前发送', async () => {
    let now = 0;
    const delays = [];
    let translateCalls = 0;
    const provider = new MicrosoftProvider(async (details) => {
      if (details.url.includes('/auth')) return { status: 200, responseText: 'token' };
      translateCalls += 1;
      if (translateCalls <= 3) {
        return {
          status: 429,
          responseHeaders: 'Retry-After: 2\r\n',
          responseText: JSON.stringify({ error: { code: 429001, message: 'Request limit exceeded.' } }),
        };
      }
      return { status: 200, responseText: JSON.stringify([{ translations: [{ text: '你好' }] }]) };
    }, {
      now: () => now,
      sleep: async (delayMs) => {
        delays.push(delayMs);
        now += delayMs;
      },
    });

    await expect(provider.translate('first', options)).rejects.toMatchObject({ status: 429, retryAfterMs: 2_000 });
    await expect(provider.translate('second', options)).resolves.toBe('你好');

    expect(delays).toEqual([2_000, 2_000, 2_000]);
    expect(translateCalls).toBe(4);
  });

  it('保留失败响应的状态、服务端错误和 Retry-After', async () => {
    const provider = new MicrosoftProvider(async (details) => {
      if (details.url.includes('/auth')) return { status: 200, responseText: 'token' };
      return {
        status: 400,
        responseHeaders: 'Retry-After: 7\r\n',
        responseText: JSON.stringify({ error: { code: 400077, message: 'The maximum request size has been exceeded.' } }),
      };
    });

    let error;
    try {
      await provider.translate('hello', options);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({
      status: 400,
      code: '400077',
      serviceMessage: 'The maximum request size has been exceeded.',
      retryAfterMs: 7_000,
    });
    expect(error.responseText).toContain('400077');
    expect(error.message).toContain('HTTP 400');
    expect(error.message).toContain('Retry-After 7 秒');
  });

  it('将网络错误、超时和服务端错误识别为可重试', () => {
    for (const status of [0, 408, 429, 500, 503]) {
      expect(new ProviderError('请求失败', { status }).isRetryable).toBe(true);
    }
    expect(new ProviderError('请求失败', { status: 400 }).isRetryable).toBe(false);
  });

});
