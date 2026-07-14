import { describe, expect, it } from 'vitest';
import { IncrementalObserver } from '../src/dom/observer.js';

describe('IncrementalObserver', () => {
  it('仅上报新增的 DOM 根节点', async () => {
    document.body.textContent = '';
    let roots = [];
    const observer = new IncrementalObserver((nextRoots) => { roots = nextRoots; }, { debounceMs: 0 });
    observer.start(document.body);
    const paragraph = document.createElement('p');
    paragraph.textContent = 'new content';
    document.body.append(paragraph);
    await new Promise((resolve) => setTimeout(resolve, 0));
    observer.stop();
    expect(roots).toEqual([paragraph]);
  });

  it('上报影响可见性的属性变更元素', async () => {
    document.body.replaceChildren();
    let roots = [];
    const observer = new IncrementalObserver((nextRoots) => { roots = nextRoots; }, { debounceMs: 0 });
    const banner = document.createElement('div');
    banner.className = 'ng-hide';
    banner.textContent = 'New subscription offer';
    document.body.append(banner);
    observer.start(document.body);
    banner.className = '';
    await new Promise((resolve) => setTimeout(resolve, 0));
    observer.stop();
    expect(roots).toEqual([banner]);
  });

  it('合并同一轮新增节点，并跟踪 details 展开与关联内容', async () => {
    document.body.replaceChildren();
    let roots = [];
    const observer = new IncrementalObserver((nextRoots) => { roots = nextRoots; }, { debounceMs: 0 });
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'More';
    const content = document.createElement('p');
    content.textContent = 'Expanded content';
    details.append(summary, content);
    document.body.append(details);
    observer.start(document.body);
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    observer.stop();

    expect(roots).toEqual([details]);
  });

  it('aria-expanded 会同时上报受控的展开区域', async () => {
    document.body.replaceChildren();
    let roots = [];
    const observer = new IncrementalObserver((nextRoots) => { roots = nextRoots; }, { debounceMs: 0 });
    const trigger = document.createElement('button');
    trigger.setAttribute('aria-controls', 'expanded-panel');
    trigger.setAttribute('aria-expanded', 'false');
    const panel = document.createElement('section');
    panel.id = 'expanded-panel';
    panel.textContent = 'Panel content';
    document.body.append(trigger, panel);
    observer.start(document.body);
    trigger.setAttribute('aria-expanded', 'true');
    await new Promise((resolve) => setTimeout(resolve, 0));
    observer.stop();

    expect(roots).toContain(trigger);
    expect(roots).toContain(panel);
  });

  it('持续更新时等待静默窗口后只上报合并后的根节点', async () => {
    document.body.replaceChildren();
    const reports = [];
    const observer = new IncrementalObserver((roots) => reports.push(roots), { debounceMs: 30 });
    const paragraph = document.createElement('p');
    paragraph.textContent = 'First update';
    document.body.append(paragraph);
    observer.start(document.body);

    paragraph.textContent = 'Second update';
    await new Promise((resolve) => setTimeout(resolve, 15));
    paragraph.textContent = 'Final update';
    await new Promise((resolve) => setTimeout(resolve, 40));
    observer.stop();

    expect(reports).toEqual([[paragraph]]);
  });
});
