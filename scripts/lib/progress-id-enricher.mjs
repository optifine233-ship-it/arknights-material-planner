function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function skillIdsFor(operatorId, characters, patchChars) {
  const record = characters?.[operatorId] || patchChars?.[operatorId];
  const result = {};
  for (const [index, skill] of (record?.skills || []).entries()) {
    if (index > 2 || !skill?.skillId) continue;
    result[`s${index + 1}`] = String(skill.skillId);
  }
  return result;
}

function moduleTypeForEquip(equip) {
  const family = String(equip?.typeName1 || '').trim().toUpperCase();
  let suffix = String(equip?.typeName2 || '').trim().toUpperCase();
  if (equip?.isSpecialEquip) suffix = 'α';
  else if (suffix === 'D') suffix = 'Δ';
  if (!family || !suffix) return '';
  return `${family}-${suffix}`;
}

export function enrichOperatorProgressIds(operators, sources = {}) {
  const output = clone(operators || {});
  const report = { missingSkills: [], missingModules: [], ambiguousModules: [] };
  const modulesByName = new Map();

  for (const equip of Object.values(sources.equipDict || {})) {
    if (equip?.type !== 'ADVANCED' || !equip.uniEquipId || !equip.uniEquipName) continue;
    const matches = modulesByName.get(equip.uniEquipName) || [];
    matches.push({
      id: String(equip.uniEquipId),
      type: moduleTypeForEquip(equip)
    });
    modulesByName.set(equip.uniEquipName, matches);
  }

  for (const operator of Object.values(output)) {
    const hasMastery = Object.values(operator.ms || {}).some((stages) => stages?.length);
    const skillIds = skillIdsFor(operator.id, sources.characters, sources.patchChars);
    if (Object.keys(skillIds).length) operator.skillIds = skillIds;
    else if (hasMastery) report.missingSkills.push({ operatorId: String(operator.id || '') });

    for (const module of operator.md || []) {
      const matches = modulesByName.get(module.name) || [];
      if (matches.length === 1) {
        module.id = matches[0].id;
        if (!module.type && matches[0].type) module.type = matches[0].type;
      }
      else if (matches.length > 1) {
        report.ambiguousModules.push({ operatorId: String(operator.id || ''), name: module.name });
      } else {
        report.missingModules.push({ operatorId: String(operator.id || ''), name: module.name });
      }
    }
  }

  return { operators: output, report };
}
