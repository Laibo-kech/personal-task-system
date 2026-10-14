import { taskColumnOrder } from "./library-sort.mjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import compression from "compression";
import express from "express";
import helmet from "helmet";
import { db, defaultListId, nextTaskNumber, writeTaskLog } from "./db.mjs";
import { registerCalendarRoutes } from "./calendar-service.mjs";
import { registerDocumentRoutes } from "./document-service.mjs";
import { registerSopRoutes, startSopScheduler } from "./sop-service.mjs";
import { analyticsRequestMiddleware, registerAnalyticsRoutes } from "./analytics-service.mjs";
import { normalizeNavigationConfig } from "../src/navigation-config.js";
const app = express();
const port = Number(process.env.PORT || 3000);
const appVersion = String(process.env.APP_VERSION || "0.1.0");
const sessionCookie = process.env.SESSION_COOKIE_NAME || "life_task_session";
const sessionTtl = Number(process.env.SESSION_TTL_SECONDS || 43200);
const adminUsername = process.env.ADMIN_USERNAME || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "";
const isProduction = process.env.NODE_ENV === "production";
const loginAttempts = new Map();
const taskStatuses = new Set(["未完成", "进行中", "已完成", "已废弃", "暂搁置"]);
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 0));
if (!adminPassword || adminPassword.length < 12) throw new Error("请通过 ADMIN_PASSWORD 设置至少 12 位登录密码");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      "default-src": ["'self'"],
      "img-src": ["'self'", "data:"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "script-src": ["'self'"],
      "upgrade-insecure-requests": null
    }
  },
  strictTransportSecurity: false,
  crossOriginOpenerPolicy: false,
  originAgentCluster: false
}));
app.use(compression());
app.use(express.json({
  limit: "1mb"
}));
app.use(express.urlencoded({
  extended: false,
  limit: "64kb"
}));
app.use(express.text({
  type: "text/plain",
  limit: "64kb"
}));
function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map(part => part.trim().split("=")).filter(([key, value]) => key && value).map(([key, ...value]) => [decodeURIComponent(key), decodeURIComponent(value.join("="))]));
}
function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function passwordMatches(input) {
  if (!adminPassword) return false;
  if (adminPassword.startsWith("$2")) {
    return bcrypt.compare(input, adminPassword);
  }
  return safeEqual(input, adminPassword);
}
function authRequired(req, res, next) {
  let token;
  try {
    token = parseCookies(req.headers.cookie)[sessionCookie];
  } catch {
    return res.status(401).json({
      error: "请先登录"
    });
  }
  if (!token) return res.status(401).json({
    error: "请先登录"
  });
  const session = db.prepare("SELECT username FROM sessions WHERE id = ? AND expires_at > ?").get(token, new Date().toISOString());
  if (!session) return res.status(401).json({
    error: "登录已过期"
  });
  req.user = {
    username: session.username
  };
  next();
}
function setSessionCookie(res, token, maxAge = sessionTtl) {
  const attributes = [`${sessionCookie}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (isProduction && process.env.COOKIE_SECURE === "true") {
    attributes.push("Secure");
  }
  res.setHeader("Set-Cookie", attributes.join("; "));
}
function singleValue(value) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
function booleanValue(value) {
  if (typeof value === "boolean") return value ? 1 : 0;
  const normalized = String(singleValue(value) ?? "").toLowerCase();
  return ["1", "true", "yes", "是", "重要", "紧急", "收藏"].includes(normalized) ? 1 : 0;
}
function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}
function beijingDate(value) {
  if (!value) return null;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(parsed);
}
function inferTimePrecision(value, requested) {
  if (!value) return null;
  if (requested === "date" || requested === "datetime") return requested;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return "date";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(parsed);
  return time === "00:00" ? "date" : "datetime";
}
function normalizeTaskTime(value, requestedPrecision) {
  if (!value) return {
    value: null,
    precision: null
  };
  const precision = inferTimePrecision(value, requestedPrecision);
  if (!precision) throw Object.assign(new Error("任务日期时间格式不正确"), {
    status: 400
  });
  if (precision === "date") {
    const date = beijingDate(value);
    if (!date) throw Object.assign(new Error("任务日期格式不正确"), {
      status: 400
    });
    return {
      value: date,
      precision
    };
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw Object.assign(new Error("任务时间格式不正确"), {
    status: 400
  });
  return {
    value: parsed.toISOString(),
    precision
  };
}
function validateTaskTimeRange(start, due) {
  if (!start.value || !due.value) return;
  const startTime = start.precision === "date" ? new Date(`${start.value}T09:00:00+08:00`).getTime() : new Date(start.value).getTime();
  const dueTime = due.precision === "date" ? new Date(`${due.value}T10:00:00+08:00`).getTime() : new Date(due.value).getTime();
  if (startTime > dueTime) throw Object.assign(new Error("开始时间不能晚于截止时间"), {
    status: 400
  });
}
function tableSettingScope(listId) {
  const normalized = Number(listId);
  return normalized ? `list:${normalized}` : "all";
}
function isProjectAvailable(projectId, listId) {
  if (!projectId) return false;
  return Boolean(db.prepare(`
        SELECT id FROM projects
        WHERE id = ? AND active = 1
          AND (list_id = ? OR list_id IS NULL)
      `).get(Number(projectId), Number(listId)));
}
function normalizeProjectId(projectId, listId) {
  const normalized = Number(projectId) || null;
  if (!normalized) return null;
  return isProjectAvailable(normalized, listId) ? normalized : null;
}
function ruleMatches(rule, task) {
  const haystack = String(task[rule.field] ?? "");
  const needle = String(rule.value ?? "");
  if (!needle) return false;
  if (rule.operator === "equals") return haystack === needle;
  if (rule.operator === "startsWith") return haystack.startsWith(needle);
  if (rule.operator === "endsWith") return haystack.endsWith(needle);
  if (rule.operator === "regex") {
    try {
      return new RegExp(needle, "i").test(haystack);
    } catch {
      return false;
    }
  }
  return haystack.toLowerCase().includes(needle.toLowerCase());
}
function applyTaskRules(task) {
  const rules = db.prepare(`
      SELECT id, field, operator, value, actions_json AS actionsJson
      FROM automation_rules
      WHERE list_id = ? AND active = 1
      ORDER BY position, id
    `).all(task.listId);
  const next = {
    ...task,
    tagIds: [...new Set((task.tagIds || []).map(Number).filter(Boolean))]
  };
  for (const rule of rules) {
    if (!ruleMatches(rule, next)) continue;
    const actions = parseJson(rule.actionsJson, {});
    if (actions.status) next.status = String(actions.status);
    if (actions.projectId !== undefined) {
      next.projectId = normalizeProjectId(actions.projectId, next.listId);
    }
    if (actions.starred !== undefined) next.starred = booleanValue(actions.starred);
    if (actions.important !== undefined) next.important = booleanValue(actions.important);
    if (actions.urgent !== undefined) next.urgent = booleanValue(actions.urgent);
    if (Array.isArray(actions.tagIds)) {
      next.tagIds = [...new Set([...next.tagIds, ...actions.tagIds.map(Number).filter(Boolean)])];
    }
  }
  return next;
}
function createTaskRecord({
  title,
  listId,
  payload = {},
  source = "网页手动",
  logSource = "网页操作"
}) {
  let startTime;
  let dueTime;
  startTime = normalizeTaskTime(payload.startAt || null, payload.startPrecision);
  dueTime = normalizeTaskTime(payload.dueAt || null, payload.duePrecision);
  validateTaskTimeRange(startTime, dueTime);
  const now = new Date().toISOString();
  const taskNo = nextTaskNumber();
  const newTask = applyTaskRules({
    title,
    listId,
    status: String(payload.status || "未完成"),
    projectId: normalizeProjectId(payload.projectId, listId),
    startAt: startTime.value,
    dueAt: dueTime.value,
    startPrecision: startTime.precision,
    duePrecision: dueTime.precision,
    starred: booleanValue(payload.starred),
    important: booleanValue(payload.important),
    urgent: booleanValue(payload.urgent),
    isPinned: booleanValue(payload.isPinned),
    source,
    notes: String(payload.notes || ""),
    tagIds: payload.tagIds || []
  });
  const result = db.prepare(`
      INSERT INTO tasks (
        task_no, title, status, list_id, project_id, start_at, due_at,
        start_precision, due_precision,
        completed_at, starred, important, urgent, is_pinned,
        source, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(taskNo, title, newTask.status, listId, newTask.projectId || null, newTask.startAt || null, newTask.dueAt || null, newTask.startPrecision || null, newTask.duePrecision || null, newTask.status === "已完成" ? now : null, newTask.starred, newTask.important, newTask.urgent, newTask.isPinned, newTask.source, newTask.notes, now, now);
  replaceTaskTags(result.lastInsertRowid, newTask.tagIds || []);
  writeTaskLog({
    taskId: result.lastInsertRowid,
    taskNo,
    eventType: "任务新建",
    newValue: newTask.status,
    source: logSource,
    message: title,
    changedFields: {
      title,
      status: newTask.status,
      listId,
      projectId: newTask.projectId || null,
      tagIds: newTask.tagIds || [],
      startAt: newTask.startAt || null,
      dueAt: newTask.dueAt || null,
      startPrecision: newTask.startPrecision || null,
      duePrecision: newTask.duePrecision || null
    }
  });
  return {
    id: result.lastInsertRowid,
    taskNo,
    status: newTask.status
  };
}
function taskSelect() {
  return `
    SELECT
      t.id, t.task_no AS taskNo, t.title, t.status,
      t.start_at AS startAt, t.due_at AS dueAt,
      t.start_precision AS startPrecision, t.due_precision AS duePrecision,
      t.completed_at AS completedAt, t.starred, t.important, t.urgent,
      t.is_pinned AS isPinned,
      t.source, t.notes,
      t.created_at AS createdAt, t.updated_at AS updatedAt,
      l.id AS listId, l.name AS listName, l.color AS listColor,
      p.id AS projectId, p.name AS projectName, p.color AS projectColor,
      COALESCE((
        SELECT json_group_array(json_object(
          'id', tag.id,
          'name', tag.name,
          'color', tag.color
        ) ORDER BY tag.id)
        FROM task_tags task_tag
        JOIN tags tag ON tag.id = task_tag.tag_id
        WHERE task_tag.task_id = t.id AND tag.active = 1
      ), '[]') AS tagsJson
    FROM tasks t
    JOIN lists l ON l.id = t.list_id
    LEFT JOIN projects p ON p.id = t.project_id
  `;
}
function shapeTask(row) {
  if (!row) return null;
  return {
    ...row,
    starred: Boolean(row.starred),
    important: Boolean(row.important),
    urgent: Boolean(row.urgent),
    isPinned: Boolean(row.isPinned),
    tagDetails: parseJson(row.tagsJson, []),
    tags: parseJson(row.tagsJson, []).map(tag => tag.name)
  };
}
app.get("/api/health", (_req, res) => {
  const databaseOk = db.prepare("SELECT 1").pluck().get() === 1;
  res.json({
    ok: databaseOk,
    service: "life-task-system",
    version: appVersion,
    time: new Date().toISOString()
  });
});
app.post("/api/auth/login", async (req, res) => {
  const key = req.ip || "unknown";
  const recent = loginAttempts.get(key) || [];
  const cutoff = Date.now() - 10 * 60 * 1000;
  const active = recent.filter(time => time > cutoff);
  if (active.length >= 8) {
    return res.status(429).json({
      error: "尝试次数过多，请稍后再试"
    });
  }
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const valid = safeEqual(username, adminUsername) && (await passwordMatches(password));
  if (!valid) {
    active.push(Date.now());
    loginAttempts.set(key, active);
    return res.status(401).json({
      error: "账号或密码不正确"
    });
  }
  loginAttempts.delete(key);
  const token = crypto.randomBytes(32).toString("hex");
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + sessionTtl * 1000);
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(createdAt.toISOString());
  db.prepare(`
    INSERT INTO sessions (id, username, created_at, expires_at, ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(token, adminUsername, createdAt.toISOString(), expiresAt.toISOString(), req.ip, req.headers["user-agent"] || "");
  setSessionCookie(res, token);
  res.json({
    username: adminUsername
  });
});
app.get("/api/auth/me", (req, res) => {
  const token = parseCookies(req.headers.cookie)[sessionCookie];
  if (!token) return res.json(null);
  const session = db.prepare("SELECT username FROM sessions WHERE id = ? AND expires_at > ?").get(token, new Date().toISOString());
  if (!session) return res.json(null);
  res.json({
    username: session.username
  });
});
app.post("/api/auth/logout", authRequired, (req, res) => {
  const token = parseCookies(req.headers.cookie)[sessionCookie];
  if (token) db.prepare("DELETE FROM sessions WHERE id = ?").run(token);
  setSessionCookie(res, "", 0);
  res.json({
    ok: true
  });
});
app.use("/api", authRequired);
app.use("/api", analyticsRequestMiddleware);
registerSopRoutes(app);
registerCalendarRoutes(app);
const documentRuntime = registerDocumentRoutes(app);
registerAnalyticsRoutes(app);
app.get("/api/meta", (_req, res) => {
  const lists = db.prepare(`
      SELECT l.id, l.name, l.color, l.position,
        l.is_default AS isDefault, l.is_pinned AS isPinned,
        l.folder_id AS folderId,
        COUNT(t.id) AS taskCount
      FROM lists l
      LEFT JOIN tasks t
        ON t.list_id = l.id AND t.deleted_at IS NULL
      WHERE l.archived_at IS NULL
      GROUP BY l.id
      ORDER BY l.is_pinned DESC, l.position, l.id
    `).all().map(row => ({
    ...row,
    isDefault: Boolean(row.isDefault),
    isPinned: Boolean(row.isPinned)
  }));
  const tags = db.prepare(`
      SELECT id, name, color, list_id AS listId
      FROM tags
      WHERE active = 1
      ORDER BY list_id IS NULL, list_id, name
    `).all();
  const projects = db.prepare("SELECT id, name, color, list_id AS listId FROM projects WHERE active = 1 ORDER BY list_id IS NULL, list_id, name").all();
  const folders = db.prepare(`
      SELECT id, name, position, collapsed
      FROM list_folders
      ORDER BY position, id
    `).all().map(row => ({
    ...row,
    collapsed: Boolean(row.collapsed)
  }));
  const modes = db.prepare(`
      SELECT id, name, position, is_default AS isDefault
      FROM list_modes
      ORDER BY position, id
    `).all().map(row => ({
    ...row,
    isDefault: Boolean(row.isDefault)
  }));
  const modeItems = db.prepare(`
      SELECT mode_id AS modeId, list_id AS listId, position
      FROM list_mode_items
      ORDER BY mode_id, position, list_id
    `).all();
  const settings = Object.fromEntries(db.prepare("SELECT key, value FROM app_settings").all().map(row => [row.key, row.value]));
  res.json({
    lists,
    tags,
    projects,
    folders,
    modes,
    modeItems,
    settings
  });
});
app.patch("/api/settings", (req, res) => {
  const allowed = new Set(["theme_mode", "light_start", "dark_start", "default_task_view", "calendar_date_field", "gantt_start_field", "gantt_end_field", "today_view_scope", "upcoming_view_scope", "task_table_font_size", "sop_table_font_size", "navigation_config"]);
  const body = {
    ...(req.body || {})
  };
  if (Object.prototype.hasOwnProperty.call(body, "navigation_config")) {
    const raw = typeof body.navigation_config === "string" ? body.navigation_config : JSON.stringify(body.navigation_config);
    if (Buffer.byteLength(raw, "utf8") > 16_384) {
      return res.status(400).json({
        error: "导航配置不能超过 16KB"
      });
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.version !== 1 || !Array.isArray(parsed?.groups)) throw new Error("invalid navigation config");
      body.navigation_config = JSON.stringify(normalizeNavigationConfig(parsed));
    } catch {
      return res.status(400).json({
        error: "导航配置格式不正确"
      });
    }
  }
  const entries = Object.entries(body).filter(([key]) => allowed.has(key));
  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);
  const save = db.transaction(() => {
    for (const [key, value] of entries) upsert.run(key, String(value), now);
  });
  save();
  res.json({
    ok: true
  });
});
app.get("/api/table-settings", (req, res) => {
  const scope = tableSettingScope(req.query.listId);
  const row = db.prepare(`
      SELECT scope, visible_columns_json AS visibleColumnsJson,
        column_widths_json AS columnWidthsJson, group_by AS groupBy,
        fill_rules_json AS fillRulesJson, locked, updated_at AS updatedAt
      FROM task_table_settings
      WHERE scope = ?
    `).get(scope);
  res.json({
    scope,
    visibleColumns: parseJson(row?.visibleColumnsJson, []),
    columnWidths: parseJson(row?.columnWidthsJson, {}),
    groupBy: row?.groupBy || "",
    fillRules: parseJson(row?.fillRulesJson, []),
    locked: Boolean(row?.locked),
    updatedAt: row?.updatedAt || null
  });
});
app.patch("/api/table-settings", (req, res) => {
  const scope = tableSettingScope(req.body?.listId);
  const visibleColumns = Array.isArray(req.body?.visibleColumns) ? req.body.visibleColumns.map(String) : [];
  const columnWidths = req.body?.columnWidths && typeof req.body.columnWidths === "object" ? req.body.columnWidths : {};
  const allowedGroups = new Set(["", "list", "status", "priority", "project", "tags"]);
  const groupBy = allowedGroups.has(String(req.body?.groupBy || "")) ? String(req.body?.groupBy || "") : "";
  const fillRules = Array.isArray(req.body?.fillRules) ? req.body.fillRules.slice(0, 30) : [];
  const locked = booleanValue(req.body?.locked);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO task_table_settings
      (scope, visible_columns_json, column_widths_json, group_by,
       fill_rules_json, locked, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope) DO UPDATE SET
      visible_columns_json = excluded.visible_columns_json,
      column_widths_json = excluded.column_widths_json,
      group_by = excluded.group_by,
      fill_rules_json = excluded.fill_rules_json,
      locked = excluded.locked,
      updated_at = excluded.updated_at
  `).run(scope, JSON.stringify(visibleColumns), JSON.stringify(columnWidths), groupBy, JSON.stringify(fillRules), locked, now);
  res.json({
    scope,
    visibleColumns,
    columnWidths,
    groupBy,
    fillRules,
    locked: Boolean(locked),
    updatedAt: now
  });
});
app.get("/api/filter-templates", (req, res) => {
  const listId = Number(req.query.listId);
  if (!listId) return res.json({
    data: []
  });
  const rows = db.prepare(`
      SELECT id, list_id AS listId, name, filters_json AS filtersJson,
        sort, position, created_at AS createdAt, updated_at AS updatedAt
      FROM filter_templates
      WHERE list_id = ?
      ORDER BY position, id
    `).all(listId).map(row => ({
    ...row,
    filters: parseJson(row.filtersJson, {}),
    filtersJson: undefined
  }));
  res.json({
    data: rows
  });
});
app.post("/api/filter-templates", (req, res) => {
  const listId = Number(req.body?.listId);
  const name = String(req.body?.name || "").trim();
  if (!listId || !name) {
    return res.status(400).json({
      error: "模板名称和清单不能为空"
    });
  }
  const list = db.prepare("SELECT id FROM lists WHERE id = ? AND archived_at IS NULL").get(listId);
  if (!list) return res.status(404).json({
    error: "清单不存在"
  });
  const filters = req.body?.filters && typeof req.body.filters === "object" ? req.body.filters : {};
  const sort = String(req.body?.sort || filters.sort || "created");
  const now = new Date().toISOString();
  const position = Number(db.prepare("SELECT MAX(position) FROM filter_templates WHERE list_id = ?").pluck().get(listId)) + 1;
  try {
    const result = db.prepare(`
        INSERT INTO filter_templates
          (list_id, name, filters_json, sort, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(listId, name, JSON.stringify(filters), sort, position, now, now);
    res.status(201).json({
      id: result.lastInsertRowid,
      listId,
      name,
      filters,
      sort,
      position
    });
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      return res.status(409).json({
        error: "当前清单已有同名模板"
      });
    }
    throw error;
  }
});
app.delete("/api/filter-templates/:id", (req, res) => {
  db.prepare("DELETE FROM filter_templates WHERE id = ?").run(req.params.id);
  res.status(204).end();
});
app.get("/api/projects", (req, res) => {
  const listId = Number(req.query.listId);
  const rows = db.prepare(`
      SELECT id, name, color, list_id AS listId, active,
        created_at AS createdAt, updated_at AS updatedAt
      FROM projects
      WHERE active = 1 AND (? = 0 OR list_id = ?)
      ORDER BY name
    `).all(listId || 0, listId || 0).map(row => ({
    ...row,
    active: Boolean(row.active)
  }));
  res.json({
    data: rows
  });
});
app.post("/api/projects", (req, res) => {
  const listId = Number(req.body?.listId);
  const name = String(req.body?.name || "").trim();
  const color = String(req.body?.color || "#2877d4");
  if (!listId || !name) {
    return res.status(400).json({
      error: "项目名称和所属清单不能为空"
    });
  }
  const list = db.prepare("SELECT id FROM lists WHERE id = ? AND archived_at IS NULL").get(listId);
  if (!list) return res.status(404).json({
    error: "清单不存在"
  });
  const now = new Date().toISOString();
  try {
    const result = db.prepare(`
        INSERT INTO projects
          (name, color, list_id, active, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?)
      `).run(name, color, listId, now, now);
    res.status(201).json({
      id: result.lastInsertRowid,
      name,
      color,
      listId
    });
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      return res.status(409).json({
        error: "已有同名项目，请换一个名称"
      });
    }
    throw error;
  }
});
app.patch("/api/projects/:id", (req, res) => {
  const project = db.prepare("SELECT * FROM projects WHERE id = ? AND active = 1").get(req.params.id);
  if (!project) return res.status(404).json({
    error: "项目不存在"
  });
  const name = String(req.body?.name ?? project.name).trim();
  const color = String(req.body?.color ?? project.color);
  const listId = Number(req.body?.listId ?? project.list_id) || project.list_id;
  if (!name || !listId) {
    return res.status(400).json({
      error: "项目名称和所属清单不能为空"
    });
  }
  try {
    db.prepare(`
      UPDATE projects
      SET name = ?, color = ?, list_id = ?, updated_at = ?
      WHERE id = ?
    `).run(name, color, listId, new Date().toISOString(), project.id);
    res.json({
      id: project.id,
      name,
      color,
      listId
    });
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      return res.status(409).json({
        error: "已有同名项目，请换一个名称"
      });
    }
    throw error;
  }
});
app.delete("/api/projects/:id", (req, res) => {
  const project = db.prepare("SELECT id FROM projects WHERE id = ? AND active = 1").get(req.params.id);
  if (!project) return res.status(404).json({
    error: "项目不存在"
  });
  const now = new Date().toISOString();
  const remove = db.transaction(() => {
    db.prepare("UPDATE tasks SET project_id = NULL, updated_at = ? WHERE project_id = ?").run(now, project.id);
    db.prepare("UPDATE projects SET active = 0, updated_at = ? WHERE id = ?").run(now, project.id);
  });
  remove();
  res.status(204).end();
});
app.get("/api/tags", (req, res) => {
  const listId = Number(req.query.listId);
  if (!listId) return res.json({
    data: []
  });
  const rows = db.prepare(`
      SELECT tag.id, tag.name, tag.color, tag.list_id AS listId,
        COUNT(task_tag.task_id) AS taskCount
      FROM tags tag
      LEFT JOIN task_tags task_tag ON task_tag.tag_id = tag.id
      WHERE tag.active = 1 AND (tag.list_id = ? OR tag.list_id IS NULL)
      GROUP BY tag.id
      ORDER BY tag.list_id IS NULL, tag.name
    `).all(listId);
  res.json({
    data: rows
  });
});
app.post("/api/tags", (req, res) => {
  const listId = Number(req.body?.listId);
  const name = String(req.body?.name || "").trim();
  const color = String(req.body?.color || "#77736d");
  if (!listId || !name) {
    return res.status(400).json({
      error: "标签名称和所属清单不能为空"
    });
  }
  const list = db.prepare("SELECT id FROM lists WHERE id = ? AND archived_at IS NULL").get(listId);
  if (!list) return res.status(404).json({
    error: "清单不存在"
  });
  const now = new Date().toISOString();
  try {
    const result = db.prepare(`
      INSERT INTO tags (name, color, list_id, active, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `).run(name, color, listId, now, now);
    res.status(201).json({
      id: result.lastInsertRowid,
      name,
      color,
      listId
    });
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      return res.status(409).json({
        error: "已有同名标签，请换一个名称"
      });
    }
    throw error;
  }
});
app.patch("/api/tags/:id", (req, res) => {
  const tag = db.prepare("SELECT * FROM tags WHERE id = ? AND active = 1").get(req.params.id);
  if (!tag) return res.status(404).json({
    error: "标签不存在"
  });
  const name = String(req.body?.name ?? tag.name).trim();
  const color = String(req.body?.color ?? tag.color);
  const listId = Number(req.body?.listId ?? tag.list_id) || tag.list_id;
  if (!name || !listId) {
    return res.status(400).json({
      error: "标签名称和所属清单不能为空"
    });
  }
  try {
    db.prepare(`
      UPDATE tags SET name = ?, color = ?, list_id = ?, updated_at = ?
      WHERE id = ?
    `).run(name, color, listId, new Date().toISOString(), tag.id);
    res.json({
      id: tag.id,
      name,
      color,
      listId
    });
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      return res.status(409).json({
        error: "已有同名标签，请换一个名称"
      });
    }
    throw error;
  }
});
app.delete("/api/tags/:id", (req, res) => {
  const tag = db.prepare("SELECT * FROM tags WHERE id = ? AND active = 1").get(req.params.id);
  if (!tag) return res.status(404).json({
    error: "标签不存在"
  });
  const affected = db.prepare("SELECT task_id AS taskId FROM task_tags WHERE tag_id = ?").all(tag.id);
  const now = new Date().toISOString();
  const remove = db.transaction(() => {
    db.prepare("DELETE FROM task_tags WHERE tag_id = ?").run(tag.id);
    db.prepare("UPDATE tags SET active = 0, updated_at = ? WHERE id = ?").run(now, tag.id);
    for (const item of affected) {
      const task = db.prepare("SELECT task_no AS taskNo FROM tasks WHERE id = ?").get(item.taskId);
      writeTaskLog({
        taskId: item.taskId,
        taskNo: task?.taskNo,
        eventType: "标签",
        oldValue: tag.name,
        newValue: "",
        message: `标签“${tag.name}”已停用`
      });
    }
  });
  remove();
  res.status(204).end();
});
app.get("/api/rules", (req, res) => {
  const listId = Number(req.query.listId);
  if (!listId) return res.json({
    data: []
  });
  const rows = db.prepare(`
      SELECT id, list_id AS listId, name, field, operator, value,
        actions_json AS actionsJson, active, position,
        created_at AS createdAt, updated_at AS updatedAt
      FROM automation_rules
      WHERE list_id = ?
      ORDER BY active DESC, position, id
    `).all(listId).map(row => ({
    ...row,
    active: Boolean(row.active),
    actions: parseJson(row.actionsJson, {}),
    actionsJson: undefined
  }));
  res.json({
    data: rows
  });
});
app.post("/api/rules", (req, res) => {
  const listId = Number(req.body?.listId);
  const name = String(req.body?.name || "").trim();
  const field = String(req.body?.field || "title");
  const operator = String(req.body?.operator || "contains");
  const value = String(req.body?.value || "").trim();
  const actions = req.body?.actions && typeof req.body.actions === "object" ? req.body.actions : {};
  if (!listId || !name || !value) {
    return res.status(400).json({
      error: "规则名称、清单和条件不能为空"
    });
  }
  const now = new Date().toISOString();
  const position = Number(db.prepare("SELECT MAX(position) FROM automation_rules WHERE list_id = ?").pluck().get(listId)) + 1;
  const result = db.prepare(`
      INSERT INTO automation_rules
        (list_id, name, field, operator, value, actions_json, active, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(listId, name, field, operator, value, JSON.stringify(actions), booleanValue(req.body?.active ?? true), position, now, now);
  res.status(201).json({
    id: result.lastInsertRowid,
    listId,
    name,
    field,
    operator,
    value,
    actions,
    active: booleanValue(req.body?.active ?? true) === 1,
    position
  });
});
app.patch("/api/rules/:id", (req, res) => {
  const rule = db.prepare("SELECT * FROM automation_rules WHERE id = ?").get(req.params.id);
  if (!rule) return res.status(404).json({
    error: "规则不存在"
  });
  const next = {
    name: String(req.body?.name ?? rule.name).trim(),
    field: String(req.body?.field ?? rule.field),
    operator: String(req.body?.operator ?? rule.operator),
    value: String(req.body?.value ?? rule.value).trim(),
    actions: req.body?.actions && typeof req.body.actions === "object" ? req.body.actions : parseJson(rule.actions_json, {}),
    active: req.body?.active === undefined ? rule.active : booleanValue(req.body.active)
  };
  if (!next.name || !next.value) {
    return res.status(400).json({
      error: "规则名称和条件不能为空"
    });
  }
  db.prepare(`
    UPDATE automation_rules
    SET name = ?, field = ?, operator = ?, value = ?,
      actions_json = ?, active = ?, updated_at = ?
    WHERE id = ?
  `).run(next.name, next.field, next.operator, next.value, JSON.stringify(next.actions), next.active, new Date().toISOString(), rule.id);
  res.json({
    id: rule.id,
    ...next,
    active: Boolean(next.active)
  });
});
app.delete("/api/rules/:id", (req, res) => {
  db.prepare("DELETE FROM automation_rules WHERE id = ?").run(req.params.id);
  res.status(204).end();
});
app.post("/api/list-folders", (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({
    error: "文件夹名称不能为空"
  });
  const now = new Date().toISOString();
  const position = Number(db.prepare("SELECT MAX(position) FROM list_folders").pluck().get()) + 1;
  try {
    const result = db.prepare(`
        INSERT INTO list_folders
          (name, position, collapsed, created_at, updated_at)
        VALUES (?, ?, 0, ?, ?)
      `).run(name, position, now, now);
    res.status(201).json({
      id: result.lastInsertRowid,
      name,
      position
    });
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      return res.status(409).json({
        error: "已经有同名文件夹"
      });
    }
    throw error;
  }
});
app.patch("/api/list-folders/:id", (req, res) => {
  const folder = db.prepare("SELECT * FROM list_folders WHERE id = ?").get(req.params.id);
  if (!folder) return res.status(404).json({
    error: "文件夹不存在"
  });
  const name = String(req.body?.name ?? folder.name).trim();
  const collapsed = req.body?.collapsed === undefined ? folder.collapsed : booleanValue(req.body.collapsed);
  db.prepare(`
    UPDATE list_folders
    SET name = ?, collapsed = ?, updated_at = ?
    WHERE id = ?
  `).run(name, collapsed, new Date().toISOString(), folder.id);
  res.json({
    id: folder.id,
    name,
    collapsed: Boolean(collapsed)
  });
});
app.delete("/api/list-folders/:id", (req, res) => {
  const folder = db.prepare("SELECT id FROM list_folders WHERE id = ?").get(req.params.id);
  if (!folder) return res.status(404).json({
    error: "文件夹不存在"
  });
  const remove = db.transaction(() => {
    db.prepare("UPDATE lists SET folder_id = NULL WHERE folder_id = ?").run(folder.id);
    db.prepare("DELETE FROM list_folders WHERE id = ?").run(folder.id);
  });
  remove();
  res.status(204).end();
});
app.post("/api/list-modes", (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({
    error: "模式名称不能为空"
  });
  const now = new Date().toISOString();
  const position = Number(db.prepare("SELECT MAX(position) FROM list_modes").pluck().get()) + 1;
  try {
    const result = db.prepare(`
        INSERT INTO list_modes
          (name, position, is_default, created_at, updated_at)
        VALUES (?, ?, 0, ?, ?)
      `).run(name, position, now, now);
    res.status(201).json({
      id: result.lastInsertRowid,
      name,
      position
    });
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      return res.status(409).json({
        error: "已经有同名模式"
      });
    }
    throw error;
  }
});
app.put("/api/list-modes/:id/lists", (req, res) => {
  const mode = db.prepare("SELECT id FROM list_modes WHERE id = ?").get(req.params.id);
  if (!mode) return res.status(404).json({
    error: "清单模式不存在"
  });
  const listIds = [...new Set((req.body?.listIds || []).map(Number))].filter(Boolean);
  const replace = db.transaction(() => {
    db.prepare("DELETE FROM list_mode_items WHERE mode_id = ?").run(mode.id);
    const insert = db.prepare(`
      INSERT INTO list_mode_items (mode_id, list_id, position)
      VALUES (?, ?, ?)
    `);
    listIds.forEach((listId, index) => insert.run(mode.id, listId, index));
  });
  replace();
  res.json({
    ok: true
  });
});
app.delete("/api/list-modes/:id", (req, res) => {
  const mode = db.prepare("SELECT * FROM list_modes WHERE id = ?").get(req.params.id);
  if (!mode) return res.status(404).json({
    error: "清单模式不存在"
  });
  if (mode.is_default) {
    return res.status(400).json({
      error: "默认模式不能删除"
    });
  }
  db.prepare("DELETE FROM list_modes WHERE id = ?").run(mode.id);
  res.status(204).end();
});
app.put("/api/lists/reorder", (req, res) => {
  const modeId = Number(req.body?.modeId);
  const listIds = [...new Set((req.body?.listIds || []).map(Number))].filter(Boolean);
  if (!modeId || listIds.length === 0) {
    return res.status(400).json({
      error: "排序数据不完整"
    });
  }
  const updateModeItem = db.prepare(`
    INSERT INTO list_mode_items (mode_id, list_id, position)
    VALUES (?, ?, ?)
    ON CONFLICT(mode_id, list_id) DO UPDATE SET position = excluded.position
  `);
  const reorder = db.transaction(() => {
    listIds.forEach((listId, index) => {
      updateModeItem.run(modeId, listId, index);
      db.prepare("UPDATE lists SET position = ? WHERE id = ?").run(index, listId);
    });
  });
  reorder();
  res.json({
    ok: true
  });
});
app.post("/api/lists", (req, res) => {
  const name = String(req.body?.name || "").trim();
  const color = String(req.body?.color || "#77736d");
  if (!name) return res.status(400).json({
    error: "清单名称不能为空"
  });
  const now = new Date().toISOString();
  try {
    const position = Number(db.prepare("SELECT MAX(position) FROM lists").pluck().get()) + 1;
    const result = db.prepare(`
        INSERT INTO lists (name, color, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(name, color, position, now, now);
    const defaultModeId = db.prepare("SELECT id FROM list_modes WHERE is_default = 1 LIMIT 1").pluck().get();
    db.prepare(`
      INSERT OR IGNORE INTO list_mode_items (mode_id, list_id, position)
      VALUES (?, ?, ?)
    `).run(defaultModeId, result.lastInsertRowid, position);
    res.status(201).json({
      id: result.lastInsertRowid,
      name,
      color
    });
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      return res.status(409).json({
        error: "已经有同名清单"
      });
    }
    throw error;
  }
});
app.patch("/api/lists/:id", (req, res) => {
  const current = db.prepare("SELECT * FROM lists WHERE id = ? AND archived_at IS NULL").get(req.params.id);
  if (!current) return res.status(404).json({
    error: "清单不存在"
  });
  const name = String(req.body?.name ?? current.name).trim();
  const color = String(req.body?.color ?? current.color);
  const folderId = req.body?.folderId === null ? null : Number(req.body?.folderId ?? current.folder_id) || null;
  const isPinned = req.body?.isPinned === undefined ? current.is_pinned : booleanValue(req.body.isPinned);
  db.prepare(`
    UPDATE lists
    SET name = ?, color = ?, folder_id = ?, is_pinned = ?, updated_at = ?
    WHERE id = ?
  `).run(name, color, folderId, isPinned, new Date().toISOString(), current.id);
  res.json({
    id: current.id,
    name,
    color,
    folderId,
    isPinned: Boolean(isPinned)
  });
});
app.delete("/api/lists/:id", (req, res) => {
  const list = db.prepare("SELECT * FROM lists WHERE id = ?").get(req.params.id);
  if (!list) return res.status(404).json({
    error: "清单不存在"
  });
  if (list.is_default) {
    return res.status(400).json({
      error: "默认清单不能归档"
    });
  }
  const count = db.prepare("SELECT COUNT(*) FROM tasks WHERE list_id = ? AND deleted_at IS NULL").pluck().get(list.id);
  if (count > 0) {
    return res.status(409).json({
      error: "请先移动该清单里的任务"
    });
  }
  db.prepare("UPDATE lists SET archived_at = ? WHERE id = ?").run(new Date().toISOString(), list.id);
  res.status(204).end();
});
function shiftDate(date, amount) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
function dynamicDateRange(preset, today) {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const monthStart = `${today.slice(0, 8)}01`;
  const monthEndDate = new Date(`${monthStart}T12:00:00Z`);
  monthEndDate.setUTCMonth(monthEndDate.getUTCMonth() + 1);
  monthEndDate.setUTCDate(0);
  const monthEnd = monthEndDate.toISOString().slice(0, 10);
  const ranges = {
    today: [today, today],
    yesterday: [shiftDate(today, -1), shiftDate(today, -1)],
    tomorrow: [shiftDate(today, 1), shiftDate(today, 1)],
    last7: [shiftDate(today, -6), today],
    last30: [shiftDate(today, -29), today],
    thisWeek: [shiftDate(today, mondayOffset), shiftDate(today, mondayOffset + 6)],
    lastWeek: [shiftDate(today, mondayOffset - 7), shiftDate(today, mondayOffset - 1)],
    thisMonth: [monthStart, monthEnd],
    next7: [today, shiftDate(today, 6)],
    next30: [today, shiftDate(today, 29)],
    thisYear: [`${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`],
    lastYear: [`${Number(today.slice(0, 4)) - 1}-01-01`, `${Number(today.slice(0, 4)) - 1}-12-31`]
  };
  return ranges[String(preset || "")] || null;
}
const advancedTaskFields = {
  title: {
    type: "text",
    expression: "t.title"
  },
  status: {
    type: "select",
    expression: "t.status"
  },
  listId: {
    type: "select",
    expression: "t.list_id"
  },
  projectId: {
    type: "select",
    expression: "t.project_id"
  },
  startAt: {
    type: "date",
    expression: "substr(t.start_at, 1, 10)"
  },
  dueAt: {
    type: "date",
    expression: "substr(t.due_at, 1, 10)"
  },
  createdAt: {
    type: "date",
    expression: "date(t.created_at, '+8 hours')"
  },
  updatedAt: {
    type: "date",
    expression: "date(t.updated_at, '+8 hours')"
  },
  completedAt: {
    type: "date",
    expression: "date(t.completed_at, '+8 hours')"
  },
  source: {
    type: "text",
    expression: "t.source"
  },
  taskNo: {
    type: "text",
    expression: "t.task_no"
  },
  databaseId: {
    type: "number",
    expression: "t.id"
  },
  notes: {
    type: "text",
    expression: "t.notes"
  },
  starred: {
    type: "boolean",
    expression: "t.starred"
  },
  important: {
    type: "boolean",
    expression: "t.important"
  },
  urgent: {
    type: "boolean",
    expression: "t.urgent"
  },
  isPinned: {
    type: "boolean",
    expression: "t.is_pinned"
  }
};
function advancedTaskCondition(condition, values, today) {
  const field = String(condition?.field || "");
  const operator = String(condition?.operator || "");
  const definition = advancedTaskFields[field];
  if (!definition && !["tagId", "priority"].includes(field)) return "";
  const value = condition?.value;
  const value2 = condition?.value2;
  if (field === "tagId") {
    if (operator === "is_empty") return "NOT EXISTS (SELECT 1 FROM task_tags aft WHERE aft.task_id = t.id)";
    if (operator === "not_empty") return "EXISTS (SELECT 1 FROM task_tags aft WHERE aft.task_id = t.id)";
    if (!["equals", "not_equals"].includes(operator) || !Number(value)) return "";
    values.push(Number(value));
    const exists = "EXISTS (SELECT 1 FROM task_tags aft WHERE aft.task_id = t.id AND aft.tag_id = ?)";
    return operator === "not_equals" ? `NOT ${exists}` : exists;
  }
  if (field === "priority") {
    const map = {
      normal: "t.important = 0 AND t.urgent = 0",
      important: "t.important = 1 AND t.urgent = 0",
      urgent: "t.important = 0 AND t.urgent = 1",
      both: "t.important = 1 AND t.urgent = 1"
    };
    const expression = map[String(value || "")];
    if (!expression) return "";
    return operator === "not_equals" ? `NOT (${expression})` : `(${expression})`;
  }
  const expression = definition.expression;
  if (operator === "is_empty") return `${expression} IS NULL OR ${expression} = ''`;
  if (operator === "not_empty") return `${expression} IS NOT NULL AND ${expression} != ''`;
  if (definition.type === "boolean") {
    if (operator === "is_true") return `${expression} = 1`;
    if (operator === "is_false") return `${expression} = 0`;
    return "";
  }
  if (definition.type === "text") {
    const text = String(value ?? "");
    if (!["contains", "not_contains", "equals", "not_equals", "starts_with", "ends_with"].includes(operator)) return "";
    if (operator === "contains" || operator === "not_contains") {
      values.push(`%${text}%`);
      return `${operator === "not_contains" ? "COALESCE(" : ""}${expression}${operator === "not_contains" ? ", '') NOT" : ""} LIKE ?`;
    }
    if (operator === "starts_with") {
      values.push(`${text}%`);
      return `${expression} LIKE ?`;
    }
    if (operator === "ends_with") {
      values.push(`%${text}`);
      return `${expression} LIKE ?`;
    }
    values.push(text);
    return operator === "not_equals" ? `COALESCE(${expression}, '') != ?` : `${expression} = ?`;
  }
  if (definition.type === "select") {
    if (!["equals", "not_equals"].includes(operator)) return "";
    const normalized = ["listId", "projectId"].includes(field) ? Number(value) : String(value ?? "");
    if (["listId", "projectId"].includes(field) && !normalized) return "";
    values.push(normalized);
    return operator === "not_equals" ? `COALESCE(${expression}, '') != ?` : `${expression} = ?`;
  }
  if (definition.type === "number") {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    const operators = {
      equals: "=",
      not_equals: "!=",
      greater: ">",
      greater_equal: ">=",
      less: "<",
      less_equal: "<="
    };
    if (operator === "between") {
      const second = Number(value2);
      if (!Number.isFinite(second)) return "";
      values.push(Math.min(number, second), Math.max(number, second));
      return `${expression} BETWEEN ? AND ?`;
    }
    if (!operators[operator]) return "";
    values.push(number);
    return `${expression} ${operators[operator]} ?`;
  }
  if (definition.type === "date") {
    if (["in_preset", "not_in_preset"].includes(operator)) {
      const range = dynamicDateRange(value, today);
      if (!range) return "";
      values.push(range[0], range[1]);
      return operator === "not_in_preset" ? `(${expression} IS NULL OR ${expression} NOT BETWEEN ? AND ?)` : `${expression} BETWEEN ? AND ?`;
    }
    const day = String(value || "").slice(0, 10);
    if (!day) return "";
    if (operator === "between") {
      const second = String(value2 || "").slice(0, 10);
      if (!second) return "";
      values.push(day < second ? day : second, day < second ? second : day);
      return `${expression} BETWEEN ? AND ?`;
    }
    const operators = {
      on: "=",
      not_on: "!=",
      before: "<",
      on_or_before: "<=",
      after: ">",
      on_or_after: ">="
    };
    if (!operators[operator]) return "";
    values.push(day);
    return operator === "not_on" ? `COALESCE(${expression}, '') != ?` : `${expression} ${operators[operator]} ?`;
  }
  return "";
}
function applyAdvancedTaskFilters({
  conditions,
  values,
  raw,
  today
}) {
  if (!raw) return;
  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return;
  }
  const fragments = (Array.isArray(parsed?.conditions) ? parsed.conditions : []).slice(0, 30).map(condition => advancedTaskCondition(condition, values, today)).filter(Boolean);
  if (!fragments.length) return;
  const joiner = parsed.logic === "or" ? " OR " : " AND ";
  conditions.push(`(${fragments.map(fragment => `(${fragment})`).join(joiner)})`);
}
function applyTaskDateFilter({
  conditions,
  values,
  query,
  column,
  prefix,
  today
}) {
  const range = dynamicDateRange(query[`${prefix}Preset`], today);
  const from = range?.[0] || (query[`${prefix}From`] ? String(query[`${prefix}From`]).slice(0, 10) : "");
  const to = range?.[1] || (query[`${prefix}To`] ? String(query[`${prefix}To`]).slice(0, 10) : "");
  if (from) {
    conditions.push(`${column} >= ?`);
    values.push(from);
  }
  if (to) {
    conditions.push(`${column} <= ?`);
    values.push(to);
  }
}
function taskGroupSelect(groupBy, where) {
  const priority = `CASE WHEN t.important AND t.urgent THEN '重要且紧急'
    WHEN t.urgent THEN '紧急' WHEN t.important THEN '重要' ELSE '普通' END`;
  const definitions = {
    list: ["CAST(l.id AS TEXT)", "l.name", "l.color"],
    status: ["t.status", "t.status", "'#77736d'"],
    priority: [priority, priority, "'#77736d'"],
    project: ["COALESCE(CAST(p.id AS TEXT), 'none')", "COALESCE(p.name, '未归属')", "CASE WHEN p.id IS NULL THEN '#77736d' ELSE COALESCE(NULLIF(p.color, ''), l.color) END"],
    tags: ["COALESCE(CAST(first_tag.id AS TEXT), 'none')", "COALESCE(first_tag.name, '未归属')", "COALESCE(first_tag.color, '#77736d')"]
  };
  if (!Object.hasOwn(definitions, groupBy)) return "";
  const [key, label, color] = definitions[groupBy];
  return `
    SELECT t.id AS taskId, ${key} AS groupKey, ${label} AS groupLabel, ${color} AS groupColor
    FROM tasks t
    JOIN lists l ON l.id = t.list_id
    LEFT JOIN projects p ON p.id = t.project_id
    ${groupBy === "tags" ? `LEFT JOIN tags first_tag ON first_tag.id = (
      SELECT tag.id FROM task_tags task_tag JOIN tags tag ON tag.id = task_tag.tag_id
      WHERE task_tag.task_id = t.id AND tag.active = 1 ORDER BY tag.id LIMIT 1
    )` : ""}
    WHERE ${where}
  `;
}
app.get("/api/tasks", (req, res) => {
  const conditions = ["t.deleted_at IS NULL"];
  const values = [];
  const view = String(req.query.view || "all");
  const today = new Date().toLocaleDateString("sv-SE", {
    timeZone: "Asia/Shanghai"
  });
  const smartField = String(req.query.smartField || "");
  const smartMode = String(req.query.smartMode || "");
  const smartDays = Math.max(1, Math.min(Number(req.query.smartDays) || 1, 365));
  const smartColumns = {
    due: "substr(t.due_at, 1, 10)",
    start: "substr(t.start_at, 1, 10)",
    created: "date(t.created_at, '+8 hours')",
    updated: "date(t.updated_at, '+8 hours')",
    completed: "date(t.completed_at, '+8 hours')"
  };
  if (["today", "upcoming"].includes(view) && smartColumns[smartField] && smartMode) {
    const ranges = {
      today: [today, today],
      yesterday: [shiftDate(today, -1), shiftDate(today, -1)],
      last: [shiftDate(today, -(smartDays - 1)), today],
      next: [today, shiftDate(today, smartDays - 1)],
      future: [shiftDate(today, 1), shiftDate(today, smartDays)]
    };
    const range = ranges[smartMode] || ranges.today;
    conditions.push(`${smartColumns[smartField]} BETWEEN ? AND ?`);
    values.push(range[0], range[1]);
    if (req.query.smartOpen === "true") conditions.push("t.status NOT IN ('已完成', '已废弃')");
  } else if (view === "today") {
    conditions.push("substr(t.due_at, 1, 10) = ?");
    values.push(today);
  } else if (view === "upcoming") {
    conditions.push("substr(t.due_at, 1, 10) > ? AND t.status NOT IN ('已完成', '已废弃')");
    values.push(today);
  } else if (view === "inbox") {
    conditions.push("t.due_at IS NULL");
  } else if (view === "starred") {
    conditions.push("t.starred = 1");
  }
  if (req.query.listId) {
    conditions.push("t.list_id = ?");
    values.push(Number(req.query.listId));
  }
  if (req.query.status) {
    conditions.push("t.status = ?");
    values.push(String(req.query.status));
  }
  if (req.query.projectId === "none") conditions.push("t.project_id IS NULL");else if (req.query.projectId) {
    conditions.push("t.project_id = ?");
    values.push(Number(req.query.projectId));
  }
  const priorityFlags = {
    "重要且紧急": [1, 1],
    "紧急": [0, 1],
    "重要": [1, 0],
    "普通": [0, 0]
  };
  if (Object.hasOwn(priorityFlags, String(req.query.priority))) {
    conditions.push("t.important = ? AND t.urgent = ?");
    values.push(...priorityFlags[req.query.priority]);
  }
  if (req.query.tagId) {
    conditions.push(`EXISTS (
      SELECT 1 FROM task_tags filter_tt
      WHERE filter_tt.task_id = t.id AND filter_tt.tag_id = ?
    )`);
    values.push(Number(req.query.tagId));
  }
  if (req.query.source) {
    conditions.push("t.source LIKE ?");
    values.push(`%${String(req.query.source).trim()}%`);
  }
  if (req.query.taskNo) {
    conditions.push("t.task_no LIKE ?");
    values.push(`%${String(req.query.taskNo).trim()}%`);
  }
  if (req.query.databaseId) {
    conditions.push("t.id = ?");
    values.push(Number(req.query.databaseId));
  }
  applyTaskDateFilter({
    conditions,
    values,
    query: req.query,
    column: "substr(t.start_at, 1, 10)",
    prefix: "start",
    today
  });
  applyTaskDateFilter({
    conditions,
    values,
    query: req.query,
    column: "substr(t.due_at, 1, 10)",
    prefix: "due",
    today
  });
  applyTaskDateFilter({
    conditions,
    values,
    query: req.query,
    column: "date(t.created_at, '+8 hours')",
    prefix: "created",
    today
  });
  if (req.query.starred === "true") conditions.push("t.starred = 1");
  if (req.query.important === "true") conditions.push("t.important = 1");
  if (req.query.urgent === "true") conditions.push("t.urgent = 1");
  if (req.query.q) {
    const query = String(req.query.q).trim();
    const databaseId = /^#?(\d+)$/.exec(query);
    const matchId = databaseId && Number.isSafeInteger(Number(databaseId[1]));
    conditions.push(`(t.title LIKE ? OR t.task_no LIKE ? OR t.notes LIKE ?${matchId ? " OR t.id = ?" : ""})`);
    const pattern = `%${query}%`;
    values.push(pattern, pattern, pattern);
    if (matchId) values.push(Number(databaseId[1]));
  }
  applyAdvancedTaskFilters({
    conditions,
    values,
    raw: req.query.filter,
    today
  });
  const allowedSorts = {
    updated: "t.updated_at DESC",
    created: "t.created_at DESC",
    due: "t.due_at IS NULL, t.due_at ASC",
    number: "t.id DESC"
  };
  const columnOrder = taskColumnOrder(req.query.sort);
  const orderBy = columnOrder || allowedSorts[req.query.sort] || allowedSorts.created;
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const where = conditions.join(" AND ");
  const total = db.prepare(`SELECT COUNT(*) FROM tasks t WHERE ${where}`).pluck().get(...values);
  const groupBy = String(req.query.groupBy || "");
  const groupSelect = taskGroupSelect(groupBy, where);
  let groups;
  let prefix = "";
  let joins = "";
  let rowWhere = `WHERE ${where}`;
  let groupOrder = "";
  let rowValues = values;
  if (groupSelect) {
    groups = db.prepare(`
      SELECT groupKey AS key, groupLabel AS label, MIN(groupColor) AS color, COUNT(*) AS count
      FROM (${groupSelect}) GROUP BY groupKey, groupLabel
    `).all(...values).sort((left, right) => left.count - right.count || left.label.localeCompare(right.label, "zh-CN") || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
    let groupOffset = 0;
    groups = groups.map(group => {
      const result = {
        ...group,
        offset: groupOffset
      };
      groupOffset += group.count;
      return result;
    });
    prefix = `WITH filtered_task_groups AS (${groupSelect})`;
    joins = `JOIN filtered_task_groups task_group ON task_group.taskId = t.id
      JOIN json_each(?) group_order ON group_order.value = task_group.groupKey`;
    rowWhere = "";
    groupOrder = "CAST(group_order.key AS INTEGER), ";
    rowValues = [...values, JSON.stringify(groups.map(group => group.key))];
  }
  const rows = db.prepare(`
      ${prefix}
      ${taskSelect()}
      ${joins}
      ${rowWhere}
      GROUP BY t.id
      ORDER BY ${groupOrder}${columnOrder ? "" : "t.is_pinned DESC, "}${orderBy}, t.id DESC
      LIMIT ? OFFSET ?
    `).all(...rowValues, limit, offset).map(shapeTask);
  res.json({
    data: rows,
    total,
    limit,
    offset,
    ...(groups ? {
      groupBy,
      groups
    } : {})
  });
});
const taskDateColumns = {
  startAt: "t.start_at",
  dueAt: "t.due_at",
  createdAt: "t.created_at",
  updatedAt: "t.updated_at",
  completedAt: "t.completed_at"
};
app.get("/api/task-schedule", (req, res) => {
  const startField = taskDateColumns[req.query.startField] || "t.start_at";
  const endField = taskDateColumns[req.query.endField] || "t.due_at";
  const conditions = ["t.deleted_at IS NULL", `(${startField} IS NOT NULL OR ${endField} IS NOT NULL)`];
  const values = [];
  if (req.query.listId) {
    conditions.push("t.list_id = ?");
    values.push(Number(req.query.listId));
  }
  if (req.query.from) {
    conditions.push(`substr(COALESCE(${endField}, ${startField}), 1, 10) >= ?`);
    values.push(String(req.query.from).slice(0, 10));
  }
  if (req.query.to) {
    conditions.push(`substr(COALESCE(${startField}, ${endField}), 1, 10) < ?`);
    values.push(String(req.query.to).slice(0, 10));
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 1000, 1), 2000);
  const rows = db.prepare(`
      ${taskSelect()}
      WHERE ${conditions.join(" AND ")}
      GROUP BY t.id
      ORDER BY COALESCE(${startField}, ${endField}) ASC, t.id DESC
      LIMIT ?
    `).all(...values, limit).map(shapeTask);
  res.json({
    data: rows,
    limit
  });
});
app.get("/api/tasks/:id", (req, res) => {
  const row = db.prepare(`
      ${taskSelect()}
      WHERE t.id = ? AND t.deleted_at IS NULL
      GROUP BY t.id
    `).get(req.params.id);
  if (!row) return res.status(404).json({
    error: "任务不存在"
  });
  res.json(shapeTask(row));
});
app.post("/api/tasks", (req, res) => {
  const rawTitle = typeof req.body?.title === "string" ? req.body.title : String(req.body?.title || "");
  const preserveTitle = req.user?.internal && req.headers["x-preserve-task-title"] === "1";
  const title = preserveTitle ? rawTitle : rawTitle.trim();
  if (!title.trim()) return res.status(400).json({
    error: "任务内容不能为空"
  });
  let startTime;
  let dueTime;
  try {
    startTime = normalizeTaskTime(req.body?.startAt || null, req.body?.startPrecision);
    dueTime = normalizeTaskTime(req.body?.dueAt || null, req.body?.duePrecision);
    validateTaskTimeRange(startTime, dueTime);
  } catch (error) {
    return res.status(error.status || 400).json({
      error: error.message
    });
  }
  const now = new Date().toISOString();
  const taskNo = nextTaskNumber();
  const listId = Number(req.body?.listId) || defaultListId();
  const newTask = applyTaskRules({
    title,
    listId,
    status: String(req.body?.status || "未完成"),
    projectId: normalizeProjectId(req.body?.projectId, listId),
    startAt: startTime.value,
    dueAt: dueTime.value,
    startPrecision: startTime.precision,
    duePrecision: dueTime.precision,
    starred: booleanValue(req.body?.starred),
    important: booleanValue(req.body?.important),
    urgent: booleanValue(req.body?.urgent),
    isPinned: booleanValue(req.body?.isPinned),
    source: String(req.body?.source || "网页手动"),
    notes: String(req.body?.notes || ""),
    tagIds: req.body?.tagIds || []
  });
  const result = db.prepare(`
      INSERT INTO tasks (
        task_no, title, status, list_id, project_id, start_at, due_at,
        start_precision, due_precision,
        completed_at, starred, important, urgent, is_pinned,
        source, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(taskNo, title, newTask.status, listId, newTask.projectId || null, newTask.startAt || null, newTask.dueAt || null, newTask.startPrecision || null, newTask.duePrecision || null, newTask.status === "已完成" ? now : null, newTask.starred, newTask.important, newTask.urgent, newTask.isPinned, newTask.source, newTask.notes, now, now);
  replaceTaskTags(result.lastInsertRowid, newTask.tagIds || []);
  writeTaskLog({
    taskId: result.lastInsertRowid,
    taskNo,
    eventType: "任务新建",
    newValue: newTask.status,
    source: "\u7F51\u9875\u64CD\u4F5C",
    message: title,
    changedFields: {
      title,
      status: newTask.status,
      listId,
      projectId: newTask.projectId || null,
      tagIds: newTask.tagIds || [],
      startAt: newTask.startAt || null,
      dueAt: newTask.dueAt || null,
      startPrecision: newTask.startPrecision || null,
      duePrecision: newTask.duePrecision || null
    }
  });
  res.status(201).json({
    id: result.lastInsertRowid,
    taskNo
  });
});
function replaceTaskTags(taskId, tagIds) {
  const listId = db.prepare("SELECT list_id FROM tasks WHERE id = ?").pluck().get(taskId);
  const requested = [...new Set(tagIds.map(Number).filter(Boolean))];
  const normalized = requested.filter(tagId => db.prepare(`
      SELECT id FROM tags
      WHERE id = ? AND active = 1 AND (list_id = ? OR list_id IS NULL)
    `).get(tagId, listId));
  const replace = db.transaction(() => {
    db.prepare("DELETE FROM task_tags WHERE task_id = ?").run(taskId);
    const insert = db.prepare("INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)");
    for (const tagId of normalized) insert.run(taskId, tagId);
  });
  replace();
}
function transferTaskRecord(taskId, targetListId, source = "网页操作") {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL").get(taskId);
  if (!task) throw Object.assign(new Error("任务不存在"), {
    status: 404
  });
  const target = db.prepare("SELECT id, name FROM lists WHERE id = ? AND archived_at IS NULL").get(targetListId);
  if (!target) throw Object.assign(new Error("目标清单不存在"), {
    status: 404
  });
  if (Number(task.list_id) === Number(target.id)) {
    throw Object.assign(new Error("目标清单不能与当前清单相同"), {
      status: 400
    });
  }
  const sourceListName = db.prepare("SELECT name FROM lists WHERE id = ?").pluck().get(task.list_id);
  const targetTagIds = db.prepare(`
    SELECT target_tag.id
    FROM task_tags task_tag
    JOIN tags source_tag ON source_tag.id = task_tag.tag_id
    JOIN tags target_tag ON target_tag.name = source_tag.name
    WHERE task_tag.task_id = ?
      AND target_tag.active = 1
      AND (target_tag.list_id = ? OR target_tag.list_id IS NULL)
  `).all(task.id, target.id).map(item => item.id);
  const now = new Date().toISOString();
  if (task.status !== "已完成") {
    db.prepare(`
      UPDATE tasks
      SET status = '已完成', completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, task.id);
    writeTaskLog({
      taskId: task.id,
      taskNo: task.task_no,
      eventType: "状态变更",
      oldValue: task.status,
      newValue: "已完成",
      source,
      message: `转移到${target.name}时自动完成`
    });
  }
  writeTaskLog({
    taskId: task.id,
    taskNo: task.task_no,
    eventType: "任务转移",
    oldValue: sourceListName,
    newValue: target.name,
    source,
    message: `已在${target.name}新建承接任务`
  });
  const taskNo = nextTaskNumber();
  const inserted = db.prepare(`
    INSERT INTO tasks (
      task_no, title, status, list_id, project_id, start_at, due_at,
      start_precision, due_precision,
      completed_at, starred, important, urgent, is_pinned,
      source, notes, created_at, updated_at
    ) VALUES (?, ?, '未完成', ?, NULL, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(taskNo, task.title, target.id, task.start_at, task.due_at, task.start_precision, task.due_precision, task.starred, task.important, task.urgent, task.is_pinned, "任务转移", task.notes || "", now, now);
  const insertTag = db.prepare("INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)");
  targetTagIds.forEach(tagId => insertTag.run(inserted.lastInsertRowid, tagId));
  writeTaskLog({
    taskId: inserted.lastInsertRowid,
    taskNo,
    eventType: "转移新建",
    newValue: "未完成",
    source,
    message: `由${sourceListName}的${task.task_no}转移创建`,
    changedFields: {
      sourceTaskId: task.id,
      sourceTaskNo: task.task_no
    }
  });
  return {
    oldTaskId: task.id,
    newTaskId: inserted.lastInsertRowid,
    taskNo
  };
}
app.patch("/api/tasks/:id", (req, res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL").get(req.params.id);
  if (!task) return res.status(404).json({
    error: "任务不存在"
  });
  const oldListName = db.prepare("SELECT name FROM lists WHERE id = ?").pluck().get(task.list_id);
  const oldProjectName = task.project_id ? db.prepare("SELECT name FROM projects WHERE id = ?").pluck().get(task.project_id) : null;
  const oldTags = db.prepare(`
      SELECT tg.name
      FROM task_tags tt
      JOIN tags tg ON tg.id = tt.tag_id
      WHERE tt.task_id = ?
      ORDER BY tg.name
    `).all(task.id).map(row => row.name);
  const patch = req.body || {};
  const next = {
    title: String(patch.title ?? task.title).trim(),
    status: String(patch.status ?? task.status),
    listId: Number(patch.listId ?? task.list_id),
    projectId: patch.projectId === null ? null : Number(patch.projectId ?? task.project_id) || null,
    startAt: patch.startAt === null ? null : patch.startAt ?? task.start_at,
    dueAt: patch.dueAt === null ? null : patch.dueAt ?? task.due_at,
    startPrecision: patch.startAt === null ? null : patch.startPrecision ?? task.start_precision,
    duePrecision: patch.dueAt === null ? null : patch.duePrecision ?? task.due_precision,
    starred: patch.starred === undefined ? task.starred : booleanValue(patch.starred),
    important: patch.important === undefined ? task.important : booleanValue(patch.important),
    urgent: patch.urgent === undefined ? task.urgent : booleanValue(patch.urgent),
    isPinned: patch.isPinned === undefined ? task.is_pinned : booleanValue(patch.isPinned),
    source: String(patch.source ?? task.source),
    notes: String(patch.notes ?? task.notes ?? "")
  };
  if (!next.title) return res.status(400).json({
    error: "任务内容不能为空"
  });
  const timeWasEdited = ["startAt", "dueAt", "startPrecision", "duePrecision"].some(field => Object.prototype.hasOwnProperty.call(patch, field));
  try {
    const normalizedStart = normalizeTaskTime(next.startAt, next.startPrecision);
    const normalizedDue = normalizeTaskTime(next.dueAt, next.duePrecision);
    if (timeWasEdited) validateTaskTimeRange(normalizedStart, normalizedDue);
    next.startAt = normalizedStart.value;
    next.startPrecision = normalizedStart.precision;
    next.dueAt = normalizedDue.value;
    next.duePrecision = normalizedDue.precision;
  } catch (error) {
    return res.status(error.status || 400).json({
      error: error.message
    });
  }
  next.projectId = normalizeProjectId(next.projectId, next.listId);
  const now = new Date().toISOString();
  const justCompleted = next.status === "已完成" && task.status !== "已完成";
  const completedAt = justCompleted ? now : next.status === "已完成" ? task.completed_at || now : null;
  db.prepare(`
    UPDATE tasks SET
      title = ?, status = ?, list_id = ?, project_id = ?, start_at = ?, due_at = ?,
      start_precision = ?, due_precision = ?,
      completed_at = ?, starred = ?, important = ?, urgent = ?,
      is_pinned = ?, source = ?, notes = ?, updated_at = ?
    WHERE id = ?
  `).run(next.title, next.status, next.listId, next.projectId, next.startAt || null, next.dueAt || null, next.startPrecision || null, next.duePrecision || null, completedAt, next.starred, next.important, next.urgent, next.isPinned, next.source, next.notes, now, task.id);
  if (Array.isArray(patch.tagIds)) {
    replaceTaskTags(task.id, patch.tagIds);
  } else if (task.list_id !== next.listId) {
    db.prepare(`
      DELETE FROM task_tags
      WHERE task_id = ? AND tag_id NOT IN (
        SELECT id FROM tags
        WHERE active = 1 AND (list_id = ? OR list_id IS NULL)
      )
    `).run(task.id, next.listId);
  }
  const newListName = db.prepare("SELECT name FROM lists WHERE id = ?").pluck().get(next.listId);
  const newProjectName = next.projectId ? db.prepare("SELECT name FROM projects WHERE id = ?").pluck().get(next.projectId) : null;
  const newTags = db.prepare(`
      SELECT tg.name
      FROM task_tags tt
      JOIN tags tg ON tg.id = tt.tag_id
      WHERE tt.task_id = ?
      ORDER BY tg.name
    `).all(task.id).map(row => row.name);
  const changes = [];
  if (task.title !== next.title) changes.push(["任务内容", task.title, next.title]);
  if (task.status !== next.status) changes.push(["状态变更", task.status, next.status]);
  if (task.list_id !== next.listId) changes.push(["移动清单", oldListName, newListName]);
  if (task.project_id !== next.projectId) changes.push(["所属项目", oldProjectName || "未归属", newProjectName || "未归属"]);
  if ((task.start_at || null) !== (next.startAt || null) || (task.start_precision || null) !== (next.startPrecision || null)) changes.push(["开始日期", task.start_at, next.startAt]);
  if ((task.due_at || null) !== (next.dueAt || null) || (task.due_precision || null) !== (next.duePrecision || null)) changes.push(["截止日期", task.due_at, next.dueAt]);
  if (task.starred !== next.starred) changes.push(["收藏标记", String(task.starred), String(next.starred)]);
  if (task.important !== next.important) changes.push(["重要状态", String(task.important), String(next.important)]);
  if (task.urgent !== next.urgent) changes.push(["紧急状态", String(task.urgent), String(next.urgent)]);
  if (task.is_pinned !== next.isPinned) changes.push(["置顶状态", String(Boolean(task.is_pinned)), String(Boolean(next.isPinned))]);
  if (task.source !== next.source) changes.push(["记录来源", task.source, next.source]);
  if ((task.notes || "") !== next.notes) changes.push(["备注", task.notes || "", next.notes]);
  if (oldTags.join("|") !== newTags.join("|")) changes.push(["标签", oldTags.join("、"), newTags.join("、")]);
  const mutationSource = patch.mutationSource === "日程系统" ? "日程系统" : "网页操作";
  for (const [eventType, oldValue, newValue] of changes) {
    writeTaskLog({
      taskId: task.id,
      taskNo: task.task_no,
      eventType,
      oldValue,
      newValue,
      source: mutationSource,
      changedFields: {
        field: eventType,
        oldValue,
        newValue
      }
    });
  }
  res.json({
    ok: true
  });
});
app.post("/api/tasks/:id/transfer", (req, res) => {
  const targetListId = Number(req.body?.targetListId);
  if (!targetListId) {
    return res.status(400).json({
      error: "请选择目标清单"
    });
  }
  try {
    const transferSource = "\u7F51\u9875\u64CD\u4F5C";
    const transfer = db.transaction(() => transferTaskRecord(req.params.id, targetListId, transferSource));
    const result = transfer();
    res.status(201).json({
      ...result
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({
      error: error.message
    });
    throw error;
  }
});
app.post("/api/tasks/batch", (req, res) => {
  const ids = [...new Set((req.body?.ids || []).map(Number).filter(Boolean))].slice(0, 500);
  const action = String(req.body?.action || "");
  if (ids.length === 0) return res.status(400).json({
    error: "请先选择任务"
  });
  if (!["status", "pin", "delete", "transfer", "project", "dueDate"].includes(action)) {
    return res.status(400).json({
      error: "不支持的批量操作"
    });
  }
  const affected = [];
  const created = [];
  const batchSource = "\u7F51\u9875\u6279\u91CF\u64CD\u4F5C";
  try {
    const runBatch = db.transaction(() => {
      for (const id of ids) {
        const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL").get(id);
        if (!task) continue;
        const now = new Date().toISOString();
        if (action === "transfer") {
          const targetListId = Number(req.body?.targetListId);
          if (!targetListId) {
            throw Object.assign(new Error("请选择目标清单"), {
              status: 400
            });
          }
          if (Number(task.list_id) === targetListId) continue;
          const result = transferTaskRecord(task.id, targetListId, batchSource);
          affected.push(result.oldTaskId);
          created.push(result.newTaskId);
          continue;
        }
        if (action === "status") {
          const status = String(req.body?.value || "");
          if (!taskStatuses.has(status)) {
            throw Object.assign(new Error("任务状态无效"), {
              status: 400
            });
          }
          if (task.status === status) continue;
          const completedAt = status === "已完成" ? task.completed_at || now : null;
          db.prepare(`
            UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?
          `).run(status, completedAt, now, task.id);
          writeTaskLog({
            taskId: task.id,
            taskNo: task.task_no,
            eventType: "状态变更",
            oldValue: task.status,
            newValue: status,
            source: batchSource
          });
        } else if (action === "project") {
          const projectId = req.body?.value ? Number(req.body.value) : null;
          if (projectId) {
            const project = db.prepare(`
              SELECT id FROM projects
              WHERE id = ? AND active = 1 AND (list_id IS NULL OR list_id = ?)
            `).get(projectId, task.list_id);
            if (!project) {
              throw Object.assign(new Error("项目不属于任务所在清单"), {
                status: 400
              });
            }
          }
          if ((task.project_id || null) === projectId) continue;
          db.prepare("UPDATE tasks SET project_id = ?, updated_at = ? WHERE id = ?").run(projectId, now, task.id);
          writeTaskLog({
            taskId: task.id,
            taskNo: task.task_no,
            eventType: "所属项目",
            oldValue: task.project_id ? String(task.project_id) : "",
            newValue: projectId ? String(projectId) : "",
            source: batchSource
          });
        } else if (action === "dueDate") {
          const dueAt = req.body?.value ? String(req.body.value).slice(0, 10) : null;
          if ((task.due_at || null) === dueAt) continue;
          db.prepare("UPDATE tasks SET due_at = ?, due_precision = ?, updated_at = ? WHERE id = ?").run(dueAt, dueAt ? "date" : null, now, task.id);
          writeTaskLog({
            taskId: task.id,
            taskNo: task.task_no,
            eventType: "截止时间",
            oldValue: task.due_at || "",
            newValue: dueAt || "",
            source: batchSource
          });
        } else if (action === "pin") {
          const isPinned = booleanValue(req.body?.value);
          if (task.is_pinned === isPinned) continue;
          db.prepare("UPDATE tasks SET is_pinned = ?, updated_at = ? WHERE id = ?").run(isPinned, now, task.id);
          writeTaskLog({
            taskId: task.id,
            taskNo: task.task_no,
            eventType: "置顶状态",
            oldValue: String(Boolean(task.is_pinned)),
            newValue: String(Boolean(isPinned)),
            source: batchSource
          });
        } else if (action === "delete") {
          db.prepare("UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?").run(now, now, task.id);
          writeTaskLog({
            taskId: task.id,
            taskNo: task.task_no,
            eventType: "任务删除",
            oldValue: task.status,
            source: batchSource,
            message: task.title
          });
        }
        affected.push(task.id);
      }
    });
    runBatch();
  } catch (error) {
    if (error.status) return res.status(error.status).json({
      error: error.message
    });
    throw error;
  }
  res.json({
    ok: true,
    affected: affected.length,
    created: created.length
  });
});
app.delete("/api/tasks/:id", (req, res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL").get(req.params.id);
  if (!task) return res.status(404).json({
    error: "任务不存在"
  });
  const now = new Date().toISOString();
  db.prepare("UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?").run(now, now, task.id);
  writeTaskLog({
    taskId: task.id,
    taskNo: task.task_no,
    eventType: "任务删除",
    oldValue: task.status,
    message: task.title,
    source: "\u7F51\u9875\u64CD\u4F5C"
  });
  res.status(204).end();
});
app.post("/api/tasks/:id/restore", (req, res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
  if (!task) return res.status(404).json({
    error: "任务不存在"
  });
  if (!task.deleted_at) return res.json({
    ok: true,
    restored: false
  });
  const now = new Date().toISOString();
  db.prepare("UPDATE tasks SET deleted_at = NULL, updated_at = ? WHERE id = ?").run(now, task.id);
  writeTaskLog({
    taskId: task.id,
    taskNo: task.task_no,
    eventType: "任务恢复",
    oldValue: task.deleted_at,
    newValue: "",
    source: "\u7F51\u9875\u64CD\u4F5C",
    message: task.title
  });
  res.json({
    ok: true,
    restored: true
  });
});
app.get("/api/tasks/:id/logs", (req, res) => {
  const rows = db.prepare(`
      SELECT id, event_type AS eventType, old_value AS oldValue,
        new_value AS newValue, source, message, occurred_at AS occurredAt,
        list_name AS listName, task_title AS taskTitle,
        task_status AS taskStatus, changed_fields_json AS changedFieldsJson
      FROM task_logs
      WHERE task_id = ?
      ORDER BY occurred_at DESC, id DESC
      LIMIT 200
    `).all(req.params.id);
  res.json({
    data: rows
  });
});
app.get("/api/logs", (req, res) => {
  const conditions = [];
  const values = [];
  if (req.query.listId) {
    conditions.push("COALESCE(lg.list_id, t.list_id) = ?");
    values.push(Number(req.query.listId));
  }
  if (req.query.status) {
    conditions.push("COALESCE(lg.task_status, t.status) = ?");
    values.push(String(req.query.status));
  }
  if (req.query.eventType) {
    conditions.push("lg.event_type = ?");
    values.push(String(req.query.eventType));
  }
  if (req.query.from) {
    conditions.push("substr(lg.occurred_at, 1, 10) >= ?");
    values.push(String(req.query.from).slice(0, 10));
  }
  if (req.query.to) {
    conditions.push("substr(lg.occurred_at, 1, 10) <= ?");
    values.push(String(req.query.to).slice(0, 10));
  }
  if (req.query.q) {
    conditions.push(`(
      lg.task_no LIKE ? OR COALESCE(lg.task_title, t.title, lg.message) LIKE ?
      OR lg.event_type LIKE ? OR lg.message LIKE ?
    )`);
    const pattern = `%${String(req.query.q).trim()}%`;
    values.push(pattern, pattern, pattern, pattern);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const total = db.prepare(`
      SELECT COUNT(*)
      FROM task_logs lg
      LEFT JOIN tasks t ON t.id = lg.task_id
      ${where}
    `).pluck().get(...values);
  const rows = db.prepare(`
      SELECT lg.id, lg.task_id AS taskId, lg.task_no AS taskNo,
        lg.event_type AS eventType, lg.old_value AS oldValue,
        lg.new_value AS newValue, lg.source, lg.message,
        lg.occurred_at AS occurredAt,
        COALESCE(lg.list_id, t.list_id) AS listId,
        COALESCE(lg.list_name, l.name, '未关联') AS listName,
        COALESCE(lg.task_title, t.title, lg.message, '未关联任务') AS title,
        COALESCE(lg.task_status, t.status, lg.new_value, '未知') AS taskStatus,
        t.id AS databaseTaskId,
        lg.changed_fields_json AS changedFieldsJson
      FROM task_logs lg
      LEFT JOIN tasks t ON t.id = lg.task_id
      LEFT JOIN lists l ON l.id = COALESCE(lg.list_id, t.list_id)
      ${where}
      ORDER BY lg.occurred_at DESC, lg.id DESC
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset);
  const today = new Date().toLocaleDateString("sv-SE", {
    timeZone: "Asia/Shanghai"
  });
  const summary = db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(substr(occurred_at, 1, 10) = ?) AS today,
        SUM(event_type = '任务新建') AS created,
        SUM(event_type = '状态变更') AS statusChanged,
        COUNT(DISTINCT task_id) AS affectedTasks
      FROM task_logs
    `).get(today);
  const eventTypes = db.prepare(`
      SELECT event_type AS eventType, COUNT(*) AS count
      FROM task_logs
      GROUP BY event_type
      ORDER BY count DESC, event_type
    `).all();
  res.json({
    data: rows,
    total,
    limit,
    offset,
    summary,
    eventTypes
  });
});
const statsRangeLabels = {
  last7: "近 7 天",
  lastWeek: "上周",
  last30: "过去 30 天",
  thisMonth: "本月",
  lastMonth: "上月",
  thisYear: "本年",
  custom: "自定义区间"
};
function addStatsDays(day, amount) {
  const value = new Date(`${day}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
function statsDaySpan(start, end) {
  return Math.round((Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000) + 1;
}
function resolveStatsRange(query, today) {
  const preset = Object.hasOwn(statsRangeLabels, query.range) ? query.range : "last30";
  const todayDate = new Date(`${today}T00:00:00.000Z`);
  let start;
  let end = today;
  if (preset === "last7") start = addStatsDays(today, -6);
  if (preset === "last30") start = addStatsDays(today, -29);
  if (preset === "thisMonth") start = `${today.slice(0, 7)}-01`;
  if (preset === "thisYear") start = `${today.slice(0, 4)}-01-01`;
  if (preset === "lastWeek") {
    const mondayOffset = (todayDate.getUTCDay() + 6) % 7;
    end = addStatsDays(today, -mondayOffset - 1);
    start = addStatsDays(end, -6);
  }
  if (preset === "lastMonth") {
    const firstThisMonth = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), 1));
    end = addStatsDays(firstThisMonth.toISOString().slice(0, 10), -1);
    start = `${end.slice(0, 7)}-01`;
  }
  if (preset === "custom") {
    const validDay = /^\d{4}-\d{2}-\d{2}$/;
    if (!validDay.test(String(query.from || "")) || !validDay.test(String(query.to || ""))) {
      throw new Error("自定义统计时间必须提供正确的开始和结束日期");
    }
    start = String(query.from);
    end = String(query.to);
  }
  const days = statsDaySpan(start, end);
  if (!Number.isFinite(days) || days < 1) throw new Error("统计开始日期不能晚于结束日期");
  if (days > 3660) throw new Error("单次统计区间不能超过 10 年");
  return {
    preset,
    label: statsRangeLabels[preset],
    start,
    end,
    days,
    previousStart: addStatsDays(start, -days),
    previousEnd: addStatsDays(start, -1)
  };
}
app.get("/api/stats", (req, res) => {
  const today = new Date().toLocaleDateString("sv-SE", {
    timeZone: "Asia/Shanghai"
  });
  let range;
  try {
    range = resolveStatsRange(req.query, today);
  } catch (error) {
    return res.status(400).json({
      error: error.message
    });
  }
  const listId = Number(req.query.listId) || null;
  const scopeSql = `deleted_at IS NULL${listId ? " AND list_id = ?" : ""}`;
  const scopeValues = listId ? [listId] : [];
  const countRange = (field, start, end) => Number(db.prepare(`
      SELECT COUNT(*) FROM tasks
      WHERE ${scopeSql}
        AND ${field} IS NOT NULL
        AND date(${field}, '+8 hours') BETWEEN ? AND ?
    `).pluck().get(...scopeValues, start, end) || 0);
  const metric = (field, currentStart, currentEnd, previousStart, previousEnd) => {
    const current = countRange(field, currentStart, currentEnd);
    const previous = countRange(field, previousStart, previousEnd);
    return {
      current,
      previous,
      change: current - previous
    };
  };
  const summary = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(status = '未完成') AS pending,
        SUM(status = '进行中') AS active,
        SUM(status = '已完成') AS completed,
        SUM(status = '已完成' AND completed_at IS NULL) AS undatedCompleted,
        SUM(date(created_at, '+8 hours') = ?) AS createdToday,
        SUM(date(completed_at, '+8 hours') = ?) AS completedToday,
        SUM(due_at IS NOT NULL AND substr(due_at, 1, 10) < ?
          AND status NOT IN ('已完成', '已废弃')) AS overdue
      FROM tasks
      WHERE ${scopeSql}
    `).get(today, today, today, ...scopeValues);
  const byStatus = db.prepare(`
      SELECT status, COUNT(*) AS count
      FROM tasks WHERE ${scopeSql}
        AND date(created_at, '+8 hours') BETWEEN ? AND ?
      GROUP BY status ORDER BY count DESC
    `).all(...scopeValues, range.start, range.end);
  const thirtyStart = addStatsDays(today, -29);
  const fillDays = (start, length, rows, keys) => {
    const byDay = new Map(rows.map(row => [row.day, row]));
    return Array.from({
      length
    }, (_, index) => {
      const day = addStatsDays(start, index);
      const found = byDay.get(day) || {};
      return {
        day,
        ...Object.fromEntries(keys.map(key => [key, Number(found[key] || 0)]))
      };
    });
  };
  const createdRows = db.prepare(`
    SELECT date(created_at, '+8 hours') AS day, COUNT(*) AS count
    FROM tasks
    WHERE ${scopeSql} AND date(created_at, '+8 hours') BETWEEN ? AND ?
    GROUP BY day ORDER BY day
  `).all(...scopeValues, range.start, range.end);
  const completedRows = db.prepare(`
    SELECT date(completed_at, '+8 hours') AS day, COUNT(*) AS count
    FROM tasks
    WHERE ${scopeSql} AND completed_at IS NOT NULL
      AND date(completed_at, '+8 hours') BETWEEN ? AND ?
    GROUP BY day ORDER BY day
  `).all(...scopeValues, range.start, range.end);
  const activityRows = db.prepare(`
    SELECT day, SUM(created) AS created, SUM(completed) AS completed,
      SUM(created + completed) AS total
    FROM (
      SELECT date(created_at, '+8 hours') AS day,
        COUNT(*) AS created, 0 AS completed
      FROM tasks
      WHERE ${scopeSql} AND date(created_at, '+8 hours') BETWEEN ? AND ?
      GROUP BY day
      UNION ALL
      SELECT date(completed_at, '+8 hours') AS day,
        0 AS created, COUNT(*) AS completed
      FROM tasks
      WHERE ${scopeSql} AND completed_at IS NOT NULL
        AND date(completed_at, '+8 hours') BETWEEN ? AND ?
      GROUP BY day
    ) activity
    GROUP BY day ORDER BY day
  `).all(...scopeValues, range.start, range.end, ...scopeValues, range.start, range.end);
  const effectiveCompletionSql = `
    CASE
      WHEN completed_at IS NULL THEN COALESCE(updated_at, created_at)
      WHEN datetime(completed_at) < datetime(created_at) THEN created_at
      ELSE completed_at
    END
  `;
  const cumulativeCreatedBefore = Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM tasks
    WHERE ${scopeSql} AND date(created_at, '+8 hours') < ?
  `).get(...scopeValues, range.start)?.count || 0);
  const cumulativeCompletedBefore = Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM tasks
    WHERE ${scopeSql} AND status = '已完成'
      AND date(${effectiveCompletionSql}, '+8 hours') < ?
  `).get(...scopeValues, range.start)?.count || 0);
  const cumulativeCompletionRows = db.prepare(`
    SELECT date(${effectiveCompletionSql}, '+8 hours') AS day, COUNT(*) AS count
    FROM tasks
    WHERE ${scopeSql} AND status = '已完成'
      AND date(${effectiveCompletionSql}, '+8 hours') BETWEEN ? AND ?
    GROUP BY day ORDER BY day
  `).all(...scopeValues, range.start, range.end);
  const metrics = {
    createdToday: metric("created_at", today, today, addStatsDays(today, -1), addStatsDays(today, -1)),
    completedToday: metric("completed_at", today, today, addStatsDays(today, -1), addStatsDays(today, -1)),
    created7: metric("created_at", addStatsDays(today, -6), today, addStatsDays(today, -13), addStatsDays(today, -7)),
    completed7: metric("completed_at", addStatsDays(today, -6), today, addStatsDays(today, -13), addStatsDays(today, -7)),
    created30: metric("created_at", thirtyStart, today, addStatsDays(today, -59), addStatsDays(today, -30)),
    completed30: metric("completed_at", thirtyStart, today, addStatsDays(today, -59), addStatsDays(today, -30))
  };
  const activeRanking = db.prepare(`
    SELECT day, SUM(created) AS created, SUM(completed) AS completed,
      SUM(created + completed) AS total
    FROM (
      SELECT date(created_at, '+8 hours') AS day,
        COUNT(*) AS created, 0 AS completed
      FROM tasks
      WHERE ${scopeSql}
        AND date(created_at, '+8 hours') BETWEEN ? AND ?
      GROUP BY day
      UNION ALL
      SELECT date(completed_at, '+8 hours') AS day,
        0 AS created, COUNT(*) AS completed
      FROM tasks
      WHERE ${scopeSql} AND completed_at IS NOT NULL
        AND date(completed_at, '+8 hours') BETWEEN ? AND ?
      GROUP BY day
    ) activity
    GROUP BY day
    ORDER BY total DESC, completed DESC, created DESC, day DESC
    LIMIT 10
  `).all(...scopeValues, range.start, range.end, ...scopeValues, range.start, range.end).map(row => ({
    day: row.day,
    created: Number(row.created || 0),
    completed: Number(row.completed || 0),
    total: Number(row.total || 0)
  }));
  const dailyActivity = fillDays(range.start, range.days, activityRows, ["created", "completed", "total"]);
  const rangeCreated = dailyActivity.reduce((sum, row) => sum + row.created, 0);
  const rangeCompleted = dailyActivity.reduce((sum, row) => sum + row.completed, 0);
  const previousCreated = countRange("created_at", range.previousStart, range.previousEnd);
  const previousCompleted = countRange("completed_at", range.previousStart, range.previousEnd);
  const completionCountByDay = new Map(cumulativeCompletionRows.map(row => [row.day, Number(row.count || 0)]));
  let cumulativeCreated = cumulativeCreatedBefore;
  let cumulativeCompleted = Math.min(cumulativeCompletedBefore, cumulativeCreatedBefore);
  const dailyCompletionRate = dailyActivity.map(row => {
    cumulativeCreated += row.created;
    cumulativeCompleted = Math.min(cumulativeCreated, cumulativeCompleted + Number(completionCountByDay.get(row.day) || 0));
    return {
      day: row.day,
      created: row.created,
      completed: row.completed,
      totalTasks: cumulativeCreated,
      completedTasks: cumulativeCompleted,
      rate: cumulativeCreated > 0 ? Math.round(cumulativeCompleted / cumulativeCreated * 1000) / 10 : 0
    };
  });
  res.json({
    range,
    summary,
    metrics,
    rangeSummary: {
      created: {
        current: rangeCreated,
        previous: previousCreated,
        change: rangeCreated - previousCreated
      },
      completed: {
        current: rangeCompleted,
        previous: previousCompleted,
        change: rangeCompleted - previousCompleted
      },
      activity: rangeCreated + rangeCompleted
    },
    byStatus,
    dailyCreated: fillDays(range.start, range.days, createdRows, ["count"]),
    dailyCompleted: fillDays(range.start, range.days, completedRows, ["count"]),
    dailyActivity,
    dailyCompletionRate,
    heatmap: dailyActivity,
    activeRanking
  });
});
app.use("/api", (_req, res) => res.status(404).json({
  error: "接口不存在"
}));
const distPath = path.resolve(process.cwd(), "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath, {
    index: false,
    maxAge: "1h"
  }));
  app.get("*splat", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    error: "服务器处理失败，请稍后重试"
  });
});
let sopScheduler = null;
const server = app.listen(port, process.env.HOST || "127.0.0.1", () => {
  console.log(`personal-task-system listening on ${port}`);
  sopScheduler = startSopScheduler();
});
async function shutdown() {
  try {
    sopScheduler?.stop();
    documentRuntime?.stop();
  } finally {
    server.close(() => process.exit(0));
  }
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
