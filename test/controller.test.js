import { describe, expect, it } from 'vitest';
import { MemoryTranslationCache } from '../src/utils/cache.js';
import { TranslationController } from '../src/translator/controller.js';

const settings = {
  sourceLanguage: 'auto', targetLanguage: 'zh-Hans',
  cacheEnabled: true, batchSize: 50, timeoutMs: 1000, translateCode: false, translateDynamic: false,
};

describe('TranslationController', () => {
  it('恢复操作会取消尚未完成的翻译写入', async () => {
    document.body.textContent = 'Hello';
    const provider = {
      async translateBatch(texts) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return texts.map(() => '你好');
      },
    };
    const controller = new TranslationController({ provider, cache: new MemoryTranslationCache(), getSettings: () => settings });
    const pending = controller.translatePage();
    await new Promise((resolve) => setTimeout(resolve, 1));
    controller.restore();
    await pending;
    expect(document.body.textContent).toBe('Hello');
  });

  it('手动翻译请求失败时向调用方返回错误，而不是误报没有文本', async () => {
    document.body.textContent = 'Hello';
    const provider = { async translateBatch() { throw new Error('服务暂不可用'); } };
    const controller = new TranslationController({ provider, cache: new MemoryTranslationCache(), getSettings: () => settings });
    await expect(controller.translatePage()).rejects.toThrow('服务暂不可用');
  });

  it('动态显示原本隐藏的内容后会自动翻译', async () => {
    document.body.replaceChildren();
    const banner = document.createElement('div');
    banner.style.display = 'none';
    banner.textContent = 'See benefits';
    document.body.append(banner);
    const provider = { async translateBatch(texts) { return texts.map(() => '查看权益'); } };
    const controller = new TranslationController({
      provider,
      cache: new MemoryTranslationCache(),
      getSettings: () => ({ ...settings, translateDynamic: true }),
    });

    await controller.translatePage();
    expect(banner.textContent).toBe('See benefits');
    banner.style.display = '';
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(banner.textContent).toBe('查看权益');
    controller.restore();
    expect(banner.textContent).toBe('See benefits');
  });

  it('仅翻译可视区后，展开的 details 内容仍会自动翻译', async () => {
    document.body.replaceChildren();
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Show details';
    const content = document.createElement('p');
    content.textContent = 'More information';
    details.append(summary, content);
    document.body.append(details);
    const provider = { async translateBatch(texts) { return texts.map(() => '更多信息'); } };
    const controller = new TranslationController({
      provider,
      cache: new MemoryTranslationCache(),
      getSettings: () => ({ ...settings, translateDynamic: true }),
    });

    await controller.translatePage();
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(content.textContent).toBe('更多信息');
    controller.restore();
  });

  it('展开初始隐藏的详情内容后会翻译该内容', async () => {
    document.body.replaceChildren();
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Show details';
    const content = document.createElement('p');
    content.hidden = true;
    content.textContent = 'Initially hidden details';
    details.append(summary, content);
    document.body.append(details);
    const provider = { async translateBatch(texts) { return texts.map(() => '已展开的详情'); } };
    const controller = new TranslationController({
      provider,
      cache: new MemoryTranslationCache(),
      getSettings: () => ({ ...settings, translateDynamic: true }),
    });

    await controller.translatePage();
    expect(content.textContent).toBe('Initially hidden details');
    content.hidden = false;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(content.textContent).toBe('已展开的详情');
    controller.restore();
  });

  it('将同一轮新增节点合并为一次批量翻译请求', async () => {
    document.body.replaceChildren();
    const requests = [];
    const provider = {
      async translateBatch(texts) {
        requests.push(texts);
        return texts.map((text) => `译文:${text}`);
      },
    };
    const controller = new TranslationController({
      provider,
      cache: new MemoryTranslationCache(),
      getSettings: () => ({ ...settings, translateDynamic: true, batchSize: 50 }),
    });
    await controller.translatePage();
    requests.length = 0;

    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 20; index += 1) {
      const paragraph = document.createElement('p');
      paragraph.textContent = `Dynamic item ${index}`;
      fragment.append(paragraph);
    }
    document.body.append(fragment);
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(requests).toHaveLength(1);
    expect(requests[0]).toHaveLength(20);
    controller.restore();
  });

  it('动态更新在前一批翻译期间会合并到下一批', async () => {
    document.body.replaceChildren();
    const batches = [];
    let releaseFirstBatch;
    const firstBatchStarted = new Promise((resolve) => { releaseFirstBatch = resolve; });
    const provider = {
      async translateBatch(texts) {
        batches.push(texts);
        if (batches.length === 1) await firstBatchStarted;
        return texts.map((text) => `译文:${text}`);
      },
    };
    const controller = new TranslationController({
      provider,
      cache: new MemoryTranslationCache(),
      getSettings: () => ({ ...settings, translateDynamic: true, batchSize: 50 }),
    });
    await controller.translatePage();
    batches.length = 0;

    const first = document.createElement('p');
    first.textContent = 'First update';
    document.body.append(first);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const second = document.createElement('p');
    const third = document.createElement('p');
    second.textContent = 'Second update';
    third.textContent = 'Third update';
    document.body.append(second, third);
    releaseFirstBatch();
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(batches).toHaveLength(2);
    expect(batches[0]).toEqual(['First update']);
    expect(batches[1]).toEqual(expect.arrayContaining(['Second update', 'Third update']));
    controller.restore();
  });

  it('样式类变化不会重复翻译已经处理过的正文', async () => {
    document.body.textContent = 'Already translated';
    const requests = [];
    const provider = {
      async translateBatch(texts) {
        requests.push(texts);
        return texts.map(() => '已翻译');
      },
    };
    const controller = new TranslationController({
      provider,
      cache: new MemoryTranslationCache(),
      getSettings: () => ({ ...settings, translateDynamic: true, cacheEnabled: false }),
    });
    await controller.translatePage();
    requests.length = 0;

    document.body.className = 'layout-updated';
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(requests).toHaveLength(0);
    controller.restore();
  });

  it('刷新动态观察配置不会丢弃防抖中的节点', async () => {
    document.body.replaceChildren();
    const provider = { async translateBatch(texts) { return texts.map(() => '已翻译'); } };
    const controller = new TranslationController({
      provider,
      cache: new MemoryTranslationCache(),
      getSettings: () => ({ ...settings, translateDynamic: true }),
    });
    await controller.translatePage();

    const paragraph = document.createElement('p');
    paragraph.textContent = 'Pending update';
    document.body.append(paragraph);
    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.refreshDynamicObserver();
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(paragraph.textContent).toBe('已翻译');
    controller.restore();
  });
});
