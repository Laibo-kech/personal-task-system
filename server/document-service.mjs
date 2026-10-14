import crypto from "node:crypto";
import JSZip from "jszip";
import multer from "multer";
import { db } from "./db.mjs";
const MAX_DEPTH = 20;
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 50 * 1024 * 1024;
const MAX_IMPORT_DOCUMENTS = 1000;
const LEASE_TTL_MS = 30_000;
const REVISION_INTERVAL_MS = 5 * 60_000;
const clients = new Set();
let searchMode = "like";
try {
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS document_search USING fts5(
    node_id UNINDEXED, title, markdown, tokenize='trigram'
  )`);
  searchMode = "fts5-trigram";
} catch {
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS document_search USING fts5(
      node_id UNINDEXED, title, markdown, tokenize='unicode61'
    )`);
    searchMode = "fts5-unicode61";
  } catch {
    searchMode = "like";
  }
}
function nowIso() {
  return new Date().toISOString();
}
function json(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}
function bool(value) {
  return Boolean(Number(value));
}
function nodeRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    parentId: row.parentId ?? null,
    type: row.type,
    title: row.title,
    position: row.position,
    pinned: bool(row.pinned),
    deletedAt: row.deletedAt || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}
function documentRow(row, {
  includeMarkdown = true
} = {}) {
  if (!row) return null;
  return {
    ...nodeRow(row),
    ...(includeMarkdown ? {
      markdown: row.markdown || ""
    } : {}),
    version: Number(row.version || 1),
    savedAt: row.savedAt
  };
}
function getNode(id) {
  return db.prepare(`
    SELECT id, parent_id AS parentId, node_type AS type, title, position,
      pinned, deleted_at AS deletedAt, created_at AS createdAt, updated_at AS updatedAt
    FROM document_nodes WHERE id = ?
  `).get(Number(id));
}
function getDocument(id) {
  return db.prepare(`
    SELECT n.id, n.parent_id AS parentId, n.node_type AS type, n.title, n.position,
      n.pinned, n.deleted_at AS deletedAt, n.created_at AS createdAt,
      n.updated_at AS updatedAt, d.markdown, d.version, d.saved_at AS savedAt
    FROM document_nodes n JOIN documents d ON d.node_id = n.id
    WHERE n.id = ?
  `).get(Number(id));
}
function descendants(id, includeSelf = true) {
  return db.prepare(`
    WITH RECURSIVE subtree(id, depth) AS (
      SELECT id, 0 FROM document_nodes WHERE id = ?
      UNION ALL
      SELECT n.id, subtree.depth + 1
      FROM document_nodes n JOIN subtree ON n.parent_id = subtree.id
      WHERE subtree.depth < 100
    )
    SELECT id, depth FROM subtree ${includeSelf ? "" : "WHERE depth > 0"}
  `).all(Number(id));
}
function ancestorDepth(parentId) {
  if (!parentId) return 0;
  const row = db.prepare(`
    WITH RECURSIVE parents(id, parent_id, depth) AS (
      SELECT id, parent_id, 1 FROM document_nodes WHERE id = ?
      UNION ALL
      SELECT n.id, n.parent_id, parents.depth + 1
      FROM document_nodes n JOIN parents ON n.id = parents.parent_id
      WHERE parents.depth < 100
    )
    SELECT MAX(depth) AS depth FROM parents
  `).get(Number(parentId));
  return Number(row?.depth || 0);
}
function subtreeHeight(id) {
  return Math.max(1, ...descendants(id).map(item => Number(item.depth) + 1));
}
function requireActiveParent(parentId) {
  if (!parentId) return null;
  const parent = getNode(parentId);
  if (!parent || parent.deletedAt) {
    const error = new Error("目标上级不存在或已在回收站");
    error.status = 400;
    throw error;
  }
  return parent;
}
function cleanTitle(value) {
  const title = String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 200);
  if (!title) {
    const error = new Error("请输入名称");
    error.status = 400;
    throw error;
  }
  return title;
}
function uniqueTitle(title, parentId, excludeId = null) {
  const exists = candidate => db.prepare(`
    SELECT 1 FROM document_nodes
    WHERE COALESCE(parent_id, 0) = COALESCE(?, 0)
      AND title = ? AND deleted_at IS NULL AND id <> COALESCE(?, -1)
    LIMIT 1
  `).get(parentId || null, candidate, excludeId);
  if (!exists(title)) return title;
  let index = 2;
  while (exists(`${title} (${index})`)) index += 1;
  return `${title} (${index})`;
}
function nextPosition(parentId) {
  return Number(db.prepare(`
    SELECT COALESCE(MAX(position), 0) + 1
    FROM document_nodes WHERE COALESCE(parent_id, 0) = COALESCE(?, 0)
  `).pluck().get(parentId || null));
}
function logDocument(nodeId, eventType, detail = {}) {
  const now = nowIso();
  db.prepare(`
    INSERT INTO document_logs (node_id, event_type, detail_json, occurred_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(nodeId || null, eventType, JSON.stringify(detail), now, now);
}
function syncSearch(nodeId) {
  if (searchMode === "like") return;
  try {
    db.prepare("DELETE FROM document_search WHERE node_id = ?").run(String(nodeId));
    const row = getDocument(nodeId);
    if (row && !row.deletedAt) {
      db.prepare("INSERT INTO document_search (node_id, title, markdown) VALUES (?, ?, ?)").run(String(row.id), row.title, row.markdown || "");
    }
  } catch {
    searchMode = "like";
  }
}
function rebuildSearch() {
  if (searchMode === "like") return;
  try {
    db.prepare("DELETE FROM document_search").run();
    const insert = db.prepare("INSERT INTO document_search (node_id, title, markdown) VALUES (?, ?, ?)");
    for (const row of db.prepare(`
      SELECT n.id, n.title, d.markdown
      FROM document_nodes n JOIN documents d ON d.node_id = n.id
      WHERE n.deleted_at IS NULL
    `).all()) insert.run(String(row.id), row.title, row.markdown || "");
  } catch {
    searchMode = "like";
  }
}
function publish(type, payload = {}) {
  const data = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const response of clients) {
    try {
      response.write(data);
    } catch {
      clients.delete(response);
    }
  }
}
function leaseRow(row) {
  if (!row) return null;
  return {
    nodeId: row.nodeId,
    clientId: row.clientId,
    username: row.username,
    expiresAt: row.expiresAt,
    updatedAt: row.updatedAt
  };
}
function activeLease(nodeId) {
  const now = nowIso();
  db.prepare("DELETE FROM document_edit_leases WHERE expires_at <= ?").run(now);
  return db.prepare(`
    SELECT node_id AS nodeId, lease_token AS leaseToken, client_id AS clientId,
      username, expires_at AS expiresAt, updated_at AS updatedAt
    FROM document_edit_leases WHERE node_id = ? AND expires_at > ?
  `).get(Number(nodeId), now);
}
function forceRevision(nodeId, reason) {
  const document = getDocument(nodeId);
  if (!document) return false;
  const result = db.prepare(`
    INSERT OR IGNORE INTO document_revisions (node_id, version, markdown, reason, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(document.id, document.version, document.markdown || "", reason, nowIso());
  return result.changes > 0;
}
function maybeRevision(document) {
  const last = db.prepare(`
    SELECT created_at AS createdAt FROM document_revisions
    WHERE node_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(document.id);
  if (!last || Date.now() - new Date(last.createdAt).getTime() >= REVISION_INTERVAL_MS) {
    forceRevision(document.id, "auto");
  }
}
function validateMarkdown(markdown) {
  const value = String(markdown ?? "");
  if (Buffer.byteLength(value, "utf8") > MAX_MARKDOWN_BYTES) {
    const error = new Error("单篇文档不能超过 2MB");
    error.status = 413;
    throw error;
  }
  if (/\]\(\s*(?:javascript|data):/i.test(value) || /<\s*(?:script|iframe|object|embed|style|link|meta|form|svg|math)\b/i.test(value) || /<[^>]+\son\w+\s*=/i.test(value)) {
    const error = new Error("文档包含不支持的 HTML 或危险链接");
    error.status = 400;
    throw error;
  }
  return value;
}
function createNode({
  type,
  title,
  parentId = null,
  markdown = "",
  reason = "create"
}) {
  if (!new Set(["folder", "document"]).has(type)) {
    const error = new Error("节点类型不正确");
    error.status = 400;
    throw error;
  }
  requireActiveParent(parentId);
  if (ancestorDepth(parentId) + 1 > MAX_DEPTH) {
    const error = new Error(`文档层级不能超过 ${MAX_DEPTH} 层`);
    error.status = 400;
    throw error;
  }
  const name = uniqueTitle(cleanTitle(title), parentId);
  const now = nowIso();
  const inserted = db.prepare(`
    INSERT INTO document_nodes
      (parent_id, node_type, title, position, pinned, deleted_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, NULL, ?, ?)
  `).run(parentId || null, type, name, nextPosition(parentId), now, now);
  if (type === "document") {
    const content = validateMarkdown(markdown);
    db.prepare(`
      INSERT INTO documents (node_id, markdown, version, saved_at, created_at, updated_at)
      VALUES (?, ?, 1, ?, ?, ?)
    `).run(inserted.lastInsertRowid, content, now, now, now);
    syncSearch(inserted.lastInsertRowid);
  }
  logDocument(inserted.lastInsertRowid, reason, {
    type,
    parentId: parentId || null
  });
  return type === "document" ? documentRow(getDocument(inserted.lastInsertRowid)) : nodeRow(getNode(inserted.lastInsertRowid));
}
function wrap(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (res.headersSent) return next(error);
      return res.status(error.status || 500).json({
        error: error.message || "文档中心操作失败"
      });
    }
  };
}
function safeFileName(value, fallback = "未命名") {
  const cleaned = String(value || fallback).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
  return cleaned || fallback;
}
function markdownTitleFromPath(fileName) {
  return cleanTitle(fileName.replace(/\.(?:md|markdown)$/i, ""));
}
function safeZipPath(value) {
  const normalized = String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").includes("..")) {
    const error = new Error("导入包包含不安全路径");
    error.status = 400;
    throw error;
  }
  return normalized;
}
function importEntries(entries, parentId) {
  requireActiveParent(parentId);
  const created = [];
  const folderMap = new Map([["", parentId || null]]);
  const ensureFolder = parts => {
    let key = "";
    let currentParent = parentId || null;
    for (const part of parts) {
      key = key ? `${key}/${part}` : part;
      if (!folderMap.has(key)) {
        const folder = createNode({
          type: "folder",
          title: part,
          parentId: currentParent,
          reason: "import_folder"
        });
        folderMap.set(key, folder.id);
        created.push(folder);
      }
      currentParent = folderMap.get(key);
    }
    return currentParent;
  };
  for (const entry of entries) {
    const parts = safeZipPath(entry.path).split("/").filter(Boolean);
    const file = parts.pop();
    const folderId = ensureFolder(parts);
    const document = createNode({
      type: "document",
      title: markdownTitleFromPath(file),
      parentId: folderId,
      markdown: entry.markdown,
      reason: "import_document"
    });
    forceRevision(document.id, "import");
    created.push(document);
  }
  return created;
}
export function registerDocumentRoutes(app) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_IMPORT_BYTES,
      files: 1
    }
  });
  const receiveUpload = (req, res, next) => upload.single("file")(req, res, error => {
    if (!error) return next();
    return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
      error: error.code === "LIMIT_FILE_SIZE" ? "导入文件不能超过 20MB" : "导入文件无法读取"
    });
  });
  app.get("/api/documents/tree", (_req, res) => {
    const rows = db.prepare(`
      SELECT id, parent_id AS parentId, node_type AS type, title, position,
        pinned, deleted_at AS deletedAt, created_at AS createdAt, updated_at AS updatedAt
      FROM document_nodes
      ORDER BY pinned DESC, position, id
    `).all().map(nodeRow);
    res.json({
      data: rows.filter(item => !item.deletedAt),
      trash: rows.filter(item => item.deletedAt),
      searchMode,
      maxDepth: MAX_DEPTH
    });
  });
  app.get("/api/documents/overview", (_req, res) => {
    const select = `
      SELECT n.id, n.parent_id AS parentId, n.node_type AS type, n.title, n.position,
        n.pinned, n.deleted_at AS deletedAt, n.created_at AS createdAt, n.updated_at AS updatedAt,
        d.version, d.saved_at AS savedAt
      FROM document_nodes n LEFT JOIN documents d ON d.node_id = n.id
    `;
    const recent = db.prepare(`${select} WHERE n.node_type = 'document' AND n.deleted_at IS NULL ORDER BY n.updated_at DESC LIMIT 12`).all().map(row => documentRow(row, {
      includeMarkdown: false
    }));
    const pinned = db.prepare(`${select} WHERE n.node_type = 'document' AND n.deleted_at IS NULL AND n.pinned = 1 ORDER BY n.updated_at DESC LIMIT 12`).all().map(row => documentRow(row, {
      includeMarkdown: false
    }));
    const counts = db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN node_type = 'document' AND deleted_at IS NULL THEN 1 ELSE 0 END) AS documents,
        SUM(CASE WHEN node_type = 'folder' AND deleted_at IS NULL THEN 1 ELSE 0 END) AS folders,
        SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS trash
      FROM document_nodes
    `).get();
    res.json({
      recent,
      pinned,
      counts
    });
  });
  app.get("/api/documents/search", (req, res) => {
    const query = String(req.query.q || "").trim().slice(0, 200);
    if (!query) return res.json({
      data: [],
      total: 0,
      searchMode
    });
    let ids = [];
    if (query.length >= 3 && searchMode.startsWith("fts5")) {
      try {
        const expression = `"${query.replaceAll('"', '""')}"`;
        ids = db.prepare("SELECT CAST(node_id AS INTEGER) AS id FROM document_search WHERE document_search MATCH ? LIMIT 100").all(expression).map(row => row.id);
      } catch {
        ids = [];
      }
    }
    const like = `%${query}%`;
    const rows = db.prepare(`
      SELECT n.id, n.parent_id AS parentId, n.node_type AS type, n.title, n.position,
        n.pinned, n.deleted_at AS deletedAt, n.created_at AS createdAt, n.updated_at AS updatedAt,
        d.version, d.saved_at AS savedAt,
        CASE WHEN d.markdown IS NULL THEN '' ELSE substr(d.markdown, MAX(1, instr(d.markdown, ?) - 45), 140) END AS excerpt
      FROM document_nodes n LEFT JOIN documents d ON d.node_id = n.id
      WHERE n.deleted_at IS NULL AND (n.title LIKE ? OR d.markdown LIKE ? ${ids.length ? `OR n.id IN (${ids.map(() => "?").join(",")})` : ""})
      ORDER BY n.pinned DESC, n.updated_at DESC LIMIT 100
    `).all(query, like, like, ...ids).map(row => ({
      ...documentRow(row, {
        includeMarkdown: false
      }),
      excerpt: row.excerpt || ""
    }));
    res.json({
      data: rows,
      total: rows.length,
      searchMode
    });
  });
  app.get("/api/documents/events", (req, res) => {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write(`event: ready\ndata: ${JSON.stringify({
      time: nowIso()
    })}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
  });
  app.get("/api/documents/logs", (req, res) => {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 100), 500));
    const rows = db.prepare(`
      SELECT l.id, l.node_id AS nodeId, n.title, l.event_type AS eventType,
        l.detail_json AS detailJson, l.occurred_at AS occurredAt
      FROM document_logs l LEFT JOIN document_nodes n ON n.id = l.node_id
      ORDER BY l.occurred_at DESC LIMIT ?
    `).all(limit).map(row => ({
      ...row,
      detail: json(row.detailJson),
      detailJson: undefined
    }));
    res.json({
      data: rows
    });
  });
  app.get("/api/documents/export", wrap(async (req, res) => {
    const nodeId = req.query.nodeId ? Number(req.query.nodeId) : null;
    const selected = nodeId ? getNode(nodeId) : null;
    if (nodeId && (!selected || selected.deletedAt)) {
      const error = new Error("导出对象不存在");
      error.status = 404;
      throw error;
    }
    if (selected?.type === "document") {
      const document = getDocument(selected.id);
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`${safeFileName(selected.title)}.md`)}`);
      return res.send(document.markdown || "");
    }
    const rows = db.prepare(`
      SELECT n.id, n.parent_id AS parentId, n.node_type AS type, n.title,
        n.position, n.pinned, n.deleted_at AS deletedAt, n.created_at AS createdAt,
        n.updated_at AS updatedAt, d.markdown
      FROM document_nodes n LEFT JOIN documents d ON d.node_id = n.id
      WHERE n.deleted_at IS NULL ORDER BY n.position, n.id
    `).all();
    const allowed = nodeId ? new Set(descendants(nodeId).map(item => item.id)) : new Set(rows.map(row => row.id));
    const byId = new Map(rows.map(row => [row.id, row]));
    const relativePath = row => {
      const parts = [safeFileName(row.title)];
      let parent = byId.get(row.parentId);
      while (parent && (!nodeId || parent.id !== nodeId)) {
        parts.unshift(safeFileName(parent.title));
        parent = byId.get(parent.parentId);
      }
      if (selected?.type === "folder") parts.unshift(safeFileName(selected.title));
      return parts.join("/");
    };
    const zip = new JSZip();
    for (const row of rows.filter(item => allowed.has(item.id) && item.type === "document")) {
      zip.file(`${relativePath(row)}.md`, row.markdown || "");
    }
    const buffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: {
        level: 6
      }
    });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`${selected ? safeFileName(selected.title) : "文档中心"}.zip`)}`);
    res.send(buffer);
  }));
  app.post("/api/documents/import", receiveUpload, wrap(async (req, res) => {
    if (!req.file) {
      const error = new Error("请选择 Markdown 或 ZIP 文件");
      error.status = 400;
      throw error;
    }
    const parentId = req.body?.parentId ? Number(req.body.parentId) : null;
    const originalName = String(req.file.originalname || "document.md");
    const entries = [];
    if (/\.zip$/i.test(originalName)) {
      let zip;
      try {
        zip = await JSZip.loadAsync(req.file.buffer, {
          checkCRC32: true
        });
      } catch {
        const error = new Error("ZIP 文件损坏或格式不正确");
        error.status = 400;
        throw error;
      }
      const files = Object.values(zip.files).filter(file => !file.dir && /\.(?:md|markdown)$/i.test(file.name));
      if (files.length > MAX_IMPORT_DOCUMENTS) {
        const error = new Error(`单次最多导入 ${MAX_IMPORT_DOCUMENTS} 篇文档`);
        error.status = 413;
        throw error;
      }
      let totalBytes = 0;
      for (const file of files) {
        const filePath = safeZipPath(file.unsafeOriginalName || file.name);
        const data = await file.async("uint8array");
        totalBytes += data.byteLength;
        if (totalBytes > MAX_UNPACKED_BYTES) {
          const error = new Error("导入包解压后不能超过 50MB");
          error.status = 413;
          throw error;
        }
        try {
          entries.push({
            path: filePath,
            markdown: new TextDecoder("utf-8", {
              fatal: true
            }).decode(data)
          });
        } catch {
          const error = new Error(`文档 ${filePath} 不是有效的 UTF-8 文本`);
          error.status = 400;
          throw error;
        }
      }
    } else if (/\.(?:md|markdown)$/i.test(originalName)) {
      try {
        entries.push({
          path: safeZipPath(originalName),
          markdown: new TextDecoder("utf-8", {
            fatal: true
          }).decode(req.file.buffer)
        });
      } catch {
        const error = new Error("Markdown 文件不是有效的 UTF-8 文本");
        error.status = 400;
        throw error;
      }
    } else {
      const error = new Error("第一版只支持 .md、.markdown 和 .zip");
      error.status = 400;
      throw error;
    }
    if (!entries.length) {
      const error = new Error("导入包中没有 Markdown 文档");
      error.status = 400;
      throw error;
    }
    entries.forEach(entry => validateMarkdown(entry.markdown));
    const created = db.transaction(() => importEntries(entries, parentId))();
    publish("document.tree.changed", {
      reason: "import",
      count: created.length
    });
    res.status(201).json({
      ok: true,
      documents: created.filter(item => item.type === "document").length,
      nodes: created.length
    });
  }));
  app.post("/api/document-nodes", wrap((req, res) => {
    const created = db.transaction(() => createNode({
      type: String(req.body?.type || "document"),
      title: req.body?.title,
      parentId: req.body?.parentId ? Number(req.body.parentId) : null,
      markdown: req.body?.markdown || ""
    }))();
    publish("document.tree.changed", {
      reason: "create",
      nodeId: created.id
    });
    res.status(201).json(created);
  }));
  app.patch("/api/document-nodes/:id", wrap((req, res) => {
    const id = Number(req.params.id);
    const node = getNode(id);
    if (!node || node.deletedAt) {
      const error = new Error("文档或文件夹不存在");
      error.status = 404;
      throw error;
    }
    const patch = req.body || {};
    let parentId = Object.prototype.hasOwnProperty.call(patch, "parentId") ? patch.parentId ? Number(patch.parentId) : null : node.parentId;
    if (parentId === id || descendants(id).some(item => item.id === parentId)) {
      const error = new Error("不能把节点移动到自己或自己的下级中");
      error.status = 400;
      throw error;
    }
    requireActiveParent(parentId);
    if (ancestorDepth(parentId) + subtreeHeight(id) > MAX_DEPTH) {
      const error = new Error(`移动后文档层级会超过 ${MAX_DEPTH} 层`);
      error.status = 400;
      throw error;
    }
    const title = Object.prototype.hasOwnProperty.call(patch, "title") ? uniqueTitle(cleanTitle(patch.title), parentId, id) : parentId !== node.parentId ? uniqueTitle(node.title, parentId, id) : node.title;
    const position = Number.isFinite(Number(patch.position)) ? Number(patch.position) : parentId !== node.parentId ? nextPosition(parentId) : node.position;
    const pinned = Object.prototype.hasOwnProperty.call(patch, "pinned") ? patch.pinned ? 1 : 0 : node.pinned ? 1 : 0;
    const now = nowIso();
    db.prepare("UPDATE document_nodes SET parent_id = ?, title = ?, position = ?, pinned = ?, updated_at = ? WHERE id = ?").run(parentId, title, position, pinned, now, id);
    logDocument(id, "update_node", {
      parentId,
      position,
      pinned: Boolean(pinned)
    });
    if (node.type === "document") syncSearch(id);
    const updated = node.type === "document" ? documentRow(getDocument(id)) : nodeRow(getNode(id));
    publish("document.tree.changed", {
      reason: "update",
      nodeId: id
    });
    res.json(updated);
  }));
  app.post("/api/document-nodes/:id/reorder", wrap((req, res) => {
    const parentId = req.body?.parentId ? Number(req.body.parentId) : null;
    const ids = Array.isArray(req.body?.nodeIds) ? req.body.nodeIds.map(Number) : [];
    const siblings = db.prepare("SELECT id FROM document_nodes WHERE COALESCE(parent_id, 0) = COALESCE(?, 0) AND deleted_at IS NULL ORDER BY position, id").all(parentId).map(row => row.id);
    if (ids.length !== siblings.length || ids.some(id => !siblings.includes(id))) {
      const error = new Error("排序数据与当前层级不一致");
      error.status = 409;
      throw error;
    }
    const now = nowIso();
    const update = db.prepare("UPDATE document_nodes SET position = ?, updated_at = ? WHERE id = ?");
    db.transaction(() => ids.forEach((id, index) => update.run(index + 1, now, id)))();
    publish("document.tree.changed", {
      reason: "reorder",
      parentId
    });
    res.json({
      ok: true
    });
  }));
  app.post("/api/document-nodes/:id/copy", wrap((req, res) => {
    const sourceId = Number(req.params.id);
    const source = getNode(sourceId);
    if (!source || source.deletedAt) {
      const error = new Error("复制对象不存在");
      error.status = 404;
      throw error;
    }
    const parentId = Object.prototype.hasOwnProperty.call(req.body || {}, "parentId") ? req.body.parentId ? Number(req.body.parentId) : null : source.parentId;
    requireActiveParent(parentId);
    if (ancestorDepth(parentId) + subtreeHeight(sourceId) > MAX_DEPTH) {
      const error = new Error(`复制后文档层级会超过 ${MAX_DEPTH} 层`);
      error.status = 400;
      throw error;
    }
    const copyBranch = (nodeId, nextParentId, root = false) => {
      const node = getNode(nodeId);
      const document = node.type === "document" ? getDocument(nodeId) : null;
      const created = createNode({
        type: node.type,
        title: root ? `${node.title} 副本` : node.title,
        parentId: nextParentId,
        markdown: document?.markdown || "",
        reason: "copy"
      });
      const children = db.prepare("SELECT id FROM document_nodes WHERE parent_id = ? AND deleted_at IS NULL ORDER BY position, id").all(nodeId);
      for (const child of children) copyBranch(child.id, created.id, false);
      return created;
    };
    const created = db.transaction(() => copyBranch(sourceId, parentId, true))();
    publish("document.tree.changed", {
      reason: "copy",
      nodeId: created.id,
      sourceId
    });
    res.status(201).json(created);
  }));
  app.delete("/api/document-nodes/:id", wrap((req, res) => {
    const id = Number(req.params.id);
    const node = getNode(id);
    if (!node) {
      const error = new Error("节点不存在");
      error.status = 404;
      throw error;
    }
    const subtree = descendants(id);
    const ids = subtree.map(item => item.id);
    if (req.query.permanent === "1") {
      if (!node.deletedAt) {
        const error = new Error("只有回收站中的内容可以永久删除");
        error.status = 409;
        throw error;
      }
      ids.forEach(nodeId => forceRevision(nodeId, "before_permanent_delete"));
      const removeSearch = searchMode === "like" ? null : db.prepare("DELETE FROM document_search WHERE node_id = ?");
      db.transaction(() => {
        ids.forEach(nodeId => removeSearch?.run(String(nodeId)));
        db.prepare("DELETE FROM document_nodes WHERE id = ?").run(id);
      })();
      logDocument(null, "permanent_delete", {
        nodeId: id,
        count: ids.length
      });
      publish("document.tree.changed", {
        reason: "permanent_delete",
        nodeId: id
      });
      return res.json({
        ok: true,
        permanent: true,
        count: ids.length
      });
    }
    if (node.deletedAt) return res.json({
      ok: true,
      count: 0
    });
    ids.forEach(nodeId => forceRevision(nodeId, "before_delete"));
    const now = nowIso();
    const placeholders = ids.map(() => "?").join(",");
    db.transaction(() => {
      db.prepare(`UPDATE document_nodes SET deleted_at = ?, updated_at = ? WHERE id IN (${placeholders})`).run(now, now, ...ids);
      db.prepare(`DELETE FROM document_edit_leases WHERE node_id IN (${placeholders})`).run(...ids);
      if (searchMode !== "like") ids.forEach(nodeId => db.prepare("DELETE FROM document_search WHERE node_id = ?").run(String(nodeId)));
    })();
    logDocument(id, "soft_delete", {
      count: ids.length
    });
    publish("document.tree.changed", {
      reason: "delete",
      nodeId: id
    });
    res.json({
      ok: true,
      count: ids.length
    });
  }));
  app.post("/api/document-nodes/:id/restore", wrap((req, res) => {
    const id = Number(req.params.id);
    const node = getNode(id);
    if (!node || !node.deletedAt) {
      const error = new Error("回收站中没有该内容");
      error.status = 404;
      throw error;
    }
    const parent = node.parentId ? getNode(node.parentId) : null;
    const parentId = parent && !parent.deletedAt ? parent.id : null;
    const title = uniqueTitle(node.title, parentId, id);
    const ids = descendants(id).map(item => item.id);
    const placeholders = ids.map(() => "?").join(",");
    const now = nowIso();
    db.transaction(() => {
      db.prepare(`UPDATE document_nodes SET deleted_at = NULL, updated_at = ? WHERE id IN (${placeholders})`).run(now, ...ids);
      db.prepare("UPDATE document_nodes SET parent_id = ?, title = ?, position = ?, updated_at = ? WHERE id = ?").run(parentId, title, nextPosition(parentId), now, id);
    })();
    ids.forEach(syncSearch);
    logDocument(id, "restore", {
      count: ids.length,
      parentId
    });
    publish("document.tree.changed", {
      reason: "restore",
      nodeId: id
    });
    res.json({
      ok: true,
      count: ids.length
    });
  }));
  app.get("/api/documents/:id", wrap((req, res) => {
    const document = getDocument(req.params.id);
    if (!document || document.deletedAt) {
      const error = new Error("文档不存在");
      error.status = 404;
      throw error;
    }
    const lease = activeLease(document.id);
    res.json({
      ...documentRow(document),
      lease: leaseRow(lease)
    });
  }));
  app.patch("/api/documents/:id", wrap((req, res) => {
    const id = Number(req.params.id);
    const document = getDocument(id);
    if (!document || document.deletedAt) {
      const error = new Error("文档不存在");
      error.status = 404;
      throw error;
    }
    const lease = activeLease(id);
    if (!lease || lease.leaseToken !== String(req.body?.leaseToken || "")) {
      return res.status(423).json({
        error: "当前网页没有编辑权",
        lease: leaseRow(lease)
      });
    }
    const expectedVersion = Number(req.body?.version);
    if (expectedVersion !== document.version) {
      return res.status(409).json({
        error: "文档已在其他网页更新",
        currentVersion: document.version
      });
    }
    const markdown = validateMarkdown(req.body?.markdown);
    if (markdown === document.markdown) return res.json(documentRow(document));
    maybeRevision(document);
    const now = nowIso();
    db.prepare("UPDATE documents SET markdown = ?, version = version + 1, saved_at = ?, updated_at = ? WHERE node_id = ?").run(markdown, now, now, id);
    db.prepare("UPDATE document_nodes SET updated_at = ? WHERE id = ?").run(now, id);
    syncSearch(id);
    const updated = documentRow(getDocument(id));
    logDocument(id, "save", {
      version: updated.version,
      bytes: Buffer.byteLength(markdown, "utf8")
    });
    publish("document.updated", {
      nodeId: id,
      version: updated.version,
      updatedAt: now
    });
    res.json(updated);
  }));
  app.post("/api/documents/:id/lease", wrap((req, res) => {
    const id = Number(req.params.id);
    const document = getDocument(id);
    if (!document || document.deletedAt) {
      const error = new Error("文档不存在");
      error.status = 404;
      throw error;
    }
    const action = String(req.body?.action || "acquire");
    const clientId = String(req.body?.clientId || "").trim().slice(0, 100);
    const suppliedToken = String(req.body?.leaseToken || "");
    if (!clientId) {
      const error = new Error("缺少网页标识");
      error.status = 400;
      throw error;
    }
    const current = activeLease(id);
    if (action === "release") {
      if (current && current.leaseToken === suppliedToken) {
        forceRevision(id, "lease_release");
        db.prepare("DELETE FROM document_edit_leases WHERE node_id = ?").run(id);
        publish("document.lease.changed", {
          nodeId: id,
          lease: null
        });
      }
      return res.json({
        ok: true,
        lease: null
      });
    }
    if (action === "renew") {
      if (!current || current.leaseToken !== suppliedToken || current.clientId !== clientId) {
        return res.status(423).json({
          error: "编辑权已经失效",
          lease: leaseRow(current)
        });
      }
      const expiresAt = new Date(Date.now() + LEASE_TTL_MS).toISOString();
      const now = nowIso();
      db.prepare("UPDATE document_edit_leases SET expires_at = ?, updated_at = ? WHERE node_id = ?").run(expiresAt, now, id);
      return res.json({
        leaseToken: suppliedToken,
        lease: leaseRow(activeLease(id))
      });
    }
    if (current && current.clientId !== clientId && action !== "takeover") {
      return res.status(423).json({
        error: "该文档正在其他网页编辑",
        lease: leaseRow(current)
      });
    }
    const leaseToken = current?.clientId === clientId ? current.leaseToken : crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + LEASE_TTL_MS).toISOString();
    const now = nowIso();
    db.prepare(`
      INSERT INTO document_edit_leases (node_id, lease_token, client_id, username, expires_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(node_id) DO UPDATE SET lease_token = excluded.lease_token,
        client_id = excluded.client_id, username = excluded.username,
        expires_at = excluded.expires_at, updated_at = excluded.updated_at
    `).run(id, leaseToken, clientId, req.user.username, expiresAt, now);
    const lease = activeLease(id);
    logDocument(id, action === "takeover" ? "lease_takeover" : "lease_acquire", {
      clientId
    });
    publish("document.lease.changed", {
      nodeId: id,
      lease: leaseRow(lease)
    });
    res.json({
      leaseToken,
      lease: leaseRow(lease)
    });
  }));
  app.get("/api/documents/:id/revisions", wrap((req, res) => {
    const document = getDocument(req.params.id);
    if (!document) {
      const error = new Error("文档不存在");
      error.status = 404;
      throw error;
    }
    const rows = db.prepare(`
      SELECT id, node_id AS nodeId, version, reason, created_at AS createdAt,
        length(markdown) AS characters, substr(markdown, 1, 160) AS preview
      FROM document_revisions WHERE node_id = ? ORDER BY version DESC LIMIT 500
    `).all(document.id);
    res.json({
      data: rows,
      currentVersion: document.version
    });
  }));
  app.get("/api/documents/:id/revisions/:revisionId", wrap((req, res) => {
    const row = db.prepare(`
      SELECT id, node_id AS nodeId, version, markdown, reason, created_at AS createdAt
      FROM document_revisions WHERE id = ? AND node_id = ?
    `).get(Number(req.params.revisionId), Number(req.params.id));
    if (!row) {
      const error = new Error("历史版本不存在");
      error.status = 404;
      throw error;
    }
    res.json(row);
  }));
  app.post("/api/documents/:id/revisions/:revisionId/restore", wrap((req, res) => {
    const id = Number(req.params.id);
    const document = getDocument(id);
    const revision = db.prepare("SELECT * FROM document_revisions WHERE id = ? AND node_id = ?").get(Number(req.params.revisionId), id);
    if (!document || !revision) {
      const error = new Error("文档或历史版本不存在");
      error.status = 404;
      throw error;
    }
    const lease = activeLease(id);
    if (!lease || lease.leaseToken !== String(req.body?.leaseToken || "")) {
      return res.status(423).json({
        error: "恢复历史版本前需要取得编辑权",
        lease: leaseRow(lease)
      });
    }
    if (Number(req.body?.version) !== document.version) {
      return res.status(409).json({
        error: "文档已更新，请刷新后重试",
        currentVersion: document.version
      });
    }
    forceRevision(id, "before_restore");
    const now = nowIso();
    db.prepare("UPDATE documents SET markdown = ?, version = version + 1, saved_at = ?, updated_at = ? WHERE node_id = ?").run(revision.markdown, now, now, id);
    db.prepare("UPDATE document_nodes SET updated_at = ? WHERE id = ?").run(now, id);
    syncSearch(id);
    const updated = documentRow(getDocument(id));
    logDocument(id, "restore_revision", {
      revisionId: revision.id,
      fromVersion: revision.version,
      version: updated.version
    });
    publish("document.updated", {
      nodeId: id,
      version: updated.version,
      updatedAt: now
    });
    res.json(updated);
  }));
  return {
    stop() {
      for (const response of clients) response.end();
      clients.clear();
    }
  };
}
const heartbeat = setInterval(() => {
  const message = `: heartbeat ${Date.now()}\n\n`;
  for (const response of clients) {
    try {
      response.write(message);
    } catch {
      clients.delete(response);
    }
  }
  db.prepare("DELETE FROM document_edit_leases WHERE expires_at <= ?").run(nowIso());
}, 15_000);
heartbeat.unref?.();
rebuildSearch();
