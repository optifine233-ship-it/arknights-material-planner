import test from 'node:test';
import assert from 'node:assert/strict';

import { enrichOperatorProgressIds } from '../scripts/lib/progress-id-enricher.mjs';

test('用稳定技能和模组 ID 扩充 PRTS 养成数据', () => {
  const operators = {
    煌: {
      id: 'char_017_huang',
      ms: { s1: [{ stage: 1 }], s2: [{ stage: 1 }], s3: [{ stage: 1 }] },
      md: [{ name: '过载的武器与过热的心脏', stages: [{ stage: 1 }] }]
    }
  };
  const result = enrichOperatorProgressIds(operators, {
    characters: {
      char_017_huang: {
        skills: [
          { skillId: 'skchr_huang_1' },
          { skillId: 'skchr_huang_2' },
          { skillId: 'skchr_huang_3' }
        ]
      }
    },
    patchChars: {},
    equipDict: {
      uniequip_002_huang: {
        uniEquipId: 'uniequip_002_huang',
        uniEquipName: '过载的武器与过热的心脏',
        type: 'ADVANCED'
      }
    }
  });

  assert.deepEqual(result.operators.煌.skillIds, {
    s1: 'skchr_huang_1',
    s2: 'skchr_huang_2',
    s3: 'skchr_huang_3'
  });
  assert.equal(result.operators.煌.md[0].id, 'uniequip_002_huang');
  assert.deepEqual(result.report, { missingSkills: [], missingModules: [], ambiguousModules: [] });
});

test('阿米娅形态从 patchChars 获取技能，模组按唯一名称匹配', () => {
  const result = enrichOperatorProgressIds({
    '阿米娅(近卫)': {
      id: 'char_1001_amiya2',
      ms: { s1: [{ stage: 1 }], s2: [{ stage: 1 }], s3: [] },
      md: [{ name: '待调弦的怒火', stages: [{ stage: 1 }] }]
    }
  }, {
    characters: {},
    patchChars: {
      char_1001_amiya2: { skills: [{ skillId: 'skchr_amiya2_1' }, { skillId: 'skchr_amiya2_2' }] }
    },
    equipDict: {
      uniequip_002_amiya2: {
        uniEquipId: 'uniequip_002_amiya2',
        uniEquipName: '待调弦的怒火',
        type: 'ADVANCED'
      }
    }
  });

  assert.deepEqual(result.operators['阿米娅(近卫)'].skillIds, {
    s1: 'skchr_amiya2_1',
    s2: 'skchr_amiya2_2'
  });
  assert.equal(result.operators['阿米娅(近卫)'].md[0].id, 'uniequip_002_amiya2');
});

test('不按数组位置猜测缺失或重名模组', () => {
  const result = enrichOperatorProgressIds({
    测试: { id: 'char_test', ms: {}, md: [{ name: '重名模组', stages: [] }] }
  }, {
    characters: {},
    patchChars: {},
    equipDict: {
      equip_a: { uniEquipId: 'equip_a', uniEquipName: '重名模组', type: 'ADVANCED' },
      equip_b: { uniEquipId: 'equip_b', uniEquipName: '重名模组', type: 'ADVANCED' }
    }
  });

  assert.equal(result.operators.测试.md[0].id, undefined);
  assert.deepEqual(result.report.ambiguousModules, [{ operatorId: 'char_test', name: '重名模组' }]);
});
