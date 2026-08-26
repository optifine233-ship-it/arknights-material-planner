import test from 'node:test';
import assert from 'node:assert/strict';

import { createRequestGate } from '../src/request-gate.js';

test('只有最近一次文件读取请求可以更新导入预览', () => {
  const gate = createRequestGate();
  const first = gate.begin();
  const second = gate.begin();

  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
});

test('关闭或切换导入页面会使尚未完成的文件读取失效', () => {
  const gate = createRequestGate();
  const request = gate.begin();

  gate.cancel();

  assert.equal(gate.isCurrent(request), false);
  const nextRequest = gate.begin();
  assert.equal(gate.isCurrent(nextRequest), true);
});
