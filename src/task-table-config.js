export const legacyDefaultTaskColumns = Object.freeze(["check", "title", "list", "status", "priority", "project", "tags", "startAt", "dueAt", "createdAt", "source", "taskNo", "databaseId", "starred"]);
export const coreDefaultTaskColumns = Object.freeze(["check", "title", "status", "priority", "project", "dueAt", "source", "actions"]);
export const legacyAllTasksDefaultColumns = Object.freeze(legacyDefaultTaskColumns.filter(column => column !== "list"));
export const taskColumnWidthBounds = Object.freeze({
  check: Object.freeze({
    min: 38,
    max: 64
  }),
  title: Object.freeze({
    min: 220,
    max: 800
  }),
  actions: Object.freeze({
    min: 96,
    max: 132
  }),
  default: Object.freeze({
    min: 56,
    max: 800
  })
});
export function clampTaskColumnWidth(key, value, fallback = 120) {
  const bounds = taskColumnWidthBounds[key] || taskColumnWidthBounds.default;
  const width = Number(value);
  const normalized = Number.isFinite(width) ? width : Number(fallback) || bounds.min;
  return Math.round(Math.max(bounds.min, Math.min(bounds.max, normalized)));
}
export function shouldShowTaskTitleMeta(activeListId) {
  return !Number(activeListId);
}
export function migrateLegacyDefaultTaskColumns(columns) {
  const matches = expected => Array.isArray(columns) && columns.length === expected.length && columns.every((column, index) => column === expected[index]);
  const isLegacyDefault = matches(legacyDefaultTaskColumns) || matches(legacyAllTasksDefaultColumns);
  return isLegacyDefault ? [...coreDefaultTaskColumns] : columns;
}
