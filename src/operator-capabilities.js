export function availableSkillLevels(operator) {
  return (operator?.sl || []).length ? [1, 2, 3, 4, 5, 6, 7] : [1];
}

export function availableMasterySkills(operator) {
  return ['s1', 's2', 's3'].filter((skill) => (operator?.ms?.[skill] || []).length > 0);
}

export function effectiveMasteryStages(operator, cultivationState) {
  return availableMasterySkills(operator).map((skill) => {
    const stage = Math.floor(Number(cultivationState?.mastery?.[skill]) || 0);
    return Math.max(0, Math.min(3, stage));
  });
}
