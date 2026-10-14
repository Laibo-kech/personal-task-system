import { OkrButton, OkrInput } from "./okr-ui.jsx";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArchiveRestore, BookOpenText, Check, ChevronDown, ChevronRight, Clock3, Copy, Download, ExternalLink, FilePlus2, FileText, Folder, FolderOpen, FolderPlus, GripVertical, History, ListTree, Lock, MoreHorizontal, Pencil, Pin, PinOff, RefreshCw, Search, Trash2, Upload, X } from "lucide-react";
import { Crepe } from "@milkdown/crepe";
import { replaceAll } from "@milkdown/kit/utils";
import { shift } from "@floating-ui/dom";
import { api, trackAnalyticsEvent } from "./api.js";
import { useAppDialog } from "./DialogContext.jsx";
const clientId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
function formatTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}
function nodeChildren(nodes) {
  const map = new Map();
  nodes.forEach(node => {
    const key = node.parentId || 0;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(node);
  });
  map.forEach(items => items.sort((left, right) => Number(right.pinned) - Number(left.pinned) || left.position - right.position || left.id - right.id));
  return map;
}
function descendantsOf(nodes, id) {
  const children = nodeChildren(nodes);
  const ids = [];
  const walk = parentId => {
    for (const node of children.get(parentId) || []) {
      ids.push(node.id);
      walk(node.id);
    }
  };
  walk(id);
  return ids;
}
function breadcrumbFor(nodes, id) {
  const map = new Map(nodes.map(node => [node.id, node]));
  const result = [];
  let current = map.get(id);
  while (current) {
    result.unshift(current);
    current = map.get(current.parentId);
  }
  return result;
}
function headingsFrom(markdown) {
  return String(markdown || "").split("\n").flatMap((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    return match ? [{
      level: match[1].length,
      text: match[2].replace(/[*_`~[\]]/g, "").trim(),
      index
    }] : [];
  });
}
function MarkdownEditor({
  markdown,
  readOnly,
  onChange,
  documentId
}) {
  const root = useRef(null);
  const editor = useRef(null);
  const changeRef = useRef(onChange);
  const suppress = useRef(false);
  changeRef.current = onChange;
  useEffect(() => {
    let disposed = false;
    const crepe = new Crepe({
      root: root.current,
      defaultValue: markdown || "",
      features: {
        [Crepe.Feature.AI]: false,
        [Crepe.Feature.ImageBlock]: false,
        [Crepe.Feature.Latex]: false
      },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: {
          text: "开始记录..."
        },
        [Crepe.Feature.BlockEdit]: {
          slashMenu: {
            root: globalThis.document.body,
            middleware: [shift({
              padding: 8,
              crossAxis: true
            })],
            floatingUIOptions: {
              strategy: "fixed"
            }
          },
          textGroup: {
            label: "文字",
            text: {
              label: "正文"
            },
            h1: {
              label: "一级标题"
            },
            h2: {
              label: "二级标题"
            },
            h3: {
              label: "三级标题"
            },
            h4: {
              label: "四级标题"
            },
            h5: {
              label: "五级标题"
            },
            h6: {
              label: "六级标题"
            },
            quote: {
              label: "引用"
            },
            divider: {
              label: "分隔线"
            }
          },
          listGroup: {
            label: "列表",
            bulletList: {
              label: "无序列表"
            },
            orderedList: {
              label: "有序列表"
            },
            taskList: {
              label: "待办列表"
            }
          },
          advancedGroup: {
            label: "更多",
            image: null,
            codeBlock: {
              label: "代码块"
            },
            table: {
              label: "表格"
            },
            math: null
          }
        },
        [Crepe.Feature.Toolbar]: {
          boldLabel: "加粗",
          italicLabel: "斜体",
          strikethroughLabel: "删除线",
          codeLabel: "行内代码",
          linkLabel: "链接",
          latexLabel: "公式",
          aiLabel: "智能编辑"
        },
        [Crepe.Feature.LinkTooltip]: {
          inputPlaceholder: "粘贴链接..."
        },
        [Crepe.Feature.CodeMirror]: {
          searchPlaceholder: "搜索代码语言",
          noResultText: "没有匹配结果",
          copyText: "复制",
          previewToggleText: previewOnly => previewOnly ? "编辑" : "隐藏预览"
        }
      }
    });
    crepe.on(listener => {
      listener.markdownUpdated((_ctx, next, previous) => {
        if (!disposed && !suppress.current && next !== previous) changeRef.current?.(next);
      });
    });
    crepe.create().then(() => {
      if (disposed) return crepe.destroy();
      editor.current = crepe;
      crepe.setReadonly(readOnly);
      return null;
    });
    return () => {
      disposed = true;
      editor.current = null;
      crepe.destroy().catch(() => {});
    };
  }, [documentId]);
  useEffect(() => {
    editor.current?.setReadonly(readOnly);
  }, [readOnly]);
  useEffect(() => {
    const crepe = editor.current;
    if (!crepe || crepe.getMarkdown() === String(markdown || "")) return;
    suppress.current = true;
    crepe.editor.action(replaceAll(String(markdown || ""), true));
    queueMicrotask(() => {
      suppress.current = false;
    });
  }, [markdown]);
  return <div className={`document-editor ${readOnly ? "is-readonly" : ""}`} ref={root} />;
}
function TreeRow({
  node,
  nodes,
  childrenMap,
  expanded,
  selectedId,
  onContext,
  onDropNode,
  onOpen,
  onToggle
}) {
  const children = childrenMap.get(node.id) || [];
  const isExpanded = expanded.has(node.id);
  const Icon = node.type === "folder" ? isExpanded ? FolderOpen : Folder : FileText;
  return <>
    <div className={`document-tree-row ${selectedId === node.id ? "active" : ""}`} draggable onContextMenu={event => {
      event.preventDefault();
      onContext(event, node);
    }} onDragStart={event => {
      event.dataTransfer.setData("text/document-node", String(node.id));
      event.dataTransfer.effectAllowed = "move";
    }} onDragOver={event => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }} onDrop={event => {
      event.preventDefault();
      event.stopPropagation();
      onDropNode(Number(event.dataTransfer.getData("text/document-node")), node, event);
    }} onClick={() => onOpen(node)}>
      <OkrButton className="document-tree-toggle" onClick={event => {
        event.stopPropagation();
        onToggle(node.id);
      }} disabled={!children.length} title={isExpanded ? "收起" : "展开"}>
        {children.length ? isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <span />}
      </OkrButton>
      <GripVertical className="document-tree-grip" size={12} />
      <Icon className={node.type} size={14} />
      <span>{node.title}</span>
      {node.pinned && <Pin size={11} />}
      <OkrButton className="document-row-more" onClick={event => {
        event.stopPropagation();
        onContext(event, node);
      }} title="更多操作"><MoreHorizontal size={14} /></OkrButton>
    </div>
    {children.length > 0 && isExpanded && <div className="document-tree-children">
      {children.map(child => <TreeRow key={child.id} node={child} nodes={nodes} childrenMap={childrenMap} expanded={expanded} selectedId={selectedId} onContext={onContext} onDropNode={onDropNode} onOpen={onOpen} onToggle={onToggle} />)}
    </div>}
  </>;
}
function DocumentSidebar({
  nodes,
  trash,
  selectedId,
  onCreate,
  onContext,
  onDropRoot,
  onDropNode,
  onOpen,
  onSearch,
  onSelectTrash,
  search,
  searchResults,
  showTrash,
  onToggle,
  expanded
}) {
  const childrenMap = useMemo(() => nodeChildren(nodes), [nodes]);
  const trashRoots = useMemo(() => {
    const deleted = new Set(trash.map(item => item.id));
    return trash.filter(item => !item.parentId || !deleted.has(item.parentId));
  }, [trash]);
  return <div className="document-sidebar-content">
    <div className="document-sidebar-title">
      <span>文档目录</span>
      <div>
        <OkrButton onClick={() => onCreate("folder", null)} title="新建文件夹"><FolderPlus size={14} /></OkrButton>
        <OkrButton onClick={() => onCreate("document", null)} title="新建文档"><FilePlus2 size={14} /></OkrButton>
      </div>
    </div>
    <label className="document-sidebar-search"><Search size={14} /><OkrInput value={search} onChange={event => onSearch(event.target.value)} placeholder="搜索文档" />{search && <OkrButton onClick={() => onSearch("")} title="清除"><X size={13} /></OkrButton>}</label>
    {search ? <div className="document-search-results">{searchResults.map(item => <OkrButton key={item.id} onClick={() => onOpen(item)}><FileText size={13} /><span><b>{item.title}</b><small>{item.excerpt || (item.type === "folder" ? "文件夹" : "")}</small></span></OkrButton>)}{!searchResults.length && <p>没有匹配结果</p>}</div> : <>
      <OkrButton className={`document-tree-home ${!selectedId && !showTrash ? "active" : ""}`} onClick={() => onOpen(null)}><BookOpenText size={14} />文档首页</OkrButton>
      <div className="document-tree" onDragOver={event => event.preventDefault()} onDrop={event => {
        event.preventDefault();
        onDropRoot(Number(event.dataTransfer.getData("text/document-node")));
      }}>
        {(childrenMap.get(0) || []).map(node => <TreeRow key={node.id} node={node} nodes={nodes} childrenMap={childrenMap} expanded={expanded} selectedId={selectedId} onContext={onContext} onDropNode={onDropNode} onOpen={onOpen} onToggle={onToggle} />)}
        {!nodes.length && <p className="document-tree-empty">暂无文档</p>}
      </div>
      <OkrButton className={`document-trash-entry ${showTrash ? "active" : ""}`} onClick={onSelectTrash}><Trash2 size={14} /><span>回收站</span><em>{trash.length}</em></OkrButton>
      {showTrash && <div className="document-trash-list">{trashRoots.map(node => <OkrButton key={node.id} onContextMenu={event => {
          event.preventDefault();
          onContext(event, node, true);
        }}><span>{node.type === "folder" ? <Folder size={13} /> : <FileText size={13} />}{node.title}</span><small>{formatTime(node.deletedAt)}</small></OkrButton>)}</div>}
    </>}
  </div>;
}
function Overview({
  data,
  onOpen
}) {
  return <div className="document-overview">
    <header><span>个人知识空间</span><h2>文档中心</h2></header>
    <div className="document-overview-stats"><span><b>{data.counts?.documents || 0}</b>文档</span><span><b>{data.counts?.folders || 0}</b>文件夹</span><span><b>{data.counts?.trash || 0}</b>回收站</span></div>
    {!!data.pinned?.length && <section><h3><Pin size={14} />已置顶</h3><div>{data.pinned.map(item => <OkrButton key={item.id} onClick={() => onOpen(item)}><FileText size={16} /><span><b>{item.title}</b><small>{formatTime(item.updatedAt)}</small></span></OkrButton>)}</div></section>}
    <section><h3><Clock3 size={14} />最近编辑</h3><div>{(data.recent || []).map(item => <OkrButton key={item.id} onClick={() => onOpen(item)}><FileText size={16} /><span><b>{item.title}</b><small>{formatTime(item.updatedAt)}</small></span></OkrButton>)}{!data.recent?.length && <p>还没有文档</p>}</div></section>
  </div>;
}
function RevisionPanel({
  document,
  leaseToken,
  onRestore,
  onNotice
}) {
  const dialog = useAppDialog();
  const [items, setItems] = useState([]);
  const load = useCallback(() => document?.id && api(`/api/documents/${document.id}/revisions`).then(result => setItems(result.data)).catch(error => onNotice(error.message)), [document?.id, onNotice]);
  useEffect(() => {
    load();
  }, [load, document?.version]);
  return <div className="document-revisions">{items.map(item => <article key={item.id}><div><b>版本 {item.version}</b><small>{formatTime(item.createdAt)}</small></div><p>{item.preview || "空白文档"}</p><OkrButton disabled={!leaseToken} onClick={async () => {
        const confirmed = await dialog.confirm({
          title: `恢复版本 ${item.version}`,
          message: "当前内容会先保存为历史版本，然后恢复所选内容。",
          confirmLabel: "确认恢复"
        });
        if (confirmed) onRestore(item);
      }}><ArchiveRestore size={13} />恢复</OkrButton></article>)}{!items.length && <p>暂无历史版本</p>}</div>;
}
export function DocumentCenterPage({
  entryMode = "overview",
  onCloseNavigation,
  onEntryModeChange = () => {},
  onNotice
}) {
  const dialog = useAppDialog();
  const [nodes, setNodes] = useState([]);
  const [trash, setTrash] = useState([]);
  const [overview, setOverview] = useState({
    recent: [],
    pinned: [],
    counts: {}
  });
  const [selectedId, setSelectedId] = useState(null);
  const [document, setDocument] = useState(null);
  const [leaseToken, setLeaseToken] = useState("");
  const [lease, setLease] = useState(null);
  const [readMode, setReadMode] = useState(false);
  const [saveState, setSaveState] = useState("已保存");
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [showTrash, setShowTrash] = useState(false);
  const [expanded, setExpanded] = useState(new Set());
  const [contextMenu, setContextMenu] = useState(null);
  const [sideTab, setSideTab] = useState("outline");
  const [rightOpen, setRightOpen] = useState(true);
  const [localDraft, setLocalDraft] = useState(null);
  const uploadRef = useRef(null);
  const documentRef = useRef(null);
  const leaseTokenRef = useRef("");
  const draftRef = useRef("");
  const saveTimer = useRef(null);
  const saving = useRef(false);
  const pendingSave = useRef(null);
  const entryModeRef = useRef(null);
  documentRef.current = document;
  leaseTokenRef.current = leaseToken;
  const loadTree = useCallback(async () => {
    const [tree, summary] = await Promise.all([api("/api/documents/tree"), api("/api/documents/overview")]);
    setNodes(tree.data);
    setTrash(tree.trash);
    setOverview(summary);
    setExpanded(current => current.size ? current : new Set(tree.data.filter(item => item.type === "folder").map(item => item.id)));
  }, []);
  useEffect(() => {
    loadTree().catch(error => onNotice(error.message));
  }, [loadTree, onNotice]);
  useEffect(() => {
    if (!search.trim()) {
      setSearchResults([]);
      return undefined;
    }
    const timer = setTimeout(() => api(`/api/documents/search?q=${encodeURIComponent(search.trim())}`).then(result => setSearchResults(result.data)).catch(error => onNotice(error.message)), 220);
    return () => clearTimeout(timer);
  }, [search, onNotice]);
  const releaseLease = useCallback(async (id = documentRef.current?.id, token = leaseTokenRef.current) => {
    if (!id || !token) return;
    await fetch(`/api/documents/${id}/lease`, {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "release",
        clientId,
        leaseToken: token
      })
    }).catch(() => {});
    if (id === documentRef.current?.id) {
      leaseTokenRef.current = "";
      setLeaseToken("");
      setLease(null);
    }
  }, []);
  const queueSave = useCallback(async markdown => {
    pendingSave.current = markdown;
    if (saving.current) return;
    saving.current = true;
    while (pendingSave.current !== null) {
      const next = pendingSave.current;
      pendingSave.current = null;
      const current = documentRef.current;
      const token = leaseTokenRef.current;
      if (!current || !token) break;
      setSaveState("保存中");
      try {
        const updated = await api(`/api/documents/${current.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            markdown: next,
            version: current.version,
            leaseToken: token
          })
        });
        documentRef.current = updated;
        setDocument(updated);
        draftRef.current = updated.markdown;
        localStorage.removeItem(`life-task-okr:document-draft:${updated.id}`);
        setSaveState("已保存");
      } catch (error) {
        setSaveState(error.status === 409 ? "版本冲突" : error.status === 423 ? "编辑权失效" : "保存失败");
        if (error.status === 423) {
          setLeaseToken("");
          leaseTokenRef.current = "";
          setLease(error.body?.lease || null);
        }
        onNotice(error.message);
        pendingSave.current = null;
      }
    }
    saving.current = false;
  }, [onNotice]);
  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (documentRef.current && leaseTokenRef.current && draftRef.current !== documentRef.current.markdown) await queueSave(draftRef.current);
    while (saving.current) await new Promise(resolve => setTimeout(resolve, 40));
  }, [queueSave]);
  const acquireLease = useCallback(async (id, action = "acquire") => {
    try {
      const result = await api(`/api/documents/${id}/lease`, {
        method: "POST",
        body: JSON.stringify({
          action,
          clientId,
          leaseToken: leaseTokenRef.current
        })
      });
      setLeaseToken(result.leaseToken);
      leaseTokenRef.current = result.leaseToken;
      setLease(result.lease);
      setReadMode(false);
      return true;
    } catch (error) {
      if (error.status === 423) {
        setLease(error.body?.lease || null);
        setLeaseToken("");
        leaseTokenRef.current = "";
        return false;
      }
      onNotice(error.message);
      return false;
    }
  }, [onNotice]);
  const openNode = useCallback(async (node, syncEntryMode = true) => {
    onCloseNavigation?.();
    if (globalThis.matchMedia?.("(max-width: 960px)").matches) setRightOpen(false);
    setShowTrash(false);
    if (!node) {
      await flushSave();
      await releaseLease();
      setSelectedId(null);
      setDocument(null);
      setLocalDraft(null);
      if (syncEntryMode) onEntryModeChange("overview");
      return;
    }
    if (node.type === "folder") {
      await flushSave();
      await releaseLease();
      setExpanded(current => new Set(current).add(node.id));
      setSelectedId(node.id);
      setDocument(null);
      if (syncEntryMode) onEntryModeChange("overview");
      return;
    }
    if (node.id === documentRef.current?.id) return;
    await flushSave();
    await releaseLease();
    setSelectedId(node.id);
    setSaveState("已保存");
    setLeaseToken("");
    leaseTokenRef.current = "";
    if (syncEntryMode) onEntryModeChange("editor");
    try {
      const loaded = await api(`/api/documents/${node.id}`);
      documentRef.current = loaded;
      draftRef.current = loaded.markdown;
      setDocument(loaded);
      setLease(loaded.lease);
      const storedDraft = localStorage.getItem(`life-task-okr:document-draft:${node.id}`);
      setLocalDraft(storedDraft && storedDraft !== loaded.markdown ? storedDraft : null);
      await acquireLease(node.id);
    } catch (error) {
      onNotice(error.message);
    }
  }, [acquireLease, flushSave, onCloseNavigation, onEntryModeChange, onNotice, releaseLease]);
  useEffect(() => {
    if (entryModeRef.current === entryMode) return;
    entryModeRef.current = entryMode;
    const applyEntryMode = async () => {
      if (entryMode === "overview") {
        await flushSave();
        await releaseLease();
        setShowTrash(false);
        setSearch("");
        setSelectedId(null);
        setDocument(null);
        setLocalDraft(null);
        return;
      }
      if (entryMode === "trash") {
        await flushSave();
        await releaseLease();
        setShowTrash(true);
        setSearch("");
        setSelectedId(null);
        setDocument(null);
        setLocalDraft(null);
        return;
      }
      if (entryMode === "search") {
        setShowTrash(false);
        window.setTimeout(() => globalThis.document.querySelector(".document-sidebar-search input")?.focus(), 0);
        return;
      }
      const recentNode = overview.recent?.[0];
      if (!documentRef.current && recentNode) await openNode(recentNode, false);
      if (entryMode === "revisions") {
        setRightOpen(true);
        setSideTab("history");
      } else {
        setSideTab("outline");
      }
    };
    applyEntryMode().catch(error => onNotice(error.message));
  }, [entryMode, flushSave, onNotice, openNode, overview.recent, releaseLease]);
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const current = documentRef.current;
    const token = leaseTokenRef.current;
    if (current && token) fetch(`/api/documents/${current.id}/lease`, {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "release",
        clientId,
        leaseToken: token
      })
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!leaseToken || !document) return undefined;
    const timer = setInterval(() => api(`/api/documents/${document.id}/lease`, {
      method: "POST",
      body: JSON.stringify({
        action: "renew",
        clientId,
        leaseToken: leaseTokenRef.current
      })
    }).then(result => setLease(result.lease)).catch(error => {
      setLeaseToken("");
      leaseTokenRef.current = "";
      setLease(error.body?.lease || null);
      setSaveState("编辑权失效");
    }), 10_000);
    return () => clearInterval(timer);
  }, [leaseToken, document?.id]);
  useEffect(() => {
    const events = new EventSource("/api/documents/events");
    const parse = event => {
      try {
        return JSON.parse(event.data);
      } catch {
        return {};
      }
    };
    const treeChanged = () => loadTree().catch(() => {});
    const updated = async event => {
      const data = parse(event);
      if (data.nodeId !== documentRef.current?.id || leaseTokenRef.current) return;
      try {
        const loaded = await api(`/api/documents/${data.nodeId}`);
        documentRef.current = loaded;
        draftRef.current = loaded.markdown;
        setDocument(loaded);
        setSaveState("已同步");
      } catch {}
    };
    const leaseChanged = event => {
      const data = parse(event);
      if (data.nodeId !== documentRef.current?.id) return;
      setLease(data.lease || null);
      if (leaseTokenRef.current && data.lease?.clientId !== clientId) {
        leaseTokenRef.current = "";
        setLeaseToken("");
        setSaveState("编辑权已被接管");
      }
    };
    events.addEventListener("document.tree.changed", treeChanged);
    events.addEventListener("document.updated", updated);
    events.addEventListener("document.lease.changed", leaseChanged);
    return () => events.close();
  }, [loadTree]);
  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);
  const createNode = async (type, parentId) => {
    const title = await dialog.askText({
      title: type === "folder" ? "新建文件夹" : "新建文档",
      label: "名称",
      initialValue: type === "folder" ? "新文件夹" : "未命名文档"
    });
    if (!title?.trim()) return;
    try {
      const created = await api("/api/document-nodes", {
        method: "POST",
        body: JSON.stringify({
          type,
          title: title.trim(),
          parentId
        })
      });
      await loadTree();
      if (parentId) setExpanded(current => new Set(current).add(parentId));
      if (type === "document") await openNode(created);
      onNotice(type === "folder" ? "文件夹已创建" : "文档已创建");
    } catch (error) {
      onNotice(error.message);
    }
  };
  const patchNode = async (node, patch, message) => {
    try {
      const updated = await api(`/api/document-nodes/${node.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
      });
      await loadTree();
      if (updated.id === documentRef.current?.id) setDocument(current => ({
        ...current,
        ...updated
      }));
      if (message) onNotice(message);
    } catch (error) {
      onNotice(error.message);
    }
  };
  const deleteNode = async (node, permanent = false) => {
    const confirmed = await dialog.confirm({
      title: permanent ? "永久删除" : "移入回收站",
      message: permanent ? `“${node.title}”及其下级内容将无法恢复。` : `“${node.title}”及其下级内容会移入回收站。`,
      danger: permanent,
      confirmLabel: permanent ? "永久删除" : "确认删除"
    });
    if (!confirmed) return;
    try {
      if (node.id === documentRef.current?.id) {
        await flushSave();
        await releaseLease();
        setDocument(null);
        setSelectedId(null);
      }
      await api(`/api/document-nodes/${node.id}${permanent ? "?permanent=1" : ""}`, {
        method: "DELETE"
      });
      await loadTree();
      onNotice(permanent ? "已永久删除" : "已移入回收站");
    } catch (error) {
      onNotice(error.message);
    }
  };
  const dropNode = async (dragId, target, event) => {
    if (!dragId || dragId === target.id || descendantsOf(nodes, dragId).includes(target.id)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / rect.height;
    const patch = ratio < 0.3 ? {
      parentId: target.parentId,
      position: target.position - 0.25
    } : ratio > 0.7 ? {
      parentId: target.parentId,
      position: target.position + 0.25
    } : {
      parentId: target.id
    };
    const dragged = nodes.find(item => item.id === dragId);
    if (dragged) await patchNode(dragged, patch, "文档位置已更新");
  };
  const context = contextMenu?.node;
  const headings = headingsFrom(document?.markdown);
  const canEdit = Boolean(document && leaseToken && !readMode);
  const path = document ? breadcrumbFor(nodes, document.id) : [];
  const sidebar = <DocumentSidebar nodes={nodes} trash={trash} selectedId={selectedId} onCreate={createNode} onContext={(event, node, inTrash = false) => setContextMenu({
    x: event.clientX,
    y: event.clientY,
    node,
    inTrash
  })} onDropRoot={id => {
    const node = nodes.find(item => item.id === id);
    if (node) patchNode(node, {
      parentId: null
    }, "已移到根目录");
  }} onDropNode={dropNode} onOpen={openNode} onSearch={value => {
    setSearch(value);
    if (value) onEntryModeChange("search");
  }} onSelectTrash={async () => {
    await flushSave();
    await releaseLease();
    setShowTrash(true);
    setSelectedId(null);
    setDocument(null);
    setLocalDraft(null);
    onEntryModeChange("trash");
  }} search={search} searchResults={searchResults} showTrash={showTrash} onToggle={id => setExpanded(current => {
    const next = new Set(current);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  })} expanded={expanded} />;
  return <div className="document-center">
    <aside className="document-inline-sidebar" aria-label="文档目录">{sidebar}</aside>
    <div className={`document-workspace ${rightOpen && document ? "with-aside" : ""}`}>
      {!document ? <Overview data={overview} onOpen={openNode} /> : <>
        <header className="document-command-bar">
          <div className="document-breadcrumb">{path.map((item, index) => <React.Fragment key={item.id}><span>{item.title}</span>{index < path.length - 1 && <ChevronRight size={12} />}</React.Fragment>)}</div>
          <div className="document-command-actions">
            <span className={`document-save-state ${saveState.includes("失败") || saveState.includes("冲突") || saveState.includes("失效") ? "error" : ""}`}>{saveState === "已保存" || saveState === "已同步" ? <Check size={13} /> : <RefreshCw className={saveState === "保存中" ? "spin" : ""} size={13} />}{saveState}</span>
            <div className="document-mode-switch"><OkrButton className={!readMode ? "active" : ""} disabled={!leaseToken} onClick={() => setReadMode(false)}><Pencil size={13} />编辑</OkrButton><OkrButton className={readMode ? "active" : ""} onClick={async () => {
                await flushSave();
                await releaseLease();
                setReadMode(true);
              }}><BookOpenText size={13} />阅读</OkrButton></div>
            <OkrButton onClick={() => setRightOpen(value => !value)} title={rightOpen ? "收起侧栏" : "展开侧栏"}><ListTree size={15} /></OkrButton>
          </div>
        </header>
        {!leaseToken && <div className="document-lock-banner"><Lock size={15} /><span>{lease ? `该文档正在另一个网页编辑，编辑权将在 ${formatTime(lease.expiresAt)} 前自动续期。` : "当前为只读状态，可以取得编辑权后继续修改。"}</span><OkrButton onClick={() => acquireLease(document.id, lease ? "takeover" : "acquire")}>{lease ? "接管编辑" : "开始编辑"}</OkrButton></div>}
        {localDraft && <div className="document-draft-banner"><span>发现这个网页中尚未提交的本地草稿</span><OkrButton disabled={!leaseToken} onClick={() => {
            setDocument(current => ({
              ...current,
              markdown: localDraft
            }));
            draftRef.current = localDraft;
            setLocalDraft(null);
            setSaveState("待保存");
            queueSave(localDraft);
          }}>恢复草稿</OkrButton><OkrButton onClick={() => {
            localStorage.removeItem(`life-task-okr:document-draft:${document.id}`);
            setLocalDraft(null);
          }}>采用线上版本</OkrButton></div>}
        <div className="document-title-row"><OkrInput aria-label="文档标题" disabled={!canEdit} value={document.title} onChange={event => setDocument(current => ({
            ...current,
            title: event.target.value
          }))} onBlur={event => event.target.value.trim() && event.target.value.trim() !== nodes.find(item => item.id === document.id)?.title && patchNode(document, {
            title: event.target.value.trim()
          })} /><span>v{document.version} · {formatTime(document.savedAt)}</span></div>
        <MarkdownEditor key={document.id} documentId={document.id} markdown={document.markdown} readOnly={!canEdit} onChange={markdown => {
          draftRef.current = markdown;
          setDocument(current => ({
            ...current,
            markdown
          }));
          localStorage.setItem(`life-task-okr:document-draft:${document.id}`, markdown);
          setSaveState("待保存");
          if (saveTimer.current) clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => queueSave(markdown), 600);
        }} />
        {rightOpen && <aside className="document-right-panel"><nav><OkrButton className={sideTab === "outline" ? "active" : ""} onClick={() => {
              setSideTab("outline");
              onEntryModeChange("editor");
            }}><ListTree size={14} />目录</OkrButton><OkrButton className={sideTab === "history" ? "active" : ""} onClick={() => {
              setSideTab("history");
              onEntryModeChange("revisions");
            }}><History size={14} />历史</OkrButton></nav>{sideTab === "outline" ? <div className="document-outline">{headings.map((heading, outlineIndex) => <OkrButton key={`${heading.index}-${heading.text}`} style={{
              paddingLeft: `${8 + (heading.level - 1) * 10}px`
            }} onClick={() => globalThis.document.querySelectorAll(".document-editor .ProseMirror h1, .document-editor .ProseMirror h2, .document-editor .ProseMirror h3, .document-editor .ProseMirror h4, .document-editor .ProseMirror h5, .document-editor .ProseMirror h6")[outlineIndex]?.scrollIntoView({
              behavior: "smooth",
              block: "start"
            })}>{heading.text}</OkrButton>)}{!headings.length && <p>暂无标题目录</p>}</div> : <RevisionPanel document={document} leaseToken={leaseToken} onNotice={onNotice} onRestore={async revision => {
            try {
              const restored = await api(`/api/documents/${document.id}/revisions/${revision.id}/restore`, {
                method: "POST",
                body: JSON.stringify({
                  leaseToken,
                  version: documentRef.current.version
                })
              });
              documentRef.current = restored;
              draftRef.current = restored.markdown;
              setDocument(restored);
              setSaveState("已恢复");
              onNotice("历史版本已恢复");
            } catch (error) {
              onNotice(error.message);
            }
          }} />}</aside>}
      </>}
    </div>
    <div className="document-floating-actions"><OkrButton onClick={() => uploadRef.current?.click()} title="导入 Markdown 或 ZIP"><Upload size={15} /></OkrButton><OkrButton onClick={() => {
        window.location.href = `/api/documents/export${selectedId ? `?nodeId=${selectedId}` : ""}`;
      }} title="导出"><Download size={15} /></OkrButton><OkrInput ref={uploadRef} hidden type="file" accept=".md,.markdown,.zip" onChange={async event => {
        const file = event.target.files?.[0];
        if (!file) return;
        const body = new FormData();
        body.append("file", file);
        if (selectedId) body.append("parentId", String(selectedId));
        try {
          const response = await fetch("/api/documents/import", {
            method: "POST",
            credentials: "same-origin",
            body
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error);
          await loadTree();
          onNotice(`已导入 ${result.documents} 篇文档`);
          trackAnalyticsEvent({
            module: "document",
            eventName: "document.import",
            metadata: {
              count: result.documents
            }
          });
        } catch (error) {
          onNotice(error.message);
        } finally {
          event.target.value = "";
        }
      }} /></div>
    {contextMenu && context && <div className="context-menu document-context-menu" style={{
      left: contextMenu.x,
      top: contextMenu.y
    }} onClick={event => event.stopPropagation()}>
      {contextMenu.inTrash ? <><OkrButton onClick={async () => {
          await api(`/api/document-nodes/${context.id}/restore`, {
            method: "POST"
          });
          setContextMenu(null);
          await loadTree();
          onNotice("内容已恢复");
        }}><ArchiveRestore size={14} />恢复</OkrButton><OkrButton className="danger" onClick={() => {
          setContextMenu(null);
          deleteNode(context, true);
        }}><Trash2 size={14} />永久删除</OkrButton></> : <>
        <OkrButton onClick={() => {
          setContextMenu(null);
          openNode(context);
        }}><ExternalLink size={14} />打开</OkrButton>
        <OkrButton onClick={() => {
          setContextMenu(null);
          createNode("document", context.id);
        }}><FilePlus2 size={14} />新建子文档</OkrButton>
        <OkrButton onClick={() => {
          setContextMenu(null);
          createNode("folder", context.id);
        }}><FolderPlus size={14} />新建子文件夹</OkrButton>
        <OkrButton onClick={async () => {
          setContextMenu(null);
          const title = await dialog.askText({
            title: "重命名",
            label: "名称",
            initialValue: context.title
          });
          if (title?.trim()) patchNode(context, {
            title: title.trim()
          }, "名称已更新");
        }}><Pencil size={14} />重命名</OkrButton>
        <OkrButton onClick={() => {
          setContextMenu(null);
          patchNode(context, {
            pinned: !context.pinned
          }, context.pinned ? "已取消置顶" : "已置顶");
        }}>{context.pinned ? <PinOff size={14} /> : <Pin size={14} />}{context.pinned ? "取消置顶" : "置顶"}</OkrButton>
        <OkrButton onClick={async () => {
          setContextMenu(null);
          try {
            await api(`/api/document-nodes/${context.id}/copy`, {
              method: "POST",
              body: JSON.stringify({})
            });
            await loadTree();
            onNotice("副本已创建");
          } catch (error) {
            onNotice(error.message);
          }
        }}><Copy size={14} />创建副本</OkrButton>
        {context.parentId && <OkrButton onClick={() => {
          setContextMenu(null);
          patchNode(context, {
            parentId: null
          }, "已移到根目录");
        }}><FolderOpen size={14} />移到根目录</OkrButton>}
        <OkrButton className="danger" onClick={() => {
          setContextMenu(null);
          deleteNode(context);
        }}><Trash2 size={14} />移入回收站</OkrButton>
      </>}
    </div>}
  </div>;
}
export default DocumentCenterPage;
