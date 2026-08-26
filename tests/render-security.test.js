import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { escapeHtml } from '../src/ui.js';

test('HTML 转义覆盖文本和属性边界字符', () => {
  assert.equal(
    escapeHtml(`</p><img src=x onerror="alert('x')">`),
    '&lt;/p&gt;&lt;img src=x onerror=&quot;alert(&#039;x&#039;)&quot;&gt;'
  );
});

test('干员职业和材料分解路径进入 innerHTML 前必须显式转义', async () => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /\$\{operator\.p\}/);
  assert.doesNotMatch(source, /\$\{source\.via\.join\('、'\)\}/);
  assert.match(source, /escapeHtml\(operator\.p\)/);
  assert.match(source, /escapeHtml\(source\.via\.join\('、'\)\)/);
});

test('直接进入仅在保存成功后关闭初始化弹窗', async () => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(
    source,
    /if \(persist\(\)\) \{\s*closeModal\(\);\s*render\(\);\s*\}/
  );
});
