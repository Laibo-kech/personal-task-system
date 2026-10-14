import lunarPackage from "lunar-javascript";
import { db, defaultListId, nextTaskNumber, writeTaskLog } from "./db.mjs";
const {
  Solar
} = lunarPackage;
const TIME_ZONE = "Asia/Shanghai";
const allowedRuleTypes = new Set(["daily", "weekly", "monthly_day", "monthly_weekday", "yearly_solar", "lunar_monthly", "lunar_yearly", "yearly_day_type", "holiday_offset", "custom"]);
function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}
function booleanValue(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}
function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(number, min), max) : fallback;
}
function localDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}
function datePart(value) {
  if (!value) return null;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text.slice(0, 10) : localDate(parsed);
}
function timePart(value) {
  if (!value || /^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(parsed);
}
function inferTimePrecision(value, storedPrecision) {
  if (!value) return null;
  if (storedPrecision === "date" || storedPrecision === "datetime") return storedPrecision;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return "date";
  return timePart(value) === "00:00" ? "date" : "datetime";
}
function addDays(date, amount) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + Number(amount));
  return value.toISOString().slice(0, 10);
}
function dayDiff(from, to) {
  return Math.round((new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000);
}
function weekday(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}
function localIso(date, time = "09:00") {
  return new Date(`${date}T${time.length === 5 ? `${time}:00` : time}+08:00`).toISOString();
}
function addMinutes(iso, minutes) {
  return new Date(new Date(iso).getTime() + Number(minutes) * 60000).toISOString();
}
function settingMap() {
  return Object.fromEntries(db.prepare("SELECT key, value FROM calendar_settings").all().map(row => [row.key, row.value]));
}
function activeList(id) {
  return db.prepare("SELECT id, name, color FROM lists WHERE id = ? AND archived_at IS NULL").get(Number(id));
}
function writeCalendarLog({
  eventId = null,
  seriesId = null,
  eventType,
  oldValue = null,
  newValue = null,
  message = null
}) {
  const at = new Date().toISOString();
  db.prepare(`
    INSERT INTO calendar_event_logs
      (event_id, series_id, event_type, old_value, new_value, message, occurred_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(eventId, seriesId, eventType, oldValue, newValue, message, at, at);
}
function dayType(date) {
  const row = db.prepare("SELECT day_type AS dayType, holiday_name AS holidayName FROM calendar_day_types WHERE calendar_date = ?").get(date);
  if (row) return row;
  return {
    dayType: [0, 6].includes(weekday(date)) ? "restday" : "workday",
    holidayName: null
  };
}
function nthWeekdayInMonth(date, targetWeekday, nth) {
  if (weekday(date) !== targetWeekday) return false;
  const day = Number(date.slice(8, 10));
  if (Number(nth) === -1) return addDays(date, 7).slice(5, 7) !== date.slice(5, 7);
  return Math.floor((day - 1) / 7) + 1 === Number(nth);
}
function normalizeRule(rule = {}) {
  const type = allowedRuleTypes.has(rule.type) ? rule.type : "daily";
  return {
    ...rule,
    type,
    interval: clamp(rule.interval, 1, 365, 1),
    weekdays: Array.isArray(rule.weekdays) ? [...new Set(rule.weekdays.map(Number).filter(item => item >= 0 && item <= 6))] : [],
    excludeDates: Array.isArray(rule.excludeDates) ? [...new Set(rule.excludeDates.map(String))] : [],
    customDates: Array.isArray(rule.customDates) ? [...new Set(rule.customDates.map(String))] : []
  };
}
export function recurrenceDates({
  startDate,
  from = startDate,
  to,
  rule,
  endDate = null,
  maxOccurrences = null,
  limit = 500
}) {
  const normalized = normalizeRule(rule);
  const scanEnd = [to || addDays(startDate, 366 * 5), endDate].filter(Boolean).sort()[0];
  const excluded = new Set(normalized.excludeDates);
  const custom = new Set(normalized.customDates);
  const holidayTargets = new Set();
  if (normalized.type === "holiday_offset") {
    for (let cursor = addDays(startDate, -31); cursor <= addDays(scanEnd, 31); cursor = addDays(cursor, 1)) {
      if (dayType(cursor).dayType === "holiday") holidayTargets.add(addDays(cursor, Number(normalized.offsetDays || 0)));
    }
  }
  const results = [];
  let matched = 0;
  const typeCounters = new Map();
  for (let cursor = startDate; cursor <= scanEnd; cursor = addDays(cursor, 1)) {
    const diff = dayDiff(startDate, cursor);
    const currentWeekday = weekday(cursor);
    const year = Number(cursor.slice(0, 4));
    const month = Number(cursor.slice(5, 7));
    const day = Number(cursor.slice(8, 10));
    const startYear = Number(startDate.slice(0, 4));
    const startMonth = Number(startDate.slice(5, 7));
    const monthOffset = (year - startYear) * 12 + month - startMonth;
    const yearOffset = year - startYear;
    let matches = false;
    if (normalized.type === "daily") matches = diff % normalized.interval === 0;
    if (normalized.type === "weekly") {
      const selected = normalized.weekdays.length ? normalized.weekdays : [weekday(startDate)];
      matches = Math.floor(diff / 7) % normalized.interval === 0 && selected.includes(currentWeekday);
    }
    if (normalized.type === "monthly_day") matches = monthOffset % normalized.interval === 0 && day === Number(normalized.day || Number(startDate.slice(8, 10)));
    if (normalized.type === "monthly_weekday") matches = monthOffset % normalized.interval === 0 && nthWeekdayInMonth(cursor, Number(normalized.weekday ?? weekday(startDate)), Number(normalized.nth || 1));
    if (normalized.type === "yearly_solar") matches = yearOffset % normalized.interval === 0 && month === Number(normalized.month || Number(startDate.slice(5, 7))) && day === Number(normalized.day || Number(startDate.slice(8, 10)));
    if (["lunar_monthly", "lunar_yearly"].includes(normalized.type)) {
      const lunar = Solar.fromYmd(Number(cursor.slice(0, 4)), month, day).getLunar();
      const lunarMonth = Number(lunar.getMonth());
      const leapAllowed = booleanValue(normalized.includeLeap) || lunarMonth > 0;
      matches = leapAllowed && Math.abs(lunarMonth) === Number(normalized.lunarMonth || Math.abs(lunar.getMonth())) && Number(lunar.getDay()) === Number(normalized.lunarDay || 1);
      if (normalized.type === "lunar_monthly") matches = leapAllowed && Number(lunar.getDay()) === Number(normalized.lunarDay || 1);
      if (normalized.type === "lunar_yearly") matches = matches && yearOffset % normalized.interval === 0;
    }
    if (normalized.type === "yearly_day_type") {
      const currentType = dayType(cursor).dayType;
      const wanted = normalized.dayType === "restday" ? "restday" : "workday";
      const yearKey = `${cursor.slice(0, 4)}:${wanted}`;
      if (!typeCounters.has(yearKey)) {
        let count = 0;
        for (let probe = `${cursor.slice(0, 4)}-01-01`; probe < cursor; probe = addDays(probe, 1)) {
          if (dayType(probe).dayType === wanted) count += 1;
        }
        typeCounters.set(yearKey, count);
      }
      if (currentType === wanted) typeCounters.set(yearKey, (typeCounters.get(yearKey) || 0) + 1);
      matches = yearOffset % normalized.interval === 0 && currentType === wanted && typeCounters.get(yearKey) === Number(normalized.nth || 1);
    }
    if (normalized.type === "holiday_offset") matches = holidayTargets.has(cursor);
    if (normalized.type === "custom") matches = custom.has(cursor);
    if (!matches || excluded.has(cursor)) continue;
    matched += 1;
    if (maxOccurrences && matched > Number(maxOccurrences)) break;
    if (cursor >= from) results.push(cursor);
    if (results.length >= limit) break;
  }
  return results;
}
function seriesRow(row) {
  return row ? {
    id: row.id,
    listId: row.listId,
    listName: row.listName,
    listColor: row.listColor,
    title: row.title,
    notes: row.notes || "",
    location: row.location || "",
    linkUrl: row.linkUrl || "",
    allDay: Boolean(row.allDay),
    startDate: row.startDate,
    startTime: row.startTime,
    durationMinutes: row.durationMinutes,
    timezone: row.timezone,
    ruleType: row.ruleType,
    rule: parseJson(row.ruleJson, {}),
    endDate: row.endDate,
    maxOccurrences: row.maxOccurrences,
    reminderMinutes: row.reminderMinutes,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  } : null;
}
function getSeries(id) {
  return seriesRow(db.prepare(`
    SELECT s.id, s.list_id AS listId, l.name AS listName, l.color AS listColor,
      s.title, s.notes, s.location, s.link_url AS linkUrl, s.all_day AS allDay,
      s.start_date AS startDate, s.start_time AS startTime, s.duration_minutes AS durationMinutes,
      s.timezone, s.rule_type AS ruleType, s.rule_json AS ruleJson, s.end_date AS endDate,
      s.max_occurrences AS maxOccurrences, s.reminder_minutes AS reminderMinutes,
      s.status, s.created_at AS createdAt, s.updated_at AS updatedAt
    FROM calendar_series s JOIN lists l ON l.id = s.list_id WHERE s.id = ?
  `).get(Number(id)));
}
function materializeSeries(series, from, to) {
  if (!series || series.status !== "active") return 0;
  const dates = recurrenceDates({
    startDate: series.startDate,
    from,
    to: addDays(to, -1),
    rule: series.rule,
    endDate: series.endDate,
    maxOccurrences: series.maxOccurrences,
    limit: 2000
  });
  const insert = db.prepare(`
    INSERT OR IGNORE INTO calendar_events (
      list_id, series_id, occurrence_key, title, notes, location, link_url,
      start_at, end_at, all_day, reminder_minutes, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)
  `);
  const now = new Date().toISOString();
  let created = 0;
  db.transaction(() => {
    for (const date of dates) {
      const startAt = series.allDay ? date : localIso(date, series.startTime);
      const endAt = series.allDay ? addDays(date, 1) : addMinutes(startAt, series.durationMinutes);
      created += insert.run(series.listId, series.id, date, series.title, series.notes, series.location, series.linkUrl, startAt, endAt, series.allDay ? 1 : 0, series.reminderMinutes, now, now).changes;
    }
  })();
  return created;
}
function eventRow(row) {
  return {
    id: `event:${row.id}`,
    sourceType: "event",
    sourceId: row.id,
    eventId: row.id,
    seriesId: row.seriesId,
    occurrenceKey: row.occurrenceKey,
    listId: row.listId,
    listName: row.listName,
    listColor: row.listColor,
    title: row.title,
    notes: row.notes || "",
    location: row.location || "",
    linkUrl: row.linkUrl || "",
    startAt: row.startAt,
    endAt: row.endAt,
    allDay: Boolean(row.allDay),
    reminderMinutes: row.reminderMinutes,
    status: row.status,
    isRecurring: Boolean(row.seriesId),
    isOverride: Boolean(row.isOverride),
    convertedTaskId: row.convertedTaskId,
    timeWarning: false
  };
}
function taskCalendarItem(row) {
  const startPrecision = inferTimePrecision(row.startAt, row.startPrecision);
  const duePrecision = inferTimePrecision(row.dueAt, row.duePrecision);
  const startDate = datePart(row.startAt);
  const dueDate = datePart(row.dueAt);
  const rawStart = row.startAt && startPrecision === "datetime" ? new Date(row.startAt).toISOString() : null;
  const rawEnd = row.dueAt && duePrecision === "datetime" ? new Date(row.dueAt).toISOString() : null;
  const comparableStart = row.startAt ? startPrecision === "date" ? localIso(startDate, "09:00") : rawStart : null;
  const comparableEnd = row.dueAt ? duePrecision === "date" ? localIso(dueDate, "10:00") : rawEnd : null;
  const invalidRange = Boolean(comparableStart && comparableEnd && new Date(comparableStart) > new Date(comparableEnd));
  let startAt;
  let endAt;
  if (invalidRange) {
    const date = dueDate || startDate;
    startAt = localIso(date, "09:00");
    endAt = localIso(date, "10:00");
  } else if (row.startAt && row.dueAt) {
    startAt = startPrecision === "date" ? localIso(startDate, "09:00") : rawStart;
    endAt = duePrecision === "date" ? localIso(dueDate, dueDate === startDate ? "10:00" : "10:00") : rawEnd;
  } else if (row.startAt) {
    startAt = startPrecision === "date" ? localIso(startDate, "09:00") : rawStart;
    endAt = addMinutes(startAt, 60);
  } else {
    endAt = duePrecision === "date" ? localIso(dueDate, "10:00") : rawEnd;
    startAt = duePrecision === "date" ? localIso(dueDate, "09:00") : addMinutes(endAt, -60);
  }
  return {
    id: `task:${row.id}`,
    sourceType: "task",
    sourceId: row.id,
    taskId: row.id,
    taskNo: row.taskNo,
    listId: row.listId,
    listName: row.listName,
    listColor: row.listColor,
    title: row.title,
    notes: row.notes || "",
    startAt,
    endAt,
    allDay: false,
    status: row.status,
    projectId: row.projectId,
    projectName: row.projectName,
    tagDetails: parseJson(row.tagsJson, []),
    startPrecision,
    duePrecision,
    rawStartAt: row.startAt,
    rawDueAt: row.dueAt,
    isRecurring: false,
    timeWarning: invalidRange
  };
}
function listFilter(query) {
  return String(query.listIds || "").split(",").map(Number).filter(Boolean);
}
export function registerCalendarRoutes(app) {
  app.get("/api/calendar/items", (req, res) => {
    const from = String(req.query.from || localDate()).slice(0, 10);
    const to = String(req.query.to || addDays(from, 42)).slice(0, 10);
    if (to <= from) return res.status(400).json({
      error: "日历结束日期必须晚于开始日期"
    });
    const listIds = listFilter(req.query);
    const showCompleted = req.query.showCompleted !== "0";
    const showDiscarded = req.query.showDiscarded === "1";
    const activeSeries = db.prepare(`
      SELECT s.id FROM calendar_series s JOIN lists l ON l.id = s.list_id
      WHERE s.status = 'active' AND l.archived_at IS NULL
        AND s.start_date < ? AND (s.end_date IS NULL OR s.end_date >= ?)
        ${listIds.length ? `AND s.list_id IN (${listIds.map(() => "?").join(",")})` : ""}
    `).all(to, from, ...listIds);
    for (const item of activeSeries) materializeSeries(getSeries(item.id), from, to);
    const tasks = db.prepare(`
      SELECT t.id, t.task_no AS taskNo, t.title, t.status, t.list_id AS listId,
        l.name AS listName, l.color AS listColor, t.project_id AS projectId,
        p.name AS projectName, t.start_at AS startAt, t.due_at AS dueAt,
        t.start_precision AS startPrecision, t.due_precision AS duePrecision,
        t.notes, COALESCE((SELECT json_group_array(json_object('id', tg.id, 'name', tg.name, 'color', tg.color))
          FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.task_id = t.id), '[]') AS tagsJson
      FROM tasks t JOIN lists l ON l.id = t.list_id LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.deleted_at IS NULL AND l.archived_at IS NULL
        AND (t.start_at IS NOT NULL OR t.due_at IS NOT NULL)
        ${showCompleted ? "" : "AND t.status <> '已完成'"}
        ${showDiscarded ? "" : "AND t.status <> '已废弃'"}
        ${listIds.length ? `AND t.list_id IN (${listIds.map(() => "?").join(",")})` : ""}
    `).all(...listIds).map(taskCalendarItem).filter(item => item.endAt > `${from}T00:00:00+08:00` && item.startAt < `${to}T00:00:00+08:00`);
    const events = db.prepare(`
      SELECT e.id, e.series_id AS seriesId, e.occurrence_key AS occurrenceKey,
        e.list_id AS listId, l.name AS listName, l.color AS listColor,
        e.title, e.notes, e.location, e.link_url AS linkUrl,
        e.start_at AS startAt, e.end_at AS endAt, e.all_day AS allDay,
        e.reminder_minutes AS reminderMinutes, e.status, e.is_override AS isOverride,
        e.converted_task_id AS convertedTaskId
      FROM calendar_events e JOIN lists l ON l.id = e.list_id
      WHERE l.archived_at IS NULL AND e.status = 'scheduled'
        AND e.start_at < ? AND e.end_at > ?
        ${listIds.length ? `AND e.list_id IN (${listIds.map(() => "?").join(",")})` : ""}
      ORDER BY e.start_at, e.id
    `).all(`${to}T00:00:00+08:00`, `${from}T00:00:00+08:00`, ...listIds).map(eventRow);
    const search = String(req.query.q || "").trim().toLowerCase();
    const allItems = [...tasks, ...events].filter(item => !search || `${item.title} ${item.notes} ${item.listName}`.toLowerCase().includes(search)).sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));
    const hasPagination = req.query.limit !== undefined;
    const limit = clamp(req.query.limit, 1, 500, 50);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    res.json({
      data: hasPagination ? allItems.slice(offset, offset + limit) : allItems,
      total: allItems.length,
      limit: hasPagination ? limit : null,
      offset: hasPagination ? offset : 0,
      from,
      to,
      taskCount: tasks.length,
      eventCount: events.length
    });
  });
  app.get("/api/calendar/unscheduled-tasks", (req, res) => {
    const listIds = listFilter(req.query);
    const limit = clamp(req.query.limit, 1, 500, 100);
    const rows = db.prepare(`
      SELECT t.id, t.task_no AS taskNo, t.title, t.status, t.list_id AS listId,
        l.name AS listName, l.color AS listColor, t.notes, t.created_at AS createdAt
      FROM tasks t JOIN lists l ON l.id = t.list_id
      WHERE t.deleted_at IS NULL AND l.archived_at IS NULL
        AND t.start_at IS NULL AND t.due_at IS NULL
        AND t.status NOT IN ('已完成', '已废弃')
        ${listIds.length ? `AND t.list_id IN (${listIds.map(() => "?").join(",")})` : ""}
      ORDER BY t.is_pinned DESC, t.created_at DESC LIMIT ?
    `).all(...listIds, limit);
    res.json({
      data: rows,
      limit
    });
  });
  app.get("/api/calendar/series", (_req, res) => {
    const data = db.prepare(`
      SELECT s.id, s.list_id AS listId, l.name AS listName, l.color AS listColor,
        s.title, s.notes, s.location, s.link_url AS linkUrl, s.all_day AS allDay,
        s.start_date AS startDate, s.start_time AS startTime, s.duration_minutes AS durationMinutes,
        s.timezone, s.rule_type AS ruleType, s.rule_json AS ruleJson, s.end_date AS endDate,
        s.max_occurrences AS maxOccurrences, s.reminder_minutes AS reminderMinutes,
        s.status, s.created_at AS createdAt, s.updated_at AS updatedAt
      FROM calendar_series s JOIN lists l ON l.id = s.list_id
      WHERE s.status <> 'deleted' ORDER BY s.status, s.updated_at DESC
    `).all().map(seriesRow);
    res.json({
      data
    });
  });
  app.post("/api/calendar/recurrence/preview", (req, res) => {
    const startDate = String(req.body?.startDate || localDate()).slice(0, 10);
    const rule = normalizeRule(req.body?.recurrence || req.body?.rule || {});
    const dates = recurrenceDates({
      startDate,
      from: startDate,
      to: req.body?.endDate || addDays(startDate, 366 * 5),
      rule,
      endDate: req.body?.endDate || null,
      maxOccurrences: req.body?.maxOccurrences || null,
      limit: 30
    });
    res.json({
      dates,
      rule
    });
  });
  app.post("/api/calendar/events", (req, res) => {
    const title = String(req.body?.title || "").trim();
    const list = activeList(req.body?.listId || defaultListId());
    if (!title) return res.status(400).json({
      error: "请输入日程名称"
    });
    if (!list) return res.status(400).json({
      error: "所属日历不存在"
    });
    const recurrence = req.body?.recurrence?.type ? normalizeRule(req.body.recurrence) : null;
    const allDay = booleanValue(req.body?.allDay);
    const startAtInput = req.body?.startAt || (allDay ? localDate() : localIso(localDate(), "09:00"));
    const startDate = datePart(startAtInput);
    const startTime = timePart(startAtInput) || String(req.body?.startTime || "09:00").slice(0, 5);
    const duration = clamp(req.body?.durationMinutes, 1, 10080, 60);
    const reminder = clamp(req.body?.reminderMinutes, 0, 10080, 10);
    const now = new Date().toISOString();
    if (recurrence) {
      const result = db.prepare(`
        INSERT INTO calendar_series (
          list_id, title, notes, location, link_url, all_day, start_date, start_time,
          duration_minutes, timezone, rule_type, rule_json, end_date, max_occurrences,
          reminder_minutes, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `).run(list.id, title, req.body?.notes || null, req.body?.location || null, req.body?.linkUrl || null, allDay ? 1 : 0, startDate, startTime, duration, TIME_ZONE, recurrence.type, JSON.stringify(recurrence), req.body?.endDate || null, req.body?.maxOccurrences ? Number(req.body.maxOccurrences) : null, reminder, now, now);
      const series = getSeries(result.lastInsertRowid);
      materializeSeries(series, startDate, addDays(startDate, 370));
      writeCalendarLog({
        seriesId: series.id,
        eventType: "重复日程新建",
        newValue: title,
        message: `${list.name} / ${title}`
      });
      return res.status(201).json({
        type: "series",
        series
      });
    }
    let startAt = allDay ? startDate : new Date(startAtInput).toISOString();
    let endAt = req.body?.endAt ? allDay ? datePart(req.body.endAt) : new Date(req.body.endAt).toISOString() : allDay ? addDays(startDate, 1) : addMinutes(startAt, duration);
    if (endAt <= startAt) return res.status(400).json({
      error: "结束时间必须晚于开始时间"
    });
    const result = db.prepare(`
      INSERT INTO calendar_events (
        list_id, title, notes, location, link_url, start_at, end_at, all_day,
        reminder_minutes, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)
    `).run(list.id, title, req.body?.notes || null, req.body?.location || null, req.body?.linkUrl || null, startAt, endAt, allDay ? 1 : 0, reminder, now, now);
    writeCalendarLog({
      eventId: result.lastInsertRowid,
      eventType: "普通日程新建",
      newValue: title,
      message: `${list.name} / ${title}`
    });
    res.status(201).json({
      type: "event",
      id: result.lastInsertRowid
    });
  });
  app.patch("/api/calendar/events/:id", (req, res) => {
    const current = db.prepare("SELECT * FROM calendar_events WHERE id = ?").get(Number(req.params.id));
    if (!current) return res.status(404).json({
      error: "日程不存在"
    });
    const scope = String(req.body?.scope || "occurrence");
    const patch = req.body || {};
    const now = new Date().toISOString();
    if (current.series_id && ["future", "series"].includes(scope)) {
      const series = getSeries(current.series_id);
      if (!series) return res.status(404).json({
        error: "重复日程模板不存在"
      });
      if (scope === "future") {
        db.prepare("UPDATE calendar_series SET end_date = ?, updated_at = ? WHERE id = ?").run(addDays(current.occurrence_key, -1), now, series.id);
        const cloned = db.prepare(`
          INSERT INTO calendar_series (
            list_id, title, notes, location, link_url, all_day, start_date, start_time,
            duration_minutes, timezone, rule_type, rule_json, end_date, max_occurrences,
            reminder_minutes, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
        `).run(Number(patch.listId || series.listId), patch.title ?? series.title, patch.notes ?? series.notes, patch.location ?? series.location, patch.linkUrl ?? series.linkUrl, patch.allDay === undefined ? series.allDay ? 1 : 0 : booleanValue(patch.allDay) ? 1 : 0, current.occurrence_key, patch.startTime || series.startTime, clamp(patch.durationMinutes, 1, 10080, series.durationMinutes), TIME_ZONE, patch.recurrence?.type || series.ruleType, JSON.stringify(patch.recurrence ? normalizeRule(patch.recurrence) : series.rule), patch.endDate ?? series.endDate, patch.maxOccurrences ?? series.maxOccurrences, clamp(patch.reminderMinutes, 0, 10080, series.reminderMinutes), now, now);
        db.prepare("UPDATE calendar_events SET status = 'cancelled', updated_at = ? WHERE series_id = ? AND occurrence_key >= ? AND is_override = 0").run(now, series.id, current.occurrence_key);
        const next = getSeries(cloned.lastInsertRowid);
        materializeSeries(next, next.startDate, addDays(next.startDate, 370));
        writeCalendarLog({
          eventId: current.id,
          seriesId: next.id,
          eventType: "修改本次及以后",
          message: next.title
        });
        return res.json({
          ok: true,
          series: next
        });
      }
      const nextRule = patch.recurrence ? normalizeRule(patch.recurrence) : series.rule;
      db.prepare(`
        UPDATE calendar_series SET list_id = ?, title = ?, notes = ?, location = ?, link_url = ?,
          all_day = ?, start_time = ?, duration_minutes = ?, rule_type = ?, rule_json = ?,
          end_date = ?, max_occurrences = ?, reminder_minutes = ?, updated_at = ? WHERE id = ?
      `).run(Number(patch.listId || series.listId), patch.title ?? series.title, patch.notes ?? series.notes, patch.location ?? series.location, patch.linkUrl ?? series.linkUrl, patch.allDay === undefined ? series.allDay ? 1 : 0 : booleanValue(patch.allDay) ? 1 : 0, patch.startTime || series.startTime, clamp(patch.durationMinutes, 1, 10080, series.durationMinutes), nextRule.type, JSON.stringify(nextRule), patch.endDate ?? series.endDate, patch.maxOccurrences ?? series.maxOccurrences, clamp(patch.reminderMinutes, 0, 10080, series.reminderMinutes), now, series.id);
      db.prepare("DELETE FROM calendar_events WHERE series_id = ? AND occurrence_key >= ? AND is_override = 0").run(series.id, localDate());
      const next = getSeries(series.id);
      materializeSeries(next, localDate(), addDays(localDate(), 370));
      writeCalendarLog({
        seriesId: series.id,
        eventType: "修改整个系列",
        message: next.title
      });
      return res.json({
        ok: true,
        series: next
      });
    }
    const list = activeList(patch.listId || current.list_id);
    const startAt = patch.startAt ? booleanValue(patch.allDay ?? current.all_day) ? datePart(patch.startAt) : new Date(patch.startAt).toISOString() : current.start_at;
    const endAt = patch.endAt ? booleanValue(patch.allDay ?? current.all_day) ? datePart(patch.endAt) : new Date(patch.endAt).toISOString() : current.end_at;
    if (!list || endAt <= startAt) return res.status(400).json({
      error: "日程时间或所属日历不正确"
    });
    db.prepare(`
      UPDATE calendar_events SET list_id = ?, title = ?, notes = ?, location = ?, link_url = ?,
        start_at = ?, end_at = ?, all_day = ?, reminder_minutes = ?, is_override = ?, updated_at = ?
      WHERE id = ?
    `).run(list.id, String(patch.title ?? current.title).trim(), patch.notes ?? current.notes, patch.location ?? current.location, patch.linkUrl ?? current.link_url, startAt, endAt, patch.allDay === undefined ? current.all_day : booleanValue(patch.allDay) ? 1 : 0, clamp(patch.reminderMinutes, 0, 10080, current.reminder_minutes), current.series_id ? 1 : current.is_override, now, current.id);
    writeCalendarLog({
      eventId: current.id,
      seriesId: current.series_id,
      eventType: "日程修改",
      oldValue: current.title,
      newValue: patch.title ?? current.title
    });
    res.json({
      ok: true
    });
  });
  app.delete("/api/calendar/events/:id", (req, res) => {
    const current = db.prepare("SELECT * FROM calendar_events WHERE id = ?").get(Number(req.params.id));
    if (!current) return res.status(404).json({
      error: "日程不存在"
    });
    const scope = String(req.query.scope || req.body?.scope || "occurrence");
    const now = new Date().toISOString();
    if (current.series_id && scope === "future") {
      db.prepare("UPDATE calendar_series SET end_date = ?, updated_at = ? WHERE id = ?").run(addDays(current.occurrence_key, -1), now, current.series_id);
      db.prepare("UPDATE calendar_events SET status = 'cancelled', updated_at = ? WHERE series_id = ? AND occurrence_key >= ?").run(now, current.series_id, current.occurrence_key);
    } else if (current.series_id && scope === "series") {
      db.prepare("UPDATE calendar_series SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now, current.series_id);
      db.prepare("UPDATE calendar_events SET status = 'cancelled', updated_at = ? WHERE series_id = ?").run(now, current.series_id);
    } else {
      db.prepare("UPDATE calendar_events SET status = 'cancelled', is_override = 1, updated_at = ? WHERE id = ?").run(now, current.id);
    }
    writeCalendarLog({
      eventId: current.id,
      seriesId: current.series_id,
      eventType: "日程取消",
      message: scope
    });
    res.status(204).end();
  });
  app.post("/api/calendar/events/:id/convert-to-task", (req, res) => {
    const event = db.prepare("SELECT * FROM calendar_events WHERE id = ? AND status = 'scheduled'").get(Number(req.params.id));
    if (!event) return res.status(404).json({
      error: "可转换的日程不存在"
    });
    const now = new Date().toISOString();
    const taskNo = nextTaskNumber();
    const startAt = event.all_day ? datePart(event.start_at) : event.start_at;
    const dueAt = event.all_day ? datePart(event.start_at) : event.end_at;
    const result = db.prepare(`
      INSERT INTO tasks (
        task_no, title, status, list_id, project_id, start_at, due_at,
        start_precision, due_precision, completed_at, starred, important, urgent,
        is_pinned, source, notes, created_at, updated_at
      ) VALUES (?, ?, '未完成', ?, NULL, ?, ?, ?, ?, NULL, 0, 0, 0, 0, '日程转换', ?, ?, ?)
    `).run(taskNo, event.title, event.list_id, startAt, dueAt, event.all_day ? "date" : "datetime", event.all_day ? "date" : "datetime", event.notes || "", now, now);
    db.prepare("UPDATE calendar_events SET status = 'converted', converted_task_id = ?, updated_at = ? WHERE id = ?").run(result.lastInsertRowid, now, event.id);
    writeTaskLog({
      taskId: result.lastInsertRowid,
      taskNo,
      eventType: "任务新建",
      newValue: "未完成",
      source: "日程系统",
      message: event.title,
      changedFields: {
        calendarEventId: event.id
      }
    });
    writeCalendarLog({
      eventId: event.id,
      seriesId: event.series_id,
      eventType: "转换为任务",
      newValue: taskNo,
      message: event.title
    });
    res.status(201).json({
      taskId: result.lastInsertRowid,
      taskNo
    });
  });
  app.get("/api/calendar/settings", (_req, res) => res.json(settingMap()));
  app.patch("/api/calendar/settings", (req, res) => {
    const allowed = new Set(["default_view", "default_start_time", "default_duration_minutes", "default_reminder_minutes", "show_completed", "show_discarded", "visible_list_ids", "visible_selection_configured", "display_start_time", "display_end_time", "calendar_view_height"]);
    const now = new Date().toISOString();
    const save = db.prepare("INSERT INTO calendar_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at");
    for (const [key, value] of Object.entries(req.body || {})) if (allowed.has(key)) save.run(key, String(value), now);
    res.json(settingMap());
  });
  app.get("/api/calendar/day-types", (req, res) => {
    const from = String(req.query.from || `${localDate().slice(0, 4)}-01-01`).slice(0, 10);
    const to = String(req.query.to || `${localDate().slice(0, 4)}-12-31`).slice(0, 10);
    res.json({
      data: db.prepare("SELECT calendar_date AS date, day_type AS dayType, holiday_name AS holidayName, note FROM calendar_day_types WHERE calendar_date BETWEEN ? AND ? ORDER BY calendar_date").all(from, to)
    });
  });
  app.put("/api/calendar/day-types/:date", (req, res) => {
    const date = String(req.params.date);
    const dayTypeValue = String(req.body?.dayType || "workday");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !["workday", "restday", "holiday"].includes(dayTypeValue)) return res.status(400).json({
      error: "日期或类型不正确"
    });
    db.prepare(`
      INSERT INTO calendar_day_types (calendar_date, day_type, holiday_name, note, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(calendar_date) DO UPDATE SET
        day_type = excluded.day_type, holiday_name = excluded.holiday_name,
        note = excluded.note, updated_at = excluded.updated_at
    `).run(date, dayTypeValue, req.body?.holidayName || null, req.body?.note || null, new Date().toISOString());
    res.json({
      ok: true
    });
  });
  app.get("/api/calendar/logs", (req, res) => {
    const limit = clamp(req.query.limit, 1, 200, 50);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const total = db.prepare("SELECT COUNT(*) AS count FROM calendar_event_logs").get().count;
    const data = db.prepare(`
      SELECT id, event_id AS eventId, series_id AS seriesId, event_type AS eventType,
        old_value AS oldValue, new_value AS newValue, message,
        occurred_at AS occurredAt FROM calendar_event_logs
      ORDER BY occurred_at DESC, id DESC LIMIT ? OFFSET ?
    `).all(limit, offset);
    res.json({
      data,
      total,
      limit,
      offset
    });
  });
}
export const calendarInternals = {
  datePart,
  timePart,
  localIso,
  taskCalendarItem,
  normalizeRule
};
