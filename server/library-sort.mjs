const taskColumns = {
  title: 't.title',
  list: 'l.name',
  status: 't.status',
  priority: 'CASE WHEN t.important = 1 AND t.urgent = 1 THEN 0 WHEN t.urgent = 1 THEN 1 WHEN t.important = 1 THEN 2 ELSE 3 END',
  project: 'p.name',
  tags: "(SELECT group_concat(name, ', ') FROM (SELECT tag.name FROM task_tags tt JOIN tags tag ON tag.id = tt.tag_id WHERE tt.task_id = t.id AND tag.active = 1 ORDER BY tag.id))",
  startAt: 't.start_at',
  dueAt: 't.due_at',
  createdAt: 't.created_at',
  updatedAt: 't.updated_at',
  source: 't.source',
  taskNo: 't.task_no',
  databaseId: 't.id',
  starred: 't.starred'
};
const executionColumns = {
  title: 'e.title',
  note: 'e.note',
  theme: 't.name',
  priority: 'e.priority',
  status: 'e.status',
  date: 'e.scheduled_date',
  scheduledDate: 'e.scheduled_date',
  dueAt: 'e.due_at',
  completedAt: 'COALESCE(e.completed_at, e.discarded_at, e.updated_at)',
  specialLabel: 'e.special_label',
  source: 'e.source_record_id'
};
const logColumns = {
  time: 'occurred_at',
  type: 'log_type',
  theme: 'theme_name',
  event: 'event_name',
  message: 'message',
  source: 'source_record_id'
};
function columnOrder(value, columns) {
  const match = /^([A-Za-z]+):(asc|desc)$/.exec(String(value || ''));
  if (!match || !Object.hasOwn(columns, match[1])) return null;
  const expression = columns[match[1]];
  return `(${expression} IS NULL OR ${expression} = '') ASC, ${expression} COLLATE NOCASE ${match[2].toUpperCase()}`;
}
export const taskColumnOrder = value => columnOrder(value, taskColumns);
export const executionColumnOrder = value => columnOrder(value, executionColumns);
export const logColumnOrder = value => columnOrder(value, logColumns);
