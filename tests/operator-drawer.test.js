import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { replaceDrawerBody } from '../src/drawer-refresh.js';

test('详情抽屉更新内容时保留滚动位置和当前控件焦点', () => {
  const originalControl = {
    dataset: {
      action: 'progress-change',
      operator: '%E6%B5%81%E6%98%8E',
      scope: 'target',
      field: 'mastery',
      key: 's2'
    }
  };
  let focusOptions = null;
  const replacementControl = {
    dataset: { ...originalControl.dataset },
    focus(options) { focusOptions = options; }
  };
  const body = { innerHTML: '<p>旧内容</p>' };
  const drawer = {
    scrollTop: 486,
    querySelector(selector) {
      return selector === '.drawer__body' ? body : null;
    },
    querySelectorAll(selector) {
      return selector === '[data-action]' ? [replacementControl] : [];
    }
  };

  assert.equal(replaceDrawerBody(drawer, '<p>新内容</p>', originalControl), true);
  assert.equal(body.innerHTML, '<p>新内容</p>');
  assert.equal(drawer.scrollTop, 486);
  assert.deepEqual(focusOptions, { preventScroll: true });
});

test('干员详情不再显示拥有状态和潜能编辑栏', async () => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /class="owned-toggle"/);
  assert.doesNotMatch(source, /data-action="toggle-owned"/);
  assert.doesNotMatch(source, /data-action="potential-change"/);
});

test('培养进度变化不重建背景页面或整个详情抽屉', async () => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('function rerenderAfterProgressChange');
  const end = source.indexOf('function updateProgress', start);
  const functionSource = source.slice(start, end);

  assert.ok(start >= 0, '应保留统一的培养进度更新入口');
  assert.match(functionSource, /replaceDrawerBody/);
  assert.doesNotMatch(functionSource, /\brender\(\)/);
  assert.doesNotMatch(functionSource, /drawer-root[^\n]*innerHTML/);
});
