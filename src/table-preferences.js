export function normalizeTablePreferences(columns, input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  const keys = columns.map(column => column.key);
  const requested = Array.isArray(value.visibleColumns) ? value.visibleColumns : keys;
  const visible = [...new Set(requested.filter(key => keys.includes(key)))];
  for (const column of columns) if (column.required && !visible.includes(column.key)) visible.push(column.key);
  return {
    visibleColumns: visible.length ? visible : keys.slice(0, 1),
    columnWidths: Object.fromEntries(columns.map(column => {
      const width = Number(value.columnWidths?.[column.key] ?? column.width);
      return [column.key, Math.max(column.minWidth || 56, Math.min(Number.isFinite(width) ? width : column.width || 120, column.maxWidth || 800))];
    }))
  };
}
