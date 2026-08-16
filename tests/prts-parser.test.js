import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractMaterialCosts,
  parseOperatorWikitext,
  parseQuantity,
  parseMaterialWikitext
} from '../scripts/lib/prts-parser.mjs';

test('解析 Wiki 数量缩写与材料消耗模板', () => {
  assert.equal(parseQuantity('3w'), 30000);
  assert.equal(parseQuantity('8万'), 80000);
  assert.equal(parseQuantity('1,200'), 1200);
  assert.deepEqual(
    extractMaterialCosts('{{材料消耗|龙门币|18w}} {{材料消耗|近卫双芯片|4}} {{材料消耗|D32钢|4}}'),
    [
      { name: '龙门币', qty: 180000 },
      { name: '近卫双芯片', qty: 4 },
      { name: 'D32钢', qty: 4 }
    ]
  );
});

test('从 PRTS 干员页面解析稳定 ID、筛选字段与全部养成项', () => {
  const text = `
{{CharinfoV2
|干员名=煌
|干员id=char_017_huang
|稀有度=5
|职业=近卫
|分支=强攻手
|位置=近战位
}}
{{干员获得方式|获得方式=公开招募 中坚寻访|上线时间=2019-12-24 16:00}}
{{精英化材料
|精1={{材料消耗|龙门币|5w}} {{材料消耗|近卫芯片|5}} {{材料消耗|装置|5}}
|精2={{材料消耗|龙门币|18w}} {{材料消耗|近卫双芯片|4}} {{材料消耗|D32钢|4}}
}}
{{技能升级材料
|2={{材料消耗|技巧概要·卷1|5}}
|3={{材料消耗|技巧概要·卷1|5}} {{材料消耗|破损装置|4}}
|一8={{材料消耗|技巧概要·卷3|8}} {{材料消耗|异铁组|4}}
|一9={{材料消耗|技巧概要·卷3|12}} {{材料消耗|异铁块|6}}
}}
{{模组
|名称=煌证章
|基础证章=yes
}}
{{模组
|名称=过载的武器与过热的心脏
|材料消耗={{材料消耗|模组数据块|4}} {{材料消耗|聚合剂|2}} {{材料消耗|龙门币|8万}}
|材料消耗2={{材料消耗|模组数据块|4}} {{材料消耗|数据增补条|60}} {{材料消耗|双极纳米片|3}}
}}
`;

  const parsed = parseOperatorWikitext(text, '煌');

  assert.equal(parsed.name, '煌');
  assert.equal(parsed.operator.id, 'char_017_huang');
  assert.equal(parsed.operator.p, '近卫');
  assert.equal(parsed.operator.sp, '强攻手');
  assert.equal(parsed.operator.pos, '近战位');
  assert.equal(parsed.operator.obtain, '公开招募 中坚寻访');
  assert.deepEqual(parsed.operator.e1, [
    { name: '近卫芯片', qty: 5 },
    { name: '装置', qty: 5 }
  ]);
  assert.equal(parsed.operator.sl.length, 2);
  assert.equal(parsed.operator.ms.s1[1].stage, 2);
  assert.equal(parsed.operator.md.length, 1);
  assert.equal(parsed.operator.md[0].name, '过载的武器与过热的心脏');
  assert.equal(parsed.operator.md[0].stages[0].mats.some((item) => item.name === '龙门币'), false);
});

test('解析材料层级、稳定 ID 与加工站配方', () => {
  const text = `
{{道具信息
|名称=异铁组
|itemId=30043
|iconId=MTL_SL_IRON3
|稀有度=2
|分类=材料
}}
{{道具配方/加工站
|产物=异铁组
|产物数量=1
|龙门币消耗=200
|原料1=异铁
|原料1数量=4
}}
`;
  assert.deepEqual(parseMaterialWikitext(text, '异铁组'), {
    name: '异铁组',
    id: '30043',
    iconId: 'MTL_SL_IRON3',
    tier: 2,
    category: '材料',
    recipe: [{ name: '异铁', qty: 4 }]
  });
});
