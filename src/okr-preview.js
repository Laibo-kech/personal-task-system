export const previewStorageKey = key => key.startsWith("life-task-okr:") ? key : `life-task-okr:${key}`;
export function initialPreviewColumnWidths(scope, widths) {
  const key = previewStorageKey(`task-columns:${scope}`);
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "null");
    if (stored && typeof stored === "object") return {
      ...widths,
      ...stored
    };
  } catch {}
  const caps = {
    check: 42,
    title: 340,
    list: 112,
    status: 96,
    priority: 70,
    project: 128,
    tags: 160,
    startAt: 132,
    dueAt: 132,
    createdAt: 144,
    source: 128,
    taskNo: 110,
    databaseId: 84,
    starred: 42,
    actions: 104
  };
  const compact = Object.fromEntries(Object.entries(widths).map(([key, width]) => [key, Math.min(Number(width) || caps[key] || 120, caps[key] || 160)]));
  savePreviewColumnWidths(scope, compact);
  return compact;
}
export function savePreviewColumnWidths(scope, widths) {
  try {
    localStorage.setItem(previewStorageKey(`task-columns:${scope}`), JSON.stringify(widths));
  } catch {}
}
