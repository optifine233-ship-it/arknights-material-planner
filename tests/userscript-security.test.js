import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHash, createHmac, webcrypto } from 'node:crypto';

const source = await readFile(new URL('../userscripts/skland-cultivation-export.user.js', import.meta.url), 'utf8');

test('森空岛导出脚本权限与联网域名保持最小化', () => {
  assert.match(source, /@match\s+https:\/\/www\.skland\.com\/\*/);
  assert.match(source, /@connect\s+zonai\.skland\.com/);
  assert.match(source, /@grant\s+GM_xmlhttpRequest/);
  assert.doesNotMatch(source, /@connect\s+\*/);
  assert.doesNotMatch(source, /@grant\s+(?:GM_setClipboard|GM_cookie|unsafeWindow|GM_setValue)/);
  assert.doesNotMatch(source, /@require/);
});

test('只调用最小养成接口，不调用过度取数接口或公共代理', () => {
  assert.match(source, /\/api\/v1\/auth\/refresh/);
  assert.match(source, /\/api\/v1\/game\/player\/binding/);
  assert.match(source, /\/api\/v1\/game\/cultivate\/player/);
  assert.doesNotMatch(source, /\/api\/v1\/game\/player\/info/);
  assert.match(source, /anonymous:\s*true/);
});

test('导出格式只包含养成字段且明确不含账号身份', () => {
  assert.match(source, /format:\s*'skland-cultivate-snapshot'/);
  assert.match(source, /items:\s*'unknown'/);
  assert.doesNotMatch(source, /GM_setValue|GM_getValue|postMessage/);
  assert.doesNotMatch(source, /console\.(?:log|warn|error)/);
});

test('脚本内签名实现通过固定 MD5 与 HMAC-SHA256 向量', async () => {
  const instrumented = source.replace(
    '  mount();\n})();',
    '  globalThis.__sklandTest = { md5Hex, sign, credentialFromStorage, sanitizeCultivation };\n})();'
  );
  const context = { TextEncoder, crypto: webcrypto, localStorage: { getItem: () => '' } };
  vm.runInNewContext(instrumented, context);
  assert.equal(context.__sklandTest.md5Hex('abc'), '900150983cd24fb0d6963f7d28e17f72');

  const token = 'temporary-token';
  const path = '/api/v1/game/cultivate/player';
  const query = 'uid=123456789';
  const timestamp = '1700000000';
  const header = JSON.stringify({ platform: '1', timestamp, dId: '', vName: '1.21.0' });
  const hmac = createHmac('sha256', token).update(`${path}${query}${timestamp}${header}`).digest('hex');
  const expected = createHash('md5').update(hmac).digest('hex');
  assert.equal(expected, 'c92734a240ecfdce31a04f94db90086d');
  assert.equal(await context.__sklandTest.sign(token, path, query, timestamp), 'c92734a240ecfdce31a04f94db90086d');

  const refreshPath = '/api/v1/auth/refresh';
  const emptyHmac = createHmac('sha256', '').update(`${refreshPath}${timestamp}${header}`).digest('hex');
  const emptyExpected = createHash('md5').update(emptyHmac).digest('hex');
  assert.equal(emptyExpected, 'd7a54c487bff41cadff3a4facae2da09');
  assert.equal(await context.__sklandTest.sign('', refreshPath, '', timestamp), 'd7a54c487bff41cadff3a4facae2da09');
});

test('脚本从森空岛 JSON 或编码存储中只提取凭据值', () => {
  const instrumented = source.replace(
    '  mount();\n})();',
    '  globalThis.__sklandTest = { credentialFromStorage };\n})();'
  );
  const context = {
    TextEncoder,
    crypto: webcrypto,
    localStorage: { getItem: () => encodeURIComponent(JSON.stringify({ cred: 'credential-value-12345' })) }
  };
  vm.runInNewContext(instrumented, context);
  assert.equal(context.__sklandTest.credentialFromStorage(), 'credential-value-12345');
});

test('脚本只为字段完整的养成响应生成安全合并快照', () => {
  const instrumented = source.replace(
    '  mount();\n})();',
    '  globalThis.__sklandTest = { sanitizeCultivation };\n})();'
  );
  const context = { TextEncoder, crypto: webcrypto };
  vm.runInNewContext(instrumented, context);
  const raw = {
    characters: [{
      id: 'char_017_huang', evolvePhase: 2, level: 70, potentialRank: 3, mainSkillLevel: 7,
      skills: [{ id: 'skchr_huang_1', level: 3 }], equips: [{ id: 'uniequip_002_huang', level: 2 }]
    }]
  };
  const snapshot = context.__sklandTest.sanitizeCultivation(raw);
  assert.equal(snapshot.completeness.characters, 'partial');
  assert.equal(snapshot.completeness.items, 'unknown');
  assert.equal(snapshot.items.length, 0);
  assert.throws(() => context.__sklandTest.sanitizeCultivation({ characters: [{ id: 'char_017_huang' }] }), /数据不完整/);
});
