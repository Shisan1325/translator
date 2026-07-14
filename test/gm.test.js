import { describe, expect, it } from 'vitest';
import { createGmApi } from '../src/utils/gm.js';

describe('GM API 适配', () => {
  it('支持返回 Promise 的现代跨域请求 API', async () => {
    const api = createGmApi({
      GM: {
        xmlHttpRequest: async () => ({ status: 200, responseText: 'ok' }),
      },
    });

    await expect(api.request({ url: 'https://example.test' })).resolves.toMatchObject({ status: 200, responseText: 'ok' });
  });

  it('支持仍使用回调的现代跨域请求 API', async () => {
    const api = createGmApi({
      GM: {
        xmlHttpRequest: (details) => {
          queueMicrotask(() => details.onload({ status: 200, responseText: 'ok' }));
          return { abort() {} };
        },
      },
    });

    await expect(api.request({ url: 'https://example.test' })).resolves.toMatchObject({ status: 200, responseText: 'ok' });
  });
});
