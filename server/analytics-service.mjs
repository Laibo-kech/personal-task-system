import crypto from "node:crypto";
import { db } from "./db.mjs";
const APP_VERSION = String(process.env.APP_VERSION || "0.1.0");
const TIME_ZONE = "Asia/Shanghai";
const MAX_METADATA_BYTES = 1024;
const blockedMetadataKey = /(content|title|message|note|clipboard|password|secret|token|cookie|authorization|query|url|link)/i;
function beijingDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function dateDaysAgo(days) {
  return beijingDate(new Date(Date.now() - Math.max(0, days) * 86_400_000));
}
function clipped(value, maximum = 120) {
  return String(value ?? "").trim().slice(0, maximum);
}
function cleanMetadataValue(value, depth = 0) {
  if (depth > 2 || value === null || value === undefined) return null;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return clipped(value, 120);
  if (Array.isArray(value)) return value.slice(0, 20).map(item => cleanMetadataValue(item, depth + 1));
  if (typeof value !== "object") return null;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !blockedMetadataKey.test(key)).slice(0, 24).map(([key, item]) => [clipped(key, 48), cleanMetadataValue(item, depth + 1)]));
}
export function safeAnalyticsMetadata(value) {
  const cleaned = cleanMetadataValue(value || {}) || {};
  const serialized = JSON.stringify(cleaned);
  if (Buffer.byteLength(serialized, "utf8") <= MAX_METADATA_BYTES) return serialized;
  return JSON.stringify({
    truncated: true,
    keys: Object.keys(cleaned).slice(0, 20)
  });
}
function normalizedEvent(input = {}) {
  const occurredAt = input.occurredAt || new Date().toISOString();
  return {
    eventUuid: clipped(input.eventUuid || crypto.randomUUID(), 100),
    occurredAt,
    statDate: beijingDate(new Date(occurredAt)),
    module: clipped(input.module || "system", 40) || "system",
    eventName: clipped(input.eventName || "unknown", 80) || "unknown",
    source: clipped(input.source || "web", 40) || "web",
    result: ["success", "failed", "cancelled"].includes(input.result) ? input.result : "success",
    page: clipped(input.page || "", 80),
    listId: Number.isInteger(Number(input.listId)) && Number(input.listId) > 0 ? Number(input.listId) : null,
    objectType: clipped(input.objectType || "", 40) || null,
    objectId: clipped(input.objectId || "", 80) || null,
    durationMs: Number.isFinite(Number(input.durationMs)) ? Math.max(0, Math.min(Math.round(Number(input.durationMs)), 3_600_000)) : null,
    errorCode: clipped(input.errorCode || "", 100) || null,
    appVersion: clipped(input.appVersion || APP_VERSION, 32) || APP_VERSION,
    deviceType: clipped(input.deviceType || "", 24) || null,
    metadataJson: safeAnalyticsMetadata(input.metadata),
    createdAt: new Date().toISOString()
  };
}
const insertEvent = db.prepare(`
  INSERT OR IGNORE INTO analytics_events (
    event_uuid, occurred_at, module, event_name, source, result, page,
    list_id, object_type, object_id, duration_ms, error_code,
    app_version, device_type, metadata_json, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const upsertDaily = db.prepare(`
  INSERT INTO analytics_daily_stats (
    stat_date, module, event_name, source, result, page, list_id,
    event_count, total_duration_ms, max_duration_ms, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  ON CONFLICT(stat_date, module, event_name, source, result, page, list_id)
  DO UPDATE SET
    event_count = analytics_daily_stats.event_count + 1,
    total_duration_ms = analytics_daily_stats.total_duration_ms + excluded.total_duration_ms,
    max_duration_ms = MAX(analytics_daily_stats.max_duration_ms, excluded.max_duration_ms),
    updated_at = excluded.updated_at
`);
const persistEvent = db.transaction(event => {
  const inserted = insertEvent.run(event.eventUuid, event.occurredAt, event.module, event.eventName, event.source, event.result, event.page, event.listId, event.objectType, event.objectId, event.durationMs, event.errorCode, event.appVersion, event.deviceType, event.metadataJson, event.createdAt);
  if (!inserted.changes) return false;
  const duration = event.durationMs || 0;
  upsertDaily.run(event.statDate, event.module, event.eventName, event.source, event.result, event.page, event.listId || 0, duration, duration, event.createdAt);
  return true;
});
export function trackAnalyticsEvent(input) {
  try {
    return persistEvent(normalizedEvent(input));
  } catch (error) {
    console.error(`analytics write failed: ${error.message}`);
    return false;
  }
}
function deviceTypeForRequest(req) {
  const explicit = clipped(req.headers["x-analytics-device"] || "", 24);
  if (explicit) return explicit;
  const userAgent = String(req.headers["user-agent"] || "");
  return /mobile|android|iphone|ipad/i.test(userAgent) ? "mobile" : "desktop";
}
function normalizedApiPath(req) {
  return String(req.originalUrl || req.url || "").split("?")[0].replace(/\/\d+(?=\/|$)/g, "/:id").replace(/\/\d{4}-\d{2}-\d{2}(?=\/|$)/g, "/:date");
}
function apiEvent(req) {
  const method = req.method.toUpperCase();
  const path = normalizedApiPath(req);
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const fields = Object.keys(body).filter(key => !blockedMetadataKey.test(key)).slice(0, 20);
  const base = {
    eventName: "configuration.update",
    module: "settings",
    objectType: null
  };
  if (path === "/api/tasks" && method === "POST") return {
    module: "task",
    eventName: "task.create",
    objectType: "task"
  };
  if (/^\/api\/tasks\/:id$/.test(path) && method === "PATCH") {
    const status = String(body.status || "");
    if (["已完成", "completed"].includes(status)) return {
      module: "task",
      eventName: "task.complete",
      objectType: "task"
    };
    if (["已废弃", "discarded", "abandoned"].includes(status)) return {
      module: "task",
      eventName: "task.discard",
      objectType: "task"
    };
    if (fields.some(field => ["startAt", "dueAt", "startPrecision", "duePrecision"].includes(field))) return {
      module: "task",
      eventName: "task.schedule",
      objectType: "task"
    };
    return {
      module: "task",
      eventName: "task.update",
      objectType: "task"
    };
  }
  if (/^\/api\/tasks\/:id$/.test(path) && method === "DELETE") return {
    module: "task",
    eventName: "task.delete",
    objectType: "task"
  };
  if (/^\/api\/tasks\/:id\/transfer$/.test(path)) return {
    module: "task",
    eventName: "task.transfer",
    objectType: "task"
  };
  if (path === "/api/tasks/batch") return {
    module: "task",
    eventName: `task.batch.${clipped(body.action || "update", 24)}`,
    objectType: "task"
  };
  if (path.startsWith("/api/filter-templates")) return {
    module: "task",
    eventName: method === "POST" ? "filter_template.create" : method === "DELETE" ? "filter_template.delete" : "filter_template.update",
    objectType: "filter_template"
  };
  if (path === "/api/table-settings") return {
    module: "task",
    eventName: "table.settings_update",
    objectType: "table_view"
  };
  if (path === "/api/calendar/recurrence/preview") return {
    module: "calendar",
    eventName: "recurrence.preview",
    objectType: "calendar_series"
  };
  if (path === "/api/calendar/events" && method === "POST") return {
    module: "calendar",
    eventName: body.recurrence ? "calendar.recurring_create" : "calendar.event_create",
    objectType: "calendar_event"
  };
  if (/^\/api\/calendar\/events\/:id$/.test(path) && method === "PATCH") return {
    module: "calendar",
    eventName: "calendar.event_update",
    objectType: "calendar_event"
  };
  if (/^\/api\/calendar\/events\/:id$/.test(path) && method === "DELETE") return {
    module: "calendar",
    eventName: "calendar.event_cancel",
    objectType: "calendar_event"
  };
  if (/^\/api\/calendar\/events\/:id\/convert-to-task$/.test(path)) return {
    module: "calendar",
    eventName: "calendar.convert_to_task",
    objectType: "calendar_event"
  };
  if (path.startsWith("/api/calendar/settings") || path.startsWith("/api/calendar/day-types")) return {
    module: "calendar",
    eventName: "calendar.settings_update",
    objectType: "calendar_settings"
  };
  if (path.startsWith("/api/sop/")) {
    if (/\/executions\/:id\/complete$/.test(path)) return {
      module: "sop",
      eventName: "sop.execution_complete",
      objectType: "sop_execution"
    };
    if (/\/executions\/:id\//.test(path)) return {
      module: "sop",
      eventName: `sop.execution_${clipped(path.split("/").at(-1), 24)}`,
      objectType: "sop_execution"
    };
    if (path === "/api/sop/batch/complete") return {
      module: "sop",
      eventName: "sop.theme_complete",
      objectType: "sop_theme"
    };
    if (/\/themes\/:id\/trigger$/.test(path)) return {
      module: "sop",
      eventName: "sop.theme_trigger",
      objectType: "sop_theme"
    };
    if (path === "/api/sop/scheduler/run") return {
      module: "sop",
      eventName: "sop.scheduler_run",
      objectType: "sop_scheduler"
    };
    if (path.includes("/themes")) return {
      module: "sop",
      eventName: `sop.theme_${method.toLowerCase()}`,
      objectType: "sop_theme"
    };
    if (path.includes("/events")) return {
      module: "sop",
      eventName: `sop.event_${method.toLowerCase()}`,
      objectType: "sop_event"
    };
    return {
      module: "sop",
      eventName: "sop.configuration_update",
      objectType: "sop"
    };
  }
  if (path.startsWith("/api/lists") || path.startsWith("/api/list-") || path.startsWith("/api/projects") || path.startsWith("/api/tags") || path.startsWith("/api/rules")) {
    return {
      module: "task",
      eventName: "task.configuration_update",
      objectType: "configuration"
    };
  }
  if (path === "/api/settings") return base;
  return {
    module: "system",
    eventName: "api.write",
    objectType: "api"
  };
}
const ANALYTICS_SKIP_POLLING_PATHS = new Set();
export function analyticsRequestMiddleware(req, res, next) {
  const path = normalizedApiPath(req);
  if (path.startsWith("/api/analytics") || path === "/api/health") return next();
  const skipPollingSuccess = ANALYTICS_SKIP_POLLING_PATHS.has(path);
  const startedAt = performance.now();
  res.once("finish", () => {
    const durationMs = Math.round(performance.now() - startedAt);
    const shouldRecord = req.method !== "GET" || res.statusCode >= 400 || durationMs >= 1000;
    if (!shouldRecord) return;
    if (skipPollingSuccess && res.statusCode < 400) return;
    const classified = req.method === "GET" ? {
      module: "system",
      eventName: res.statusCode >= 400 ? "api.read_failed" : "api.slow_read",
      objectType: "api"
    } : apiEvent(req);
    const actualPath = normalizedApiPath(req);
    const objectId = String(req.originalUrl || "").match(/\/(\d+)(?:\/|\?|$)/)?.[1] || null;
    const claimedSource = clipped(req.headers["x-analytics-source"] || "", 40);
    const source = "web";
    setImmediate(() => trackAnalyticsEvent({
      ...classified,
      source,
      result: res.statusCode >= 400 ? "failed" : "success",
      page: clipped(req.headers["x-analytics-page"] || "", 80),
      listId: req.body?.listId || req.query?.listId || null,
      objectId,
      durationMs,
      errorCode: res.statusCode >= 400 ? `http_${res.statusCode}` : null,
      deviceType: deviceTypeForRequest(req),
      metadata: {
        method: req.method,
        path: actualPath,
        status: res.statusCode,
        action: req.body?.action,
        fields: Object.keys(req.body && typeof req.body === "object" ? req.body : {}).filter(key => !blockedMetadataKey.test(key)).slice(0, 20),
        selectedCount: Array.isArray(req.body?.ids) ? req.body.ids.length : undefined
      }
    }));
  });
  next();
}
function percent(value, total) {
  return total ? Math.round(value / total * 1000) / 10 : 100;
}
export function buildAnalyticsOverview({
  days = 30,
  module = "",
  source = ""
} = {}) {
  const safeDays = Math.max(1, Math.min(Number(days) || 30, 365));
  const startDate = dateDaysAgo(safeDays - 1);
  const where = ["stat_date >= ?"];
  const params = [startDate];
  if (module) {
    where.push("module = ?");
    params.push(module);
  }
  if (source) {
    where.push("source = ?");
    params.push(source);
  }
  const predicate = where.join(" AND ");
  const summary = db.prepare(`
    SELECT
      COALESCE(SUM(event_count), 0) AS total,
      COALESCE(SUM(CASE WHEN result = 'success' THEN event_count ELSE 0 END), 0) AS success,
      COALESCE(SUM(CASE WHEN result = 'failed' THEN event_count ELSE 0 END), 0) AS failed,
      COALESCE(SUM(total_duration_ms), 0) AS totalDuration,
      COUNT(DISTINCT stat_date) AS activeDays
    FROM analytics_daily_stats WHERE ${predicate}
  `).get(...params);
  const trend = db.prepare(`
    SELECT stat_date AS date,
      SUM(event_count) AS count,
      SUM(CASE WHEN result = 'success' THEN event_count ELSE 0 END) AS success,
      SUM(CASE WHEN result = 'failed' THEN event_count ELSE 0 END) AS failed
    FROM analytics_daily_stats WHERE ${predicate}
    GROUP BY stat_date ORDER BY stat_date
  `).all(...params);
  const modules = db.prepare(`
    SELECT module AS name, SUM(event_count) AS count
    FROM analytics_daily_stats WHERE ${predicate}
    GROUP BY module ORDER BY count DESC, module LIMIT 12
  `).all(...params);
  const sources = db.prepare(`
    SELECT source AS name, SUM(event_count) AS count
    FROM analytics_daily_stats WHERE ${predicate}
    GROUP BY source ORDER BY count DESC, source LIMIT 12
  `).all(...params);
  const features = db.prepare(`
    SELECT module, event_name AS eventName, SUM(event_count) AS count,
      SUM(CASE WHEN result = 'failed' THEN event_count ELSE 0 END) AS failed
    FROM analytics_daily_stats WHERE ${predicate}
    GROUP BY module, event_name ORDER BY count DESC, event_name LIMIT 20
  `).all(...params);
  const recentParams = [`${startDate}T00:00:00.000Z`];
  const recentWhere = ["occurred_at >= ?", "result = 'failed'"];
  if (module) {
    recentWhere.push("module = ?");
    recentParams.push(module);
  }
  if (source) {
    recentWhere.push("source = ?");
    recentParams.push(source);
  }
  const recentFailures = db.prepare(`
    SELECT id, occurred_at AS occurredAt, module, event_name AS eventName,
      source, page, duration_ms AS durationMs, error_code AS errorCode
    FROM analytics_events WHERE ${recentWhere.join(" AND ")}
    ORDER BY occurred_at DESC LIMIT 20
  `).all(...recentParams);
  const durations = db.prepare(`
    SELECT duration_ms AS durationMs FROM analytics_events
    WHERE occurred_at >= ? AND duration_ms IS NOT NULL
      ${module ? "AND module = ?" : ""} ${source ? "AND source = ?" : ""}
    ORDER BY duration_ms
  `).all(`${startDate}T00:00:00.000Z`, ...(module ? [module] : []), ...(source ? [source] : []));
  const p95Duration = durations.length ? durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))].durationMs : 0;
  const storage = db.prepare(`
    SELECT COUNT(*) AS eventCount,
      COALESCE(SUM(220 + length(module) + length(event_name) + length(source) + length(result) + length(page) + length(metadata_json)), 0) AS payloadBytes
    FROM analytics_events
  `).get();
  const total = Number(summary.total || 0);
  const success = Number(summary.success || 0);
  const failed = Number(summary.failed || 0);
  return {
    range: {
      days: safeDays,
      startDate,
      endDate: beijingDate()
    },
    summary: {
      total,
      success,
      failed,
      successRate: percent(success, total),
      averageDurationMs: total ? Math.round(Number(summary.totalDuration || 0) / total) : 0,
      p95DurationMs: Number(p95Duration || 0),
      activeDays: Number(summary.activeDays || 0)
    },
    trend,
    modules,
    sources,
    features,
    recentFailures,
    storage: {
      eventCount: Number(storage.eventCount || 0),
      estimatedBytes: Math.round(Number(storage.payloadBytes || 0) * 1.6),
      retention: "permanent"
    }
  };
}
export function registerAnalyticsRoutes(app) {
  app.post("/api/analytics/events", (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const inserted = trackAnalyticsEvent({
      eventUuid: body.eventUuid,
      module: body.module,
      eventName: body.eventName,
      source: "web",
      result: body.result,
      page: body.page,
      listId: body.listId,
      objectType: body.objectType,
      objectId: body.objectId,
      durationMs: body.durationMs,
      errorCode: body.errorCode,
      deviceType: deviceTypeForRequest(req),
      metadata: body.metadata
    });
    res.status(inserted ? 201 : 200).json({
      ok: true,
      inserted
    });
  });
  app.get("/api/analytics/overview", (req, res) => {
    res.json(buildAnalyticsOverview({
      days: req.query.days,
      module: req.query.module,
      source: req.query.source
    }));
  });
  app.get("/api/analytics/events", (req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const where = ["1 = 1"];
    const params = [];
    if (req.query.module) {
      where.push("module = ?");
      params.push(clipped(req.query.module, 40));
    }
    if (req.query.source) {
      where.push("source = ?");
      params.push(clipped(req.query.source, 40));
    }
    if (req.query.result) {
      where.push("result = ?");
      params.push(clipped(req.query.result, 16));
    }
    const predicate = where.join(" AND ");
    const total = db.prepare(`SELECT COUNT(*) AS count FROM analytics_events WHERE ${predicate}`).get(...params).count;
    const data = db.prepare(`
      SELECT id, occurred_at AS occurredAt, module, event_name AS eventName,
        source, result, page, list_id AS listId, object_type AS objectType,
        object_id AS objectId, duration_ms AS durationMs, error_code AS errorCode,
        app_version AS appVersion, device_type AS deviceType
      FROM analytics_events WHERE ${predicate}
      ORDER BY occurred_at DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    res.json({
      data,
      total: Number(total),
      limit,
      offset
    });
  });
}
