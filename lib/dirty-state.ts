export function hasMeaningfulDraft(values: Record<string, unknown>) {
  return Object.values(values).some((value) => Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "");
}

export function dirtyDialogAction(isDirty: boolean, intent: "backdrop" | "request") {
  if (!isDirty) return "close" as const;
  return intent === "backdrop" ? "ignore" as const : "confirm" as const;
}

export function countChangedFields(baseline: Record<string, unknown>, current: Record<string, unknown>) {
  const keys = new Set([...Object.keys(baseline), ...Object.keys(current)]);
  let count = 0;
  for (const key of keys) {
    if (!Object.is(baseline[key], current[key])) count += 1;
  }
  return count;
}

export function countSetChanges(baseline: Iterable<string>, current: Iterable<string>) {
  const baselineSet = new Set(baseline);
  const currentSet = new Set(current);
  let count = 0;
  for (const value of baselineSet) if (!currentSet.has(value)) count += 1;
  for (const value of currentSet) if (!baselineSet.has(value)) count += 1;
  return count;
}

export function countChangedRecords<T extends { id: string }>(baseline: T[], current: T[]) {
  const baselineById = new Map(baseline.map((record) => [record.id, JSON.stringify(record)]));
  const currentById = new Map(current.map((record) => [record.id, JSON.stringify(record)]));
  const ids = new Set([...baselineById.keys(), ...currentById.keys()]);
  let count = 0;
  for (const id of ids) {
    if (baselineById.get(id) !== currentById.get(id)) count += 1;
  }
  return count;
}
