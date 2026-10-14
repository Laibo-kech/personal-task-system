import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { defaultCalendarView } from "../src/calendar-defaults.js";
const databasePath = process.env.DATABASE_PATH || path.resolve(process.cwd(), "data", "life-tasks.sqlite");
fs.mkdirSync(path.dirname(databasePath), {
  recursive: true
});
const sqlite = new DatabaseSync(databasePath);
function wrapStatement(statement) {
  let pluckFirstColumn = false;
  const wrapper = {
    all(...params) {
      return statement.all(...params);
    },
    get(...params) {
      const row = statement.get(...params);
      if (!pluckFirstColumn || !row) return row;
      return row[Object.keys(row)[0]];
    },
    pluck() {
      pluckFirstColumn = true;
      return wrapper;
    },
    run(...params) {
      const result = statement.run(...params);
      return {
        changes: Number(result.changes),
        lastInsertRowid: Number(result.lastInsertRowid)
      };
    }
  };
  return wrapper;
}
export const db = {
  close() {
    sqlite.close();
  },
  exec(sql) {
    return sqlite.exec(sql);
  },
  pragma(value) {
    return sqlite.exec(`PRAGMA ${value}`);
  },
  prepare(sql) {
    return wrapStatement(sqlite.prepare(sql));
  },
  transaction(callback) {
    return (...args) => {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = callback(...args);
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    };
  }
};
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");
db.exec("CREATE TABLE IF NOT EXISTS lists (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    name TEXT NOT NULL UNIQUE,\n    color TEXT NOT NULL DEFAULT '#9c5a43',\n    position INTEGER NOT NULL DEFAULT 0,\n    is_default INTEGER NOT NULL DEFAULT 0,\n    archived_at TEXT,\n    created_at TEXT NOT NULL,\n    updated_at TEXT NOT NULL\n  , folder_id INTEGER, is_pinned INTEGER NOT NULL DEFAULT 0);\n\nCREATE TABLE IF NOT EXISTS projects (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    name TEXT NOT NULL UNIQUE,\n    color TEXT NOT NULL DEFAULT '#2877d4',\n    source_record_id TEXT UNIQUE,\n    active INTEGER NOT NULL DEFAULT 1,\n    raw_json TEXT,\n    created_at TEXT NOT NULL,\n    updated_at TEXT NOT NULL\n  , list_id INTEGER);\n\nCREATE TABLE IF NOT EXISTS tags (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    name TEXT NOT NULL UNIQUE,\n    color TEXT NOT NULL DEFAULT '#77736d',\n    source_record_id TEXT UNIQUE,\n    active INTEGER NOT NULL DEFAULT 1,\n    raw_json TEXT,\n    created_at TEXT NOT NULL,\n    updated_at TEXT NOT NULL\n  , list_id INTEGER);\n\nCREATE TABLE IF NOT EXISTS tasks (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    task_no TEXT NOT NULL UNIQUE,\n    title TEXT NOT NULL,\n    status TEXT NOT NULL DEFAULT '\u672A\u5B8C\u6210',\n    list_id INTEGER NOT NULL REFERENCES lists(id),\n    project_id INTEGER REFERENCES projects(id),\n    due_at TEXT,\n    completed_at TEXT,\n    starred INTEGER NOT NULL DEFAULT 0,\n    important INTEGER NOT NULL DEFAULT 0,\n    urgent INTEGER NOT NULL DEFAULT 0,\n    source TEXT NOT NULL DEFAULT '\u7F51\u9875\u624B\u52A8',\n    notes TEXT,\n    raw_json TEXT,\n    created_at TEXT NOT NULL,\n    updated_at TEXT NOT NULL,\n    deleted_at TEXT\n  , start_at TEXT, start_precision TEXT, due_precision TEXT, is_pinned INTEGER NOT NULL DEFAULT 0, sync_revision INTEGER NOT NULL DEFAULT 0);\n\nCREATE TABLE IF NOT EXISTS task_tags (\n    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,\n    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,\n    PRIMARY KEY (task_id, tag_id)\n  );\n\nCREATE TABLE IF NOT EXISTS task_logs (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,\n    task_no TEXT,\n    event_type TEXT NOT NULL,\n    old_value TEXT,\n    new_value TEXT,\n    source TEXT NOT NULL DEFAULT '\u670D\u52A1\u5668\u7CFB\u7EDF',\n    message TEXT,\n    occurred_at TEXT NOT NULL,\n    created_at TEXT NOT NULL,\n    raw_json TEXT, list_id INTEGER, list_name TEXT, task_title TEXT, task_status TEXT, changed_fields_json TEXT\n  );\n\nCREATE TABLE IF NOT EXISTS calendar_series (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    list_id INTEGER NOT NULL REFERENCES lists(id),\n    title TEXT NOT NULL,\n    notes TEXT,\n    location TEXT,\n    link_url TEXT,\n    all_day INTEGER NOT NULL DEFAULT 0,\n    start_date TEXT NOT NULL,\n    start_time TEXT NOT NULL DEFAULT '09:00',\n    duration_minutes INTEGER NOT NULL DEFAULT 60,\n    timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',\n    rule_type TEXT NOT NULL,\n    rule_json TEXT NOT NULL DEFAULT '{}',\n    end_date TEXT,\n    max_occurrences INTEGER,\n    reminder_minutes INTEGER NOT NULL DEFAULT 10,\n    status TEXT NOT NULL DEFAULT 'active',\n    created_at TEXT NOT NULL,\n    updated_at TEXT NOT NULL\n  );\n\nCREATE TABLE IF NOT EXISTS calendar_events (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    list_id INTEGER NOT NULL REFERENCES lists(id),\n    series_id INTEGER REFERENCES calendar_series(id) ON DELETE CASCADE,\n    occurrence_key TEXT,\n    title TEXT NOT NULL,\n    notes TEXT,\n    location TEXT,\n    link_url TEXT,\n    start_at TEXT NOT NULL,\n    end_at TEXT NOT NULL,\n    all_day INTEGER NOT NULL DEFAULT 0,\n    reminder_minutes INTEGER NOT NULL DEFAULT 10,\n    status TEXT NOT NULL DEFAULT 'scheduled',\n    is_override INTEGER NOT NULL DEFAULT 0,\n    converted_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,\n    created_at TEXT NOT NULL,\n    updated_at TEXT NOT NULL,\n    UNIQUE(series_id, occurrence_key)\n  );\n\nCREATE TABLE IF NOT EXISTS calendar_event_logs (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    event_id INTEGER REFERENCES calendar_events(id) ON DELETE SET NULL,\n    series_id INTEGER REFERENCES calendar_series(id) ON DELETE SET NULL,\n    event_type TEXT NOT NULL,\n    old_value TEXT,\n    new_value TEXT,\n    message TEXT,\n    occurred_at TEXT NOT NULL,\n    created_at TEXT NOT NULL\n  );\n\nCREATE TABLE IF NOT EXISTS calendar_day_types (\n    calendar_date TEXT PRIMARY KEY,\n    day_type TEXT NOT NULL,\n    holiday_name TEXT,\n    note TEXT,\n    updated_at TEXT NOT NULL\n  );\n\nCREATE TABLE IF NOT EXISTS calendar_settings (\n    key TEXT PRIMARY KEY,\n    value TEXT NOT NULL,\n    updated_at TEXT NOT NULL\n  );\n\nCREATE TABLE IF NOT EXISTS sessions (\n    id TEXT PRIMARY KEY,\n    username TEXT NOT NULL,\n    created_at TEXT NOT NULL,\n    expires_at TEXT NOT NULL,\n    ip TEXT,\n    user_agent TEXT\n  );\n\nCREATE TABLE IF NOT EXISTS list_folders (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    name TEXT NOT NULL UNIQUE,\n    position INTEGER NOT NULL DEFAULT 0,\n    collapsed INTEGER NOT NULL DEFAULT 0,\n    created_at TEXT NOT NULL,\n    updated_at TEXT NOT NULL\n  );\n\nCREATE TABLE IF NOT EXISTS list_modes (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    name TEXT NOT NULL UNIQUE,\n    position INTEGER NOT NULL DEFAULT 0,\n    is_default INTEGER NOT NULL DEFAULT 0,\n    created_at TEXT NOT NULL,\n    updated_at TEXT NOT NULL\n  );\n\nCREATE TABLE IF NOT EXISTS list_mode_items (\n    mode_id INTEGER NOT NULL REFERENCES list_modes(id) ON DELETE CASCADE,\n    list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,\n    position INTEGER NOT NULL DEFAULT 0,\n    PRIMARY KEY (mode_id, list_id)\n  );\n\nCREATE TABLE IF NOT EXISTS app_settings (\n    key TEXT PRIMARY KEY,\n    value TEXT NOT NULL,\n    updated_at TEXT NOT NULL\n  );\n\nCREATE TABLE IF NOT EXISTS task_table_settings (\n    scope TEXT PRIMARY KEY,\n    visible_columns_json TEXT NOT NULL DEFAULT '[]',\n    column_widths_json TEXT NOT NULL DEFAULT '{}',\n    group_by TEXT NOT NULL DEFAULT '',\n    fill_rules_json TEXT NOT NULL DEFAULT '[]',\n    locked INTEGER NOT NULL DEFAULT 0,\n    updated_at TEXT NOT NULL\n  );\n\nCREATE TABLE IF NOT EXISTS filter_templates (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,\n    name TEXT NOT NULL,\n    filters_json TEXT NOT NULL,\n    sort TEXT NOT NULL DEFAULT 'created',\n    position INTEGER NOT NULL DEFAULT 0,\n    created_at TEXT NOT NULL,\n    updated_at TEXT NOT NULL,\n    UNIQUE(list_id, name)\n  );\n\nCREATE TABLE IF NOT EXISTS automation_rules (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,\n    name TEXT NOT NULL,\n    field TEXT NOT NULL DEFAULT 'title',\n    operator TEXT NOT NULL DEFAULT 'contains',\n    value TEXT NOT NULL,\n    actions_json TEXT NOT NULL DEFAULT '{}',\n    active INTEGER NOT NULL DEFAULT 1,\n    position INTEGER NOT NULL DEFAULT 0,\n    created_at TEXT NOT NULL,\n    updated_at TEXT NOT NULL\n  );\n\nCREATE TABLE IF NOT EXISTS analytics_events (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    event_uuid TEXT NOT NULL UNIQUE,\n    occurred_at TEXT NOT NULL,\n    module TEXT NOT NULL,\n    event_name TEXT NOT NULL,\n    source TEXT NOT NULL DEFAULT 'web',\n    result TEXT NOT NULL DEFAULT 'success',\n    page TEXT NOT NULL DEFAULT '',\n    list_id INTEGER REFERENCES lists(id) ON DELETE SET NULL,\n    object_type TEXT,\n    object_id TEXT,\n    duration_ms INTEGER,\n    error_code TEXT,\n    app_version TEXT NOT NULL,\n    device_type TEXT,\n    metadata_json TEXT NOT NULL DEFAULT '{}',\n    created_at TEXT NOT NULL\n  );\n\nCREATE TABLE IF NOT EXISTS analytics_daily_stats (\n    stat_date TEXT NOT NULL,\n    module TEXT NOT NULL,\n    event_name TEXT NOT NULL,\n    source TEXT NOT NULL,\n    result TEXT NOT NULL,\n    page TEXT NOT NULL DEFAULT '',\n    list_id INTEGER NOT NULL DEFAULT 0,\n    event_count INTEGER NOT NULL DEFAULT 0,\n    total_duration_ms INTEGER NOT NULL DEFAULT 0,\n    max_duration_ms INTEGER NOT NULL DEFAULT 0,\n    updated_at TEXT NOT NULL,\n    PRIMARY KEY (stat_date, module, event_name, source, result, page, list_id)\n  );\n\nCREATE TABLE IF NOT EXISTS sop_themes (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    source_record_id TEXT UNIQUE,\n    name TEXT NOT NULL,\n    color TEXT NOT NULL DEFAULT '#9c5a43',\n    category TEXT,\n    priority TEXT NOT NULL DEFAULT 'P4',\n    is_important INTEGER NOT NULL DEFAULT 0,\n    frequency_label TEXT,\n    rule_type TEXT NOT NULL DEFAULT 'none',\n    rule_config_json TEXT NOT NULL DEFAULT '{}',\n    interval_days INTEGER,\n    delay_discard_hours INTEGER,\n    start_date TEXT,\n    next_run_date TEXT,\n    create_state TEXT NOT NULL DEFAULT '\u7B49\u5F85\u521B\u5EFA',\n    status TEXT NOT NULL DEFAULT 'enabled',\n    generation_enabled INTEGER NOT NULL DEFAULT 1,\n    theme_type TEXT NOT NULL DEFAULT 'standard',\n    generation_mode TEXT NOT NULL DEFAULT 'schedule',\n    continuous_enabled INTEGER NOT NULL DEFAULT 0,\n    continuous_days INTEGER NOT NULL DEFAULT 1,\n    follow_source_event_id INTEGER,\n    follow_delay_days INTEGER NOT NULL DEFAULT 0,\n    position INTEGER NOT NULL DEFAULT 0,\n    source_payload TEXT,\n    source_created_at TEXT,\n    source_updated_at TEXT,\n    created_at TEXT NOT NULL,\n    updated_at TEXT NOT NULL\n  );\n\nCREATE TABLE IF NOT EXISTS sop_events (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    theme_id INTEGER NOT NULL REFERENCES sop_themes(id) ON DELETE CASCADE,\n    source_record_id TEXT UNIQUE,\n    source_unique_number TEXT,\n    title TEXT NOT NULL,\n    note TEXT,\n    sort_order REAL NOT NULL DEFAULT 0,\n    category TEXT,\n    special_label TEXT,\n    mobile_capable INTEGER NOT NULL DEFAULT 0,\n    early_completion INTEGER NOT NULL DEFAULT 0,\n    generation_enabled INTEGER NOT NULL DEFAULT 1,\n    active_until TEXT,\n    recurrence_type TEXT,\n    recurrence_config_json TEXT NOT NULL DEFAULT '{}',\n    recurrence_start_date TEXT,\n    recurrence_end_type TEXT NOT NULL DEFAULT 'never',\n    recurrence_count INTEGER,\n    recurrence_end_date TEXT,\n    generation_mode TEXT NOT NULL DEFAULT 'inherit',\n    continuous_enabled INTEGER NOT NULL DEFAULT 0,\n    continuous_days INTEGER NOT NULL DEFAULT 1,\n    follow_source_event_id INTEGER,\n    follow_delay_days INTEGER NOT NULL DEFAULT 0,\n    source_payload TEXT,\n    created_at TEXT NOT NULL,\n    updated_at TEXT NOT NULL\n  );\n\nCREATE TABLE IF NOT EXISTS sop_executions (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    source_record_id TEXT UNIQUE,\n    source_log_number TEXT,\n    theme_id INTEGER REFERENCES sop_themes(id) ON DELETE SET NULL,\n    event_id INTEGER REFERENCES sop_events(id) ON DELETE SET NULL,\n    title TEXT NOT NULL,\n    note TEXT,\n    category TEXT,\n    priority TEXT NOT NULL DEFAULT 'P4',\n    is_important INTEGER NOT NULL DEFAULT 0,\n    mobile_capable INTEGER NOT NULL DEFAULT 0,\n    early_completion INTEGER NOT NULL DEFAULT 0,\n    special_label TEXT,\n    scheduled_date TEXT NOT NULL,\n    due_at TEXT,\n    deferred_until TEXT,\n    status TEXT NOT NULL DEFAULT 'pending',\n    completed_at TEXT,\n    discarded_at TEXT,\n    batch_completed INTEGER NOT NULL DEFAULT 0,\n    permanent_disabled INTEGER NOT NULL DEFAULT 0,\n    idempotency_key TEXT NOT NULL UNIQUE,\n    source_payload TEXT,\n    source_created_at TEXT,\n    source_updated_at TEXT,\n    created_at TEXT NOT NULL,\n    updated_at TEXT NOT NULL\n  );\n\nCREATE TABLE IF NOT EXISTS sop_execution_events (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    execution_id INTEGER REFERENCES sop_executions(id) ON DELETE CASCADE,\n    event_type TEXT NOT NULL,\n    source TEXT NOT NULL DEFAULT '\u7F51\u9875\u64CD\u4F5C',\n    detail_json TEXT NOT NULL DEFAULT '{}',\n    occurred_at TEXT NOT NULL,\n    created_at TEXT NOT NULL\n  );\n\nCREATE TABLE IF NOT EXISTS sop_runtime_logs (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    source_table_id TEXT,\n    source_record_id TEXT,\n    log_type TEXT NOT NULL,\n    level TEXT NOT NULL DEFAULT 'info',\n    theme_name TEXT,\n    event_name TEXT,\n    message TEXT NOT NULL,\n    detail_json TEXT NOT NULL DEFAULT '{}',\n    occurred_at TEXT NOT NULL,\n    created_at TEXT NOT NULL,\n    UNIQUE(source_table_id, source_record_id)\n  );\n\nCREATE TABLE IF NOT EXISTS sop_work_calendar (\n    calendar_date TEXT PRIMARY KEY,\n    day_type TEXT NOT NULL,\n    weekday_label TEXT,\n    first_workday INTEGER NOT NULL DEFAULT 0,\n    day_after_rest INTEGER NOT NULL DEFAULT 0,\n    note TEXT,\n    source_record_id TEXT UNIQUE,\n    source_payload TEXT,\n    source TEXT NOT NULL DEFAULT 'manual',\n    updated_at TEXT NOT NULL\n  , template_id INTEGER);\n\nCREATE TABLE IF NOT EXISTS sop_calendar_templates (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    name TEXT NOT NULL UNIQUE,\n    color TEXT NOT NULL DEFAULT '#2877d4',\n    weekday_config_json TEXT NOT NULL DEFAULT '{\"1\":\"workday\",\"2\":\"workday\",\"3\":\"workday\",\"4\":\"workday\",\"5\":\"workday\",\"6\":\"restday\",\"0\":\"restday\"}',\n    is_default INTEGER NOT NULL DEFAULT 0,\n    created_at TEXT NOT NULL,\n    updated_at TEXT NOT NULL\n  );\n\nCREATE TABLE IF NOT EXISTS sop_manual_calendars (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    name TEXT NOT NULL UNIQUE,\n    color TEXT NOT NULL DEFAULT '#2877d4',\n    status TEXT NOT NULL DEFAULT 'active',\n    created_at TEXT NOT NULL,\n    updated_at TEXT NOT NULL\n  );\n\nCREATE TABLE IF NOT EXISTS sop_manual_calendar_dates (\n    calendar_id INTEGER NOT NULL REFERENCES sop_manual_calendars(id) ON DELETE CASCADE,\n    calendar_date TEXT NOT NULL,\n    note TEXT,\n    created_at TEXT NOT NULL,\n    updated_at TEXT NOT NULL,\n    PRIMARY KEY (calendar_id, calendar_date)\n  );\n\nCREATE TABLE IF NOT EXISTS sop_settings (\n    key TEXT PRIMARY KEY,\n    value TEXT NOT NULL,\n    updated_at TEXT NOT NULL\n  );\n\nCREATE TABLE IF NOT EXISTS sop_view_settings (\n    scope TEXT PRIMARY KEY,\n    visible_columns_json TEXT NOT NULL DEFAULT '[]',\n    column_order_json TEXT NOT NULL DEFAULT '[]',\n    column_widths_json TEXT NOT NULL DEFAULT '{}',\n    group_by TEXT NOT NULL DEFAULT 'theme',\n    updated_at TEXT NOT NULL\n  );\n\nCREATE TABLE IF NOT EXISTS document_nodes (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    parent_id INTEGER REFERENCES document_nodes(id) ON DELETE CASCADE,\n    node_type TEXT NOT NULL CHECK(node_type IN ('folder', 'document')),\n    title TEXT NOT NULL,\n    position REAL NOT NULL DEFAULT 0,\n    pinned INTEGER NOT NULL DEFAULT 0,\n    deleted_at TEXT,\n    created_at TEXT NOT NULL,\n    updated_at TEXT NOT NULL\n  );\n\nCREATE TABLE IF NOT EXISTS documents (\n    node_id INTEGER PRIMARY KEY REFERENCES document_nodes(id) ON DELETE CASCADE,\n    markdown TEXT NOT NULL DEFAULT '',\n    version INTEGER NOT NULL DEFAULT 1,\n    saved_at TEXT NOT NULL,\n    created_at TEXT NOT NULL,\n    updated_at TEXT NOT NULL\n  );\n\nCREATE TABLE IF NOT EXISTS document_revisions (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    node_id INTEGER NOT NULL REFERENCES documents(node_id) ON DELETE CASCADE,\n    version INTEGER NOT NULL,\n    markdown TEXT NOT NULL,\n    reason TEXT NOT NULL DEFAULT 'auto',\n    created_at TEXT NOT NULL,\n    UNIQUE(node_id, version)\n  );\n\nCREATE TABLE IF NOT EXISTS document_edit_leases (\n    node_id INTEGER PRIMARY KEY REFERENCES documents(node_id) ON DELETE CASCADE,\n    lease_token TEXT NOT NULL UNIQUE,\n    client_id TEXT NOT NULL,\n    username TEXT NOT NULL,\n    expires_at TEXT NOT NULL,\n    updated_at TEXT NOT NULL\n  );\n\nCREATE TABLE IF NOT EXISTS document_logs (\n    id INTEGER PRIMARY KEY AUTOINCREMENT,\n    node_id INTEGER REFERENCES document_nodes(id) ON DELETE SET NULL,\n    event_type TEXT NOT NULL,\n    detail_json TEXT NOT NULL DEFAULT '{}',\n    occurred_at TEXT NOT NULL,\n    created_at TEXT NOT NULL\n  );\n\nCREATE INDEX IF NOT EXISTS idx_tasks_list ON tasks(list_id);\n\nCREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);\n\nCREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_at);\n\nCREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(updated_at DESC);\n\nCREATE INDEX IF NOT EXISTS idx_tasks_deleted ON tasks(deleted_at);\n\nCREATE INDEX IF NOT EXISTS idx_logs_task ON task_logs(task_id, occurred_at DESC);\n\nCREATE INDEX IF NOT EXISTS idx_logs_number ON task_logs(task_no);\n\nCREATE INDEX IF NOT EXISTS idx_analytics_events_time\n    ON analytics_events(occurred_at DESC);\n\nCREATE INDEX IF NOT EXISTS idx_analytics_events_feature\n    ON analytics_events(module, event_name, occurred_at DESC);\n\nCREATE INDEX IF NOT EXISTS idx_analytics_events_result\n    ON analytics_events(result, occurred_at DESC);\n\nCREATE INDEX IF NOT EXISTS idx_analytics_events_source\n    ON analytics_events(source, occurred_at DESC);\n\nCREATE INDEX IF NOT EXISTS idx_analytics_daily_date\n    ON analytics_daily_stats(stat_date DESC, module, source);\n\nCREATE INDEX IF NOT EXISTS idx_sop_themes_status\n    ON sop_themes(status, generation_enabled, position);\n\nCREATE INDEX IF NOT EXISTS idx_sop_events_theme\n    ON sop_events(theme_id, generation_enabled, sort_order);\n\nCREATE INDEX IF NOT EXISTS idx_sop_executions_date_status\n    ON sop_executions(scheduled_date, status, theme_id);\n\nCREATE INDEX IF NOT EXISTS idx_sop_executions_event\n    ON sop_executions(event_id, scheduled_date);\n\nCREATE INDEX IF NOT EXISTS idx_sop_execution_events_execution\n    ON sop_execution_events(execution_id, occurred_at DESC);\n\nCREATE INDEX IF NOT EXISTS idx_sop_runtime_logs_time\n    ON sop_runtime_logs(occurred_at DESC, log_type);\n\nCREATE INDEX IF NOT EXISTS idx_document_nodes_parent\n    ON document_nodes(parent_id, deleted_at, pinned DESC, position, id);\n\nCREATE INDEX IF NOT EXISTS idx_document_nodes_deleted\n    ON document_nodes(deleted_at, updated_at DESC);\n\nCREATE INDEX IF NOT EXISTS idx_document_revisions_node\n    ON document_revisions(node_id, version DESC);\n\nCREATE INDEX IF NOT EXISTS idx_document_leases_expiry\n    ON document_edit_leases(expires_at);\n\nCREATE INDEX IF NOT EXISTS idx_document_logs_time\n    ON document_logs(occurred_at DESC, event_type);");
const now = new Date().toISOString();
db.prepare(`
  INSERT OR IGNORE INTO sop_calendar_templates
    (name, color, weekday_config_json, is_default, created_at, updated_at)
  VALUES ('标准工作日历', '#2877d4', ?, 1, ?, ?)
`).run(JSON.stringify({
  0: "restday",
  1: "workday",
  2: "workday",
  3: "workday",
  4: "workday",
  5: "workday",
  6: "restday"
}), now, now);
const seedList = db.prepare(`
  INSERT OR IGNORE INTO lists
    (name, color, position, is_default, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const seedLists = db.transaction(() => {
  seedList.run("生活任务", "#9c5a43", 0, 1, now, now);
  seedList.run("工作任务", "#2877d4", 1, 0, now, now);
});
seedLists();
const defaultMode = db.prepare(`
  INSERT OR IGNORE INTO list_modes
    (name, position, is_default, created_at, updated_at)
  VALUES ('全部清单', 0, 1, ?, ?)
`);
defaultMode.run(now, now);
const defaultModeId = db.prepare("SELECT id FROM list_modes WHERE is_default = 1 ORDER BY id LIMIT 1").pluck().get();
const addDefaultModeItem = db.prepare(`
  INSERT OR IGNORE INTO list_mode_items (mode_id, list_id, position)
  SELECT ?, id, position FROM lists WHERE id = ?
`);
for (const list of db.prepare("SELECT id FROM lists WHERE archived_at IS NULL").all()) {
  addDefaultModeItem.run(defaultModeId, list.id);
}
const seedSetting = db.prepare(`
  INSERT OR IGNORE INTO app_settings (key, value, updated_at)
  VALUES (?, ?, ?)
`);
for (const [key, value] of [["theme_mode", "auto"], ["light_start", "07:00"], ["dark_start", "19:00"], ["default_task_view", "table"], ["calendar_date_field", "dueAt"], ["gantt_start_field", "startAt"], ["gantt_end_field", "dueAt"], ["today_view_scope", JSON.stringify({
  field: "due",
  mode: "today",
  days: 1,
  openOnly: false
})], ["upcoming_view_scope", JSON.stringify({
  field: "due",
  mode: "future",
  days: 7,
  openOnly: true
})]]) {
  seedSetting.run(key, value, now);
}
const seedCalendarSetting = db.prepare(`
  INSERT OR IGNORE INTO calendar_settings (key, value, updated_at)
  VALUES (?, ?, ?)
`);
for (const [key, value] of [["default_view", defaultCalendarView], ["default_start_time", "09:00"], ["default_duration_minutes", "60"], ["default_reminder_minutes", "10"], ["show_completed", "1"], ["show_discarded", "0"], ["visible_list_ids", "[]"], ["display_start_time", "06:00:00"], ["display_end_time", "24:00:00"], ["calendar_view_height", "720"]]) {
  seedCalendarSetting.run(key, value, now);
}
const seedSopSetting = db.prepare(`
  INSERT OR IGNORE INTO sop_settings (key, value, updated_at)
  VALUES (?, ?, ?)
`);
for (const [key, value] of [["timezone", "Asia/Shanghai"], ["scheduler_enabled", "1"], ["generation_time", "04:00"], ["maintenance_time", "00:05"], ["default_sop_tab", "today"]]) {
  seedSopSetting.run(key, value, now);
}
const recurringEventsThemeMigration = "migration.sop_recurring_events_theme.v1";
let recurringEventsTheme = db.prepare("SELECT id FROM sop_themes WHERE theme_type = 'recurring_events' LIMIT 1").get();
if (!recurringEventsTheme) {
  recurringEventsTheme = db.prepare("SELECT id FROM sop_themes WHERE name = '重复事件' LIMIT 1").get();
}
if (recurringEventsTheme) {
  db.prepare(`
    UPDATE sop_themes SET name = '重复事件', theme_type = 'recurring_events',
      frequency_label = '事件独立循环', rule_type = 'none', rule_config_json = '{}',
      interval_days = NULL, start_date = NULL, next_run_date = NULL,
      generation_mode = 'schedule', continuous_enabled = 0, continuous_days = 1,
      follow_source_event_id = NULL, follow_delay_days = 0,
      status = 'enabled', generation_enabled = 1, position = -1, updated_at = ?
    WHERE id = ?
  `).run(now, recurringEventsTheme.id);
} else {
  const inserted = db.prepare(`
    INSERT INTO sop_themes (
      name, color, category, priority, is_important, frequency_label,
      rule_type, rule_config_json, status, generation_enabled, theme_type,
      position, created_at, updated_at
    ) VALUES ('重复事件', '#2877d4', '独立循环', 'P4', 0, '事件独立循环',
      'none', '{}', 'enabled', 1, 'recurring_events', -1, ?, ?)
  `).run(now, now);
  recurringEventsTheme = {
    id: inserted.lastInsertRowid
  };
}
db.prepare(`
  INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`).run(recurringEventsThemeMigration, JSON.stringify({
  themeId: recurringEventsTheme.id
}), now);
db.prepare(`
  UPDATE sop_events SET generation_mode = 'independent',
    follow_source_event_id = NULL, follow_delay_days = 0
  WHERE theme_id = ?
`).run(recurringEventsTheme.id);
export function defaultListId() {
  return db.prepare("SELECT id FROM lists WHERE archived_at IS NULL ORDER BY is_default DESC, position ASC LIMIT 1").pluck().get();
}
export function nextTaskNumber() {
  const value = db.prepare("SELECT MAX(CAST(REPLACE(task_no, 'T-', '') AS INTEGER)) FROM tasks WHERE task_no LIKE 'T-%'").pluck().get();
  return `T-${String((Number(value) || 0) + 1).padStart(5, "0")}`;
}
export function writeTaskLog({
  taskId,
  taskNo,
  eventType,
  oldValue = null,
  newValue = null,
  source = "网页操作",
  message = null,
  occurredAt = new Date().toISOString(),
  changedFields = null
}) {
  const snapshot = taskId ? db.prepare(`
          SELECT t.title, t.status, t.list_id AS listId, l.name AS listName
          FROM tasks t
          LEFT JOIN lists l ON l.id = t.list_id
          WHERE t.id = ?
        `).get(taskId) : null;
  db.prepare(`
    INSERT INTO task_logs (
      task_id, task_no, event_type, old_value, new_value,
      source, message, occurred_at, created_at,
      list_id, list_name, task_title, task_status, changed_fields_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(taskId, taskNo, eventType, oldValue, newValue, source, message, occurredAt, new Date().toISOString(), snapshot?.listId || null, snapshot?.listName || null, snapshot?.title || message || null, snapshot?.status || newValue || null, changedFields ? JSON.stringify(changedFields) : null);
}
export function closeDatabase() {
  db.close();
}
