import { executionColumnOrder, logColumnOrder } from "./library-sort.mjs";
import { randomUUID } from "node:crypto";
import { db } from "./db.mjs";
const SOP_PAGE_SIZE = 50;
const RECURRING_EVENTS_THEME_TYPE = "recurring_events";
const recurringRuleTypes = new Set(["daily", "workday", "restday", "weekly", "monthly_day", "monthly_last_day", "first_workday", "nth_workday", "nth_restday", "last_workday", "last_restday", "day_before_workday", "day_before_restday", "day_after_workday", "day_after_rest", "interval", "custom_dates"]);
const themeColors = ["#e11d48", "#dc2626", "#f97316", "#ca8a19", "#eab308", "#65a30d", "#16a34a", "#059669", "#0d9488", "#0891b2", "#0284c7", "#2563eb", "#4f46e5", "#7c3aed", "#9333ea", "#c026d3", "#db2777", "#be123c", "#9c5a43", "#475569", "#77736d", "#2877d4", "#3c8b62", "#0f766e"];
const executionViewColumns = ["select", "complete", "title", "note", "theme", "priority", "status", "scheduledDate", "dueAt", "specialLabel", "mobile", "source", "actions"];
const defaultExecutionVisibleColumns = ["complete", "title", "note", "theme", "priority", "status", "scheduledDate", "dueAt", "actions"];
const defaultExecutionColumnWidths = {
  select: 44,
  complete: 58,
  title: 300,
  note: 260,
  theme: 160,
  priority: 82,
  status: 96,
  scheduledDate: 108,
  dueAt: 108,
  specialLabel: 130,
  mobile: 86,
  source: 165,
  actions: 142
};
function nowIso() {
  return new Date().toISOString();
}
function numberedThemeName(value, excludeId = null) {
  const base = String(value || "").trim().replace(/^\d{2,3}-/, "");
  const row = excludeId ? db.prepare("SELECT name FROM sop_themes WHERE id <> ? AND name GLOB '[0-9][0-9]-*' ORDER BY CAST(substr(name, 1, instr(name, '-') - 1) AS INTEGER) DESC LIMIT 1").get(excludeId) : db.prepare("SELECT name FROM sop_themes WHERE name GLOB '[0-9][0-9]-*' ORDER BY CAST(substr(name, 1, instr(name, '-') - 1) AS INTEGER) DESC LIMIT 1").get();
  const current = Number(String(row?.name || "").split("-")[0]) || 0;
  return `${String(current + 1).padStart(2, "0")}-${base}`;
}
function isRecurringEventsTheme(theme) {
  return theme?.themeType === RECURRING_EVENTS_THEME_TYPE;
}
function toBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}
function asJson(value, fallback = {}) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}
function uniqueAllowedColumns(value, fallback) {
  const source = Array.isArray(value) ? value : fallback;
  return [...new Set(source.filter(key => executionViewColumns.includes(key)))];
}
function normalizeExecutionViewSettings(row = {}) {
  const visibleColumns = uniqueAllowedColumns(asJson(row.visible_columns_json, row.visibleColumns || defaultExecutionVisibleColumns), defaultExecutionVisibleColumns);
  const savedOrder = uniqueAllowedColumns(asJson(row.column_order_json, row.columnOrder || executionViewColumns), executionViewColumns);
  const columnOrder = [...savedOrder, ...executionViewColumns.filter(key => !savedOrder.includes(key))];
  const rawWidths = asJson(row.column_widths_json, row.columnWidths || {});
  const columnWidths = Object.fromEntries(executionViewColumns.map(key => {
    const width = Number(rawWidths?.[key] ?? defaultExecutionColumnWidths[key]);
    return [key, Math.max(42, Math.min(Number.isFinite(width) ? width : defaultExecutionColumnWidths[key], 800))];
  }));
  return {
    scope: "executions",
    visibleColumns: visibleColumns.length ? visibleColumns : defaultExecutionVisibleColumns,
    columnOrder,
    columnWidths,
    groupBy: row.group_by === "" ? "" : "theme",
    updatedAt: row.updated_at || null
  };
}
function getExecutionViewSettings() {
  const row = db.prepare("SELECT * FROM sop_view_settings WHERE scope = 'executions'").get();
  return normalizeExecutionViewSettings(row || {});
}
function localDate(offset = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(Date.now() + offset * 86_400_000));
  const read = type => parts.find(part => part.type === type)?.value;
  return `${read("year")}-${read("month")}-${read("day")}`;
}
function beijingTime() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(new Date());
  const read = type => parts.find(part => part.type === type)?.value;
  return `${read("hour")}:${read("minute")}`;
}
function addDays(date, amount) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
function daysBetween(anchor, date) {
  return Math.round((new Date(`${date}T12:00:00Z`) - new Date(`${anchor}T12:00:00Z`)) / 86_400_000);
}
function dayOfWeek(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}
function mapFrequencyLabel(label, intervalDays = null) {
  const value = String(label || "");
  if (value.includes("自定义日期")) return {
    type: "custom_dates",
    config: {}
  };
  if (value.includes("手动")) return {
    type: "manual",
    config: {}
  };
  if (value.includes("不创建") || value.includes("不定期")) return {
    type: "none",
    config: {}
  };
  if (value.includes("首个工作日")) return {
    type: "first_workday",
    config: {}
  };
  if (value.includes("最后一个工作日")) return {
    type: "last_workday",
    config: {}
  };
  if (value.includes("最后一个休息日")) return {
    type: "last_restday",
    config: {}
  };
  if (value.includes("次日为工作日")) return {
    type: "day_before_workday",
    config: {}
  };
  if (value.includes("次日为休息日")) return {
    type: "day_before_restday",
    config: {}
  };
  if (value.includes("休息日次日")) return {
    type: "day_after_rest",
    config: {}
  };
  if (value.includes("工作日")) return {
    type: "workday",
    config: {}
  };
  if (value.includes("休息日") || value.includes("工休日")) return {
    type: "restday",
    config: {}
  };
  const weekdays = {
    周日: 0,
    周一: 1,
    周二: 2,
    周三: 3,
    周四: 4,
    周五: 5,
    周六: 6
  };
  for (const [text, weekday] of Object.entries(weekdays)) {
    if (value.includes(text)) return {
      type: "weekly",
      config: {
        weekdays: [weekday]
      }
    };
  }
  if (value.includes("周期") || /每\d+日/.test(value)) {
    const detected = Number(value.match(/每(\d+)日/)?.[1] || intervalDays || 1);
    return {
      type: "interval",
      config: {
        intervalDays: Math.max(detected, 1)
      }
    };
  }
  if (value.includes("每日")) return {
    type: "daily",
    config: {}
  };
  return {
    type: "none",
    config: {}
  };
}
function manualCalendar(calendarId, {
  activeOnly = true
} = {}) {
  const id = Number(calendarId);
  if (!id) return null;
  const statusClause = activeOnly ? " AND status = 'active'" : "";
  return db.prepare(`
    SELECT id, name, color, status, created_at AS createdAt, updated_at AS updatedAt
    FROM sop_manual_calendars WHERE id = ?${statusClause}
  `).get(id) || null;
}
function normalizeRuleConfig(ruleType, rawConfig = {}) {
  const config = {
    ...(rawConfig || {})
  };
  if (ruleType !== "custom_dates") return config;
  const calendar = manualCalendar(config.calendarId);
  if (!calendar) {
    throw Object.assign(new Error("请选择有效的 SOP 手动日期日历"), {
      status: 400
    });
  }
  return {
    calendarId: calendar.id
  };
}
function isManualCalendarDate(calendarId, date) {
  return Boolean(db.prepare(`
    SELECT 1
    FROM sop_manual_calendar_dates d
    JOIN sop_manual_calendars c ON c.id = d.calendar_id
    WHERE d.calendar_id = ? AND d.calendar_date = ? AND c.status = 'active'
  `).get(Number(calendarId), date));
}
function calendarType(date) {
  const row = db.prepare(`
    SELECT day_type AS dayType, first_workday AS firstWorkday,
           day_after_rest AS dayAfterRest
    FROM sop_work_calendar WHERE calendar_date = ?
  `).get(date);
  if (row) return row;
  const weekday = dayOfWeek(date);
  return {
    dayType: weekday === 0 || weekday === 6 ? "restday" : "workday",
    firstWorkday: false,
    dayAfterRest: false
  };
}
function isWorkday(date) {
  return ["workday", "adjusted_workday"].includes(calendarType(date).dayType);
}
function firstWorkday(date) {
  const source = db.prepare(`
    SELECT first_workday AS firstWorkday
    FROM sop_work_calendar WHERE calendar_date = ?
  `).get(date);
  if (source?.firstWorkday) return true;
  return isWorkday(date) && dayOfWeek(date) === 1;
}
function dayNumberByType(date, targetWorkday) {
  const day = Number(date.slice(8));
  let count = 0;
  for (let current = 1; current <= day; current += 1) {
    const candidate = `${date.slice(0, 8)}${String(current).padStart(2, "0")}`;
    if (isWorkday(candidate) === targetWorkday) count += 1;
  }
  return isWorkday(date) === targetWorkday ? count : 0;
}
function isLastDayByType(date, targetWorkday) {
  if (isWorkday(date) !== targetWorkday) return false;
  let candidate = addDays(date, 1);
  while (candidate.slice(0, 7) === date.slice(0, 7)) {
    if (isWorkday(candidate) === targetWorkday) return false;
    candidate = addDays(candidate, 1);
  }
  return true;
}
function shouldGenerate(theme, date) {
  if (theme.startDate && date < theme.startDate) return false;
  const config = asJson(theme.ruleConfigJson, {});
  switch (theme.ruleType) {
    case "daily":
      return true;
    case "workday":
      return isWorkday(date);
    case "restday":
      return !isWorkday(date);
    case "weekly":
      return (config.weekdays || []).map(Number).includes(dayOfWeek(date));
    case "monthly_day":
      return Number(date.slice(8)) === Number(config.day || 1);
    case "monthly_last_day":
      return addDays(date, 1).slice(0, 7) !== date.slice(0, 7);
    case "first_workday":
      return firstWorkday(date);
    case "nth_workday":
      return dayNumberByType(date, true) === Number(config.nth || 1);
    case "nth_restday":
      return dayNumberByType(date, false) === Number(config.nth || 1);
    case "last_workday":
      return isLastDayByType(date, true);
    case "last_restday":
      return isLastDayByType(date, false);
    case "day_before_workday":
      return isWorkday(addDays(date, 1));
    case "day_before_restday":
      return !isWorkday(addDays(date, 1));
    case "day_after_workday":
      return isWorkday(addDays(date, -1));
    case "day_after_rest":
      {
        const source = calendarType(date);
        return Boolean(source.dayAfterRest) || isWorkday(date) && !isWorkday(addDays(date, -1));
      }
    case "custom_dates":
      return isManualCalendarDate(config.calendarId, date);
    case "interval":
      {
        const anchor = theme.startDate || date;
        const difference = daysBetween(anchor, date);
        const intervalDays = Math.max(Number(config.intervalDays || theme.intervalDays || 1), 1);
        const continuousDays = theme.continuousEnabled ? Math.max(1, Number(theme.continuousDays || 1)) : 1;
        return difference >= 0 && difference % intervalDays < continuousDays;
      }
    default:
      return false;
  }
}
function normalizedContinuousInput({
  ruleType,
  ruleConfig = {},
  intervalDays = null,
  continuousEnabled = false,
  continuousDays = 1
}) {
  const enabled = toBoolean(continuousEnabled);
  const days = enabled ? Math.max(1, Number(continuousDays || 1)) : 1;
  if (!enabled) return {
    enabled: false,
    days: 1
  };
  if (ruleType !== "interval") {
    throw Object.assign(new Error("持续性生成仅适用于“间隔天数”循环周期"), {
      status: 400
    });
  }
  const interval = Math.max(1, Number(ruleConfig?.intervalDays || intervalDays || 1));
  if (days > interval) {
    throw Object.assign(new Error(`持续生成天数不能超过间隔天数（当前间隔 ${interval} 天）`), {
      status: 400
    });
  }
  return {
    enabled: true,
    days
  };
}
function normalizedFollowInput({
  generationMode,
  followSourceEventId,
  followDelayDays
}, fallbackMode) {
  const mode = String(generationMode || fallbackMode);
  const allowedModes = fallbackMode === "schedule" ? ["schedule", "follow"] : ["inherit", "follow"];
  if (!allowedModes.includes(mode)) {
    throw Object.assign(new Error("产生方式不正确"), {
      status: 400
    });
  }
  if (mode !== "follow") return {
    mode,
    sourceEventId: null,
    delayDays: 0
  };
  const sourceEventId = Number(followSourceEventId);
  if (!sourceEventId || !db.prepare("SELECT 1 FROM sop_events WHERE id = ?").get(sourceEventId)) {
    throw Object.assign(new Error("请选择有效的跟随来源事件"), {
      status: 400
    });
  }
  return {
    mode,
    sourceEventId,
    delayDays: Math.max(0, Math.min(3650, Number(followDelayDays || 0)))
  };
}
function assertNoFollowCycle({
  targetType,
  targetId = null,
  targetThemeId = null,
  sourceEventId
}) {
  const adjacency = new Map();
  const addEdge = (source, target) => {
    if (!adjacency.has(source)) adjacency.set(source, []);
    adjacency.get(source).push(target);
  };
  for (const row of db.prepare(`
    SELECT id, follow_source_event_id AS sourceEventId
    FROM sop_events WHERE generation_mode = 'follow' AND follow_source_event_id IS NOT NULL
  `).all()) {
    if (targetType === "event" && Number(row.id) === Number(targetId)) continue;
    addEdge(Number(row.sourceEventId), Number(row.id));
  }
  for (const theme of db.prepare(`
    SELECT id, follow_source_event_id AS sourceEventId
    FROM sop_themes WHERE generation_mode = 'follow' AND follow_source_event_id IS NOT NULL
  `).all()) {
    if (targetType === "theme" && Number(theme.id) === Number(targetId)) continue;
    for (const event of db.prepare("SELECT id FROM sop_events WHERE theme_id = ? AND generation_mode <> 'follow'").all(theme.id)) {
      addEdge(Number(theme.sourceEventId), Number(event.id));
    }
  }
  const targets = targetType === "event" ? [Number(targetId)].filter(Boolean) : db.prepare("SELECT id FROM sop_events WHERE theme_id = ? AND generation_mode <> 'follow'").all(Number(targetId || targetThemeId)).map(row => Number(row.id));
  for (const target of targets) addEdge(Number(sourceEventId), target);
  const visiting = new Set();
  const visited = new Set();
  const visit = node => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of adjacency.get(node) || []) if (visit(next)) return true;
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  for (const node of adjacency.keys()) {
    if (visit(node)) throw Object.assign(new Error("跟随关系会形成循环，请修改来源事件"), {
      status: 400
    });
  }
}
function recurrenceInput(body = {}, current = {}) {
  const type = String(body.recurrenceType ?? current.recurrenceType ?? "").trim();
  if (!recurringRuleTypes.has(type)) {
    throw Object.assign(new Error("重复事件必须配置有效的循环周期"), {
      status: 400
    });
  }
  let config = {
    ...(body.recurrenceConfig ?? current.recurrenceConfig ?? {})
  };
  if (type === "weekly") {
    config.weekdays = [...new Set((Array.isArray(config.weekdays) ? config.weekdays : []).map(Number).filter(day => day >= 0 && day <= 6))];
    if (!config.weekdays.length) throw Object.assign(new Error("每周循环至少选择一个星期"), {
      status: 400
    });
  }
  if (type === "interval") config.intervalDays = Math.max(1, Number(config.intervalDays || 1));
  if (type === "monthly_day") config.day = Math.max(1, Math.min(31, Number(config.day || 1)));
  if (["nth_workday", "nth_restday"].includes(type)) config.nth = Math.max(1, Math.min(23, Number(config.nth || 1)));
  config = normalizeRuleConfig(type, config);
  if (type === "custom_dates") {
    return {
      type,
      config,
      startDate: null,
      endType: "never",
      count: null,
      endDate: null,
      continuous: {
        enabled: false,
        days: 1
      }
    };
  }
  const startDate = String(body.recurrenceStartDate ?? current.recurrenceStartDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw Object.assign(new Error("请选择首次触发日期"), {
      status: 400
    });
  }
  const endType = String(body.recurrenceEndType ?? current.recurrenceEndType ?? "never");
  if (!["never", "count", "date"].includes(endType)) {
    throw Object.assign(new Error("循环停止方式不正确"), {
      status: 400
    });
  }
  const count = endType === "count" ? Math.max(1, Number(body.recurrenceCount ?? current.recurrenceCount ?? 1)) : null;
  const endDate = endType === "date" ? String(body.recurrenceEndDate ?? current.recurrenceEndDate ?? "").slice(0, 10) : null;
  if (endType === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw Object.assign(new Error("请选择循环停止日期"), {
      status: 400
    });
  }
  if (endDate && endDate < startDate) {
    throw Object.assign(new Error("循环停止日期不能早于开始日期"), {
      status: 400
    });
  }
  const continuous = normalizedContinuousInput({
    ruleType: type,
    ruleConfig: config,
    continuousEnabled: body.continuousEnabled ?? current.continuousEnabled,
    continuousDays: body.continuousDays ?? current.continuousDays
  });
  return {
    type,
    config,
    startDate,
    endType,
    count,
    endDate,
    continuous
  };
}
function needsFirstTriggerDate(generationMode, ruleType) {
  return generationMode === "schedule" && !["manual", "none", "custom_dates"].includes(ruleType);
}
function firstTriggerDateInput(value, required) {
  const date = String(value || "").slice(0, 10);
  if (required && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw Object.assign(new Error("请选择首次触发日期"), {
      status: 400
    });
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw Object.assign(new Error("首次触发日期格式不正确"), {
      status: 400
    });
  }
  return date || null;
}
function shouldGenerateRecurringEvent(event, date) {
  if (!event.generationEnabled || !event.recurrenceType) return false;
  if (event.recurrenceStartDate && date < event.recurrenceStartDate) return false;
  if (event.recurrenceEndType === "date" && event.recurrenceEndDate && date > event.recurrenceEndDate) return false;
  if (event.recurrenceEndType === "count" && event.recurrenceCount && event.recurrenceType === "interval") {
    const difference = daysBetween(event.recurrenceStartDate, date);
    const interval = Math.max(1, Number(event.recurrenceConfig?.intervalDays || 1));
    if (difference < 0 || Math.floor(difference / interval) >= Number(event.recurrenceCount)) return false;
  } else if (event.recurrenceEndType === "count" && event.recurrenceCount) {
    const generated = db.prepare("SELECT COUNT(*) FROM sop_executions WHERE event_id = ?").pluck().get(event.id);
    if (Number(generated) >= Number(event.recurrenceCount)) return false;
  }
  return shouldGenerate({
    ruleType: event.recurrenceType,
    ruleConfigJson: event.recurrenceConfigJson,
    startDate: event.recurrenceStartDate,
    continuousEnabled: event.continuousEnabled,
    continuousDays: event.continuousDays
  }, date);
}
function logRuntime({
  logType,
  level = "info",
  themeName = null,
  eventName = null,
  message,
  detail = {},
  occurredAt = nowIso()
}) {
  db.prepare(`
    INSERT INTO sop_runtime_logs (
      log_type, level, theme_name, event_name, message,
      detail_json, occurred_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(logType, level, themeName, eventName, message, JSON.stringify(detail), occurredAt, nowIso());
}
function writeExecutionEvent(executionId, eventType, detail = {}, source = "网页操作") {
  const occurredAt = nowIso();
  db.prepare(`
    INSERT INTO sop_execution_events (
      execution_id, event_type, source, detail_json, occurred_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(executionId, eventType, source, JSON.stringify(detail), occurredAt, occurredAt);
}
function themeRow(row) {
  return {
    ...row,
    isImportant: Boolean(row.isImportant),
    generationEnabled: Boolean(row.generationEnabled),
    continuousEnabled: Boolean(row.continuousEnabled),
    isSystem: row.themeType === RECURRING_EVENTS_THEME_TYPE,
    ruleConfig: asJson(row.ruleConfigJson, {})
  };
}
function eventRow(row) {
  return {
    ...row,
    mobileCapable: Boolean(row.mobileCapable),
    earlyCompletion: Boolean(row.earlyCompletion),
    generationEnabled: Boolean(row.generationEnabled),
    continuousEnabled: Boolean(row.continuousEnabled),
    recurrenceConfig: asJson(row.recurrenceConfigJson, {})
  };
}
function executionRow(row) {
  return {
    ...row,
    isImportant: Boolean(row.isImportant),
    mobileCapable: Boolean(row.mobileCapable),
    earlyCompletion: Boolean(row.earlyCompletion),
    batchCompleted: Boolean(row.batchCompleted),
    permanentDisabled: Boolean(row.permanentDisabled),
    isCarryover: Boolean(row.isImportant && row.status === "pending" && row.scheduledDate < localDate())
  };
}
function getTheme(id) {
  const row = db.prepare(`
    SELECT id, source_record_id AS sourceRecordId, name, color, category, priority,
      is_important AS isImportant, frequency_label AS frequencyLabel,
      rule_type AS ruleType, rule_config_json AS ruleConfigJson,
      interval_days AS intervalDays, delay_discard_hours AS delayDiscardHours,
      start_date AS startDate, next_run_date AS nextRunDate,
      create_state AS createState, status,
      generation_enabled AS generationEnabled, theme_type AS themeType,
      generation_mode AS generationMode, continuous_enabled AS continuousEnabled,
      continuous_days AS continuousDays, follow_source_event_id AS followSourceEventId,
      follow_delay_days AS followDelayDays, position,
      source_created_at AS sourceCreatedAt, source_updated_at AS sourceUpdatedAt,
      created_at AS createdAt, updated_at AS updatedAt
    FROM sop_themes WHERE id = ?
  `).get(Number(id));
  return row ? themeRow(row) : null;
}
function generateTheme(themeId, date = localDate(), source = "网页手动", {
  forceNewRun = false
} = {}) {
  const theme = getTheme(themeId);
  if (!theme || theme.status === "archived") return {
    error: "SOP 主题不存在",
    status: 404
  };
  if (theme.ruleType === "custom_dates" && !isManualCalendarDate(theme.ruleConfig?.calendarId, date)) {
    return {
      error: "该日期不在主题关联的 SOP 手动日期日历中",
      status: 400
    };
  }
  if (isRecurringEventsTheme(theme)) {
    return {
      error: "重复事件由每个事件自己的循环周期自动运行，不支持手动触发主题",
      status: 400
    };
  }
  const events = db.prepare(`
    SELECT id, title, note, category, special_label AS specialLabel,
      mobile_capable AS mobileCapable, early_completion AS earlyCompletion,
      generation_enabled AS generationEnabled, active_until AS activeUntil
    FROM sop_events
    WHERE theme_id = ? AND generation_enabled = 1
      AND generation_mode <> 'follow'
      AND (active_until IS NULL OR active_until >= ?)
    ORDER BY sort_order, id
  `).all(theme.id, date);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO sop_executions (
      theme_id, event_id, title, note, category, priority, is_important,
      mobile_capable, early_completion, special_label, scheduled_date, due_at,
      status, idempotency_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `);
  const created = [];
  const createdAt = nowIso();
  const runId = forceNewRun ? randomUUID() : null;
  const hasExecutionForDate = forceNewRun ? null : db.prepare(`
    SELECT 1 FROM sop_executions
    WHERE theme_id = ? AND event_id = ? AND scheduled_date = ?
    LIMIT 1
  `);
  db.transaction(() => {
    for (const event of events) {
      if (hasExecutionForDate?.get(theme.id, event.id, date)) continue;
      const result = insert.run(theme.id, event.id, event.title, event.note, event.category || theme.category, theme.priority, theme.isImportant ? 1 : 0, event.mobileCapable ? 1 : 0, event.earlyCompletion ? 1 : 0, event.specialLabel, date, date, forceNewRun ? `manual:${theme.id}:${date}:${runId}:${event.id}` : `generated:${theme.id}:${event.id}:${date}`, createdAt, createdAt);
      if (result.changes) {
        created.push(result.lastInsertRowid);
        writeExecutionEvent(result.lastInsertRowid, "created", {
          themeId: theme.id,
          date,
          runId
        }, source);
      }
    }
  })();
  const followed = generateFollowers(created, source);
  logRuntime({
    logType: "theme_generated",
    themeName: theme.name,
    message: `${theme.name} 已生成 ${created.length} 条执行事项`,
    detail: {
      themeId: theme.id,
      date,
      created: created.length,
      followed: followed.created,
      source,
      runId,
      forceNewRun
    }
  });
  return {
    theme,
    created: created.length,
    followed: followed.created,
    totalCreated: created.length + followed.created,
    ids: created,
    runId
  };
}
function generateFollowers(seedExecutionIds, source = "自动跟随产生") {
  const queue = [...seedExecutionIds.map(Number).filter(Boolean)];
  const createdIds = [];
  const visited = new Set();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO sop_executions (
      theme_id, event_id, title, note, category, priority, is_important,
      mobile_capable, early_completion, special_label, scheduled_date, due_at,
      status, idempotency_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `);
  while (queue.length) {
    const sourceExecutionId = queue.shift();
    if (visited.has(sourceExecutionId)) continue;
    visited.add(sourceExecutionId);
    if (visited.size > 10_000) throw new Error("跟随生成数量异常，请检查跟随关系");
    const sourceExecution = db.prepare(`
      SELECT id, event_id AS eventId, scheduled_date AS scheduledDate
      FROM sop_executions WHERE id = ?
    `).get(sourceExecutionId);
    if (!sourceExecution?.eventId) continue;
    const targets = [...db.prepare(`
        SELECT e.id, e.theme_id AS themeId, e.title, e.note, e.category,
          e.special_label AS specialLabel, e.mobile_capable AS mobileCapable,
          e.early_completion AS earlyCompletion, e.follow_delay_days AS followDelayDays,
          e.active_until AS activeUntil,
          t.category AS themeCategory, t.priority, t.is_important AS isImportant
        FROM sop_events e JOIN sop_themes t ON t.id = e.theme_id
        WHERE e.generation_mode = 'follow' AND e.follow_source_event_id = ?
          AND e.generation_enabled = 1 AND t.generation_enabled = 1 AND t.status = 'enabled'
      `).all(sourceExecution.eventId).map(row => ({
      ...row,
      keyType: "event"
    })), ...db.prepare(`
        SELECT e.id, e.theme_id AS themeId, e.title, e.note, e.category,
          e.special_label AS specialLabel, e.mobile_capable AS mobileCapable,
          e.early_completion AS earlyCompletion, t.follow_delay_days AS followDelayDays,
          e.active_until AS activeUntil,
          t.category AS themeCategory, t.priority, t.is_important AS isImportant
        FROM sop_themes t JOIN sop_events e ON e.theme_id = t.id
        WHERE t.generation_mode = 'follow' AND t.follow_source_event_id = ?
          AND t.generation_enabled = 1 AND t.status = 'enabled'
          AND e.generation_enabled = 1 AND e.generation_mode <> 'follow'
      `).all(sourceExecution.eventId).map(row => ({
      ...row,
      keyType: "theme"
    }))];
    for (const target of targets) {
      const scheduledDate = addDays(sourceExecution.scheduledDate, Number(target.followDelayDays || 0));
      if (target.activeUntil && target.activeUntil < scheduledDate) continue;
      const createdAt = nowIso();
      const result = insert.run(target.themeId, target.id, target.title, target.note, target.category || target.themeCategory, target.priority, target.isImportant ? 1 : 0, target.mobileCapable ? 1 : 0, target.earlyCompletion ? 1 : 0, target.specialLabel, scheduledDate, scheduledDate, `follow:${target.keyType}:${target.id}:${sourceExecutionId}`, createdAt, createdAt);
      if (!result.changes) continue;
      createdIds.push(result.lastInsertRowid);
      queue.push(Number(result.lastInsertRowid));
      writeExecutionEvent(result.lastInsertRowid, "created", {
        followedFromExecutionId: sourceExecutionId,
        followedFromEventId: sourceExecution.eventId,
        delayDays: Number(target.followDelayDays || 0)
      }, source);
    }
  }
  if (createdIds.length) {
    logRuntime({
      logType: "follow_generated",
      message: `跟随产生 ${createdIds.length} 条执行事项`,
      detail: {
        seedExecutionIds,
        createdIds,
        source
      }
    });
  }
  return {
    created: createdIds.length,
    ids: createdIds
  };
}
function generateRecurringEvents(date = localDate(), source = "定时调度") {
  const theme = db.prepare(`
    SELECT id, name, color, category, priority, is_important AS isImportant
    FROM sop_themes
    WHERE theme_type = 'recurring_events' AND status = 'enabled' AND generation_enabled = 1
    LIMIT 1
  `).get();
  if (!theme) return {
    themeId: null,
    eventsChecked: 0,
    executionsCreated: 0,
    ids: []
  };
  const events = db.prepare(`
    SELECT id, title, note, category, special_label AS specialLabel,
      mobile_capable AS mobileCapable, early_completion AS earlyCompletion,
      generation_enabled AS generationEnabled, recurrence_type AS recurrenceType,
      recurrence_config_json AS recurrenceConfigJson,
      recurrence_start_date AS recurrenceStartDate,
      recurrence_end_type AS recurrenceEndType, recurrence_count AS recurrenceCount,
      recurrence_end_date AS recurrenceEndDate,
      generation_mode AS generationMode, continuous_enabled AS continuousEnabled,
      continuous_days AS continuousDays
    FROM sop_events
    WHERE theme_id = ? AND generation_enabled = 1
      AND recurrence_type IS NOT NULL
    ORDER BY sort_order, id
  `).all(theme.id).map(eventRow);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO sop_executions (
      theme_id, event_id, title, note, category, priority, is_important,
      mobile_capable, early_completion, special_label, scheduled_date, due_at,
      status, idempotency_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `);
  const created = [];
  const createdAt = nowIso();
  db.transaction(() => {
    for (const event of events) {
      if (!shouldGenerateRecurringEvent(event, date)) continue;
      const result = insert.run(theme.id, event.id, event.title, event.note, event.category || theme.category, theme.priority, theme.isImportant ? 1 : 0, event.mobileCapable ? 1 : 0, event.earlyCompletion ? 1 : 0, event.specialLabel, date, date, `recurring-event:${event.id}:${date}`, createdAt, createdAt);
      if (result.changes) {
        created.push(result.lastInsertRowid);
        writeExecutionEvent(result.lastInsertRowid, "created", {
          eventId: event.id,
          date,
          recurrenceType: event.recurrenceType
        }, source);
      }
    }
  })();
  const followed = generateFollowers(created, source);
  logRuntime({
    logType: "recurring_events_generated",
    themeName: theme.name,
    message: `${date} 重复事件已生成 ${created.length} 条执行事项`,
    detail: {
      date,
      themeId: theme.id,
      eventsChecked: events.length,
      created: created.length,
      followed: followed.created,
      source
    }
  });
  return {
    themeId: theme.id,
    eventsChecked: events.length,
    executionsCreated: created.length,
    followed: followed.created,
    totalCreated: created.length + followed.created,
    ids: created
  };
}
function futureRuleLabel({
  ruleType,
  ruleConfig = {},
  frequencyLabel = "",
  continuousEnabled = false,
  continuousDays = 1
}) {
  const labels = {
    daily: "每日",
    workday: "每个工作日",
    restday: "每个休息日",
    weekly: "指定星期",
    monthly_day: "每月指定日期",
    monthly_last_day: "每月最后一天",
    first_workday: "每月首个工作日",
    nth_workday: "每月指定工作日",
    nth_restday: "每月指定休息日",
    last_workday: "每月最后一个工作日",
    last_restday: "每月最后一个休息日",
    day_before_workday: "次日为工作日",
    day_before_restday: "次日为休息日",
    day_after_workday: "前一日为工作日",
    day_after_rest: "前一日为休息日",
    interval: "间隔循环",
    custom_dates: "手动日期日历"
  };
  let label = frequencyLabel || labels[ruleType] || "自动规则";
  if (ruleType === "weekly" && Array.isArray(ruleConfig.weekdays)) {
    const weekdayLabels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    label = ruleConfig.weekdays.map(Number).sort((a, b) => a - b).map(day => weekdayLabels[day]).join("、") || label;
  }
  if (ruleType === "monthly_day") label = `每月 ${Number(ruleConfig.day || 1)} 日`;
  if (ruleType === "nth_workday") label = `每月第 ${Number(ruleConfig.nth || 1)} 个工作日`;
  if (ruleType === "nth_restday") label = `每月第 ${Number(ruleConfig.nth || 1)} 个休息日`;
  if (ruleType === "interval") label = `每 ${Math.max(1, Number(ruleConfig.intervalDays || 1))} 天`;
  if (continuousEnabled) label += `，连续 ${Math.max(1, Number(continuousDays || 1))} 天`;
  return label;
}
function recurringEventMatchesSchedule(event, date) {
  if (!event.generationEnabled || !event.recurrenceType) return false;
  if (event.recurrenceStartDate && date < event.recurrenceStartDate) return false;
  if (event.recurrenceEndType === "date" && event.recurrenceEndDate && date > event.recurrenceEndDate) return false;
  if (event.recurrenceEndType === "count" && event.recurrenceCount && event.recurrenceType === "interval") {
    const difference = daysBetween(event.recurrenceStartDate, date);
    const interval = Math.max(1, Number(event.recurrenceConfig?.intervalDays || 1));
    if (difference < 0 || Math.floor(difference / interval) >= Number(event.recurrenceCount)) return false;
  }
  return shouldGenerate({
    ruleType: event.recurrenceType,
    ruleConfigJson: event.recurrenceConfigJson,
    startDate: event.recurrenceStartDate,
    continuousEnabled: event.continuousEnabled,
    continuousDays: event.continuousDays
  }, date);
}
function previewSopFutureOccurrences({
  from = addDays(localDate(), 1),
  days = 45
} = {}) {
  const today = localDate();
  const safeDays = Math.max(1, Math.min(90, Number(days) || 45));
  const to = addDays(from, safeDays - 1);
  const themes = db.prepare(`
    SELECT t.id, t.name, t.color, t.category, t.priority,
      t.is_important AS isImportant, t.frequency_label AS frequencyLabel,
      t.rule_type AS ruleType, t.rule_config_json AS ruleConfigJson,
      t.interval_days AS intervalDays, t.start_date AS startDate,
      t.status, t.generation_enabled AS generationEnabled,
      t.theme_type AS themeType, t.generation_mode AS generationMode,
      t.continuous_enabled AS continuousEnabled, t.continuous_days AS continuousDays,
      t.follow_source_event_id AS followSourceEventId,
      t.follow_delay_days AS followDelayDays, t.position
    FROM sop_themes t
    WHERE t.status = 'enabled'
    ORDER BY CASE WHEN t.theme_type = 'recurring_events' THEN 0 ELSE 1 END, t.position, t.id
  `).all().map(themeRow);
  const events = db.prepare(`
    SELECT e.id, e.theme_id AS themeId, t.name AS themeName,
      e.title, e.note, e.sort_order AS sortOrder, e.category,
      e.special_label AS specialLabel, e.generation_enabled AS generationEnabled,
      e.active_until AS activeUntil, e.recurrence_type AS recurrenceType,
      e.recurrence_config_json AS recurrenceConfigJson,
      e.recurrence_start_date AS recurrenceStartDate,
      e.recurrence_end_type AS recurrenceEndType,
      e.recurrence_count AS recurrenceCount,
      e.recurrence_end_date AS recurrenceEndDate,
      e.generation_mode AS generationMode,
      e.continuous_enabled AS continuousEnabled,
      e.continuous_days AS continuousDays,
      e.follow_source_event_id AS followSourceEventId,
      e.follow_delay_days AS followDelayDays,
      t.position AS themePosition, t.theme_type AS themeType,
      t.generation_enabled AS themeGenerationEnabled,
      t.generation_mode AS themeGenerationMode
    FROM sop_events e
    JOIN sop_themes t ON t.id = e.theme_id
    WHERE t.status = 'enabled'
    ORDER BY t.position, e.sort_order, e.id
  `).all().map(row => ({
    ...eventRow(row),
    themeGenerationEnabled: Boolean(row.themeGenerationEnabled)
  }));
  const themesById = new Map(themes.map(theme => [Number(theme.id), theme]));
  const eventsById = new Map(events.map(event => [Number(event.id), event]));
  const eventsByTheme = new Map();
  for (const event of events) {
    const key = Number(event.themeId);
    if (!eventsByTheme.has(key)) eventsByTheme.set(key, []);
    eventsByTheme.get(key).push(event);
  }
  const existingRows = db.prepare(`
    SELECT x.id, x.theme_id AS themeId, x.event_id AS eventId,
      x.title, x.scheduled_date AS scheduledDate, x.status
    FROM sop_executions x
    WHERE x.scheduled_date BETWEEN ? AND ?
    ORDER BY x.scheduled_date, x.id
  `).all(from, to);
  const existingByEventDate = new Map();
  for (const row of existingRows) {
    const key = `${row.eventId}:${row.scheduledDate}`;
    if (!existingByEventDate.has(key)) existingByEventDate.set(key, []);
    existingByEventDate.get(key).push(row);
  }
  const existingCounts = new Map(db.prepare(`
    SELECT event_id AS eventId, COUNT(*) AS count
    FROM sop_executions WHERE event_id IS NOT NULL GROUP BY event_id
  `).all().map(row => [Number(row.eventId), Number(row.count)]));
  const forecastCountUsage = new Map();
  const occurrences = [];
  const occurrenceKeys = new Set();
  const queue = [];
  const existingState = (eventId, date) => {
    const rows = existingByEventDate.get(`${eventId}:${date}`) || [];
    return {
      alreadyGenerated: rows.length > 0,
      existingCount: rows.length,
      existingStatuses: [...new Set(rows.map(row => row.status))]
    };
  };
  const addThemeOccurrence = (theme, date, triggerSource, ruleLabel, chainKey, sourceEventTitle = null) => {
    const key = `theme:${theme.id}:${date}:${chainKey}`;
    if (occurrenceKeys.has(key)) return;
    occurrenceKeys.add(key);
    occurrences.push({
      key,
      kind: "theme",
      date,
      themeId: theme.id,
      themeName: theme.name,
      title: theme.name,
      priority: theme.priority,
      isImportant: theme.isImportant,
      themePosition: theme.position,
      triggerSource,
      ruleLabel,
      sourceEventTitle,
      generationEnabled: true,
      alreadyGenerated: false
    });
  };
  const addEventOccurrence = (event, date, triggerSource, ruleLabel, chainKey, sourceEventTitle = null) => {
    const key = `event:${event.id}:${date}:${chainKey}`;
    if (occurrenceKeys.has(key)) return null;
    occurrenceKeys.add(key);
    const state = existingState(event.id, date);
    const item = {
      key,
      kind: "event",
      date,
      themeId: event.themeId,
      themeName: event.themeName,
      eventId: event.id,
      title: event.title,
      category: event.category,
      specialLabel: event.specialLabel,
      priority: themesById.get(Number(event.themeId))?.priority || "P4",
      isImportant: Boolean(themesById.get(Number(event.themeId))?.isImportant),
      themePosition: event.themePosition ?? themesById.get(Number(event.themeId))?.position ?? 0,
      eventSortOrder: event.sortOrder,
      triggerSource,
      ruleLabel,
      sourceEventTitle,
      generationEnabled: true,
      ...state
    };
    occurrences.push(item);
    queue.push({
      ...item,
      chainKey: key
    });
    return item;
  };
  const dates = [];
  for (let offset = 0; offset < safeDays; offset += 1) dates.push(addDays(from, offset));
  const scheduledThemes = themes.filter(theme => theme.themeType !== RECURRING_EVENTS_THEME_TYPE && theme.generationEnabled && theme.generationMode === "schedule");
  const recurringTheme = themes.find(theme => theme.themeType === RECURRING_EVENTS_THEME_TYPE && theme.generationEnabled);
  const recurringEvents = recurringTheme ? (eventsByTheme.get(Number(recurringTheme.id)) || []).filter(event => event.generationEnabled && event.recurrenceType) : [];
  for (const date of dates) {
    for (const theme of scheduledThemes) {
      if (!shouldGenerate(theme, date)) continue;
      const ruleLabel = futureRuleLabel({
        ruleType: theme.ruleType,
        ruleConfig: theme.ruleConfig,
        frequencyLabel: theme.frequencyLabel,
        continuousEnabled: theme.continuousEnabled,
        continuousDays: theme.continuousDays
      });
      const chainKey = `schedule:${theme.id}:${date}`;
      addThemeOccurrence(theme, date, "schedule", ruleLabel, chainKey);
      for (const event of eventsByTheme.get(Number(theme.id)) || []) {
        if (!event.generationEnabled || event.generationMode === "follow") continue;
        if (event.activeUntil && event.activeUntil < date) continue;
        addEventOccurrence(event, date, "theme", `跟随主题 · ${ruleLabel}`, chainKey);
      }
    }
    for (const event of recurringEvents) {
      if (!recurringEventMatchesSchedule(event, date)) continue;
      const state = existingState(event.id, date);
      if (event.recurrenceEndType === "count" && event.recurrenceCount && event.recurrenceType !== "interval" && !state.alreadyGenerated) {
        const used = Number(existingCounts.get(Number(event.id)) || 0) + Number(forecastCountUsage.get(Number(event.id)) || 0);
        if (used >= Number(event.recurrenceCount)) continue;
        forecastCountUsage.set(Number(event.id), Number(forecastCountUsage.get(Number(event.id)) || 0) + 1);
      }
      const ruleLabel = futureRuleLabel({
        ruleType: event.recurrenceType,
        ruleConfig: event.recurrenceConfig,
        continuousEnabled: event.continuousEnabled,
        continuousDays: event.continuousDays
      });
      addEventOccurrence(event, date, "recurring", ruleLabel, `recurring:${event.id}:${date}`);
    }
  }
  const eventFollowers = new Map();
  for (const event of events.filter(item => item.generationEnabled && item.themeGenerationEnabled && item.generationMode === "follow" && item.followSourceEventId)) {
    const sourceId = Number(event.followSourceEventId);
    if (!eventFollowers.has(sourceId)) eventFollowers.set(sourceId, []);
    eventFollowers.get(sourceId).push({
      type: "event",
      event,
      delayDays: Number(event.followDelayDays || 0)
    });
  }
  for (const theme of themes.filter(item => item.generationEnabled && item.generationMode === "follow" && item.followSourceEventId)) {
    const sourceId = Number(theme.followSourceEventId);
    if (!eventFollowers.has(sourceId)) eventFollowers.set(sourceId, []);
    eventFollowers.get(sourceId).push({
      type: "theme",
      theme,
      delayDays: Number(theme.followDelayDays || 0)
    });
  }
  let queueIndex = 0;
  while (queueIndex < queue.length && queueIndex < 10_000) {
    const source = queue[queueIndex];
    queueIndex += 1;
    for (const target of eventFollowers.get(Number(source.eventId)) || []) {
      const date = addDays(source.date, target.delayDays);
      if (date < from || date > to) continue;
      const ruleLabel = `跟随“${source.title}” · 延迟 ${target.delayDays} 天`;
      const chainKey = `${source.chainKey}>${target.type}:${target.type === "event" ? target.event.id : target.theme.id}`;
      if (target.type === "event") {
        if (target.event.activeUntil && target.event.activeUntil < date) continue;
        addEventOccurrence(target.event, date, "follow", ruleLabel, chainKey, source.title);
        continue;
      }
      addThemeOccurrence(target.theme, date, "follow", ruleLabel, chainKey, source.title);
      for (const event of eventsByTheme.get(Number(target.theme.id)) || []) {
        if (!event.generationEnabled || event.generationMode === "follow") continue;
        if (event.activeUntil && event.activeUntil < date) continue;
        addEventOccurrence(event, date, "follow", ruleLabel, chainKey, source.title);
      }
    }
  }
  const representedEventDates = new Set(occurrences.filter(item => item.kind === "event").map(item => `${item.eventId}:${item.date}`));
  for (const row of existingRows) {
    const pairKey = `${row.eventId}:${row.scheduledDate}`;
    if (representedEventDates.has(pairKey) || !["pending", "deferred"].includes(row.status)) continue;
    const event = eventsById.get(Number(row.eventId));
    const theme = themesById.get(Number(row.themeId));
    occurrences.push({
      key: `existing:${row.id}`,
      kind: "event",
      date: row.scheduledDate,
      themeId: row.themeId,
      themeName: theme?.name || "历史主题",
      eventId: row.eventId,
      title: row.title,
      category: event?.category || null,
      specialLabel: event?.specialLabel || null,
      priority: theme?.priority || "P4",
      isImportant: Boolean(theme?.isImportant),
      themePosition: theme?.position ?? 9999,
      eventSortOrder: event?.sortOrder ?? row.id,
      triggerSource: "existing",
      ruleLabel: "已提前生成",
      sourceEventTitle: null,
      generationEnabled: Boolean(event?.generationEnabled),
      alreadyGenerated: true,
      existingCount: 1,
      existingStatuses: [row.status]
    });
  }
  occurrences.sort((left, right) => left.date.localeCompare(right.date) || Number(left.themePosition || 0) - Number(right.themePosition || 0) || (left.kind === right.kind ? 0 : left.kind === "theme" ? -1 : 1) || Number(left.eventSortOrder || 0) - Number(right.eventSortOrder || 0) || String(left.title).localeCompare(String(right.title), "zh-CN"));
  const groups = [];
  for (const occurrence of occurrences) {
    let group = groups.at(-1);
    if (!group || group.date !== occurrence.date) {
      group = {
        date: occurrence.date,
        daysFromToday: daysBetween(today, occurrence.date),
        weekday: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][dayOfWeek(occurrence.date)],
        items: []
      };
      groups.push(group);
    }
    group.items.push(occurrence);
  }
  const eventOccurrences = occurrences.filter(item => item.kind === "event");
  return {
    generatedAt: nowIso(),
    from,
    to,
    days: safeDays,
    summary: {
      activeDates: groups.length,
      themeOccurrences: occurrences.filter(item => item.kind === "theme").length,
      eventOccurrences: eventOccurrences.length,
      forecastedEvents: eventOccurrences.filter(item => !item.alreadyGenerated).length,
      alreadyGeneratedEvents: eventOccurrences.filter(item => item.alreadyGenerated).length,
      activeThemes: new Set(eventOccurrences.map(item => item.themeId)).size
    },
    groups
  };
}
export function runSopGeneration(date = localDate(), source = "定时调度") {
  const themes = db.prepare(`
    SELECT id, start_date AS startDate, next_run_date AS nextRunDate,
      rule_type AS ruleType, rule_config_json AS ruleConfigJson,
      interval_days AS intervalDays, continuous_enabled AS continuousEnabled,
      continuous_days AS continuousDays
    FROM sop_themes
    WHERE status = 'enabled' AND generation_enabled = 1
      AND theme_type <> 'recurring_events' AND generation_mode = 'schedule'
  `).all();
  let themesTriggered = 0;
  let executionsCreated = 0;
  for (const theme of themes) {
    if (!shouldGenerate(theme, date)) continue;
    const result = generateTheme(theme.id, date, source);
    themesTriggered += 1;
    executionsCreated += result.totalCreated || result.created || 0;
  }
  const recurring = generateRecurringEvents(date, source);
  executionsCreated += recurring.totalCreated || recurring.executionsCreated || 0;
  logRuntime({
    logType: "scheduler_generation",
    message: `${date} 定时生成完成：${themesTriggered} 个主题，${executionsCreated} 条事项`,
    detail: {
      date,
      themesTriggered,
      executionsCreated,
      recurring,
      source
    }
  });
  return {
    date,
    themesTriggered,
    executionsCreated,
    recurring
  };
}
export function runSopMaintenance(date = localDate(), source = "定时调度") {
  const rows = db.prepare(`
    SELECT e.id
    FROM sop_executions e
    LEFT JOIN sop_themes t ON t.id = e.theme_id
    WHERE e.status = 'pending' AND e.is_important = 1 AND e.scheduled_date < ?
  `).all(date);
  db.transaction(() => {
    db.prepare("UPDATE sop_themes SET create_state = '等待创建', updated_at = ? WHERE create_state <> '等待创建'").run(nowIso());
  })();
  logRuntime({
    logType: "scheduler_maintenance",
    message: `${date} 凌晨维护完成，保留 ${rows.length} 条未完成重要事项继续处理`,
    detail: {
      date,
      carriedOver: rows.length,
      discarded: 0,
      source
    }
  });
  return {
    date,
    carriedOver: rows.length,
    discarded: 0
  };
}
export function restoreAutomaticallyDiscardedImportant(date, source = "系统逻辑修复") {
  const rows = db.prepare(`
    SELECT DISTINCT e.id
    FROM sop_executions e
    JOIN sop_execution_events event ON event.execution_id = e.id
    WHERE e.scheduled_date = ?
      AND e.status = 'discarded'
      AND e.is_important = 1
      AND event.event_type = 'discarded'
      AND event.source = '定时调度'
      AND event.detail_json LIKE '%"automatic":true%'
    ORDER BY e.id
  `).all(date);
  const restoredAt = nowIso();
  db.transaction(() => {
    for (const row of rows) {
      db.prepare(`
        UPDATE sop_executions
        SET status = 'pending', discarded_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(restoredAt, row.id);
      writeExecutionEvent(row.id, "reopen", {
        automaticRepair: true,
        reason: "恢复被旧版维护逻辑错误废弃的重要事项",
        scheduledDate: date
      }, source);
    }
  })();
  logRuntime({
    logType: "important_carryover_restored",
    message: `${date} 已恢复 ${rows.length} 条被自动废弃的重要事项`,
    detail: {
      date,
      restored: rows.length,
      ids: rows.map(row => row.id),
      source
    }
  });
  return {
    date,
    restored: rows.length,
    ids: rows.map(row => row.id)
  };
}
function setting(key, fallback) {
  return db.prepare("SELECT value FROM sop_settings WHERE key = ?").pluck().get(key) ?? fallback;
}
function saveSetting(key, value) {
  db.prepare(`
    INSERT INTO sop_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, String(value), nowIso());
}
export function startSopScheduler() {
  if (String(process.env.SOP_SCHEDULER_DISABLED || "") === "1") {
    console.log("SOP scheduler disabled by environment");
    return {
      stop() {}
    };
  }
  let running = false;
  async function cycle() {
    if (running || setting("scheduler_enabled", "1") !== "1") return;
    running = true;
    try {
      const date = localDate();
      const time = beijingTime();
      if (time === setting("generation_time", "04:00") && setting("last_generation_date", "") !== date) {
        runSopGeneration(date);
        saveSetting("last_generation_date", date);
      }
      if (time === setting("maintenance_time", "00:05") && setting("last_maintenance_date", "") !== date) {
        runSopMaintenance(date);
        saveSetting("last_maintenance_date", date);
      }
      saveSetting("scheduler_last_seen_at", nowIso());
    } catch (error) {
      logRuntime({
        logType: "scheduler_error",
        level: "error",
        message: `SOP 调度失败：${error.message}`,
        detail: {
          stack: error.stack
        }
      });
      console.error(`sop scheduler failed: ${error.message}`);
    } finally {
      running = false;
    }
  }
  cycle();
  const timer = setInterval(cycle, 60_000);
  return {
    stop: () => clearInterval(timer),
    cycle
  };
}
function transitionExecution(id, action, body = {}, source = "网页操作") {
  const row = db.prepare(`
    SELECT e.*, t.name AS theme_name, ev.title AS event_title
    FROM sop_executions e
    LEFT JOIN sop_themes t ON t.id = e.theme_id
    LEFT JOIN sop_events ev ON ev.id = e.event_id
    WHERE e.id = ?
  `).get(Number(id));
  if (!row) return null;
  const occurredAt = nowIso();
  const updates = {
    complete: ["completed", occurredAt, null, null],
    reopen: ["pending", null, null, null],
    discard: ["discarded", null, occurredAt, null],
    defer: ["deferred", null, null, body.deferredUntil || addDays(localDate(), 1)]
  };
  if (action === "permanent-disable") {
    db.transaction(() => {
      db.prepare(`
        UPDATE sop_executions SET status = 'completed', completed_at = ?,
          permanent_disabled = 1, updated_at = ? WHERE id = ?
      `).run(occurredAt, occurredAt, row.id);
      if (row.event_id) {
        db.prepare("UPDATE sop_events SET generation_enabled = 0, updated_at = ? WHERE id = ?").run(occurredAt, row.event_id);
      }
      writeExecutionEvent(row.id, "permanent_disabled", {
        eventId: row.event_id
      }, source);
    })();
  } else {
    const values = updates[action];
    if (!values) return {
      error: "不支持的操作"
    };
    db.prepare(`
      UPDATE sop_executions SET status = ?, completed_at = ?, discarded_at = ?,
        deferred_until = ?, updated_at = ? WHERE id = ?
    `).run(...values, occurredAt, row.id);
    writeExecutionEvent(row.id, action, body, source);
  }
  logRuntime({
    logType: `execution_${action.replaceAll("-", "_")}`,
    themeName: row.theme_name,
    eventName: row.event_title || row.title,
    message: `${row.title} 状态已更新`,
    detail: {
      id: row.id,
      action,
      ...body
    }
  });
  return db.prepare("SELECT id, status, completed_at AS completedAt, discarded_at AS discardedAt, deferred_until AS deferredUntil, permanent_disabled AS permanentDisabled FROM sop_executions WHERE id = ?").get(row.id);
}
function safeLimit(value, maximum = 200) {
  return Math.max(1, Math.min(Number(value || SOP_PAGE_SIZE), maximum));
}
function respondNotFound(res, message) {
  return res.status(404).json({
    error: message
  });
}
export function registerSopRoutes(app) {
  app.get("/api/sop/meta", (_req, res) => {
    const settings = Object.fromEntries(db.prepare("SELECT key, value FROM sop_settings ORDER BY key").all().map(row => [row.key, row.value]));
    const counts = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM sop_themes WHERE status <> 'archived') AS themes,
        (SELECT COUNT(*) FROM sop_events) AS events,
        (SELECT COUNT(*) FROM sop_executions) AS executions,
        (SELECT COUNT(*) FROM sop_runtime_logs) AS logs,
        (SELECT COUNT(*) FROM sop_work_calendar) AS calendarDays
    `).get();
    const today = localDate();
    const todaySummary = db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'discarded' THEN 1 ELSE 0 END) AS discarded,
        SUM(CASE WHEN status = 'deferred' THEN 1 ELSE 0 END) AS deferred
      FROM sop_executions
      WHERE scheduled_date = ?
    `).get(today);
    const pendingSummary = db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN scheduled_date = ? THEN 1 ELSE 0 END) AS today,
        SUM(CASE WHEN scheduled_date < ? AND is_important = 1 THEN 1 ELSE 0 END) AS carryover,
        COUNT(DISTINCT theme_id) AS themes
      FROM sop_executions
      WHERE status = 'pending'
        AND (scheduled_date = ? OR (scheduled_date < ? AND is_important = 1))
    `).get(today, today, today, today);
    res.json({
      today,
      counts,
      todaySummary,
      pendingSummary,
      settings
    });
  });
  app.get("/api/sop/view-settings", (_req, res) => {
    res.json(getExecutionViewSettings());
  });
  app.patch("/api/sop/view-settings", (req, res) => {
    const current = getExecutionViewSettings();
    const next = normalizeExecutionViewSettings({
      visibleColumns: req.body?.visibleColumns ?? current.visibleColumns,
      columnOrder: req.body?.columnOrder ?? current.columnOrder,
      columnWidths: req.body?.columnWidths ?? current.columnWidths,
      group_by: req.body?.groupBy === "" ? "" : req.body?.groupBy === "theme" ? "theme" : current.groupBy
    });
    const updatedAt = nowIso();
    db.prepare(`
      INSERT INTO sop_view_settings (
        scope, visible_columns_json, column_order_json, column_widths_json, group_by, updated_at
      ) VALUES ('executions', ?, ?, ?, ?, ?)
      ON CONFLICT(scope) DO UPDATE SET
        visible_columns_json = excluded.visible_columns_json,
        column_order_json = excluded.column_order_json,
        column_widths_json = excluded.column_widths_json,
        group_by = excluded.group_by,
        updated_at = excluded.updated_at
    `).run(JSON.stringify(next.visibleColumns), JSON.stringify(next.columnOrder), JSON.stringify(next.columnWidths), next.groupBy, updatedAt);
    res.json({
      ...next,
      updatedAt
    });
  });
  app.get("/api/sop/future-occurrences", (req, res) => {
    const from = String(req.query.from || addDays(localDate(), 1)).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      return res.status(400).json({
        error: "开始日期格式不正确"
      });
    }
    const days = Math.max(1, Math.min(90, Number(req.query.days) || 45));
    res.json(previewSopFutureOccurrences({
      from,
      days
    }));
  });
  app.get("/api/sop/themes", (req, res) => {
    const values = [];
    const where = ["t.status <> 'archived'"];
    if (req.query.q) {
      values.push(`%${String(req.query.q).trim()}%`);
      where.push("(t.name LIKE ? OR t.category LIKE ?)");
      values.push(values[values.length - 1]);
    }
    if (req.query.status && req.query.status !== "all") {
      where.push("t.status = ?");
      values.push(String(req.query.status));
    }
    const rows = db.prepare(`
      SELECT t.id, t.source_record_id AS sourceRecordId, t.name, t.color, t.category,
        t.priority, t.is_important AS isImportant, t.frequency_label AS frequencyLabel,
        t.rule_type AS ruleType, t.rule_config_json AS ruleConfigJson,
        t.interval_days AS intervalDays, t.delay_discard_hours AS delayDiscardHours,
        t.start_date AS startDate, t.next_run_date AS nextRunDate,
        t.create_state AS createState, t.status,
        t.generation_enabled AS generationEnabled, t.theme_type AS themeType,
        t.generation_mode AS generationMode, t.continuous_enabled AS continuousEnabled,
        t.continuous_days AS continuousDays, t.follow_source_event_id AS followSourceEventId,
        t.follow_delay_days AS followDelayDays, t.position,
        t.updated_at AS updatedAt, COUNT(e.id) AS eventCount
      FROM sop_themes t LEFT JOIN sop_events e ON e.theme_id = t.id
      WHERE ${where.join(" AND ")}
      GROUP BY t.id
      ORDER BY CASE WHEN t.theme_type = 'recurring_events' THEN 0 ELSE 1 END, t.position, t.id
    `).all(...values).map(themeRow);
    res.json({
      data: rows,
      total: rows.length
    });
  });
  app.post("/api/sop/themes", (req, res) => {
    const rawName = String(req.body?.name || "").trim();
    if (!rawName) return res.status(400).json({
      error: "请输入 SOP 主题名称"
    });
    const name = numberedThemeName(rawName);
    const frequencyLabel = String(req.body?.frequencyLabel || "手动触发");
    const rule = mapFrequencyLabel(frequencyLabel, req.body?.intervalDays);
    const ruleType = req.body?.ruleType || rule.type;
    let ruleConfig = req.body?.ruleConfig || rule.config;
    let continuous;
    let follow;
    let startDate;
    try {
      ruleConfig = normalizeRuleConfig(ruleType, ruleConfig);
      continuous = normalizedContinuousInput({
        ruleType,
        ruleConfig,
        intervalDays: req.body?.intervalDays,
        continuousEnabled: req.body?.continuousEnabled,
        continuousDays: req.body?.continuousDays
      });
      follow = normalizedFollowInput(req.body || {}, "schedule");
      startDate = ruleType === "custom_dates" ? null : firstTriggerDateInput(req.body?.startDate, needsFirstTriggerDate(follow.mode, ruleType));
    } catch (error) {
      return res.status(error.status || 400).json({
        error: error.message
      });
    }
    const createdAt = nowIso();
    const result = db.prepare(`
      INSERT INTO sop_themes (
        name, color, category, priority, is_important, frequency_label,
        rule_type, rule_config_json, interval_days, delay_discard_hours,
        start_date, status, generation_enabled, theme_type, generation_mode,
        continuous_enabled, continuous_days, follow_source_event_id, follow_delay_days,
        position, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'standard', ?, ?, ?, ?, ?,
        COALESCE((SELECT MAX(position) + 1 FROM sop_themes), 0), ?, ?)
    `).run(name, req.body?.color || themeColors[Number(db.prepare("SELECT COUNT(*) FROM sop_themes").pluck().get()) % themeColors.length], req.body?.category || null, req.body?.priority || "P4", toBoolean(req.body?.isImportant) ? 1 : 0, follow.mode === "follow" ? "跟随事件产生" : frequencyLabel, ruleType, JSON.stringify(ruleConfig), req.body?.intervalDays || null, req.body?.delayDiscardHours ?? null, startDate, req.body?.status || "enabled", req.body?.generationEnabled === false ? 0 : 1, follow.mode, continuous.enabled ? 1 : 0, continuous.days, follow.sourceEventId, follow.delayDays, createdAt, createdAt);
    logRuntime({
      logType: "theme_created",
      themeName: name,
      message: `新建 SOP 主题：${name}`,
      detail: {
        id: result.lastInsertRowid
      }
    });
    res.status(201).json(getTheme(result.lastInsertRowid));
  });
  app.put("/api/sop/themes/reorder", (req, res) => {
    const ids = Array.isArray(req.body?.themeIds) ? req.body.themeIds.map(Number).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({
      error: "请提交主题顺序"
    });
    const updatedAt = nowIso();
    const recurringId = db.prepare("SELECT id FROM sop_themes WHERE theme_type = 'recurring_events' LIMIT 1").pluck().get();
    const standardIds = ids.filter(id => id !== recurringId);
    const update = db.prepare("UPDATE sop_themes SET position = ?, updated_at = ? WHERE id = ? AND theme_type <> 'recurring_events'");
    db.transaction(() => {
      if (recurringId) db.prepare("UPDATE sop_themes SET position = -1, updated_at = ? WHERE id = ?").run(updatedAt, recurringId);
      standardIds.forEach((id, index) => update.run(index, updatedAt, id));
    })();
    logRuntime({
      logType: "theme_reordered",
      message: `调整 ${ids.length} 个 SOP 主题顺序`,
      detail: {
        ids
      }
    });
    res.json({
      ok: true,
      updated: ids.length
    });
  });
  app.patch("/api/sop/themes/:id", (req, res) => {
    const current = getTheme(req.params.id);
    if (!current) return respondNotFound(res, "SOP 主题不存在");
    const map = {
      name: "name",
      color: "color",
      category: "category",
      priority: "priority",
      isImportant: "is_important",
      frequencyLabel: "frequency_label",
      ruleType: "rule_type",
      ruleConfig: "rule_config_json",
      intervalDays: "interval_days",
      delayDiscardHours: "delay_discard_hours",
      startDate: "start_date",
      nextRunDate: "next_run_date",
      createState: "create_state",
      status: "status",
      generationEnabled: "generation_enabled",
      position: "position",
      generationMode: "generation_mode",
      continuousEnabled: "continuous_enabled",
      continuousDays: "continuous_days",
      followSourceEventId: "follow_source_event_id",
      followDelayDays: "follow_delay_days"
    };
    const body = {
      ...(req.body || {})
    };
    if (isRecurringEventsTheme(current)) {
      for (const key of ["name", "frequencyLabel", "ruleType", "ruleConfig", "intervalDays", "startDate", "nextRunDate", "status", "generationEnabled", "position"]) {
        delete body[key];
      }
    }
    if (body.name !== undefined) {
      const base = String(body.name || "").trim().replace(/^\d{2,3}-/, "");
      const prefix = current.name.match(/^(\d{2,3})-/)?.[1];
      body.name = prefix ? `${prefix}-${base}` : numberedThemeName(base, current.id);
    }
    if (body.frequencyLabel && !body.ruleType) {
      const rule = mapFrequencyLabel(body.frequencyLabel, body.intervalDays ?? current.intervalDays);
      body.ruleType = rule.type;
      body.ruleConfig = rule.config;
    }
    if (!isRecurringEventsTheme(current)) {
      const ruleType = body.ruleType ?? current.ruleType;
      let ruleConfig = body.ruleConfig ?? current.ruleConfig;
      try {
        ruleConfig = normalizeRuleConfig(ruleType, ruleConfig);
        const follow = normalizedFollowInput({
          generationMode: body.generationMode ?? current.generationMode,
          followSourceEventId: body.followSourceEventId ?? current.followSourceEventId,
          followDelayDays: body.followDelayDays ?? current.followDelayDays
        }, "schedule");
        const continuous = normalizedContinuousInput({
          ruleType,
          ruleConfig,
          intervalDays: body.intervalDays ?? current.intervalDays,
          continuousEnabled: follow.mode === "follow" ? false : body.continuousEnabled ?? current.continuousEnabled,
          continuousDays: body.continuousDays ?? current.continuousDays
        });
        const startDate = ruleType === "custom_dates" ? null : firstTriggerDateInput(body.startDate ?? current.startDate, needsFirstTriggerDate(follow.mode, ruleType));
        Object.assign(body, {
          ruleConfig,
          generationMode: follow.mode,
          followSourceEventId: follow.sourceEventId,
          followDelayDays: follow.delayDays,
          continuousEnabled: continuous.enabled,
          continuousDays: continuous.days,
          startDate,
          frequencyLabel: follow.mode === "follow" ? "跟随事件产生" : body.frequencyLabel ?? (current.generationMode === "follow" ? "自定义触发" : current.frequencyLabel)
        });
        if (follow.mode === "follow") {
          assertNoFollowCycle({
            targetType: "theme",
            targetId: current.id,
            sourceEventId: follow.sourceEventId
          });
        }
      } catch (error) {
        return res.status(error.status || 400).json({
          error: error.message
        });
      }
    }
    const entries = Object.entries(body).filter(([key]) => map[key]);
    if (!entries.length) return res.status(400).json({
      error: "没有需要保存的内容"
    });
    const values = entries.map(([key, value]) => {
      if (["isImportant", "generationEnabled", "continuousEnabled"].includes(key)) return toBoolean(value) ? 1 : 0;
      if (key === "ruleConfig") return JSON.stringify(value || {});
      return value === "" ? null : value;
    });
    values.push(nowIso(), Number(req.params.id));
    db.prepare(`UPDATE sop_themes SET ${entries.map(([key]) => `${map[key]} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...values);
    logRuntime({
      logType: "theme_updated",
      themeName: current.name,
      message: `更新 SOP 主题：${current.name}`,
      detail: body
    });
    res.json(getTheme(req.params.id));
  });
  app.delete("/api/sop/themes/:id", (req, res) => {
    const current = getTheme(req.params.id);
    if (!current) return respondNotFound(res, "SOP 主题不存在");
    if (isRecurringEventsTheme(current)) return res.status(400).json({
      error: "重复事件是系统主题，不能归档"
    });
    db.prepare("UPDATE sop_themes SET status = 'archived', generation_enabled = 0, updated_at = ? WHERE id = ?").run(nowIso(), current.id);
    logRuntime({
      logType: "theme_archived",
      themeName: current.name,
      message: `归档 SOP 主题：${current.name}`
    });
    res.status(204).end();
  });
  app.post("/api/sop/themes/:id/trigger", (req, res) => {
    const result = generateTheme(Number(req.params.id), req.body?.date || localDate(), "网页手动触发", {
      forceNewRun: true
    });
    if (result.error) return res.status(result.status || 400).json({
      error: result.error
    });
    res.json(result);
  });
  app.post("/api/sop/themes/:id/clone", (req, res) => {
    const current = getTheme(req.params.id);
    if (!current) return respondNotFound(res, "SOP 主题不存在");
    if (isRecurringEventsTheme(current)) return res.status(400).json({
      error: "重复事件是系统主题，不能复制"
    });
    const createdAt = nowIso();
    const inserted = db.prepare(`
      INSERT INTO sop_themes (
        name, color, category, priority, is_important, frequency_label, rule_type,
        rule_config_json, interval_days, delay_discard_hours, start_date, status,
        generation_enabled, theme_type, generation_mode, continuous_enabled,
        continuous_days, follow_source_event_id, follow_delay_days,
        position, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'disabled', 0, 'standard', ?, ?, ?, ?, ?,
        COALESCE((SELECT MAX(position) + 1 FROM sop_themes), 0), ?, ?)
    `).run(numberedThemeName(`${current.name.replace(/^\d{2,3}-/, "")}（副本）`), current.color, current.category, current.priority, current.isImportant ? 1 : 0, current.frequencyLabel, current.ruleType, JSON.stringify(current.ruleConfig), current.intervalDays, current.delayDiscardHours, current.startDate, current.generationMode, current.continuousEnabled ? 1 : 0, current.continuousDays, current.followSourceEventId, current.followDelayDays, createdAt, createdAt);
    db.prepare(`
      INSERT INTO sop_events (
        theme_id, title, note, sort_order, category, special_label, mobile_capable,
        early_completion, generation_enabled, active_until, recurrence_type,
        recurrence_config_json, recurrence_start_date, recurrence_end_type,
        recurrence_count, recurrence_end_date, generation_mode, continuous_enabled,
        continuous_days, follow_source_event_id, follow_delay_days, created_at, updated_at
      ) SELECT ?, title, note, sort_order, category, special_label, mobile_capable,
        early_completion, generation_enabled, active_until, recurrence_type,
        recurrence_config_json, recurrence_start_date, recurrence_end_type,
        recurrence_count, recurrence_end_date, generation_mode, continuous_enabled,
        continuous_days, follow_source_event_id, follow_delay_days, ?, ?
      FROM sop_events WHERE theme_id = ?
    `).run(inserted.lastInsertRowid, createdAt, createdAt, current.id);
    res.status(201).json(getTheme(inserted.lastInsertRowid));
  });
  app.get("/api/sop/events", (req, res) => {
    const values = [];
    const where = ["1 = 1"];
    if (req.query.themeId) {
      where.push("e.theme_id = ?");
      values.push(Number(req.query.themeId));
    }
    if (req.query.q) {
      const value = `%${String(req.query.q).trim()}%`;
      where.push("(e.title LIKE ? OR e.note LIKE ? OR e.special_label LIKE ?)");
      values.push(value, value, value);
    }
    const limit = safeLimit(req.query.limit, 5000);
    const offset = Math.max(0, Number(req.query.offset || 0));
    const total = db.prepare(`SELECT COUNT(*) FROM sop_events e WHERE ${where.join(" AND ")}`).pluck().get(...values);
    const rows = db.prepare(`
      SELECT e.id, e.theme_id AS themeId, t.name AS themeName, t.color AS themeColor,
        e.source_record_id AS sourceRecordId, e.source_unique_number AS sourceUniqueNumber,
        e.title, e.note, e.sort_order AS sortOrder, e.category,
        e.special_label AS specialLabel, e.mobile_capable AS mobileCapable,
        e.early_completion AS earlyCompletion, e.generation_enabled AS generationEnabled,
        e.active_until AS activeUntil, e.recurrence_type AS recurrenceType,
        e.recurrence_config_json AS recurrenceConfigJson,
        e.recurrence_start_date AS recurrenceStartDate,
        e.recurrence_end_type AS recurrenceEndType,
        e.recurrence_count AS recurrenceCount,
        e.recurrence_end_date AS recurrenceEndDate,
        e.generation_mode AS generationMode, e.continuous_enabled AS continuousEnabled,
        e.continuous_days AS continuousDays, e.follow_source_event_id AS followSourceEventId,
        e.follow_delay_days AS followDelayDays, e.updated_at AS updatedAt
      FROM sop_events e JOIN sop_themes t ON t.id = e.theme_id
      WHERE ${where.join(" AND ")}
      ORDER BY CASE WHEN t.theme_type = 'recurring_events' THEN 0 ELSE 1 END, t.position, e.sort_order, e.id
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset).map(eventRow);
    res.json({
      data: rows,
      total,
      limit,
      offset
    });
  });
  app.get("/api/sop/events/:id", (req, res) => {
    const row = db.prepare(`
      SELECT e.id, e.theme_id AS themeId, t.name AS themeName, t.color AS themeColor,
        e.title, e.note, e.sort_order AS sortOrder, e.category,
        e.special_label AS specialLabel, e.mobile_capable AS mobileCapable,
        e.early_completion AS earlyCompletion, e.generation_enabled AS generationEnabled,
        e.active_until AS activeUntil, e.recurrence_type AS recurrenceType,
        e.recurrence_config_json AS recurrenceConfigJson,
        e.recurrence_start_date AS recurrenceStartDate,
        e.recurrence_end_type AS recurrenceEndType,
        e.recurrence_count AS recurrenceCount,
        e.recurrence_end_date AS recurrenceEndDate,
        e.generation_mode AS generationMode, e.continuous_enabled AS continuousEnabled,
        e.continuous_days AS continuousDays, e.follow_source_event_id AS followSourceEventId,
        e.follow_delay_days AS followDelayDays, e.updated_at AS updatedAt
      FROM sop_events e JOIN sop_themes t ON t.id = e.theme_id WHERE e.id = ?
    `).get(Number(req.params.id));
    if (!row) return respondNotFound(res, "SOP 事件不存在");
    res.json(eventRow(row));
  });
  app.put("/api/sop/events/reorder", (req, res) => {
    const themeId = Number(req.body?.themeId);
    const ids = Array.isArray(req.body?.eventIds) ? req.body.eventIds.map(Number).filter(Boolean) : [];
    if (!themeId || !ids.length) return res.status(400).json({
      error: "请提交主题和事件顺序"
    });
    const allowed = new Set(db.prepare("SELECT id FROM sop_events WHERE theme_id = ?").all(themeId).map(row => row.id));
    if (ids.some(id => !allowed.has(id))) return res.status(400).json({
      error: "事件不属于当前主题"
    });
    const updatedAt = nowIso();
    const update = db.prepare("UPDATE sop_events SET sort_order = ?, updated_at = ? WHERE id = ? AND theme_id = ?");
    db.transaction(() => ids.forEach((id, index) => update.run(index + 1, updatedAt, id, themeId)))();
    logRuntime({
      logType: "event_reordered",
      message: `调整 ${ids.length} 个 SOP 事件顺序`,
      detail: {
        themeId,
        ids
      }
    });
    res.json({
      ok: true,
      updated: ids.length
    });
  });
  app.post("/api/sop/events", (req, res) => {
    const themeId = Number(req.body?.themeId);
    const title = String(req.body?.title || "").trim();
    const theme = getTheme(themeId);
    if (!theme) return res.status(400).json({
      error: "请选择有效的 SOP 主题"
    });
    if (!title) return res.status(400).json({
      error: "请输入事件内容"
    });
    let recurrence = null;
    let follow = {
      mode: isRecurringEventsTheme(theme) ? "independent" : "inherit",
      sourceEventId: null,
      delayDays: 0
    };
    if (isRecurringEventsTheme(theme)) {
      try {
        recurrence = recurrenceInput(req.body);
      } catch (error) {
        return res.status(error.status || 400).json({
          error: error.message
        });
      }
    } else {
      try {
        follow = normalizedFollowInput(req.body || {}, "inherit");
      } catch (error) {
        return res.status(error.status || 400).json({
          error: error.message
        });
      }
    }
    const createdAt = nowIso();
    const result = db.prepare(`
      INSERT INTO sop_events (
        theme_id, source_unique_number, title, note, sort_order, category,
        special_label, mobile_capable, early_completion, generation_enabled,
        active_until, recurrence_type, recurrence_config_json, recurrence_start_date,
        recurrence_end_type, recurrence_count, recurrence_end_date, generation_mode,
        continuous_enabled, continuous_days, follow_source_event_id, follow_delay_days,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM sop_events WHERE theme_id = ?), 1), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(themeId, `web-${crypto.randomUUID()}`, title, req.body?.note || null, themeId, req.body?.category || null, req.body?.specialLabel || null, toBoolean(req.body?.mobileCapable) ? 1 : 0, toBoolean(req.body?.earlyCompletion) ? 1 : 0, req.body?.generationEnabled === false ? 0 : 1, isRecurringEventsTheme(theme) ? null : req.body?.activeUntil || null, recurrence?.type || null, JSON.stringify(recurrence?.config || {}), recurrence?.startDate || null, recurrence?.endType || "never", recurrence?.count || null, recurrence?.endDate || null, follow.mode, recurrence?.continuous.enabled ? 1 : 0, recurrence?.continuous.days || 1, follow.sourceEventId, follow.delayDays, createdAt, createdAt);
    logRuntime({
      logType: "event_created",
      eventName: title,
      message: `新建 SOP 事件：${title}`,
      detail: {
        id: result.lastInsertRowid,
        themeId
      }
    });
    res.status(201).json({
      id: result.lastInsertRowid
    });
  });
  app.patch("/api/sop/events/:id", (req, res) => {
    const current = db.prepare(`
      SELECT e.*, t.theme_type AS themeType
      FROM sop_events e JOIN sop_themes t ON t.id = e.theme_id
      WHERE e.id = ?
    `).get(Number(req.params.id));
    if (!current) return respondNotFound(res, "SOP 事件不存在");
    const targetTheme = getTheme(req.body?.themeId ?? current.theme_id);
    if (!targetTheme) return res.status(400).json({
      error: "请选择有效的 SOP 主题"
    });
    if (targetTheme.generationMode === "follow" && Number(targetTheme.followSourceEventId) === Number(current.id)) {
      return res.status(400).json({
        error: "跟随来源事件不能放入由它触发的主题，否则会形成循环"
      });
    }
    let recurrence = null;
    if (isRecurringEventsTheme(targetTheme)) {
      try {
        recurrence = recurrenceInput(req.body, eventRow({
          recurrenceType: current.recurrence_type,
          recurrenceConfigJson: current.recurrence_config_json,
          recurrenceStartDate: current.recurrence_start_date,
          recurrenceEndType: current.recurrence_end_type,
          recurrenceCount: current.recurrence_count,
          recurrenceEndDate: current.recurrence_end_date,
          continuousEnabled: current.continuous_enabled,
          continuousDays: current.continuous_days
        }));
      } catch (error) {
        return res.status(error.status || 400).json({
          error: error.message
        });
      }
    } else {
      try {
        const follow = normalizedFollowInput({
          generationMode: req.body?.generationMode ?? current.generation_mode ?? "inherit",
          followSourceEventId: req.body?.followSourceEventId ?? current.follow_source_event_id,
          followDelayDays: req.body?.followDelayDays ?? current.follow_delay_days
        }, "inherit");
        if (follow.mode === "follow") {
          assertNoFollowCycle({
            targetType: "event",
            targetId: current.id,
            targetThemeId: targetTheme.id,
            sourceEventId: follow.sourceEventId
          });
        }
        req.body.generationMode = follow.mode;
        req.body.followSourceEventId = follow.sourceEventId;
        req.body.followDelayDays = follow.delayDays;
      } catch (error) {
        return res.status(error.status || 400).json({
          error: error.message
        });
      }
    }
    const map = {
      themeId: "theme_id",
      title: "title",
      note: "note",
      sortOrder: "sort_order",
      category: "category",
      specialLabel: "special_label",
      mobileCapable: "mobile_capable",
      earlyCompletion: "early_completion",
      generationEnabled: "generation_enabled",
      activeUntil: "active_until",
      recurrenceType: "recurrence_type",
      recurrenceConfig: "recurrence_config_json",
      recurrenceStartDate: "recurrence_start_date",
      recurrenceEndType: "recurrence_end_type",
      recurrenceCount: "recurrence_count",
      recurrenceEndDate: "recurrence_end_date",
      generationMode: "generation_mode",
      continuousEnabled: "continuous_enabled",
      continuousDays: "continuous_days",
      followSourceEventId: "follow_source_event_id",
      followDelayDays: "follow_delay_days"
    };
    const body = {
      ...(req.body || {})
    };
    if (isRecurringEventsTheme(targetTheme)) {
      Object.assign(body, {
        activeUntil: null,
        recurrenceType: recurrence.type,
        recurrenceConfig: recurrence.config,
        recurrenceStartDate: recurrence.startDate,
        recurrenceEndType: recurrence.endType,
        recurrenceCount: recurrence.count,
        recurrenceEndDate: recurrence.endDate,
        generationMode: "independent",
        continuousEnabled: recurrence.continuous.enabled,
        continuousDays: recurrence.continuous.days,
        followSourceEventId: null,
        followDelayDays: 0
      });
    } else if (current.themeType === RECURRING_EVENTS_THEME_TYPE) {
      Object.assign(body, {
        recurrenceType: null,
        recurrenceConfig: {},
        recurrenceStartDate: null,
        recurrenceEndType: "never",
        recurrenceCount: null,
        recurrenceEndDate: null,
        continuousEnabled: false,
        continuousDays: 1
      });
    }
    const entries = Object.entries(body).filter(([key]) => map[key]);
    if (!entries.length) return res.status(400).json({
      error: "没有需要保存的内容"
    });
    const values = entries.map(([key, value]) => {
      if (["mobileCapable", "earlyCompletion", "generationEnabled", "continuousEnabled"].includes(key)) return toBoolean(value) ? 1 : 0;
      if (key === "recurrenceConfig") return JSON.stringify(value || {});
      return value === "" ? null : value;
    });
    values.push(nowIso(), current.id);
    db.prepare(`UPDATE sop_events SET ${entries.map(([key]) => `${map[key]} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...values);
    logRuntime({
      logType: "event_updated",
      eventName: current.title,
      message: `更新 SOP 事件：${current.title}`,
      detail: body
    });
    res.json({
      ok: true
    });
  });
  app.delete("/api/sop/events/:id", (req, res) => {
    const current = db.prepare("SELECT id, title FROM sop_events WHERE id = ?").get(Number(req.params.id));
    if (!current) return respondNotFound(res, "SOP 事件不存在");
    const linked = db.prepare("SELECT COUNT(*) FROM sop_executions WHERE event_id = ?").pluck().get(current.id);
    if (linked) {
      db.prepare("UPDATE sop_events SET generation_enabled = 0, updated_at = ? WHERE id = ?").run(nowIso(), current.id);
      return res.status(409).json({
        error: `该事件已有 ${linked} 条历史执行记录，已改为停用，不能物理删除`
      });
    }
    db.prepare("DELETE FROM sop_events WHERE id = ?").run(current.id);
    res.status(204).end();
  });
  app.get("/api/sop/executions", (req, res) => {
    const values = [];
    const where = ["1 = 1"];
    if (req.query.scope === "pending") {
      const today = localDate();
      where.push("e.status = 'pending'");
      where.push("(e.scheduled_date = ? OR (e.scheduled_date < ? AND e.is_important = 1))");
      values.push(today, today);
    } else if (req.query.date) {
      const date = String(req.query.date);
      if (req.query.carryover === "true") {
        where.push("(e.scheduled_date = ? OR (e.scheduled_date < ? AND e.is_important = 1 AND e.status = 'pending'))");
        values.push(date, date);
      } else {
        where.push("e.scheduled_date = ?");
        values.push(date);
      }
    }
    if (req.query.dateFrom) {
      where.push("e.scheduled_date >= ?");
      values.push(String(req.query.dateFrom));
    }
    if (req.query.dateTo) {
      where.push("e.scheduled_date <= ?");
      values.push(String(req.query.dateTo));
    }
    if (req.query.themeId) {
      where.push("e.theme_id = ?");
      values.push(Number(req.query.themeId));
    }
    if (req.query.scope !== "pending" && req.query.status && req.query.status !== "all") {
      where.push("e.status = ?");
      values.push(String(req.query.status));
    }
    if (req.query.important === "true") where.push("e.is_important = 1");
    if (req.query.mobile === "true") where.push("e.mobile_capable = 1");
    if (req.query.early === "true") where.push("e.early_completion = 1");
    if (req.query.priority) {
      where.push("e.priority = ?");
      values.push(String(req.query.priority));
    }
    if (req.query.category) {
      where.push("e.category = ?");
      values.push(String(req.query.category));
    }
    if (req.query.specialLabel) {
      where.push("e.special_label = ?");
      values.push(String(req.query.specialLabel));
    }
    if (req.query.q) {
      const value = `%${String(req.query.q).trim()}%`;
      where.push("(e.title LIKE ? OR e.note LIKE ? OR t.name LIKE ?)");
      values.push(value, value, value);
    }
    const limit = safeLimit(req.query.limit);
    const offset = Math.max(0, Number(req.query.offset || 0));
    const executionSorts = {
      theme: "CASE WHEN t.theme_type = 'recurring_events' THEN 0 ELSE 1 END, COALESCE(t.position, 9999), COALESCE(source_event.sort_order, 999999999), e.id",
      event: "CASE WHEN t.theme_type = 'recurring_events' THEN 0 ELSE 1 END, e.title COLLATE NOCASE, e.id",
      priority: "CASE WHEN t.theme_type = 'recurring_events' THEN 0 ELSE 1 END, e.priority, COALESCE(t.position, 9999), COALESCE(source_event.sort_order, 999999999)",
      dateAsc: "CASE WHEN t.theme_type = 'recurring_events' THEN 0 ELSE 1 END, e.scheduled_date ASC, COALESCE(t.position, 9999), COALESCE(source_event.sort_order, 999999999)",
      dateDesc: "CASE WHEN t.theme_type = 'recurring_events' THEN 0 ELSE 1 END, e.scheduled_date DESC, COALESCE(t.position, 9999), COALESCE(source_event.sort_order, 999999999)",
      status: "CASE WHEN t.theme_type = 'recurring_events' THEN 0 ELSE 1 END, e.status, COALESCE(t.position, 9999), COALESCE(source_event.sort_order, 999999999)"
    };
    const columnOrder = executionColumnOrder(req.query.sort);
    const groupOrder = req.query.groupBy === "theme" && !String(req.query.sort).startsWith("theme:") ? "CASE WHEN t.theme_type = 'recurring_events' THEN 0 ELSE 1 END, COALESCE(t.position, 9999), e.theme_id, " : "";
    const orderBy = columnOrder ? `${groupOrder}${columnOrder}, e.id` : req.query.groupBy === "theme" ? executionSorts.theme : executionSorts[String(req.query.sort || "dateDesc")] || executionSorts.dateDesc;
    const total = db.prepare(`
      SELECT COUNT(*) FROM sop_executions e LEFT JOIN sop_themes t ON t.id = e.theme_id
      WHERE ${where.join(" AND ")}
    `).pluck().get(...values);
    const data = db.prepare(`
      SELECT e.id, e.source_record_id AS sourceRecordId, e.source_log_number AS sourceLogNumber,
        e.theme_id AS themeId, t.name AS themeName, t.color AS themeColor,
        e.event_id AS eventId, source_event.sort_order AS sortOrder,
        e.title, e.note, e.category, e.priority,
        e.is_important AS isImportant, e.mobile_capable AS mobileCapable,
        e.early_completion AS earlyCompletion, e.special_label AS specialLabel,
        e.scheduled_date AS scheduledDate, e.due_at AS dueAt,
        e.deferred_until AS deferredUntil, e.status, e.completed_at AS completedAt,
        e.discarded_at AS discardedAt, e.batch_completed AS batchCompleted,
        e.permanent_disabled AS permanentDisabled, e.created_at AS createdAt,
        e.updated_at AS updatedAt
      FROM sop_executions e
      LEFT JOIN sop_themes t ON t.id = e.theme_id
      LEFT JOIN sop_events source_event ON source_event.id = e.event_id
      WHERE ${where.join(" AND ")}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset).map(executionRow);
    res.json({
      data,
      total,
      limit,
      offset
    });
  });
  app.get("/api/sop/executions/:id", (req, res) => {
    const row = db.prepare(`
      SELECT e.*, t.name AS themeName, t.color AS themeColor
      FROM sop_executions e LEFT JOIN sop_themes t ON t.id = e.theme_id WHERE e.id = ?
    `).get(Number(req.params.id));
    if (!row) return respondNotFound(res, "SOP 执行事项不存在");
    const events = db.prepare(`
      SELECT event_type AS eventType, source, detail_json AS detailJson,
        occurred_at AS occurredAt FROM sop_execution_events
      WHERE execution_id = ? ORDER BY occurred_at DESC, id DESC
    `).all(row.id).map(event => ({
      ...event,
      detail: asJson(event.detailJson, {})
    }));
    res.json({
      ...executionRow(row),
      events
    });
  });
  app.patch("/api/sop/executions/:id", (req, res) => {
    const current = db.prepare("SELECT id, title FROM sop_executions WHERE id = ?").get(Number(req.params.id));
    if (!current) return respondNotFound(res, "SOP 执行事项不存在");
    const map = {
      title: "title",
      note: "note",
      category: "category",
      priority: "priority",
      isImportant: "is_important",
      scheduledDate: "scheduled_date",
      dueAt: "due_at",
      specialLabel: "special_label",
      mobileCapable: "mobile_capable",
      earlyCompletion: "early_completion"
    };
    const entries = Object.entries(req.body || {}).filter(([key]) => map[key]);
    if (!entries.length) return res.status(400).json({
      error: "没有需要保存的内容"
    });
    const values = entries.map(([key, value]) => {
      if (["isImportant", "mobileCapable", "earlyCompletion"].includes(key)) return toBoolean(value) ? 1 : 0;
      return value === "" ? null : value;
    });
    values.push(nowIso(), current.id);
    db.prepare(`UPDATE sop_executions SET ${entries.map(([key]) => `${map[key]} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...values);
    writeExecutionEvent(current.id, "updated", req.body);
    res.json({
      ok: true
    });
  });
  app.post("/api/sop/executions/:id/:action", (req, res) => {
    const action = String(req.params.action);
    if (!["complete", "reopen", "discard", "defer", "permanent-disable"].includes(action)) {
      return res.status(404).json({
        error: "不支持的 SOP 操作"
      });
    }
    const result = transitionExecution(req.params.id, action, req.body || {});
    if (!result) return respondNotFound(res, "SOP 执行事项不存在");
    if (result.error) return res.status(400).json({
      error: result.error
    });
    res.json(result);
  });
  app.post("/api/sop/batch/complete", (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean).slice(0, 500) : [];
    const themeId = Number(req.body?.themeId || 0);
    const date = req.body?.date || localDate();
    const rows = ids.length ? db.prepare(`SELECT id FROM sop_executions WHERE id IN (${ids.map(() => "?").join(",")}) AND status <> 'completed'`).all(...ids) : themeId ? req.body?.scope === "pending" ? db.prepare(`
              SELECT id FROM sop_executions
              WHERE theme_id = ? AND status = 'pending'
                AND (scheduled_date = ? OR (scheduled_date < ? AND is_important = 1))
            `).all(themeId, date, date) : db.prepare("SELECT id FROM sop_executions WHERE theme_id = ? AND scheduled_date = ? AND status <> 'completed'").all(themeId, date) : [];
    const completedAt = nowIso();
    db.transaction(() => {
      for (const row of rows) {
        db.prepare("UPDATE sop_executions SET status = 'completed', completed_at = ?, discarded_at = NULL, batch_completed = 1, updated_at = ? WHERE id = ?").run(completedAt, completedAt, row.id);
        writeExecutionEvent(row.id, "completed", {
          batch: true
        });
      }
    })();
    logRuntime({
      logType: "batch_completed",
      message: `批量完成 ${rows.length} 条 SOP 事项`,
      detail: {
        ids,
        themeId,
        date,
        scope: req.body?.scope || "date"
      }
    });
    res.json({
      updated: rows.length
    });
  });
  app.post("/api/sop/batch/discard", (req, res) => {
    const themeId = Number(req.body?.themeId || 0);
    const date = String(req.body?.date || localDate()).slice(0, 10);
    if (!themeId) return res.status(400).json({
      error: "请选择需要放弃当日事件的主题"
    });
    const rows = db.prepare(`
      SELECT id FROM sop_executions
      WHERE theme_id = ? AND scheduled_date = ?
        AND status NOT IN ('completed', 'discarded')
      ORDER BY id
    `).all(themeId, date);
    const discardedAt = nowIso();
    db.transaction(() => {
      for (const row of rows) {
        db.prepare(`
          UPDATE sop_executions
          SET status = 'discarded', completed_at = NULL, discarded_at = ?,
            batch_completed = 0, deferred_until = NULL, updated_at = ?
          WHERE id = ?
        `).run(discardedAt, discardedAt, row.id);
        writeExecutionEvent(row.id, "discarded", {
          batch: true,
          date,
          excludedFromCompletionStatistics: true
        });
      }
    })();
    const themeName = db.prepare("SELECT name FROM sop_themes WHERE id = ?").pluck().get(themeId) || null;
    logRuntime({
      logType: "batch_discarded",
      themeName,
      message: `批量放弃 ${date} 的 ${rows.length} 条 SOP 事项`,
      detail: {
        themeId,
        date,
        ids: rows.map(row => row.id),
        excludedFromCompletionStatistics: true
      }
    });
    res.json({
      updated: rows.length,
      themeId,
      date,
      status: "discarded",
      countedAsCompleted: false
    });
  });
  app.post("/api/sop/special-labels/:label/complete", (req, res) => {
    const date = req.body?.date || localDate();
    const rows = req.body?.scope === "pending" ? db.prepare(`
          SELECT id FROM sop_executions
          WHERE special_label = ? AND status = 'pending'
            AND (scheduled_date = ? OR (scheduled_date < ? AND is_important = 1))
        `).all(String(req.params.label), date, date) : db.prepare(`
          SELECT id FROM sop_executions
          WHERE special_label = ? AND scheduled_date = ? AND status <> 'completed'
        `).all(String(req.params.label), date);
    const completedAt = nowIso();
    db.transaction(() => {
      for (const row of rows) {
        db.prepare("UPDATE sop_executions SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?").run(completedAt, completedAt, row.id);
        writeExecutionEvent(row.id, "completed", {
          specialLabel: req.params.label
        });
      }
    })();
    res.json({
      updated: rows.length,
      label: req.params.label,
      date
    });
  });
  app.get("/api/sop/manual-calendars", (req, res) => {
    const includeArchived = req.query.status === "all";
    const rows = db.prepare(`
      SELECT c.id, c.name, c.color, c.status,
        COUNT(d.calendar_date) AS dateCount,
        MIN(d.calendar_date) AS firstDate,
        MAX(d.calendar_date) AS lastDate,
        (SELECT COUNT(*) FROM sop_themes t
          WHERE t.rule_type = 'custom_dates'
            AND CAST(json_extract(t.rule_config_json, '$.calendarId') AS INTEGER) = c.id
            AND t.status <> 'archived') AS linkedThemeCount,
        (SELECT COUNT(*) FROM sop_events e
          WHERE e.recurrence_type = 'custom_dates'
            AND CAST(json_extract(e.recurrence_config_json, '$.calendarId') AS INTEGER) = c.id
            AND e.generation_enabled = 1) AS linkedEventCount,
        c.created_at AS createdAt, c.updated_at AS updatedAt
      FROM sop_manual_calendars c
      LEFT JOIN sop_manual_calendar_dates d ON d.calendar_id = c.id
      WHERE (? = 1 OR c.status = 'active')
      GROUP BY c.id
      ORDER BY CASE WHEN c.status = 'active' THEN 0 ELSE 1 END, c.id
    `).all(includeArchived ? 1 : 0);
    res.json({
      data: rows,
      total: rows.length
    });
  });
  app.post("/api/sop/manual-calendars", (req, res) => {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({
      error: "请输入手动日期日历名称"
    });
    if (db.prepare("SELECT 1 FROM sop_manual_calendars WHERE name = ?").get(name)) {
      return res.status(409).json({
        error: "手动日期日历名称已存在"
      });
    }
    const createdAt = nowIso();
    const result = db.prepare(`
      INSERT INTO sop_manual_calendars (name, color, status, created_at, updated_at)
      VALUES (?, ?, 'active', ?, ?)
    `).run(name, req.body?.color || "#2877d4", createdAt, createdAt);
    logRuntime({
      logType: "manual_calendar_created",
      message: `新建 SOP 手动日期日历：${name}`,
      detail: {
        id: result.lastInsertRowid
      }
    });
    res.status(201).json(manualCalendar(result.lastInsertRowid, {
      activeOnly: false
    }));
  });
  app.patch("/api/sop/manual-calendars/:id", (req, res) => {
    const current = manualCalendar(req.params.id, {
      activeOnly: false
    });
    if (!current) return respondNotFound(res, "SOP 手动日期日历不存在");
    const name = String(req.body?.name ?? current.name).trim();
    const color = String(req.body?.color || current.color);
    const status = String(req.body?.status || current.status);
    if (!name) return res.status(400).json({
      error: "请输入手动日期日历名称"
    });
    if (!['active', 'archived'].includes(status)) return res.status(400).json({
      error: "日历状态不正确"
    });
    if (db.prepare("SELECT 1 FROM sop_manual_calendars WHERE name = ? AND id <> ?").get(name, current.id)) {
      return res.status(409).json({
        error: "手动日期日历名称已存在"
      });
    }
    db.prepare(`
      UPDATE sop_manual_calendars SET name = ?, color = ?, status = ?, updated_at = ? WHERE id = ?
    `).run(name, color, status, nowIso(), current.id);
    logRuntime({
      logType: "manual_calendar_updated",
      message: `更新 SOP 手动日期日历：${name}`,
      detail: {
        id: current.id,
        status
      }
    });
    res.json(manualCalendar(current.id, {
      activeOnly: false
    }));
  });
  app.get("/api/sop/manual-calendars/:id/dates", (req, res) => {
    const calendar = manualCalendar(req.params.id, {
      activeOnly: false
    });
    if (!calendar) return respondNotFound(res, "SOP 手动日期日历不存在");
    const from = String(req.query.from || "0000-01-01");
    const to = String(req.query.to || "9999-12-31");
    const data = db.prepare(`
      SELECT calendar_date AS calendarDate, note, created_at AS createdAt, updated_at AS updatedAt
      FROM sop_manual_calendar_dates
      WHERE calendar_id = ? AND calendar_date BETWEEN ? AND ?
      ORDER BY calendar_date
    `).all(calendar.id, from, to);
    res.json({
      calendar,
      data,
      total: data.length,
      from,
      to
    });
  });
  app.put("/api/sop/manual-calendars/:id/dates/:date", (req, res) => {
    const calendar = manualCalendar(req.params.id);
    if (!calendar) return respondNotFound(res, "可用的 SOP 手动日期日历不存在");
    const date = String(req.params.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({
      error: "日期格式不正确"
    });
    const createdAt = nowIso();
    db.prepare(`
      INSERT INTO sop_manual_calendar_dates (calendar_id, calendar_date, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(calendar_id, calendar_date) DO UPDATE SET
        note = excluded.note, updated_at = excluded.updated_at
    `).run(calendar.id, date, req.body?.note || null, createdAt, createdAt);
    logRuntime({
      logType: "manual_calendar_date_added",
      message: `${calendar.name} 加入日期 ${date}`,
      detail: {
        calendarId: calendar.id,
        date
      }
    });
    res.json({
      ok: true,
      calendarId: calendar.id,
      date,
      selected: true
    });
  });
  app.delete("/api/sop/manual-calendars/:id/dates/:date", (req, res) => {
    const calendar = manualCalendar(req.params.id);
    if (!calendar) return respondNotFound(res, "可用的 SOP 手动日期日历不存在");
    const date = String(req.params.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({
      error: "日期格式不正确"
    });
    const result = db.prepare(`
      DELETE FROM sop_manual_calendar_dates WHERE calendar_id = ? AND calendar_date = ?
    `).run(calendar.id, date);
    if (result.changes) {
      logRuntime({
        logType: "manual_calendar_date_removed",
        message: `${calendar.name} 移除日期 ${date}`,
        detail: {
          calendarId: calendar.id,
          date
        }
      });
    }
    res.json({
      ok: true,
      calendarId: calendar.id,
      date,
      selected: false,
      removed: result.changes
    });
  });
  app.get("/api/sop/calendar", (req, res) => {
    const from = String(req.query.from || `${localDate().slice(0, 8)}01`);
    const to = String(req.query.to || addDays(from, 41));
    const rows = db.prepare(`
      SELECT calendar_date AS calendarDate, day_type AS dayType,
        weekday_label AS weekdayLabel, first_workday AS firstWorkday,
        day_after_rest AS dayAfterRest, note, source, template_id AS templateId,
        updated_at AS updatedAt
      FROM sop_work_calendar WHERE calendar_date BETWEEN ? AND ? ORDER BY calendar_date
    `).all(from, to).map(row => ({
      ...row,
      firstWorkday: Boolean(row.firstWorkday),
      dayAfterRest: Boolean(row.dayAfterRest)
    }));
    res.json({
      data: rows,
      from,
      to
    });
  });
  app.put("/api/sop/calendar/:date", (req, res) => {
    const date = String(req.params.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({
      error: "日期格式不正确"
    });
    const dayType = String(req.body?.dayType || "workday");
    if (!["workday", "restday", "holiday", "adjusted_workday"].includes(dayType)) {
      return res.status(400).json({
        error: "工休类型不正确"
      });
    }
    db.prepare(`
      INSERT INTO sop_work_calendar (
        calendar_date, day_type, weekday_label, first_workday, day_after_rest,
        note, source, template_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?)
      ON CONFLICT(calendar_date) DO UPDATE SET
        day_type = excluded.day_type, first_workday = excluded.first_workday,
        day_after_rest = excluded.day_after_rest, note = excluded.note,
        source = 'manual', template_id = excluded.template_id, updated_at = excluded.updated_at
    `).run(date, dayType, `每周${["日", "一", "二", "三", "四", "五", "六"][dayOfWeek(date)]}`, toBoolean(req.body?.firstWorkday) ? 1 : 0, toBoolean(req.body?.dayAfterRest) ? 1 : 0, req.body?.note || null, req.body?.templateId ? Number(req.body.templateId) : null, nowIso());
    logRuntime({
      logType: "calendar_updated",
      message: `更新工作日历：${date}`,
      detail: req.body
    });
    res.json({
      ok: true
    });
  });
  app.get("/api/sop/calendar-templates", (_req, res) => {
    const data = db.prepare(`
      SELECT id, name, color, weekday_config_json AS weekdayConfigJson,
        is_default AS isDefault, created_at AS createdAt, updated_at AS updatedAt
      FROM sop_calendar_templates ORDER BY is_default DESC, id
    `).all().map(row => ({
      ...row,
      isDefault: Boolean(row.isDefault),
      weekdayConfig: asJson(row.weekdayConfigJson, {})
    }));
    res.json({
      data
    });
  });
  app.post("/api/sop/calendar-templates", (req, res) => {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({
      error: "请输入日历模板名称"
    });
    const config = req.body?.weekdayConfig || {
      0: "restday",
      1: "workday",
      2: "workday",
      3: "workday",
      4: "workday",
      5: "workday",
      6: "restday"
    };
    const createdAt = nowIso();
    const result = db.prepare(`
      INSERT INTO sop_calendar_templates (name, color, weekday_config_json, is_default, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?)
    `).run(name, req.body?.color || themeColors[0], JSON.stringify(config), createdAt, createdAt);
    res.status(201).json({
      id: result.lastInsertRowid,
      name,
      color: req.body?.color || themeColors[0],
      weekdayConfig: config
    });
  });
  app.patch("/api/sop/calendar-templates/:id", (req, res) => {
    const current = db.prepare("SELECT * FROM sop_calendar_templates WHERE id = ?").get(Number(req.params.id));
    if (!current) return respondNotFound(res, "日历模板不存在");
    const name = String(req.body?.name ?? current.name).trim();
    const color = req.body?.color || current.color;
    const config = req.body?.weekdayConfig || asJson(current.weekday_config_json, {});
    db.prepare("UPDATE sop_calendar_templates SET name = ?, color = ?, weekday_config_json = ?, updated_at = ? WHERE id = ?").run(name, color, JSON.stringify(config), nowIso(), current.id);
    res.json({
      id: current.id,
      name,
      color,
      weekdayConfig: config
    });
  });
  app.get("/api/sop/logs", (req, res) => {
    const values = [];
    const where = ["1 = 1"];
    if (req.query.type) {
      where.push("log_type = ?");
      values.push(String(req.query.type));
    }
    if (req.query.theme) {
      where.push("theme_name = ?");
      values.push(String(req.query.theme));
    }
    if (req.query.q) {
      const value = `%${String(req.query.q).trim()}%`;
      where.push("(message LIKE ? OR event_name LIKE ? OR theme_name LIKE ?)");
      values.push(value, value, value);
    }
    const limit = safeLimit(req.query.limit);
    const offset = Math.max(0, Number(req.query.offset || 0));
    const total = db.prepare(`SELECT COUNT(*) FROM sop_runtime_logs WHERE ${where.join(" AND ")}`).pluck().get(...values);
    const data = db.prepare(`
      SELECT id, log_type AS logType, level, theme_name AS themeName,
        event_name AS eventName, message, detail_json AS detailJson,
        occurred_at AS occurredAt, source_table_id AS sourceTableId,
        source_record_id AS sourceRecordId
      FROM sop_runtime_logs WHERE ${where.join(" AND ")}
      ORDER BY ${logColumnOrder(req.query.sort) || "occurred_at DESC"}, id DESC LIMIT ? OFFSET ?
    `).all(...values, limit, offset).map(row => ({
      ...row,
      detail: asJson(row.detailJson, {})
    }));
    res.json({
      data,
      total,
      limit,
      offset
    });
  });
  app.get("/api/sop/stats", (req, res) => {
    const values = [];
    const scope = req.query.themeId ? " AND theme_id = ?" : "";
    if (req.query.themeId) values.push(Number(req.query.themeId));
    const summary = db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'discarded' THEN 1 ELSE 0 END) AS discarded,
        SUM(CASE WHEN status = 'deferred' THEN 1 ELSE 0 END) AS deferred
      FROM sop_executions WHERE 1 = 1 ${scope}
    `).get(...values);
    const byStatus = db.prepare(`
      SELECT status, COUNT(*) AS count FROM sop_executions
      WHERE 1 = 1 ${scope} GROUP BY status ORDER BY count DESC
    `).all(...values);
    const from = addDays(localDate(), -29);
    const dailyRows = db.prepare(`
      SELECT scheduled_date AS date, COUNT(*) AS created,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
      FROM sop_executions WHERE scheduled_date >= ? ${scope}
      GROUP BY scheduled_date ORDER BY scheduled_date
    `).all(from, ...values);
    const dailyMap = new Map(dailyRows.map(row => [row.date, row]));
    const daily = Array.from({
      length: 30
    }, (_, index) => {
      const date = addDays(from, index);
      return dailyMap.get(date) || {
        date,
        created: 0,
        completed: 0
      };
    });
    const themes = db.prepare(`
      SELECT t.id, t.name, t.color, COUNT(e.id) AS total,
        SUM(CASE WHEN e.status = 'completed' THEN 1 ELSE 0 END) AS completed
      FROM sop_themes t LEFT JOIN sop_executions e ON e.theme_id = t.id
      WHERE t.status <> 'archived' GROUP BY t.id
      ORDER BY CASE WHEN t.theme_type = 'recurring_events' THEN 0 ELSE 1 END, total DESC LIMIT 12
    `).all();
    res.json({
      summary,
      byStatus,
      daily,
      themes
    });
  });
  app.get("/api/sop/settings", (_req, res) => {
    res.json(Object.fromEntries(db.prepare("SELECT key, value FROM sop_settings ORDER BY key").all().map(row => [row.key, row.value])));
  });
  app.patch("/api/sop/settings", (req, res) => {
    const allowed = new Set(["scheduler_enabled", "generation_time", "maintenance_time", "default_sop_tab"]);
    for (const [key, value] of Object.entries(req.body || {})) {
      if (allowed.has(key)) saveSetting(key, value);
    }
    res.json(Object.fromEntries(db.prepare("SELECT key, value FROM sop_settings ORDER BY key").all().map(row => [row.key, row.value])));
  });
  app.post("/api/sop/scheduler/run", (req, res) => {
    const date = req.body?.date || localDate();
    const generation = runSopGeneration(date, "网页手动调度");
    const maintenance = req.body?.maintenance ? runSopMaintenance(date, "网页手动调度") : null;
    res.json({
      generation,
      maintenance
    });
  });
}
export { localDate, mapFrequencyLabel };
