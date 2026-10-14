import "@fontsource-variable/geist";
import "@fontsource-variable/noto-sans-sc";
import { OkrSelect } from "./okr-ui.jsx";
import { OkrProvider, ActionMenu, Badge, Checkbox, Pagination, Select } from "./okr-ui.jsx";
import { OkrActivityChart } from "./okr-charts.jsx";
import { initialPreviewColumnWidths, savePreviewColumnWidths } from "./okr-preview.js";
import "./okr-styles.css";
import "./workspace-consistency.css";
import { LibraryScroll, LibrarySortButton, libraryAriaSort, LibraryDateRange, useLibraryState } from "./LibrarySurface";
import "./database-library.css";
import { OkrButton, OkrCellPopover, OkrDialogSurface, OkrInput, OkrTextarea, OkrToolbarMenu } from "./okr-ui.jsx";
import React, { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, AlertCircle, Archive, BarChart3, Bell, BookOpenText, CalendarClock, CalendarDays, CalendarRange, ChartGantt, Check, CheckSquare, ClipboardList, ChevronDown, ChevronRight, Circle, Clipboard, ClipboardCheck, Clock3, Database, FileClock, FileSearch, FileText, Filter, Flag, FolderPlus, GripVertical, Inbox, LayoutList, LayoutDashboard, ListChecks, LoaderCircle, Lock, LogOut, Mail, Menu, MoreHorizontal, MoveRight, Moon, PanelLeftClose, PanelLeftOpen, PaintBucket, Pin, Pencil, Plus, RefreshCw, Repeat2, Search, Rows3, ScrollText, Settings, ShieldCheck, SlidersHorizontal, Split, Star, Sparkles, Square, Sun, Table2, Tag, Tags, Trash2, TrendingUp, Unlock, Undo2, UploadCloud, Workflow, X } from "lucide-react";
import { api, setAnalyticsPage, trackAnalyticsEvent } from "./api.js";
import { AnimatedChart, AnimatedKpi } from "./AnimatedChart.jsx";
import { launchCompletionParticles } from "./completion-particles.js";
import { animateTaskRowReflow, captureTaskRowPositions, taskCompletionExitDuration } from "./task-completion-motion.js";
import { horizontalRailState, horizontalWheelDelta } from "./horizontal-list-scroll.js";
import { configuredNavigation, defaultNavigationConfig, navigationRegistry, normalizeNavigationConfig, primaryNavigationPage } from "./navigation-config.js";
import { navigationIcon } from "./navigation-ui.js";
import { clampTaskColumnWidth, coreDefaultTaskColumns, shouldShowTaskTitleMeta } from "./task-table-config.js";
import { settingsRouteFromHash } from "./settings-routes.js";
import { DialogProvider, useAppDialog } from "./DialogContext.jsx";
import { LogPage } from "./LogPage.jsx";
import { ListDisplaySettings } from "./SettingsPage.jsx";
import { SettingsCenterPage } from "./SettingsCenterPage.jsx";
import { SidebarLists } from "./SidebarLists.jsx";
import { StatsPage } from "./StatsPage.jsx";
import { SopPage } from "./SopPage.jsx";
import { TagManagerPage } from "./TagManagerPage.jsx";
import { CalendarSystemPage } from "./CalendarSystemPage.jsx";
import { TaskConditionRows, createTaskCondition, defaultTaskFilterState, normalizeTaskFilters, taskFilterMatches } from "./TaskConditionBuilder.jsx";
const platform = navigator.platform || navigator.userAgentData?.platform || navigator.userAgent;
document.documentElement.dataset.platform = /mac|iphone|ipad|ipod/i.test(platform) ? "mac" : "other";
function hydrateNavigationGroups(settings) {
  return configuredNavigation(settings?.navigation_config).map(group => ({
    ...group,
    icon: navigationIcon(group.icon),
    pages: group.pages.map(page => ({
      ...page,
      icon: navigationIcon(page.icon)
    }))
  }));
}
const CalendarView = lazy(() => import("./ScheduleViews.jsx").then(module => ({
  default: module.CalendarView
})));
const GanttView = lazy(() => import("./ScheduleViews.jsx").then(module => ({
  default: module.GanttView
})));
const DocumentCenterPage = lazy(() => import("./DocumentCenterPage.jsx"));
const dateFieldOptions = [["startAt", "开始时间"], ["dueAt", "截止时间"], ["createdAt", "创建时间"], ["updatedAt", "更新时间"], ["completedAt", "完成时间"]];
const statuses = ["未完成", "进行中", "已完成", "已废弃", "暂搁置"];
const TASK_PAGE_SIZE = 50;
const defaultTaskFilters = defaultTaskFilterState();
const listColors = ["#9c5a43", "#2877d4", "#3c8b62", "#ca8a19", "#77736d", "#8b5cf6", "#db2777", "#0f766e", "#2563eb", "#b45309", "#475569", "#dc2626", "#16a34a", "#7c3aed", "#e11d48", "#f97316", "#eab308", "#65a30d", "#059669", "#0891b2", "#0284c7", "#4f46e5", "#9333ea", "#c026d3", "#be123c", "#0d9488"];
const taskColumnDefs = [{
  key: "check",
  label: "完成",
  width: 46,
  locked: true
}, {
  key: "title",
  label: "任务主信息",
  width: 390
}, {
  key: "list",
  label: "所属清单",
  width: 112
}, {
  key: "status",
  label: "状态",
  width: 84
}, {
  key: "priority",
  label: "优先",
  width: 70
}, {
  key: "project",
  label: "项目",
  width: 130
}, {
  key: "tags",
  label: "标签",
  width: 160
}, {
  key: "startAt",
  label: "开始时间",
  width: 132
}, {
  key: "dueAt",
  label: "截止时间",
  width: 132
}, {
  key: "createdAt",
  label: "创建时间",
  width: 110
}, {
  key: "source",
  label: "来源",
  width: 130
}, {
  key: "taskNo",
  label: "系统编号",
  width: 100
}, {
  key: "databaseId",
  label: "数据库 ID",
  width: 84
}, {
  key: "starred",
  label: "星标",
  width: 42
}, {
  key: "actions",
  label: "操作",
  width: 112,
  locked: true
}];
const defaultTaskColumns = coreDefaultTaskColumns;
const defaultColumnWidths = Object.fromEntries(taskColumnDefs.map(column => [column.key, column.width]));
const defaultTableSettings = {
  visibleColumns: defaultTaskColumns,
  columnWidths: defaultColumnWidths,
  groupBy: "",
  fillRules: [],
  locked: false
};
const systemViews = new Set(["calendar-system", "sop", "documents", "list-system", "settings"]);
const defaultSmartViewScopes = {
  today: {
    listId: "",
    field: "due",
    mode: "today",
    days: 1,
    openOnly: false
  },
  upcoming: {
    listId: "",
    field: "due",
    mode: "future",
    days: 7,
    openOnly: true
  }
};
function parseSmartViewScope(value, fallback) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object") return fallback;
    return {
      listId: Number(parsed.listId) || "",
      field: ["created", "due", "start", "updated", "completed"].includes(parsed.field) ? parsed.field : fallback.field,
      mode: ["today", "yesterday", "last", "next", "future"].includes(parsed.mode) ? parsed.mode : fallback.mode,
      days: Math.max(1, Math.min(Number(parsed.days) || fallback.days, 365)),
      openOnly: Boolean(parsed.openOnly)
    };
  } catch {
    return fallback;
  }
}
function projectsForList(projects, listId) {
  const normalized = Number(listId);
  if (!normalized) return projects;
  return projects.filter(project => !project.listId || project.listId === normalized);
}
function tagsForList(tags, listId) {
  const normalized = Number(listId);
  if (!normalized) return tags;
  return tags.filter(tag => !tag.listId || tag.listId === normalized);
}
function normalizeVisibleColumns(columns) {
  const requested = Array.isArray(columns) && columns.length > 0 ? columns : defaultTaskColumns;
  const allowed = new Set(taskColumnDefs.map(column => column.key));
  const visible = requested.filter(key => allowed.has(key));
  for (const key of ["check", "title", "actions"]) {
    if (!visible.includes(key)) visible.unshift(key);
  }
  return taskColumnDefs.map(column => column.key).filter(key => visible.includes(key));
}
function toInputDate(value) {
  return value ? String(value).slice(0, 10) : "";
}
function inferTaskTimePrecision(value, storedPrecision) {
  if (!value) return "date";
  if (["date", "datetime"].includes(storedPrecision)) return storedPrecision;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return "date";
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date(value));
  return time === "00:00" ? "date" : "datetime";
}
function toTaskTimeInput(value, precision) {
  if (!value) return "";
  if (inferTaskTimePrecision(value, precision) === "date") return String(value).slice(0, 10);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map(item => [item.type, item.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
}
function taskTimeApiValue(value, precision) {
  if (!value) return null;
  return precision === "date" ? value.slice(0, 10) : new Date(`${value}:00+08:00`).toISOString();
}
function formatTaskTime(value, precision) {
  if (!value) return "未设置";
  if (inferTaskTimePrecision(value, precision) === "date") return String(value).slice(0, 10);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date(value));
}
function formatDate(value) {
  if (!value) return "未设置";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  const today = new Date();
  const target = new Date(date.toLocaleString("en-US", {
    timeZone: "Asia/Shanghai"
  }));
  const current = new Date(today.toLocaleString("en-US", {
    timeZone: "Asia/Shanghai"
  }));
  const dayDiff = Math.round((new Date(target.toDateString()) - new Date(current.toDateString())) / 86400000);
  if (dayDiff === 0) return "今天";
  if (dayDiff === 1) return "明天";
  if (dayDiff === -1) return "昨天";
  return target.toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric"
  });
}
function formatDateTime(value) {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
function formatBeijingTime(value = new Date()) {
  return value.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}
function beijingGreeting(value = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    hourCycle: "h23"
  }).format(value));
  if (hour < 5) return "凌晨好";
  if (hour < 8) return "早上好";
  if (hour < 11) return "上午好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  if (hour < 20) return "傍晚好";
  if (hour < 23) return "晚上好";
  return "深夜好";
}
function beijingDate(offset = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(Date.now() + offset * 86400000));
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
const listSystemTabs = [["stats", "统计图表", BarChart3], ["logs", "日志统计", ScrollText], ["projects", "项目管理", Tags], ["tags", "标签管理", Tag], ["rules", "规则管理", SlidersHorizontal], ["display", "显示设置", LayoutList], ["cards", "卡片批阅", CheckSquare]];
function ListSystemWorkspace({
  activeTab,
  onTabChange,
  pages
}) {
  return <section className="list-system-workspace">
      <nav className="list-system-tabs" aria-label="清单系统功能">
        {listSystemTabs.map(([id, label, Icon]) => <OkrButton className={activeTab === id ? "active" : ""} key={id} onClick={() => {
        onTabChange(id);
        trackAnalyticsEvent({
          module: "task",
          eventName: "list_system.tab_open",
          metadata: {
            tab: id
          }
        });
      }}>
            <Icon size={15} /><span>{label}</span>
          </OkrButton>)}
      </nav>
      <div className="list-system-content">{pages[activeTab]}</div>
    </section>;
}
function TaskCardReview({
  initialListId,
  lists,
  onNotice,
  onOpenTask,
  onRefresh
}) {
  const [listId, setListId] = useState(initialListId || "");
  const [mode, setMode] = useState("recent");
  const [items, setItems] = useState([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [motion, setMotion] = useState("enter");
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      view: "all",
      status: "未完成",
      limit: "200",
      offset: "0",
      sort: "created"
    });
    if (listId) params.set("listId", listId);
    setLoading(true);
    api(`/api/tasks?${params}`, {
      signal: controller.signal
    }).then(result => {
      const next = [...result.data];
      if (mode === "random") next.sort(() => Math.random() - 0.5);
      setItems(next);
      setIndex(0);
      setMotion("enter");
    }).catch(error => error.name !== "AbortError" && onNotice(error.message)).finally(() => !controller.signal.aborted && setLoading(false));
    return () => controller.abort();
  }, [listId, mode, reloadKey, onNotice]);
  const current = items[index] || null;
  const move = direction => {
    if (!items.length) return;
    setMotion(direction > 0 ? "leave-left" : "leave-right");
    window.setTimeout(() => {
      setIndex(value => (value + direction + items.length) % items.length);
      setMotion(direction > 0 ? "enter-right" : "enter-left");
      window.requestAnimationFrame(() => window.setTimeout(() => setMotion("enter"), 20));
    }, 180);
  };
  const update = async (patch, message, remove = false) => {
    if (!current) return;
    await api(`/api/tasks/${current.id}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
    onNotice(message);
    await onRefresh();
    if (remove) {
      setItems(rows => rows.filter(item => item.id !== current.id));
      setIndex(value => Math.max(0, Math.min(value, items.length - 2)));
    } else {
      setItems(rows => rows.map(item => item.id === current.id ? {
        ...item,
        ...patch
      } : item));
    }
  };
  return <section className="task-card-review">
      <div className="card-review-toolbar">
        <div><span>任务清单</span><h2>卡片批阅</h2></div>
        <OkrSelect value={listId} onChange={event => setListId(event.target.value ? Number(event.target.value) : "")}>
          <option value="">全部清单</option>{lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}
        </OkrSelect>
        <OkrSelect value={mode} onChange={event => setMode(event.target.value)}><option value="recent">最近创建优先</option><option value="random">随机顺序</option></OkrSelect>
        <OkrButton className="icon-only" onClick={() => setReloadKey(value => value + 1)} title="重新读取"><RefreshCw size={15} /></OkrButton>
      </div>
      <div className="card-review-stage">
        {loading ? <div className="table-state"><LoaderCircle className="spin" size={20} />正在准备卡片</div> : !current ? <div className="table-state empty">当前范围没有未完成任务</div> : <article className={`review-card ${motion}`} key={current.id} onClick={() => onOpenTask(current.id)}>
            <header><span style={{
            "--list-color": current.listColor || "#9c5a43"
          }}><i />{current.listName}</span><b>{index + 1} / {items.length}</b></header>
            <div className="review-card-body"><small>{current.taskNo} · 数据库 #{current.id}</small><h2>{current.title}</h2>{current.notes && <p>{current.notes}</p>}</div>
            <div className="review-card-meta"><StatusPill status={current.status} />{current.projectName && <span>{current.projectName}</span>}{(current.tagDetails || []).map(tag => <span key={tag.id} style={{
            "--tag-color": tag.color
          }}>{tag.name}</span>)}{current.dueAt && <time>截止 {String(current.dueAt).slice(0, 10)}</time>}</div>
            <footer>
              <OkrButton onClick={() => move(-1)} title="上一张"><ChevronRight className="flip-x" size={16} /></OkrButton>
              <OkrButton className="complete" onClick={() => update({
            status: "已完成"
          }, "任务已完成", true)}><Check size={15} />已完成</OkrButton>
              <OkrButton className="discard" onClick={() => update({
            status: "已废弃"
          }, "任务已放弃", true)}><Trash2 size={15} />已放弃</OkrButton>
              <OkrButton onClick={() => update({
            starred: !current.starred
          }, current.starred ? "已取消星标" : "已加星标")}><Star size={15} fill={current.starred ? "currentColor" : "none"} />星标</OkrButton>
              <OkrButton onClick={() => onOpenTask(current.id)}><Pencil size={15} />详情</OkrButton>
              <OkrButton onClick={() => move(1)} title="下一张"><ChevronRight size={16} /></OkrButton>
            </footer>
          </article>}
      </div>
    </section>;
}
function SmartViewScopeBar({
  lists,
  scope,
  view,
  onChange
}) {
  const label = view === "today" ? "今天" : "即将到来";
  return <section className="smart-view-scope" aria-label={`${label}筛选范围`}>
      <b>{label}范围</b>
      <label>所属清单<OkrSelect aria-label={`${label}所属清单`} value={scope.listId || ""} onChange={event => onChange({
        ...scope,
        listId: event.target.value ? Number(event.target.value) : ""
      })}><option value="">全部清单</option>{lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</OkrSelect></label>
      <label>日期字段<OkrSelect value={scope.field} onChange={event => onChange({
        ...scope,
        field: event.target.value
      })}><option value="due">截止日期</option><option value="created">创建日期</option><option value="start">开始日期</option><option value="updated">更新时间</option><option value="completed">完成日期</option></OkrSelect></label>
      <label>动态范围<OkrSelect value={scope.mode} onChange={event => onChange({
        ...scope,
        mode: event.target.value
      })}><option value="today">今日</option><option value="yesterday">昨日</option><option value="last">近 N 天</option><option value="next">今日起 N 天</option><option value="future">未来 N 天</option></OkrSelect></label>
      {["last", "next", "future"].includes(scope.mode) && <label>N 天<OkrInput min="1" max="365" type="number" value={scope.days} onChange={event => onChange({
        ...scope,
        days: Math.max(1, Math.min(Number(event.target.value) || 1, 365))
      })} /></label>}
      <label className="scope-check"><OkrInput type="checkbox" checked={scope.openOnly} onChange={event => onChange({
        ...scope,
        openOnly: event.target.checked
      })} />仅未完成</label>
      <span>按每天日期自动计算，配置已保存</span>
    </section>;
}
function App() {
  const dialog = useAppDialog();
  const initialSettingsRoute = settingsRouteFromHash(window.location.hash);
  const [user, setUser] = useState(undefined);
  const [meta, setMeta] = useState({
    lists: [],
    tags: [],
    projects: [],
    folders: [],
    modes: [],
    modeItems: [],
    settings: {}
  });
  const [tasks, setTasks] = useState([]);
  const [groupResult, setGroupResult] = useState({
    groupBy: "",
    groups: []
  });
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [view, setView] = useState(() => initialSettingsRoute ? "settings" : "all");
  const [taskView, setTaskView] = useState(null);
  const [moduleTabs, setModuleTabs] = useState({
    list: "stats",
    calendar: "workspace",
    sop: "today",
    document: "overview",
    mail: "inbox",
    node: "workbench",
    settings: initialSettingsRoute?.themeId || "home"
  });
  const lastPageByGroupRef = useRef({});
  const landingInitializedRef = useRef(Boolean(initialSettingsRoute));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("life-task-okr:sidebar-collapsed") === "1");
  const [commandOpen, setCommandOpen] = useState(false);
  const [resolvedTheme, setResolvedTheme] = useState("light");
  const [activeModeId, setActiveModeId] = useState(null);
  const [calendarDateField, setCalendarDateField] = useState(null);
  const [ganttStartField, setGanttStartField] = useState(null);
  const [ganttEndField, setGanttEndField] = useState(null);
  const [hasSavedLibraryList] = useState(() => {
    try {
      return localStorage.getItem("life-library:v1:tasks:list") !== null;
    } catch {
      return false;
    }
  });
  const [listId, setListId] = useLibraryState("tasks:list", null);
  const [query, setQuery] = useLibraryState("tasks:query", "");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filters, setFilters] = useLibraryState("tasks:advanced", {
    logic: "and",
    conditions: [],
    sort: "created"
  });
  const [quickFilters, setQuickFilters] = useLibraryState("tasks:filters", {
    status: "未完成",
    projectId: "",
    priority: "",
    dueFrom: "",
    dueTo: ""
  });
  const patchQuickFilters = patch => setQuickFilters(current => ({
    ...current,
    ...patch
  }));
  const resetLibraryFilters = () => {
    setQuery("");
    setQuickFilters({
      status: "",
      projectId: "",
      priority: "",
      dueFrom: "",
      dueTo: ""
    });
    setFilters(current => ({
      logic: "and",
      conditions: [],
      sort: current.sort
    }));
  };
  const [smartViewScopes, setSmartViewScopes] = useState(defaultSmartViewScopes);
  const [filterTemplates, setFilterTemplates] = useState([]);
  const [tableSettings, setTableSettings] = useState(defaultTableSettings);
  const [tableSettingsScope, setTableSettingsScope] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [fillOpen, setFillOpen] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState(() => new Set());
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [listDialogOpen, setListDialogOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [undoTask, setUndoTask] = useState(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const undoLock = useRef(false);
  const undoTimer = useRef(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const announce = useCallback(message => {
    setToast(message);
    clearTimeout(window.__taskToast);
    window.__taskToast = setTimeout(() => setToast(""), 2600);
  }, []);
  useEffect(() => () => clearTimeout(undoTimer.current), []);
  const undoCompletion = async () => {
    if (!undoTask || undoLock.current) return;
    const original = undoTask;
    undoLock.current = true;
    setUndoBusy(true);
    clearTimeout(undoTimer.current);
    try {
      await new Promise(resolve => setTimeout(resolve, Math.max(0, original.readyAt - Date.now())));
      await api(`/api/tasks/${original.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: original.status
        })
      });
      setUndoTask(null);
      refreshTasks();
      await refreshMeta();
      announce("已撤销完成，任务已恢复");
    } catch (error) {
      setUndoTask(current => current ? {
        ...current,
        error: error.message
      } : current);
    } finally {
      undoLock.current = false;
      setUndoBusy(false);
    }
  };
  useEffect(() => {
    localStorage.setItem("life-task-okr:sidebar-collapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);
  useEffect(() => {
    const openCommand = event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", openCommand);
    return () => window.removeEventListener("keydown", openCommand);
  }, []);
  const refreshMeta = useCallback(async () => {
    const next = await api("/api/meta");
    setMeta(next);
    setTaskView(current => current || (next.settings.default_task_view === "calendar" ? "table" : next.settings.default_task_view) || "table");
    setCalendarDateField(current => current || next.settings.calendar_date_field || "dueAt");
    setGanttStartField(current => current || next.settings.gantt_start_field || "startAt");
    setGanttEndField(current => current || next.settings.gantt_end_field || "dueAt");
    setActiveModeId(current => next.modes.some(mode => mode.id === current) ? current : next.modes.find(mode => mode.isDefault)?.id || next.modes[0]?.id);
    const nextSmartViewScopes = {
      today: parseSmartViewScope(next.settings.today_view_scope, defaultSmartViewScopes.today),
      upcoming: parseSmartViewScope(next.settings.upcoming_view_scope, defaultSmartViewScopes.upcoming)
    };
    setSmartViewScopes(current => JSON.stringify(current) === JSON.stringify(nextSmartViewScopes) ? current : nextSmartViewScopes);
  }, []);
  useEffect(() => {
    if (!user || meta.settings?.navigation_config || localStorage.getItem("life-task-okr:navigation-server-migrated:v1")) return;
    const rawOrder = localStorage.getItem("life-task-okr:sidebar-section-order:v1");
    const rawOpen = localStorage.getItem("life-task-okr:sidebar-section-open:v1");
    if (!rawOrder && !rawOpen) return;
    let order = [];
    let open = {};
    try {
      order = JSON.parse(rawOrder || "[]");
    } catch {
      order = [];
    }
    try {
      open = JSON.parse(rawOpen || "{}");
    } catch {
      open = {};
    }
    const defaults = defaultNavigationConfig();
    const groupById = new Map(defaults.groups.map(group => [group.id, group]));
    const ordered = [...(Array.isArray(order) ? order : []).filter((id, index, values) => groupById.has(id) && values.indexOf(id) === index), ...defaults.groups.map(group => group.id).filter(id => !(Array.isArray(order) ? order : []).includes(id))];
    const migrated = normalizeNavigationConfig({
      version: 1,
      groups: ordered.map(id => ({
        ...groupById.get(id),
        defaultOpen: typeof open[id] === "boolean" ? open[id] : groupById.get(id).defaultOpen
      }))
    });
    api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({
        navigation_config: migrated
      })
    }).then(async () => {
      localStorage.setItem("life-task-okr:navigation-server-migrated:v1", "1");
      await refreshMeta();
    }).catch(error => announce(`旧导航配置迁移失败：${error.message}`));
  }, [announce, meta.settings?.navigation_config, refreshMeta, user]);
  useEffect(() => {
    const settings = meta.settings || {};
    const applyTheme = () => {
      let theme = settings.theme_mode || "auto";
      if (theme === "auto") {
        const minutes = new Date().getHours() * 60 + new Date().getMinutes();
        const [lightHour, lightMinute] = (settings.light_start || "07:00").split(":").map(Number);
        const [darkHour, darkMinute] = (settings.dark_start || "19:00").split(":").map(Number);
        const lightStart = lightHour * 60 + lightMinute;
        const darkStart = darkHour * 60 + darkMinute;
        theme = minutes >= lightStart && minutes < darkStart ? "light" : "dark";
      }
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.colorScheme = theme;
      setResolvedTheme(theme);
    };
    applyTheme();
    const timer = window.setInterval(applyTheme, 60000);
    return () => window.clearInterval(timer);
  }, [meta.settings]);
  useEffect(() => {
    api("/api/auth/me").then(data => setUser(data)).catch(() => setUser(null));
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    setPage(0);
  }, [view, listId, debouncedQuery, filters, quickFilters, taskView, tableSettings.groupBy]);
  useEffect(() => {
    if (!user) return;
    refreshMeta().catch(error => announce(error.message));
  }, [user, refreshMeta, announce]);
  useEffect(() => {
    if (!user || initialSettingsRoute || landingInitializedRef.current || !taskView || meta.lists.length === 0) return;
    const landingList = meta.lists.find(list => list.name?.trim() === "生活任务") || meta.lists.find(list => list.isDefault) || meta.lists[0];
    landingInitializedRef.current = true;
    lastPageByGroupRef.current.tasks = "all";
    setView("all");
    setTaskView("table");
    if (!hasSavedLibraryList) setListId(landingList?.id || null);
    setPage(0);
  }, [initialSettingsRoute, meta.lists, taskView, user]);
  useEffect(() => {
    if (!user) return;
    setAnalyticsPage(view);
    const module = view === "calendar-system" ? "calendar" : view === "sop" ? "sop" : view === "documents" ? "document" : view === "settings" ? "settings" : "task";
    trackAnalyticsEvent({
      module,
      eventName: "page.open",
      page: view,
      listId,
      metadata: {
        view
      }
    });
  }, [user, view, listId]);
  useEffect(() => {
    if (!user || systemViews.has(view) || !taskView) return;
    trackAnalyticsEvent({
      module: "task",
      eventName: "task.view_switch",
      listId,
      metadata: {
        view: taskView
      }
    });
  }, [user, view, taskView, listId]);
  useEffect(() => {
    if (!user) return undefined;
    const onError = event => trackAnalyticsEvent({
      module: "system",
      eventName: "frontend.error",
      result: "failed",
      errorCode: event.error?.name || "window_error",
      metadata: {
        line: event.lineno,
        column: event.colno
      }
    });
    const onRejection = event => trackAnalyticsEvent({
      module: "system",
      eventName: "frontend.unhandled_rejection",
      result: "failed",
      errorCode: event.reason?.name || "unhandled_rejection"
    });
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [user]);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const requestedScope = listId ? `list:${listId}` : "all";
    const query = listId ? `?listId=${listId}` : "";
    setTableSettingsScope(null);
    api(`/api/table-settings${query}`, {
      signal: controller.signal
    }).then(settings => {
      setTableSettings({
        visibleColumns: normalizeVisibleColumns(settings.visibleColumns),
        columnWidths: initialPreviewColumnWidths(requestedScope, {
          ...defaultColumnWidths,
          ...settings.columnWidths
        }),
        groupBy: settings.groupBy || "",
        fillRules: Array.isArray(settings.fillRules) ? settings.fillRules : [],
        locked: Boolean(settings.locked)
      });
      setTableSettingsScope(requestedScope);
    }).catch(error => {
      if (error.name !== "AbortError") {
        setTableSettings(defaultTableSettings);
        setTableSettingsScope(requestedScope);
        announce(error.message);
      }
    });
    return () => controller.abort();
  }, [user, listId, announce]);
  const refreshFilterTemplates = useCallback(async () => {
    if (!listId) {
      setFilterTemplates([]);
      return;
    }
    const result = await api(`/api/filter-templates?listId=${listId}`);
    setFilterTemplates(result.data);
  }, [listId]);
  useEffect(() => {
    if (!user) return;
    refreshFilterTemplates().catch(error => announce(error.message));
  }, [user, refreshFilterTemplates, announce]);
  useEffect(() => {
    if (!user || systemViews.has(view) || taskView !== "table") return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      view,
      limit: String(TASK_PAGE_SIZE),
      offset: String(page * TASK_PAGE_SIZE),
      sort: filters.sort
    });
    const smartScope = ["today", "upcoming"].includes(view) ? smartViewScopes[view] || defaultSmartViewScopes[view] : null;
    const effectiveListId = smartScope ? smartScope.listId : listId;
    if (tableSettings.groupBy) params.set("groupBy", tableSettings.groupBy);
    if (effectiveListId) params.set("listId", String(effectiveListId));
    if (debouncedQuery) params.set("q", debouncedQuery);
    if (filters.conditions?.length) {
      params.set("filter", JSON.stringify({
        logic: filters.logic,
        conditions: filters.conditions
      }));
    }
    for (const [key, value] of Object.entries(quickFilters)) {
      if (value) params.set(key, value);
    }
    if (filters.status) params.set("status", filters.status);
    if (filters.projectId) params.set("projectId", filters.projectId);
    if (filters.tagId) params.set("tagId", filters.tagId);
    if (filters.source) params.set("source", filters.source);
    if (filters.taskNo) params.set("taskNo", filters.taskNo);
    if (filters.databaseId) params.set("databaseId", filters.databaseId);
    if (filters.startFrom) params.set("startFrom", filters.startFrom);
    if (filters.startTo) params.set("startTo", filters.startTo);
    if (filters.startPreset) params.set("startPreset", filters.startPreset);
    if (filters.dueFrom) params.set("dueFrom", filters.dueFrom);
    if (filters.dueTo) params.set("dueTo", filters.dueTo);
    if (filters.duePreset) params.set("duePreset", filters.duePreset);
    if (filters.createdFrom) params.set("createdFrom", filters.createdFrom);
    if (filters.createdTo) params.set("createdTo", filters.createdTo);
    if (filters.createdPreset) params.set("createdPreset", filters.createdPreset);
    if (filters.starred) params.set("starred", "true");
    if (filters.important) params.set("important", "true");
    if (filters.urgent) params.set("urgent", "true");
    if (smartScope) {
      params.set("smartField", smartScope.field);
      params.set("smartMode", smartScope.mode);
      params.set("smartDays", String(smartScope.days));
      if (smartScope.openOnly) params.set("smartOpen", "true");
    }
    setLoading(true);
    api(`/api/tasks?${params}`, {
      signal: controller.signal
    }).then(result => {
      const nextTasks = Array.isArray(result?.data) ? result.data : [];
      const nextTotal = Number(result?.total);
      setTasks(nextTasks);
      setGroupResult({
        groupBy: result.groupBy || "",
        groups: result.groups || []
      });
      setTotal(current => Number.isFinite(nextTotal) ? nextTotal : Math.max(current, page * TASK_PAGE_SIZE + nextTasks.length));
    }).catch(error => {
      if (error.name !== "AbortError") announce(error.message);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [user, view, listId, debouncedQuery, filters, quickFilters, page, taskView, refreshKey, smartViewScopes, tableSettings.groupBy, announce]);
  const activeList = meta.lists.find(list => list.id === listId);
  const adminNavigationGroups = useMemo(() => hydrateNavigationGroups(meta.settings), [meta.settings]);
  const adminNavigationPages = useMemo(() => adminNavigationGroups.flatMap(group => group.pages.map(page => ({
    ...page,
    groupId: group.id,
    groupLabel: group.label
  }))), [adminNavigationGroups]);
  const activeNavigationId = useMemo(() => {
    if (view === "list-system") return `list-${moduleTabs.list}`;
    if (view === "calendar-system") return `calendar-${moduleTabs.calendar}`;
    if (view === "sop") return `sop-${moduleTabs.sop}`;
    if (view === "documents") return `documents-${moduleTabs.document}`;
    if (view === "mail") return `mail-${moduleTabs.mail}`;
    if (view === "nodes") return `node-${moduleTabs.node}`;
    if (view === "settings") return `settings-${moduleTabs.settings}`;
    if (taskView === "calendar") return "task-calendar";
    if (taskView === "gantt") return "task-gantt";
    return view;
  }, [moduleTabs, taskView, view]);
  const activeNavigationPage = adminNavigationPages.find(item => item.id === activeNavigationId) || adminNavigationPages[0];
  const activeNavigationGroup = adminNavigationGroups.find(group => group.pages.some(page => page.id === activeNavigationId)) || adminNavigationGroups[0];
  const currentProjects = useMemo(() => projectsForList(meta.projects, listId), [meta.projects, listId]);
  const visibleColumns = useMemo(() => normalizeVisibleColumns(tableSettings.visibleColumns), [tableSettings.visibleColumns]);
  const activeFilterCount = Number(filters.conditions?.length || 0);
  const pageCount = Math.max(Math.ceil(total / TASK_PAGE_SIZE), 1);
  const currentTableSettingsScope = listId ? `list:${listId}` : "all";
  const refreshTasks = () => setRefreshKey(value => value + 1);
  useEffect(() => {
    setSelectedTaskIds(new Set());
  }, [listId, page, view, filters, debouncedQuery]);
  const runBatchAction = async (action, extra = {}) => {
    const ids = [...selectedTaskIds];
    if (ids.length === 0) {
      announce("请先勾选任务");
      return;
    }
    await api("/api/tasks/batch", {
      method: "POST",
      body: JSON.stringify({
        ids,
        action,
        ...extra
      })
    });
    setSelectedTaskIds(new Set());
    refreshTasks();
    await refreshMeta();
    announce(action === "transfer" ? "所选任务已转移" : "批量操作已完成");
  };
  const saveTableSettings = async (nextSettings, message) => {
    const normalized = {
      visibleColumns: normalizeVisibleColumns(nextSettings.visibleColumns),
      columnWidths: {
        ...defaultColumnWidths,
        ...nextSettings.columnWidths
      },
      groupBy: nextSettings.groupBy || "",
      fillRules: Array.isArray(nextSettings.fillRules) ? nextSettings.fillRules : [],
      locked: Boolean(nextSettings.locked)
    };
    try {
      await api("/api/table-settings", {
        method: "PATCH",
        body: JSON.stringify({
          listId,
          ...normalized
        })
      });
      setTableSettings(normalized);
      savePreviewColumnWidths(listId ? `list:${listId}` : "all", normalized.columnWidths);
      if (message) announce(message);
      return true;
    } catch (error) {
      announce(error.message || "视图保存失败，请重试");
      return false;
    }
  };
  const saveFilterTemplate = async () => {
    if (!listId) {
      announce("请先选择一个清单，再保存视图");
      return;
    }
    const name = await dialog.askText({
      title: "保存当前视图",
      label: "视图名称",
      placeholder: "例如：本周待处理"
    });
    if (!name?.trim()) return;
    try {
      await api("/api/filter-templates", {
        method: "POST",
        body: JSON.stringify({
          listId,
          name: name.trim(),
          filters: {
            ...filters,
            quickFilters,
            viewSettings: {
              visibleColumns: tableSettings.visibleColumns,
              columnWidths: tableSettings.columnWidths,
              groupBy: tableSettings.groupBy,
              fillRules: tableSettings.fillRules
            }
          },
          sort: filters.sort
        })
      });
      await refreshFilterTemplates();
      announce("当前视图已保存");
    } catch (error) {
      announce(error.message || "视图保存失败");
    }
  };
  const applyFilterTemplate = async template => {
    if (tableSettings.locked) {
      announce("请先解锁视图");
      return false;
    }
    if (template.filters?.viewSettings && !(await saveTableSettings({
      ...tableSettings,
      ...template.filters.viewSettings
    }))) return false;
    setQuickFilters(template.filters?.quickFilters || {
      status: "",
      projectId: "",
      priority: "",
      dueFrom: "",
      dueTo: ""
    });
    setFilters(normalizeTaskFilters({
      ...template.filters,
      sort: template.sort || template.filters?.sort || "created"
    }));
    trackAnalyticsEvent({
      module: "task",
      eventName: "filter_template.apply",
      listId,
      objectType: "filter_template",
      objectId: template.id
    });
    announce(`已切换到视图：${template.name}`);
    return true;
  };
  const toggleTheme = async () => {
    const nextTheme = resolvedTheme === "dark" ? "light" : "dark";
    await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({
        theme_mode: nextTheme
      })
    });
    await refreshMeta();
    announce(nextTheme === "dark" ? "已切换到黑夜模式" : "已切换到白天模式");
  };
  const createFolderFromSidebar = async () => {
    const name = await dialog.askText({
      title: "新建文件夹",
      label: "文件夹名称",
      placeholder: "例如：工作清单"
    });
    if (!name?.trim()) return;
    await api("/api/list-folders", {
      method: "POST",
      body: JSON.stringify({
        name: name.trim()
      })
    });
    await refreshMeta();
    announce("文件夹已创建");
  };
  const requestClipboardPermission = async () => {
    if (!window.isSecureContext || !navigator.clipboard) {
      trackAnalyticsEvent({
        module: "task",
        eventName: "clipboard.permission",
        result: "failed",
        errorCode: "insecure_context"
      });
      announce("当前地址不是安全连接，浏览器不会开放自动读取剪切板权限");
      return;
    }
    try {
      if (navigator.permissions?.query) {
        const permission = await navigator.permissions.query({
          name: "clipboard-read"
        });
        if (permission.state === "denied") {
          trackAnalyticsEvent({
            module: "task",
            eventName: "clipboard.permission",
            result: "failed",
            errorCode: "permission_denied"
          });
          announce("剪切板权限已被浏览器拒绝，请在地址栏网站设置中允许");
          return;
        }
      }
      await navigator.clipboard.readText();
      trackAnalyticsEvent({
        module: "task",
        eventName: "clipboard.permission",
        result: "success"
      });
      announce("剪切板读取权限已可用");
    } catch {
      trackAnalyticsEvent({
        module: "task",
        eventName: "clipboard.permission",
        result: "failed",
        errorCode: "permission_error"
      });
      announce("浏览器暂未授权，请在弹出的权限提示中选择允许");
    }
  };
  const openTaskById = useCallback(async taskId => {
    if (!taskId) return;
    const task = await api(`/api/tasks/${taskId}`);
    setSelectedTask(task);
  }, []);
  const switchView = nextView => {
    if (nextView !== "settings" && window.location.hash.startsWith("#settings")) {
      history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
    }
    setView(nextView);
    if (["all", "today", "upcoming"].includes(nextView)) setListId(null);
    setMobileNavOpen(false);
  };
  const navigateAdminTarget = useCallback(target => {
    const tabKey = target.view === "list-system" ? "list" : target.view === "calendar-system" ? "calendar" : target.view === "sop" ? "sop" : target.view === "documents" ? "document" : target.view === "mail" ? "mail" : target.view === "nodes" ? "node" : target.view === "settings" ? "settings" : null;
    if (tabKey && target.tab) {
      setModuleTabs(current => ({
        ...current,
        [tabKey]: target.tab
      }));
    }
    if (target.view !== "settings" && window.location.hash.startsWith("#settings")) {
      history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
    }
    setView(target.view);
    if (target.taskView) setTaskView(target.taskView);
    if (["all", "today", "upcoming", "starred"].includes(target.view)) setListId(null);
    setMobileNavOpen(false);
    setCommandOpen(false);
    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }, []);
  useEffect(() => {
    if (!activeNavigationGroup?.id || !activeNavigationPage?.id) return;
    lastPageByGroupRef.current[activeNavigationGroup.id] = activeNavigationPage.id;
  }, [activeNavigationGroup?.id, activeNavigationPage?.id]);
  const navigateAdminGroup = useCallback(group => {
    const remembered = lastPageByGroupRef.current[group.id];
    const page = primaryNavigationPage(group, remembered);
    if (page?.target) navigateAdminTarget(page.target);
  }, [navigateAdminTarget]);
  useEffect(() => {
    if (!adminNavigationPages.length || adminNavigationPages.some(page => page.id === activeNavigationId)) return;
    const registeredGroup = navigationRegistry.find(group => group.pages.some(page => page.id === activeNavigationId));
    const visibleGroup = adminNavigationGroups.find(group => group.id === registeredGroup?.id);
    const fallback = visibleGroup?.pages[0] || adminNavigationPages[0];
    if (fallback?.target) navigateAdminTarget(fallback.target);
  }, [activeNavigationId, adminNavigationGroups, adminNavigationPages, navigateAdminTarget]);
  const selectTaskList = useCallback(id => {
    if (window.location.hash.startsWith("#settings")) {
      history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
    }
    setListId(id || null);
    setView("all");
    setTaskView("table");
    setMobileNavOpen(false);
    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }, []);
  const saveSmartViewScope = async (targetView, nextScope) => {
    const normalized = parseSmartViewScope(nextScope, defaultSmartViewScopes[targetView]);
    setSmartViewScopes(current => ({
      ...current,
      [targetView]: normalized
    }));
    await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({
        [`${targetView}_view_scope`]: JSON.stringify(normalized)
      })
    });
  };
  if (user === undefined) return <BootScreen />;
  if (!user) return <LoginPage onLogin={nextUser => {
    landingInitializedRef.current = Boolean(initialSettingsRoute);
    setUser(nextUser);
  }} />;
  if (!taskView) return <BootScreen />;
  return <div className={`workspace ${sidebarCollapsed ? "sidebar-collapsed" : ""}`} style={{
    "--task-table-font-size": `${Math.max(13, Math.min(Number(meta.settings.task_table_font_size) || 14, 16))}px`,
    "--sop-table-font-size": `${Math.max(9, Math.min(Number(meta.settings.sop_table_font_size) || 14, 16))}px`
  }}>
      <Sidebar activeGroupId={activeNavigationGroup?.id} collapsed={sidebarCollapsed} groups={adminNavigationGroups} mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} onNavigateGroup={navigateAdminGroup} onToggleCollapsed={() => setSidebarCollapsed(current => !current)} user={user} />

      <main className={`main-panel ${!systemViews.has(view) && taskView === "table" || view === "sop" && ["today", "history", "logs", "configs"].includes(moduleTabs.sop) ? "library-database-main" : ""} ${view === "all" && taskView === "table" ? "task-database-main" : ""} ${""}`}>
        <Header activeList={systemViews.has(view) ? null : ["today", "upcoming"].includes(view) ? meta.lists.find(list => list.id === smartViewScopes[view]?.listId) : activeList} groupLabel={activeNavigationPage.groupLabel} onCommand={() => setCommandOpen(true)} onThemeToggle={toggleTheme} onMenu={() => setMobileNavOpen(true)} onNotifications={() => setNoticeOpen(true)} onLogout={async () => {
        await api("/api/auth/logout", {
          method: "POST"
        });
        landingInitializedRef.current = Boolean(initialSettingsRoute);
        setUser(null);
      }} quickAdd={!systemViews.has(view) ? <QuickAdd defaults={view === "today" ? {
        dueAt: beijingDate(),
        duePrecision: "date"
      } : {}} listId={listId || meta.lists.find(list => list.isDefault)?.id || meta.lists[0]?.id} onAdded={async () => {
        refreshTasks();
        await refreshMeta();
        announce("任务已加入清单");
      }} onNotice={announce} /> : null} resolvedTheme={resolvedTheme} pageLabel={activeNavigationPage.label} userName={user.username} view={view} />
        {view !== "settings" && <SecondaryNavigation activePageId={activeNavigationId} group={activeNavigationGroup} onNavigate={navigateAdminTarget} />}
        {systemViews.has(view) && !["settings", "calendar-system"].includes(view) && <SystemPageHero page={activeNavigationPage} />}

        {view === "sop" ? <SopPage activeTab={moduleTabs.sop} onNotice={announce} onOpenSettings={() => {
        setView("settings");
        setModuleTabs(current => ({
          ...current,
          settings: "sop"
        }));
      }} onTabChange={tab => setModuleTabs(current => ({
        ...current,
        sop: tab
      }))} /> : view === "documents" ? <Suspense fallback={<div className="table-state"><LoaderCircle className="spin" size={20} />正在加载文档中心</div>}>
            <DocumentCenterPage entryMode={moduleTabs.document} onCloseNavigation={() => setMobileNavOpen(false)} onEntryModeChange={tab => setModuleTabs(current => ({
          ...current,
          document: tab
        }))} onNotice={announce} />
          </Suspense> : view === "calendar-system" ? <CalendarSystemPage activeTab={moduleTabs.calendar} initialListId={listId} lists={meta.lists} onNotice={announce} onOpenSettings={() => {
        setView("settings");
        setModuleTabs(current => ({
          ...current,
          settings: "calendar"
        }));
      }} onOpenTask={openTaskById} onRefreshMeta={refreshMeta} onTabChange={tab => setModuleTabs(current => ({
        ...current,
        calendar: tab
      }))} /> : view === "list-system" ? <ListSystemWorkspace activeTab={moduleTabs.list} onTabChange={tab => setModuleTabs(current => ({
        ...current,
        list: tab
      }))} pages={{
        stats: <StatsPage lists={meta.lists} />,
        logs: <LogPage lists={meta.lists} onOpenTask={openTaskById} />,
        projects: <ProjectManagerPage initialListId={listId} meta={meta} onRefresh={refreshMeta} onNotice={announce} />,
        tags: <TagManagerPage initialListId={listId} meta={meta} onRefresh={refreshMeta} onNotice={announce} />,
        rules: <RuleManagerPage initialListId={listId} meta={meta} onRefresh={refreshMeta} onNotice={announce} />,
        display: <ListDisplaySettings meta={meta} onRefresh={refreshMeta} onNotice={announce} />,
        cards: <TaskCardReview initialListId={listId} lists={meta.lists} onNotice={announce} onOpenTask={openTaskById} onRefresh={() => {
          refreshTasks();
          return refreshMeta();
        }} />
      }} /> : view === "settings" ? <SettingsCenterPage activeTab={moduleTabs.settings} meta={meta} onNotice={announce} onRefresh={refreshMeta} onTabChange={tab => setModuleTabs(current => ({
        ...current,
        settings: tab
      }))} onThemeChanged={refreshMeta} /> : <>
            <HorizontalListFilter activeListId={listId} activeModeId={activeModeId} folders={meta.folders} lists={meta.lists} modeItems={meta.modeItems} modes={meta.modes} onCreateFolder={createFolderFromSidebar} onCreateList={() => setListDialogOpen(true)} onModeChange={setActiveModeId} onNotify={announce} onRefresh={refreshMeta} onSelectList={selectTaskList} view={view} />
            {view === "today" && taskView === "table" && <TodayOverview onOpenTask={setSelectedTask} refreshKey={refreshKey} tasks={tasks} />}
            {["today", "upcoming"].includes(view) && <SmartViewScopeBar lists={meta.lists} scope={smartViewScopes[view]} view={view} onChange={next => saveSmartViewScope(view, next).catch(error => announce(error.message))} />}
            <section className={`database-surface ${taskView === "table" ? "admin-data-grid" : ""}`} aria-label="任务数据库">
              <div className={`database-toolbar ${taskView === "table" ? "admin-data-toolbar" : ""}`}>
                {taskView === "table" ? <div className="data-toolbar-left library-filters">
                    <SearchField value={query} onChange={setQuery} />
                    <OkrSelect aria-label="状态筛选" value={quickFilters.status} onChange={e => patchQuickFilters({
                status: e.target.value
              })}><option value="">全部状态</option>{statuses.map(status => <option key={status}>{status}</option>)}</OkrSelect>
                    <OkrSelect aria-label="项目筛选" value={quickFilters.projectId} onChange={e => patchQuickFilters({
                projectId: e.target.value
              })}><option value="">全部项目</option><option value="none">未关联项目</option>{meta.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</OkrSelect>
                    <OkrSelect aria-label="优先级筛选" value={quickFilters.priority} onChange={e => patchQuickFilters({
                priority: e.target.value
              })}><option value="">全部优先级</option>{["重要且紧急", "紧急", "重要", "普通"].map(priority => <option key={priority}>{priority}</option>)}</OkrSelect>
                    <LibraryDateRange from={quickFilters.dueFrom} to={quickFilters.dueTo} onFrom={dueFrom => patchQuickFilters({
                dueFrom
              })} onTo={dueTo => patchQuickFilters({
                dueTo
              })} />
                    <OkrButton type="button" onClick={resetLibraryFilters}>重置筛选</OkrButton>
                    <OkrButton className={`data-filter-button ${filterOpen || activeFilterCount > 0 ? "is-active" : ""}`} onClick={() => setFilterOpen(true)}>
                      <Filter size={15} />
                      高级筛选
                      {activeFilterCount > 0 && <em>{activeFilterCount}</em>}
                    </OkrButton>
                  </div> : <div className="date-field-controls">
                    {taskView === "calendar" ? <label>
                        日期字段
                        <OkrSelect value={calendarDateField || "dueAt"} onChange={event => setCalendarDateField(event.target.value)}>
                          {dateFieldOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </OkrSelect>
                      </label> : <>
                        <label>开始字段<OkrSelect value={ganttStartField || "startAt"} onChange={event => setGanttStartField(event.target.value)}>{dateFieldOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</OkrSelect></label>
                        <label>结束字段<OkrSelect value={ganttEndField || "dueAt"} onChange={event => setGanttEndField(event.target.value)}>{dateFieldOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</OkrSelect></label>
                      </>}
                  </div>}
                <div className="toolbar-actions">
                  <div className="segmented" aria-label="任务显示方式">
                    <OkrButton className={taskView === "table" ? "active" : ""} onClick={() => setTaskView("table")} title="数据库表格"><Table2 size={15} /></OkrButton>
                    <OkrButton className={view === "calendar-system" ? "active" : ""} onClick={() => setView("calendar-system")} title="在日程系统中查看当前清单"><CalendarDays size={15} /></OkrButton>
                    <OkrButton className={taskView === "gantt" ? "active" : ""} onClick={() => setTaskView("gantt")} title="甘特图"><ChartGantt size={15} /></OkrButton>
                  </div>
                  {taskView === "table" && <>
                  <OkrButton className={templatesOpen || filterTemplates.length > 0 ? "is-active" : ""} disabled={!listId} onClick={() => setTemplatesOpen(true)} title={listId ? "管理当前清单保存的视图" : "先选择一个清单"}>
                    <Filter size={15} />
                    已存视图
                    {filterTemplates.length > 0 && <em>{filterTemplates.length}</em>}
                  </OkrButton>
                  <OkrButton className={batchMode ? "is-active" : ""} disabled={tableSettings.locked} onClick={() => {
                  setBatchMode(current => !current);
                  setSelectedTaskIds(new Set());
                }} title={batchMode ? "退出批量编辑" : "批量编辑"}>
                    <CheckSquare size={15} />
                    {batchMode ? "退出批量编辑" : "批量编辑"}
                  </OkrButton>
                  <OkrToolbarMenu label="视图设置" trigger={<OkrButton type="button" className={tableSettings.locked ? "is-active" : ""} title="视图设置"><SlidersHorizontal size={15} />视图设置<ChevronDown size={13} /></OkrButton>}>
                  <OkrButton className={columnsOpen ? "is-active" : ""} disabled={tableSettings.locked} onClick={() => setColumnsOpen(true)} title="选择显示字段">
                    <LayoutList size={15} />
                    字段
                  </OkrButton>
                  <OkrButton className={tableSettings.groupBy ? "is-active" : ""} disabled={tableSettings.locked} onClick={() => setGroupOpen(true)} title="按字段分组">
                    <Rows3 size={15} />
                    分组
                  </OkrButton>
                  <OkrButton className={tableSettings.fillRules.length ? "is-active" : ""} disabled={tableSettings.locked} onClick={() => setFillOpen(true)} title="条件填色管理">
                    <PaintBucket size={15} />
                    填色
                  </OkrButton>
                  <OkrButton onClick={requestClipboardPermission} title="申请浏览器剪切板读取权限">
                    <ClipboardCheck size={15} />
                    剪切板
                  </OkrButton>
                  <OkrButton className={tableSettings.locked ? "is-active" : ""} onClick={() => {
                    const nextLocked = !tableSettings.locked;
                    if (nextLocked) {
                      setBatchMode(false);
                      setSelectedTaskIds(new Set());
                      setColumnsOpen(false);
                      setGroupOpen(false);
                      setFillOpen(false);
                    }
                    saveTableSettings({
                      ...tableSettings,
                      locked: nextLocked
                    }, nextLocked ? "视图已锁定，仅完成按钮可修改任务" : "视图已解锁");
                  }} title={tableSettings.locked ? "解锁当前视图" : "锁定当前视图"}>
                    {tableSettings.locked ? <Lock size={15} /> : <Unlock size={15} />}
                    {tableSettings.locked ? "已锁" : "锁定"}
                  </OkrButton>
                  </OkrToolbarMenu>
                  <div className="toolbar-pagination">
                    <span>共 {Number(total || 0).toLocaleString("zh-CN")} 条</span>
                    <PaginationControls onPage={setPage} page={page} pageCount={pageCount} />
                  </div>
                  </>}
                </div>
              </div>

              {taskView === "table" && batchMode && <BatchActionBar lists={meta.lists} projects={currentProjects} onAction={runBatchAction} onExit={() => {
            setBatchMode(false);
            setSelectedTaskIds(new Set());
          }} selectedCount={selectedTaskIds.size} />}

              {taskView === "table" ? tableSettingsScope !== currentTableSettingsScope ? <div className="table-state"><LoaderCircle className="spin" size={20} />正在加载表格设置</div> : <TaskTable sort={filters.sort} onSort={sort => setFilters(current => ({
            ...current,
            sort
          }))} batchMode={batchMode} columnWidths={tableSettings.columnWidths} fillRules={tableSettings.fillRules} groupBy={tableSettings.groupBy} groupMetadata={groupResult.groupBy === tableSettings.groupBy ? groupResult.groups : []} locked={tableSettings.locked} loading={loading} meta={meta} onColumnResize={(key, width) => !tableSettings.locked && saveTableSettings({
            ...tableSettings,
            visibleColumns,
            columnWidths: {
              ...tableSettings.columnWidths,
              [key]: width
            }
          }, "列宽已保存")} onNotify={announce} onOpen={setSelectedTask} onPage={setPage} onCompletionCommit={async (task, nextStatus) => {
            await api(`/api/tasks/${task.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                status: nextStatus
              })
            });
            if (nextStatus !== "已完成") {
              setTasks(current => current.map(item => item.id === task.id ? {
                ...item,
                status: nextStatus
              } : item));
            }
            announce(nextStatus === "已完成" ? "任务已完成" : "任务已恢复为未完成");
            if (nextStatus === "已完成") {
              clearTimeout(undoTimer.current);
              setUndoTask({
                id: task.id,
                status: task.status,
                readyAt: Date.now() + taskCompletionExitDuration() + 50
              });
              undoTimer.current = setTimeout(() => setUndoTask(null), 12000);
            }
            window.setTimeout(() => {
              refreshMeta().catch(error => announce(error.message));
            }, 320);
          }} onRemoveCompleted={taskId => {
            setTasks(current => current.filter(item => item.id !== taskId));
            setTotal(current => Math.max(0, current - 1));
            setSelectedTaskIds(current => {
              if (!current.has(taskId)) return current;
              const next = new Set(current);
              next.delete(taskId);
              return next;
            });
            window.setTimeout(refreshTasks, 220);
          }} onDelete={async task => {
            const confirmed = await dialog.confirm({
              title: "移入回收区",
              message: "确认将这条任务移入回收区？",
              confirmLabel: "移入回收区",
              danger: true
            });
            if (!confirmed) return;
            await api(`/api/tasks/${task.id}`, {
              method: "DELETE"
            });
            refreshTasks();
            refreshMeta();
            announce("任务已移入回收区");
          }} onPatch={async (task, patch, message = "任务已更新") => {
            await api(`/api/tasks/${task.id}`, {
              method: "PATCH",
              body: JSON.stringify(patch)
            });
            refreshTasks();
            refreshMeta();
            announce(message);
          }} onSelectTask={(taskId, checked) => {
            setSelectedTaskIds(current => {
              const next = new Set(current);
              if (checked) next.add(taskId);else next.delete(taskId);
              return next;
            });
          }} onSelectVisible={checked => {
            setSelectedTaskIds(current => {
              const next = new Set(current);
              tasks.forEach(task => checked ? next.add(task.id) : next.delete(task.id));
              return next;
            });
          }} onTransfer={async (task, targetListId) => {
            await api(`/api/tasks/${task.id}/transfer`, {
              method: "POST",
              body: JSON.stringify({
                targetListId
              })
            });
            refreshTasks();
            await refreshMeta();
            announce("原任务已完成，目标清单已新建任务");
          }} selectedTaskIds={selectedTaskIds} showTitleMeta={shouldShowTaskTitleMeta(listId)} page={page} pageCount={pageCount} tasks={tasks} total={total} visibleColumns={visibleColumns} /> : <Suspense fallback={<div className="table-state"><LoaderCircle className="spin" size={20} />正在加载视图</div>}>
                  {taskView === "calendar" ? <CalendarView dateField={calendarDateField || "dueAt"} key={`calendar-${listId}-${calendarDateField}-${refreshKey}`} listId={listId} onChanged={() => {
              refreshTasks();
              refreshMeta();
              announce("任务日期已更新");
            }} onOpenTask={setSelectedTask} /> : <GanttView endField={ganttEndField || "dueAt"} key={`gantt-${listId}-${ganttStartField}-${ganttEndField}-${refreshKey}`} listId={listId} onChanged={() => {
              refreshTasks();
              refreshMeta();
              announce("任务日期已更新");
            }} onOpenTask={setSelectedTask} startField={ganttStartField || "startAt"} />}
                </Suspense>}
            </section>
          </>}
      </main>

      {filterOpen && <FilterPanel filters={filters} meta={meta} onApply={next => {
      setFilters(next);
      setFilterOpen(false);
    }} onClose={() => setFilterOpen(false)} />}
      {templatesOpen && <FilterTemplatePanel disabled={!listId} onApply={async template => {
      if ((await applyFilterTemplate(template)) !== false) setTemplatesOpen(false);
    }} onClose={() => setTemplatesOpen(false)} onDelete={async template => {
      await api(`/api/filter-templates/${template.id}`, {
        method: "DELETE"
      });
      await refreshFilterTemplates();
      announce("筛选模板已删除");
    }} onSave={saveFilterTemplate} templates={filterTemplates} />}
      {columnsOpen && <ColumnPanel columnWidths={tableSettings.columnWidths} onClose={() => setColumnsOpen(false)} onSave={async nextVisibleColumns => {
      const saved = await saveTableSettings({
        ...tableSettings,
        visibleColumns: nextVisibleColumns
      }, "显示字段已保存");
      if (saved) setColumnsOpen(false);
    }} visibleColumns={visibleColumns} />}
      {groupOpen && <GroupPanel groupBy={tableSettings.groupBy} onClose={() => setGroupOpen(false)} onSave={async groupBy => {
      if (await saveTableSettings({
        ...tableSettings,
        groupBy
      }, groupBy ? "分组方式已保存" : "已取消分组")) setGroupOpen(false);
    }} />}
      {fillOpen && <FillPanel meta={meta} onClose={() => setFillOpen(false)} onSave={async fillRules => {
      if (await saveTableSettings({
        ...tableSettings,
        fillRules
      }, "填色规则已保存")) setFillOpen(false);
    }} rules={tableSettings.fillRules} />}
      {noticeOpen && <NotificationPanel onClose={() => setNoticeOpen(false)} />}
      {selectedTask && <TaskModal meta={meta} onClose={() => setSelectedTask(null)} onDeleted={() => {
      setSelectedTask(null);
      refreshTasks();
      refreshMeta();
      announce("任务已移入回收区");
    }} onSaved={() => {
      setSelectedTask(null);
      refreshTasks();
      refreshMeta();
      announce("任务已更新");
    }} readOnly={tableSettings.locked} task={selectedTask} />}
      {listDialogOpen && <ListDialog onClose={() => setListDialogOpen(false)} onCreated={async list => {
      setListDialogOpen(false);
      await refreshMeta();
      setListId(Number(list.id));
      setView("all");
      announce("新清单已创建");
    }} />}
      {commandOpen && <AdminCommandPalette activeNavId={activeNavigationId} pages={adminNavigationPages} onClose={() => setCommandOpen(false)} onNavigate={navigateAdminTarget} onOpenTask={async id => {
      setCommandOpen(false);
      await openTaskById(id);
    }} />}
      {undoTask && <div className="toast okr-undo-toast" role="status">
        <Check size={16} /><span>{undoTask.error || "任务已完成"}</span>
        <OkrButton type="button" variant="secondary" disabled={undoBusy} onClick={undoCompletion}><Undo2 size={15} />{undoBusy ? "恢复中" : "撤销"}</OkrButton>
        <OkrButton type="button" className="icon-only" title="关闭通知" onClick={() => {
        clearTimeout(undoTimer.current);
        setUndoTask(null);
      }}><X size={15} /></OkrButton>
      </div>}
      {toast && !undoTask && <div className={`toast ${/失败|错误|不能为空|无法|请选择|未保存/.test(toast) ? "is-error" : ""}`} role={/失败|错误|不能为空|无法|请选择|未保存/.test(toast) ? "alert" : "status"}>
          {/失败|错误|不能为空|无法|请选择|未保存/.test(toast) ? <AlertCircle size={16} /> : <Check size={16} />}
          {toast}
        </div>}
    </div>;
}
function TaskLogoGlyph() {
  return <svg className="task-logo-glyph" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="6.2" cy="6.4" r="1.35" />
    <path d="M10 6.4h7.5" />
    <path className="task-logo-check" d="m5.2 13.1 3.2 3.25 10-10.1" />
  </svg>;
}
function BootScreen() {
  return <div className="boot-screen">
      <span className="brand-mark">
        <TaskLogoGlyph />
      </span>
      <LoaderCircle className="spin" size={20} />
    </div>;
}
function LoginPage({
  onLogin
}) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async event => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const user = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username,
          password
        })
      });
      onLogin(user);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoading(false);
    }
  };
  return <main className="login-page">
      <section className="login-panel">
        <div className="login-brand">
          <span className="brand-mark">
            <TaskLogoGlyph />
          </span>
          <div>
            <b>任务清单</b>
            <small>服务器工作区</small>
          </div>
        </div>
        <div className="login-copy">
          <h1>登录任务清单</h1>
        </div>
        <form onSubmit={submit}>
          <label>
            账号
            <OkrInput autoComplete="username" onChange={event => setUsername(event.target.value)} value={username} />
          </label>
          <label>
            密码
            <OkrInput autoComplete="current-password" autoFocus onChange={event => setPassword(event.target.value)} type="password" value={password} />
          </label>
          {error && <p className="form-error">{error}</p>}
          <OkrButton className="primary-button" disabled={loading}>
            {loading && <LoaderCircle className="spin" size={16} />}
            登录工作台
          </OkrButton>
        </form>
      </section>
    </main>;
}
const sidebarOrderStorageKey = "life-task-okr:sidebar-section-order:v1";
const sidebarOpenStorageKey = "life-task-okr:sidebar-section-open:v1";
const defaultSidebarSectionOrder = ["tasks", "lists", "calendar", "sop", "documents", "system"];
function normalizeSidebarSectionOrder(value) {
  const validIds = new Set(defaultSidebarSectionOrder);
  const saved = Array.isArray(value) ? value.filter((id, index) => validIds.has(id) && value.indexOf(id) === index) : [];
  return [...saved, ...defaultSidebarSectionOrder.filter(id => !saved.includes(id))];
}
function loadSidebarSectionOrder() {
  try {
    return normalizeSidebarSectionOrder(JSON.parse(localStorage.getItem(sidebarOrderStorageKey) || "[]"));
  } catch {
    return [...defaultSidebarSectionOrder];
  }
}
function loadSidebarOpenGroups() {
  const defaults = Object.fromEntries(defaultSidebarSectionOrder.map(id => [id, id === "tasks"]));
  try {
    const saved = JSON.parse(localStorage.getItem(sidebarOpenStorageKey) || "{}");
    return Object.fromEntries(Object.entries(defaults).map(([id, fallback]) => [id, typeof saved[id] === "boolean" ? saved[id] : fallback]));
  } catch {
    return defaults;
  }
}
function HorizontalListFilter({
  activeListId,
  activeModeId,
  folders,
  lists,
  modeItems,
  modes,
  onCreateFolder,
  onCreateList,
  onModeChange,
  onNotify,
  onRefresh,
  onSelectList,
  view
}) {
  const [managerOpen, setManagerOpen] = useState(false);
  const [railState, setRailState] = useState({
    canScrollLeft: false,
    canScrollRight: false,
    hasOverflow: false,
    maxScroll: 0
  });
  const railRef = useRef(null);
  const visibleLists = useMemo(() => {
    const positions = new Map(modeItems.filter(item => item.modeId === activeModeId).map(item => [item.listId, item.position]));
    return lists.filter(list => positions.has(list.id)).sort((left, right) => {
      if (left.isPinned !== right.isPinned) return left.isPinned ? -1 : 1;
      return (positions.get(left.id) ?? left.position) - (positions.get(right.id) ?? right.position);
    });
  }, [activeModeId, lists, modeItems]);
  const total = visibleLists.reduce((sum, list) => sum + Number(list.taskCount || 0), 0);
  const updateRailState = useCallback(() => {
    setRailState(horizontalRailState(railRef.current));
  }, []);
  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return undefined;
    const frame = window.requestAnimationFrame(updateRailState);
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(updateRailState) : null;
    resizeObserver?.observe(rail);
    window.addEventListener("resize", updateRailState);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateRailState);
    };
  }, [updateRailState, visibleLists]);
  useEffect(() => {
    const rail = railRef.current;
    const active = rail?.querySelector("button.active");
    if (!rail || !active) return;
    const railBox = rail.getBoundingClientRect();
    const activeBox = active.getBoundingClientRect();
    if (activeBox.left < railBox.left + 6) {
      rail.scrollBy({
        left: activeBox.left - railBox.left - 10,
        behavior: "smooth"
      });
    } else if (activeBox.right > railBox.right - 6) {
      rail.scrollBy({
        left: activeBox.right - railBox.right + 10,
        behavior: "smooth"
      });
    }
  }, [activeListId, activeModeId]);
  useEffect(() => {
    if (!managerOpen) return undefined;
    const closeOnOutside = event => {
      if (!event.target.closest?.(".horizontal-list-filter")) setManagerOpen(false);
    };
    const closeOnEscape = event => {
      if (event.key === "Escape") setManagerOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [managerOpen]);
  const selectList = id => {
    setManagerOpen(false);
    onSelectList(id);
  };
  const scrollRail = useCallback(direction => {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollBy({
      behavior: "smooth",
      left: direction * Math.max(220, Math.round(rail.clientWidth * 0.72))
    });
  }, []);
  const handleRailWheel = useCallback(event => {
    const rail = railRef.current;
    if (!rail) return;
    const state = horizontalRailState(rail);
    const delta = horizontalWheelDelta(event);
    if (!state.hasOverflow || !delta) return;
    if (delta < 0 && !state.canScrollLeft || delta > 0 && !state.canScrollRight) return;
    event.preventDefault();
    rail.scrollLeft += delta;
    updateRailState();
  }, [updateRailState]);
  const handleRailKeyDown = useCallback(event => {
    const rail = railRef.current;
    if (!rail || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") rail.scrollTo({
      behavior: "smooth",
      left: 0
    });else if (event.key === "End") rail.scrollTo({
      behavior: "smooth",
      left: rail.scrollWidth
    });else scrollRail(event.key === "ArrowLeft" ? -1 : 1);
  }, [scrollRail]);
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return undefined;
    rail.addEventListener("wheel", handleRailWheel, {
      passive: false
    });
    return () => rail.removeEventListener("wheel", handleRailWheel);
  }, [handleRailWheel]);
  return <section className="horizontal-list-filter" aria-label="清单筛选">
      <div className="horizontal-list-label"><Filter size={15} /><span>清单筛选</span></div>
      <div className={`horizontal-list-rail-shell ${railState.hasOverflow ? "is-overflowing" : ""}`}>
        <OkrButton aria-label="向左浏览清单" className="horizontal-list-scroll-button previous" disabled={!railState.canScrollLeft} onClick={() => scrollRail(-1)} title="向左浏览清单" type="button"><ChevronRight className="flip-x" size={15} /></OkrButton>
        <div aria-label="清单横向列表，可使用左右方向键浏览" className="horizontal-list-rail" onKeyDown={handleRailKeyDown} onScroll={updateRailState} ref={railRef} tabIndex={0}>
        <OkrButton className={!activeListId ? "active" : ""} data-list-id="all" onClick={() => selectList(null)} title="显示全部清单任务">
          <LayoutList size={14} /><span>全部清单</span><em>{total}</em>
        </OkrButton>
        {visibleLists.map(list => <OkrButton className={activeListId === list.id ? "active" : ""} data-list-id={list.id} key={list.id} onClick={() => selectList(list.id)} title={`${list.name} · ${list.taskCount} 条任务`}>
            <i style={{
            background: list.color
          }} />
            <span>{list.name}</span>
            <em>{list.taskCount}</em>
          </OkrButton>)}
        </div>
        <OkrButton aria-label="向右浏览清单" className="horizontal-list-scroll-button next" disabled={!railState.canScrollRight} onClick={() => scrollRail(1)} title="向右浏览清单" type="button"><ChevronRight size={15} /></OkrButton>
      </div>
      <div className="horizontal-list-actions">
        <label className="horizontal-mode-select" title="清单显示模式">
          <OkrSelect aria-label="清单显示模式" value={activeModeId || ""} onChange={event => onModeChange(Number(event.target.value))}>
            {modes.map(mode => <option key={mode.id} value={mode.id}>模式：{mode.name}</option>)}
          </OkrSelect>
          <ChevronDown size={12} />
        </label>
        <OkrButton className="icon-only" onClick={onCreateFolder} title="新建文件夹"><FolderPlus size={15} /></OkrButton>
        <OkrButton className="icon-only" onClick={onCreateList} title="新建清单"><Plus size={15} /></OkrButton>
        <OkrButton aria-expanded={managerOpen} className={`horizontal-list-manage ${managerOpen ? "active" : ""}`} onClick={() => setManagerOpen(current => !current)} title="管理、排序和置顶清单">
          <SlidersHorizontal size={15} /><span>管理</span>
        </OkrButton>
      </div>
      {managerOpen && <div className="horizontal-list-manager" role="dialog" aria-label="清单管理">
        <header><div><small>当前显示模式</small><b>{modes.find(mode => mode.id === activeModeId)?.name || "清单"}</b></div><OkrButton className="icon-only" onClick={() => setManagerOpen(false)} title="关闭"><X size={15} /></OkrButton></header>
        <SidebarLists activeListId={activeListId} activeModeId={activeModeId} folders={folders} lists={lists} modeItems={modeItems} modes={modes} onModeChange={onModeChange} onNotify={onNotify} onRefresh={onRefresh} onSelectList={selectList} view={view} />
      </div>}
    </section>;
}
function Sidebar({
  activeGroupId,
  collapsed,
  groups,
  mobileOpen,
  onClose,
  onNavigateGroup,
  onToggleCollapsed,
  user
}) {
  return <>
      {mobileOpen && <OkrButton className="mobile-scrim" onClick={onClose} aria-label="关闭菜单遮罩" />}
      <aside className={`sidebar admin-sidebar ${mobileOpen ? "is-open" : ""}`}>
        <div className="sidebar-brand">
          <span className="brand-mark admin-brand-mark"><TaskLogoGlyph /></span>
          {!collapsed && <span>
            <b>任务清单</b>
            <small>个人运营中枢</small>
          </span>}
          <OkrButton className="icon-only mobile-close" onClick={onClose} title="关闭导航">
            <PanelLeftClose size={17} />
          </OkrButton>
        </div>
        <nav className="admin-sidebar-nav" aria-label="任务系统功能">
          {groups.filter(group => group.id !== "system").map(group => {
          const GroupIcon = group.icon;
          const active = group.id === activeGroupId;
          return <OkrButton aria-current={active ? "page" : undefined} className={`admin-nav-group-button admin-primary-nav-button ${active ? "active" : ""}`} key={group.id} onClick={() => onNavigateGroup(group)} title={group.label}>
              <GroupIcon size={17} />
              {!collapsed && <span>{group.label}</span>}
            </OkrButton>;
        })}
        </nav>
        <div className="admin-sidebar-footer">
          {groups.filter(group => group.id === "system").map(group => <OkrButton key={group.id} className={`admin-nav-group-button admin-primary-nav-button ${activeGroupId === group.id ? "active" : ""}`} aria-current={activeGroupId === group.id ? "page" : undefined} title={group.label} onClick={() => onNavigateGroup(group)}><Settings size={17} />{!collapsed && <span>{group.label}</span>}
          </OkrButton>)}
          <div className="sidebar-user sidebar-profile">
          <span>{user.username.slice(0, 1)}</span>
          {!collapsed && <div>
            <b>{user.username}</b>
            <small>当前账号</small>
          </div>}
          </div>
          <OkrButton className="admin-collapse-button" onClick={onToggleCollapsed} title={collapsed ? "展开侧边栏" : "折叠侧边栏"}>
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            {!collapsed && <span>折叠侧边栏</span>}
          </OkrButton>
        </div>
      </aside>
    </>;
}
function SecondaryNavigation({
  activePageId,
  group,
  onNavigate
}) {
  const navRef = useRef(null);
  if (!group?.pages?.length) return null;
  const onKeyDown = event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = [...navRef.current.querySelectorAll("button:not(:disabled)")];
    const currentIndex = buttons.indexOf(document.activeElement);
    let nextIndex = currentIndex < 0 ? 0 : currentIndex;
    if (event.key === "ArrowRight") nextIndex = (nextIndex + 1) % buttons.length;
    if (event.key === "ArrowLeft") nextIndex = (nextIndex - 1 + buttons.length) % buttons.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = buttons.length - 1;
    event.preventDefault();
    buttons[nextIndex]?.focus();
    buttons[nextIndex]?.click();
  };
  return <nav className="admin-secondary-nav" aria-label={`${group.label}二级页面`} onKeyDown={onKeyDown} ref={navRef}>
    <div className="admin-secondary-nav-track">
      {group.pages.map(page => {
        const PageIcon = page.icon;
        const active = page.id === activePageId;
        return <OkrButton aria-current={active ? "page" : undefined} className={active ? "active" : ""} key={page.id} onClick={() => onNavigate(page.target)} type="button">
          <PageIcon size={14} /><span>{page.label}</span>
        </OkrButton>;
      })}
    </div>
  </nav>;
}
function Header({
  activeList,
  groupLabel,
  onCommand,
  onLogout,
  onMenu,
  onNotifications,
  onThemeToggle,
  pageLabel,
  quickAdd,
  resolvedTheme,
  userName,
  view
}) {
  return <header className="admin-topbar">
      <div className="admin-topbar-left">
        <OkrButton className="icon-only mobile-menu" onClick={onMenu} title="菜单"><Menu size={19} /></OkrButton>
        <div className="admin-breadcrumbs"><span>{groupLabel || "任务中心"}</span><ChevronRight size={13} /><b>{activeList?.name || pageLabel || "今天"}</b></div>
      </div>
      {quickAdd && <div className="admin-topbar-quick-add">{quickAdd}</div>}
      <div className="admin-topbar-actions">
        <OkrButton className="admin-command-button" aria-label="搜索页面、任务或编号" onClick={onCommand}><Search size={15} /><span>搜索页面、任务或编号</span><kbd>⌘ K</kbd></OkrButton>
        <OkrButton className="icon-only" onClick={onThemeToggle} title={resolvedTheme === "dark" ? "切换白天模式" : "切换黑夜模式"}>{resolvedTheme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</OkrButton>
        <OkrButton className="icon-only admin-notification-button" onClick={onNotifications} title="最近动态"><Bell size={17} /><i /></OkrButton>
        <ActionMenu label="账号菜单" trigger={<OkrButton type="button" className="admin-top-avatar" title="账号菜单">{String(userName || "我").slice(0, 1)}</OkrButton>} items={[{
        label: resolvedTheme === "dark" ? "切换浅色" : "切换深色",
        onSelect: onThemeToggle
      }, {
        label: "最近动态",
        onSelect: onNotifications
      }, {
        label: "退出登录",
        onSelect: onLogout
      }]} />
      </div>
    </header>;
}
const taskPageDescriptions = {
  today: "把今天真正重要的任务放在第一屏，范围会按你的动态日期设置自动更新。",
  upcoming: "按未来日期查看即将到来的任务，并保留清单和动态范围配置。",
  starred: "集中处理已经主动标记星标的重要任务。",
  all: "完整任务数据库，支持筛选、字段、分组、填色、锁定和批量操作。",
  "task-calendar": "按任务日期字段查看和拖动任务，所有修改都会写回真实任务数据。",
  "task-gantt": "在时间轴中查看任务开始、截止和进度，并保留真实任务详情入口。"
};
function TaskPageHero({
  activeList,
  page,
  total
}) {
  const title = activeList?.name || page?.label || "今天";
  const description = activeList ? `${activeList.name} 的真实任务数据库视图。` : taskPageDescriptions[page?.id] || "个人任务系统工作台。";
  return <section className="admin-page-hero">
    <div><h1>{title}</h1></div>
    <div className="admin-hero-summary"><span>当前结果</span><b>{Number(total || 0).toLocaleString()}</b><small>条任务</small></div>
  </section>;
}
const systemGroupDescriptions = {
  "清单系统": "用真实任务数据管理统计、日志、项目、标签、规则、显示设置和卡片批阅。",
  "日程系统": "统一安排任务与日程，管理重复规则、日历来源和工作日设置。",
  "SOP 系统": "处理日常执行事项，维护主题、事件、日历、调度、历史和统计。",
  "文档中心": "在同一工作区管理文档树、编辑租约、全文搜索、版本和回收站。",
  "系统与设置": "维护外观、任务视图、清单整理、外部授权、统计、接入和系统日志。"
};
function SystemPageHero({
  page
}) {
  return <section className="admin-page-hero admin-system-hero">
    <div><h1>{page?.label || "系统设置"}</h1></div>
  </section>;
}
function TodayOverview({
  onOpenTask,
  refreshKey,
  tasks
}) {
  const [data, setData] = useState(null);
  const [logs, setLogs] = useState([]);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([api("/api/stats?range=last7", {
      signal: controller.signal
    }), api("/api/logs?limit=4&offset=0", {
      signal: controller.signal
    })]).then(([stats, logResult]) => {
      setData(stats);
      setLogs(logResult.data || []);
    }).catch(error => {
      if (error.name !== "AbortError") setData(null);
    });
    return () => controller.abort();
  }, [refreshKey]);
  if (!data) return <section className="admin-today-dashboard loading"><LoaderCircle className="spin" size={18} />正在汇总今日工作台</section>;
  const completionRate = Number(data.summary?.total || 0) > 0 ? Math.round(Number(data.summary.completed || 0) / Number(data.summary.total) * 100) : 0;
  const metrics = [["今日创建", Number(data.summary?.createdToday || 0), data.metrics?.createdToday?.change || 0, "primary", ""], ["今日完成", Number(data.summary?.completedToday || 0), data.metrics?.completedToday?.change || 0, "success", ""], ["当前逾期", Number(data.summary?.overdue || 0), null, "danger", ""], ["累计完成率", completionRate, null, "purple", "%"]];
  const week = data.dailyActivity || [];
  const weekChart = {
    labels: week.map(item => item.day.slice(5)),
    datasets: [{
      label: "创建 + 完成",
      data: week.map(item => Number(item.total || 0)),
      borderColor: "#3976e8",
      backgroundColor: "#3976e824",
      fill: true,
      tension: 0.38,
      pointRadius: 2,
      pointHoverRadius: 4
    }]
  };
  return <section className="admin-today-dashboard">
    <div className="admin-today-metrics">{metrics.map(([label, value, change, tone, suffix]) => <article className={tone} key={label}><span>{label}</span><strong><AnimatedKpi value={value} suffix={suffix} /></strong>{change !== null && <em>{Number(change) >= 0 ? "+" : ""}{change}</em>}<i /></article>)}</div>
    <div className="admin-today-grid">
      <section className="admin-dashboard-card focus"><header><div><Sparkles size={16} /><b>今日重点</b></div><small>{tasks.length} 条当前任务</small></header><div className="admin-focus-list">{tasks.slice(0, 5).map((task, index) => <OkrButton key={task.id} onClick={() => onOpenTask(task)}><span>{index + 1}</span><div><b>{task.title}</b><small>{task.listName || "未分类"} · {formatDate(task.dueAt)}</small></div><StatusPill status={task.status} /></OkrButton>)}{!tasks.length && <p>今天当前没有符合范围的任务</p>}</div></section>
      <section className="admin-dashboard-card trend"><header><div><TrendingUp size={16} /><b>近 7 日活跃</b></div><small>创建 + 完成</small></header><OkrActivityChart label="近 7 日任务活跃趋势" series={[{
          name: "创建 + 完成",
          points: week.map(item => ({
            date: item.day,
            value: Number(item.total || 0)
          }))
        }]} height={178} /></section>
      <section className="admin-dashboard-card activity"><header><div><Activity size={16} /><b>最近动态</b></div><small>实时日志</small></header><div className="admin-activity-list">{logs.map(item => <article key={item.id}><time>{item.occurredAt ? new Date(item.occurredAt).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false
              }) : "--:--"}</time><i /><span><b>{item.eventType || "任务事件"}</b><small>{item.taskTitle || item.message || item.taskNo || "系统记录"}</small></span></article>)}{!logs.length && <p>暂无最近动态</p>}</div></section>
    </div>
  </section>;
}
function AdminCommandPalette({
  activeNavId,
  onClose,
  onNavigate,
  onOpenTask,
  pages
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const search = query.trim();
  const results = pages.filter(page => `${page.groupLabel}${page.label}`.toLowerCase().includes(search.toLowerCase())).slice(0, search ? 6 : 12);
  useEffect(() => {
    setMatches([]);
    setError("");
    setActiveIndex(0);
    if (!search) {
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      api(`/api/tasks?${new URLSearchParams({
        q: search,
        view: "all",
        limit: "12",
        offset: "0",
        sort: "updated"
      })}`, {
        signal: controller.signal
      }).then(result => setMatches(result.data || [])).catch(nextError => {
        if (!controller.signal.aborted) setError(nextError.message);
      }).finally(() => {
        if (!controller.signal.aborted) setSearching(false);
      });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search]);
  const choices = [...matches.map(task => () => onOpenTask(task.id)), ...results.map(page => () => onNavigate(page.target))];
  return <OkrDialogSurface title="搜索页面、任务或编号" className="admin-command-palette" onClose={onClose}>
    <label><Search size={19} /><OkrInput autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索页面、任务或编号" onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (["ArrowDown", "ArrowUp"].includes(event.key)) {
          event.preventDefault();
          const next = (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % Math.max(choices.length, 1);
          setActiveIndex(next);
          event.currentTarget.closest('[role="dialog"]')?.querySelector(`[data-command-index="${next}"]`)?.scrollIntoView({
            block: "nearest"
          });
        }
        if (event.key === "Enter" && choices[activeIndex]) {
          event.preventDefault();
          choices[activeIndex]();
        }
      }} /><kbd>ESC</kbd></label>
    <div className="command-results">
      {search && <><span>任务</span>{searching && <p role="status">正在搜索</p>}{error && <p role="alert">{error}</p>}
        {matches.map((task, index) => <OkrButton type="button" key={task.id} data-command-index={index} className={activeIndex === index ? "active" : ""} onClick={() => onOpenTask(task.id)}>
          <FileText size={16} /><span><b>{task.title}</b><small>{task.taskNo} · {task.listName} · {task.status}</small></span><ChevronRight size={14} />
        </OkrButton>)}{!searching && !error && !matches.length && <p>没有匹配的任务</p>}</>}
      {!!results.length && <span>功能页面</span>}{results.map((page, index) => {
        const Icon = page.icon;
        return <OkrButton type="button" data-command-index={matches.length + index} className={activeIndex === matches.length + index ? "active" : ""} key={page.id} onClick={() => onNavigate(page.target)}><Icon size={16} /><span><b>{page.label}</b><small>{page.groupLabel}</small></span>{page.id === activeNavId ? <Check size={14} /> : <ChevronRight size={14} />}</OkrButton>;
      })}
    </div>
  </OkrDialogSurface>;
}
function QuickAdd({
  defaults = {},
  listId,
  onAdded,
  onNotice
}) {
  const dialog = useAppDialog();
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const textareaRef = useRef(null);
  const submitting = useRef(false);
  const resize = useCallback(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "34px";
    const contentHeight = Math.max(34, node.scrollHeight);
    node.style.height = `${Math.min(contentHeight, 120)}px`;
    node.style.overflowY = contentHeight > 120 ? "auto" : "hidden";
  }, []);
  useEffect(() => {
    resize();
  }, [resize, title]);
  const add = async (value = title) => {
    const content = String(value || "").trim();
    if (!content || !listId || submitting.current) return false;
    submitting.current = true;
    setLoading(true);
    try {
      await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: content,
          listId,
          ...defaults
        })
      });
      setTitle(current => current.trim() === content ? "" : current);
      try {
        await onAdded?.();
      } catch {
        onNotice?.("任务已保存，列表刷新失败，请刷新页面");
      }
      return true;
    } catch (error) {
      setTitle(current => current || content);
      onNotice?.(error.message || "新增任务失败，请稍后重试");
      return false;
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };
  const addFromClipboard = async () => {
    try {
      let content = "";
      if (navigator.clipboard?.readText && window.isSecureContext) {
        content = await navigator.clipboard.readText();
      } else {
        content = await dialog.askText({
          title: "粘贴任务内容",
          label: "当前浏览器不允许自动读取剪切板，请在这里粘贴",
          placeholder: "粘贴后点击加入清单",
          multiline: true
        });
      }
      if (!content?.trim()) {
        onNotice?.("剪切板没有可识别内容");
        return;
      }
      const saved = await add(content);
      trackAnalyticsEvent({
        module: "task",
        eventName: "clipboard.quick_add",
        result: saved ? "success" : "failed",
        listId
      });
    } catch (error) {
      trackAnalyticsEvent({
        module: "task",
        eventName: "clipboard.quick_add",
        result: "failed",
        listId,
        errorCode: error.name || "clipboard_error"
      });
      onNotice?.(error.message || "读取剪切板失败");
    }
  };
  return <div className="quick-add">
      <Plus size={17} />
      <OkrTextarea aria-label="新任务内容" onChange={event => {
      setTitle(event.target.value);
      resize();
    }} onInput={resize} onKeyDown={event => {
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        add();
      }
    }} onPaste={() => window.requestAnimationFrame(resize)} placeholder="快速添加任务，按 Enter 保存" ref={textareaRef} rows={1} value={title} />
      <OkrButton className="clipboard-button" disabled={loading} onClick={addFromClipboard} title="识别剪切板并新建任务">
        <Clipboard size={14} />
        识别剪切板
      </OkrButton>
      <OkrButton disabled={loading || !title.trim()} onClick={() => add()}>
        {loading ? <LoaderCircle className="spin" size={15} /> : "添加"}
      </OkrButton>
    </div>;
}
function SearchField({
  onChange,
  value
}) {
  return <label className="search-field">
      <Search size={16} />
      <OkrInput aria-label="搜索任务" onChange={event => onChange(event.target.value)} placeholder="搜索任务内容或编号" value={value} />
      {value && <OkrButton className="icon-only" onClick={() => onChange("")} title="清空">
          <X size={14} />
        </OkrButton>}
    </label>;
}
function PaginationControls({
  onPage,
  page,
  pageCount
}) {
  return <div className="pagination-controls" aria-label="翻页">
      <OkrButton disabled={page === 0} onClick={() => onPage(Math.max(page - 1, 0))} title="上一页">
        ‹
      </OkrButton>
      <span>{page + 1} / {pageCount}</span>
      <OkrButton disabled={page + 1 >= pageCount} onClick={() => onPage(Math.min(page + 1, pageCount - 1))} title="下一页">
        ›
      </OkrButton>
    </div>;
}
function BatchActionBar({
  lists,
  onAction,
  onExit,
  projects,
  selectedCount
}) {
  const dialog = useAppDialog();
  const [targetListId, setTargetListId] = useState("");
  const [dueDate, setDueDate] = useState("");
  return <div className="batch-action-bar">
      <span><CheckSquare size={15} />已选择 <b>{selectedCount}</b> 条</span>
      <div className="batch-status-pills" aria-label="批量修改状态">
        {statuses.map(status => <OkrButton className={`status-pill status-${status}`} key={status} onClick={() => onAction("status", {
        value: status
      })}>
            {status}
          </OkrButton>)}
      </div>
      <label>
        项目
        <OkrSelect defaultValue="" onChange={event => {
        if (event.target.value === "") return;
        onAction("project", {
          value: event.target.value === "none" ? null : Number(event.target.value)
        });
        event.target.value = "";
      }}>
          <option value="">批量修改项目</option>
          <option value="none">未归属项目</option>
          {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        </OkrSelect>
      </label>
      <label className="batch-date-control">
        截止日期
        <OkrInput type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} />
      </label>
      <OkrButton disabled={!dueDate} onClick={() => onAction("dueDate", {
      value: dueDate
    })}>应用日期</OkrButton>
      <OkrButton onClick={() => onAction("dueDate", {
      value: null
    })}>清空日期</OkrButton>
      <OkrButton onClick={() => onAction("pin", {
      value: true
    })}><Pin size={14} />置顶</OkrButton>
      <OkrButton onClick={() => onAction("pin", {
      value: false
    })}><Pin size={14} />取消置顶</OkrButton>
      <label className="batch-transfer-select">
        转移
        <OkrSelect value={targetListId} onChange={event => setTargetListId(event.target.value)}>
          <option value="">选择目标清单</option>
          {lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}
        </OkrSelect>
      </label>
      <OkrButton className="primary-button confirm-action" disabled={!targetListId || selectedCount === 0} onClick={() => onAction("transfer", {
      targetListId: Number(targetListId)
    })}>
        <MoveRight size={14} />确认转移
      </OkrButton>
      <OkrButton className="danger-text" onClick={async () => {
      const confirmed = await dialog.confirm({
        title: "批量移入回收区",
        message: `确认将选中的 ${selectedCount} 条任务移入回收区？`,
        confirmLabel: "批量移入",
        danger: true
      });
      if (confirmed) onAction("delete");
    }}>删除</OkrButton>
      <OkrButton className="batch-exit" onClick={onExit}>退出批量</OkrButton>
    </div>;
}
function FilterTemplatePanel({
  disabled,
  onApply,
  onClose,
  onDelete,
  onSave,
  templates
}) {
  return <OkrDialogSurface asChild title="保存的视图" onClose={onClose}>
      <section className="small-dialog template-dialog" role="dialog" aria-modal="true">
        <header>
          <div><h2>保存的视图</h2></div>
          <OkrButton className="icon-only" onClick={onClose} title="关闭"><X size={18} /></OkrButton>
        </header>
        <div className="template-dialog-content">
          {templates.length ? templates.map(template => <article className="template-card" key={template.id}>
              <OkrButton onClick={() => onApply(template)}>
                <span><Filter size={15} /><b>{template.name}</b></span>
              </OkrButton>
              <OkrButton className="icon-only danger" onClick={() => onDelete(template)} title="删除模板"><Trash2 size={14} /></OkrButton>
            </article>) : <div className="panel-empty"><Filter size={20} /><b>暂无保存的视图</b><span>{disabled ? "先选择一个清单" : ""}</span></div>}
        </div>
        <footer>
          <OkrButton onClick={onClose}>关闭</OkrButton>
          <OkrButton className="primary-button" disabled={disabled} onClick={onSave}><Plus size={14} />保存当前视图</OkrButton>
        </footer>
      </section>
    </OkrDialogSurface>;
}
function ColumnPanel({
  onClose,
  onSave,
  visibleColumns
}) {
  const [draft, setDraft] = useState(() => normalizeVisibleColumns(visibleColumns));
  const toggle = (key, checked) => {
    if (checked) {
      setDraft(current => normalizeVisibleColumns([...current, key]));
    } else {
      setDraft(current => current.filter(item => item !== key));
    }
  };
  return <OkrDialogSurface asChild title="显示字段" onClose={onClose}>
      <section className="small-dialog column-dialog" role="dialog" aria-modal="true">
        <header>
          <div>
            <h2>显示字段</h2>
          </div>
          <OkrButton className="icon-only" onClick={onClose} title="关闭">
            <X size={18} />
          </OkrButton>
        </header>
        <div className="column-options">
          {taskColumnDefs.map(column => <Checkbox key={column.key} label={column.label} checked={draft.includes(column.key)} disabled={column.locked} onCheckedChange={checked => toggle(column.key, checked)} />)}
        </div>
        <footer>
          <OkrButton onClick={() => setDraft(defaultTaskColumns)}>恢复默认</OkrButton>
          <OkrButton className="primary-button" onClick={() => onSave(draft)}>
            保存字段
          </OkrButton>
        </footer>
      </section>
    </OkrDialogSurface>;
}
const groupOptions = [["", "不分组"], ["list", "所属清单"], ["status", "任务状态"], ["priority", "优先级"], ["project", "项目"], ["tags", "标签"]];
function GroupPanel({
  groupBy,
  onClose,
  onSave
}) {
  const [draft, setDraft] = useState(groupBy || "");
  return <OkrDialogSurface asChild title="分组展示" onClose={onClose}>
      <section className="small-dialog group-dialog" role="dialog" aria-modal="true">
        <header>
          <div><h2>分组展示</h2></div>
          <OkrButton className="icon-only" onClick={onClose} title="关闭"><X size={18} /></OkrButton>
        </header>
        <div className="group-options">
          {groupOptions.map(([value, label]) => <OkrButton className={draft === value ? "active" : ""} key={value || "none"} onClick={() => setDraft(value)}>
              <Rows3 size={15} />
              <span>{label}</span>
              {draft === value && <Check size={14} />}
            </OkrButton>)}
        </div>
        <footer>
          <OkrButton onClick={() => setDraft("")}>清除分组</OkrButton>
          <OkrButton className="primary-button" onClick={() => onSave(draft)}>保存分组</OkrButton>
        </footer>
      </section>
    </OkrDialogSurface>;
}
const fillColors = ["#ef4444", "#f59e0b", "#22c55e", "#0ea5e9", "#8b5cf6", "#ec4899", "#64748b"];
function normalizeFillRule(rule, index = 0) {
  if (Array.isArray(rule?.conditions)) return {
    ...rule,
    logic: rule.logic === "or" ? "or" : "and"
  };
  const fieldMap = {
    status: "status",
    list: "listId",
    priority: "priority",
    project: "projectId",
    tags: "tagId"
  };
  const values = {
    普通: "normal",
    重要: "important",
    紧急: "urgent",
    重要且紧急: "both"
  };
  const field = fieldMap[rule?.field] || "status";
  return {
    id: rule?.id || `fill-${Date.now()}-${index}`,
    logic: "and",
    conditions: [createTaskCondition(field, {
      operator: "equals",
      value: values[rule?.value] || rule?.value || "未完成"
    })],
    target: rule?.target || "row",
    color: rule?.color || fillColors[3]
  };
}
function FillPanel({
  meta,
  onClose,
  onSave,
  rules
}) {
  const [draft, setDraft] = useState(() => (rules || []).map(normalizeFillRule));
  const addRule = () => setDraft(current => [...current, {
    id: `fill-${Date.now()}-${current.length}`,
    logic: "and",
    conditions: [createTaskCondition("status")],
    target: "row",
    color: fillColors[3]
  }]);
  const patchRule = (id, patch) => setDraft(current => current.map(rule => rule.id === id ? {
    ...rule,
    ...patch
  } : rule));
  return <OkrDialogSurface asChild title="填色管理" onClose={onClose}>
      <section className="small-dialog fill-dialog" role="dialog" aria-modal="true">
        <header>
          <div><h2>填色管理</h2></div>
          <OkrButton className="icon-only" onClick={onClose} title="关闭"><X size={18} /></OkrButton>
        </header>
        <div className="fill-rule-list">
          {draft.map((rule, index) => <article key={rule.id}>
              <header>
                <b>规则 {index + 1}</b>
                <label>填色对象<OkrSelect value={rule.target} onChange={event => patchRule(rule.id, {
                target: event.target.value
              })}><option value="row">整行</option>{taskColumnDefs.filter(column => column.key !== "check").map(column => <option key={column.key} value={column.key}>{column.label}</option>)}</OkrSelect></label>
                <div className="fill-color-options" aria-label="填色颜色">{fillColors.map(color => <OkrButton className={rule.color === color ? "active" : ""} key={color} onClick={() => patchRule(rule.id, {
                color
              })} style={{
                background: color
              }} title={color}>{rule.color === color && <Check size={12} />}</OkrButton>)}</div>
                <OkrButton className="icon-only danger-text" onClick={() => setDraft(current => current.filter(item => item.id !== rule.id))} title="删除规则"><Trash2 size={15} /></OkrButton>
              </header>
              <div className="fill-rule-conditions">
                <TaskConditionRows meta={meta} onChange={next => patchRule(rule.id, {
              logic: next.logic,
              conditions: next.conditions
            })} value={rule} emptyLabel="新增一个条件后开始填色" />
              </div>
            </article>)}
          {draft.length === 0 && <div className="table-state empty">暂无填色规则</div>}
        </div>
        <footer>
          <OkrButton onClick={addRule}><Plus size={14} />新增规则</OkrButton>
          <OkrButton className="primary-button" onClick={() => onSave(draft)}>保存填色</OkrButton>
        </footer>
      </section>
    </OkrDialogSurface>;
}
function TaskContextMenu({
  lists,
  menu,
  onClose,
  onDelete,
  onOpen,
  onPatch,
  onTransfer
}) {
  if (!menu) return null;
  const {
    task,
    x,
    y
  } = menu;
  const run = async action => {
    await action();
    onClose();
  };
  const nextDoneStatus = task.status === "已完成" ? "未完成" : "已完成";
  return <div className="context-menu" onClick={event => event.stopPropagation()} style={{
    left: x,
    top: y
  }}>
      <OkrButton onClick={() => run(() => onOpen(task))}><FileSearch size={15} />打开详情</OkrButton>
      <OkrButton onClick={() => run(() => onPatch(task, {
      status: nextDoneStatus
    }, nextDoneStatus === "已完成" ? "任务已完成" : "任务已恢复为未完成"))}>
        <CheckSquare size={15} />{task.status === "已完成" ? "恢复未完成" : "标记完成"}
      </OkrButton>
      <OkrButton onClick={() => run(() => onPatch(task, {
      status: "进行中"
    }, "任务已设为进行中"))}>
        <Clock3 size={15} />设为进行中
      </OkrButton>
      <OkrButton onClick={() => run(() => onPatch(task, {
      status: "暂搁置"
    }, "任务已暂搁置"))}>
        <Circle size={15} />暂搁置
      </OkrButton>
      <OkrButton onClick={() => run(() => onPatch(task, {
      status: "已废弃"
    }, "任务已放弃"))}>
        <Archive size={15} />已放弃
      </OkrButton>
      <OkrButton onClick={() => run(() => onPatch(task, {
      starred: !task.starred
    }, task.starred ? "已取消星标" : "已加星标"))}>
        <Star size={15} />{task.starred ? "取消星标" : "加星标"}
      </OkrButton>
      <OkrButton onClick={() => run(() => onPatch(task, {
      important: !task.important
    }, task.important ? "已取消重要" : "已标记重要"))}>
        <Flag size={15} />{task.important ? "取消重要" : "标记重要"}
      </OkrButton>
      <OkrButton onClick={() => run(() => onPatch(task, {
      urgent: !task.urgent
    }, task.urgent ? "已取消紧急" : "已标记紧急"))}>
        <Bell size={15} />{task.urgent ? "取消紧急" : "标记紧急"}
      </OkrButton>
      <OkrButton onClick={() => run(() => onPatch(task, {
      isPinned: !task.isPinned
    }, task.isPinned ? "已取消置顶" : "任务已置顶"))}>
        <Pin size={15} />{task.isPinned ? "取消置顶" : "置顶任务"}
      </OkrButton>
      <div className="context-menu-section">
        <span><MoveRight size={12} />转移到清单</span>
        {lists.filter(list => list.id !== task.listId).map(list => <OkrButton key={list.id} onClick={() => run(() => onTransfer(task, list.id))}>
            <i style={{
          background: list.color
        }} />{list.name}
          </OkrButton>)}
      </div>
      <OkrButton className="danger" onClick={() => run(() => onDelete(task))}>
        <Trash2 size={15} />移入回收区
      </OkrButton>
    </div>;
}
async function copyText(text, onNotify) {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const node = document.createElement("textarea");
      node.value = text;
      node.style.position = "fixed";
      node.style.left = "-9999px";
      document.body.appendChild(node);
      node.focus();
      node.select();
      document.execCommand("copy");
      document.body.removeChild(node);
    }
    onNotify?.("任务内容已复制");
  } catch (error) {
    onNotify?.(error.message || "复制失败");
  }
}
function taskPriority(task) {
  if (task.important && task.urgent) return "重要且紧急";
  if (task.urgent) return "紧急";
  if (task.important) return "重要";
  return "普通";
}
function cellText(task, type) {
  const values = {
    title: task.title,
    list: task.listName,
    status: task.status,
    priority: taskPriority(task),
    project: task.projectName || "未归属",
    tags: (task.tagDetails || []).map(tag => tag.name).join(", "),
    startAt: toTaskTimeInput(task.startAt, task.startPrecision),
    dueAt: toTaskTimeInput(task.dueAt, task.duePrecision),
    createdAt: task.createdAt || "",
    source: task.source || "",
    taskNo: task.taskNo || "",
    databaseId: String(task.id),
    starred: task.starred ? "是" : "否"
  };
  return String(values[type] ?? "");
}
function pastePatch(task, type, text, meta) {
  const value = String(text || "").trim();
  if (type === "title") return value ? {
    title: value
  } : null;
  if (type === "source") return {
    source: value
  };
  if (["startAt", "dueAt"].includes(type)) {
    if (!value) return {
      [type]: null,
      [type === "startAt" ? "startPrecision" : "duePrecision"]: null
    };
    return /^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10)) ? {
      [type]: value.slice(0, 10),
      [type === "startAt" ? "startPrecision" : "duePrecision"]: "date"
    } : null;
  }
  if (type === "status") return statuses.includes(value) ? {
    status: value
  } : null;
  if (type === "priority") {
    const important = ["重要", "重要且紧急"].includes(value);
    const urgent = ["紧急", "重要且紧急"].includes(value);
    return ["普通", "重要", "紧急", "重要且紧急"].includes(value) ? {
      important,
      urgent
    } : null;
  }
  if (type === "list") {
    const list = meta.lists.find(item => String(item.id) === value || item.name === value);
    return list ? {
      listId: list.id,
      projectId: null
    } : null;
  }
  if (type === "project") {
    if (!value || value === "未归属") return {
      projectId: null
    };
    const project = projectsForList(meta.projects, task.listId).find(item => String(item.id) === value || item.name === value);
    return project ? {
      projectId: project.id
    } : null;
  }
  if (type === "tags") {
    if (!value) return {
      tagIds: []
    };
    const names = value.split(/[,，、]/).map(item => item.trim()).filter(Boolean);
    const available = tagsForList(meta.tags, task.listId);
    const matches = names.map(name => available.find(tag => tag.name === name || String(tag.id) === name)).filter(Boolean);
    return matches.length === names.length ? {
      tagIds: matches.map(tag => tag.id)
    } : null;
  }
  if (type === "starred") return {
    starred: ["是", "true", "1"].includes(value.toLowerCase())
  };
  return null;
}
function fillRuleMatches(task, rule) {
  if (Array.isArray(rule?.conditions)) return taskFilterMatches(task, rule);
  if (rule.field === "status") return task.status === rule.value;
  if (rule.field === "priority") return taskPriority(task) === rule.value;
  if (rule.field === "list") return String(task.listId) === String(rule.value);
  if (rule.field === "project") return String(task.projectId || "") === String(rule.value);
  if (rule.field === "tags") return (task.tagDetails || []).some(tag => String(tag.id) === String(rule.value));
  return false;
}
function fillFor(task, target, rules) {
  return (rules || []).find(rule => rule.target === target && fillRuleMatches(task, rule))?.color || "";
}
function buildTaskGroups(tasks, groupBy, metadata = []) {
  if (!groupBy) return [];
  const groups = new Map();
  for (const task of tasks) {
    let key = "none";
    let label = "未归属";
    let color = "#77736d";
    if (groupBy === "list") ({
      key,
      label,
      color
    } = {
      key: String(task.listId),
      label: task.listName,
      color: task.listColor
    });
    if (groupBy === "status") ({
      key,
      label
    } = {
      key: task.status,
      label: task.status
    });
    if (groupBy === "priority") ({
      key,
      label
    } = {
      key: taskPriority(task),
      label: taskPriority(task)
    });
    if (groupBy === "project" && task.projectId) ({
      key,
      label,
      color
    } = {
      key: String(task.projectId),
      label: task.projectName,
      color: task.projectColor || task.listColor
    });
    if (groupBy === "tags" && task.tagDetails?.length) {
      const tag = task.tagDetails[0];
      ({
        key,
        label,
        color
      } = {
        key: String(tag.id),
        label: tag.name,
        color: tag.color
      });
    }
    if (!groups.has(key)) groups.set(key, {
      key,
      label,
      color,
      tasks: []
    });
    groups.get(key).tasks.push(task);
  }
  if (metadata.length) return metadata.filter(group => groups.has(group.key)).map(group => ({
    ...groups.get(group.key),
    ...group
  }));
  return [...groups.values()];
}
function TaskTable({
  sort,
  onSort,
  batchMode,
  columnWidths,
  fillRules,
  groupBy,
  groupMetadata,
  loading,
  locked,
  meta,
  onColumnResize,
  onCompletionCommit,
  onDelete,
  onNotify,
  onOpen,
  onPage,
  onPatch,
  onRemoveCompleted,
  onSelectTask,
  onSelectVisible,
  onTransfer,
  selectedTaskIds,
  showTitleMeta,
  tasks,
  page,
  pageCount,
  total,
  visibleColumns
}) {
  const [menu, setMenu] = useState(null);
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const [liveWidths, setLiveWidths] = useState(columnWidths);
  const [editingCell, setEditingCell] = useState(null);
  const [selectedCell, setSelectedCell] = useState(null);
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const [completionPendingIds, setCompletionPendingIds] = useState(() => new Set());
  const [completionExitingIds, setCompletionExitingIds] = useState(() => new Set());
  const [horizontallyScrolled, setHorizontallyScrolled] = useState(false);
  const copiedCellRef = useRef(null);
  const completionInFlightRef = useRef(new Set());
  const pendingReflowPositionsRef = useRef(null);
  const reflowAnimationsRef = useRef([]);
  const rowNodesRef = useRef(new Map());
  useEffect(() => {
    setLiveWidths({
      ...defaultColumnWidths,
      ...columnWidths
    });
  }, [columnWidths]);
  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    const onScroll = event => {
      if (event.target instanceof Element && event.target.closest(".context-menu")) return;
      close();
    };
    const onKeyDown = event => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);
  useLayoutEffect(() => {
    const previousPositions = pendingReflowPositionsRef.current;
    if (!previousPositions) return;
    pendingReflowPositionsRef.current = null;
    reflowAnimationsRef.current.forEach(animation => animation?.cancel?.());
    reflowAnimationsRef.current = animateTaskRowReflow(previousPositions, rowNodesRef.current);
  }, [tasks]);
  useEffect(() => () => {
    reflowAnimationsRef.current.forEach(animation => animation?.cancel?.());
  }, []);
  const openMenu = (event, task) => {
    event.preventDefault();
    event.stopPropagation();
    if (locked) return;
    setMenu({
      task,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 254)),
      y: Math.min(event.clientY, window.innerHeight - 520)
    });
  };
  const beginEdit = (event, task, type) => {
    event.stopPropagation();
    if (["check"].includes(type)) return;
    if (["taskNo", "databaseId"].includes(type)) {
      const value = type === "taskNo" ? task.taskNo : String(task.id);
      if (value) copyText(value, onNotify);
      return;
    }
    if (locked || type === "createdAt") return;
    setEditingCell({
      taskId: task.id,
      type
    });
  };
  const commitEdit = async (task, patch, message) => {
    try {
      await onPatch(task, patch, message);
      setEditingCell(null);
      return true;
    } catch (error) {
      onNotify(error.message || "字段修改失败");
      return false;
    }
  };
  const toggleTaskComplete = async (task, anchor) => {
    if (completionInFlightRef.current.has(task.id)) return;
    const completing = task.status !== "已完成";
    const rect = anchor?.getBoundingClientRect?.();
    completionInFlightRef.current.add(task.id);
    setCompletionPendingIds(current => new Set(current).add(task.id));
    try {
      const nextStatus = completing ? "已完成" : "未完成";
      await onCompletionCommit(task, nextStatus);
      if (completing) {
        setCompletionExitingIds(current => new Set(current).add(task.id));
        if (rect) launchCompletionParticles(rect, {
          accentColor: task.listColor
        });
        await new Promise(resolve => window.setTimeout(resolve, taskCompletionExitDuration()));
        pendingReflowPositionsRef.current = captureTaskRowPositions(rowNodesRef.current);
        onRemoveCompleted(task.id);
      }
    } catch (error) {
      setCompletionExitingIds(current => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
      onNotify(error?.message || "任务状态修改失败，已恢复原状态");
    } finally {
      completionInFlightRef.current.delete(task.id);
      setCompletionPendingIds(current => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
      setCompletionExitingIds(current => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
  };
  const columns = taskColumnDefs.filter(column => visibleColumns.includes(column.key));
  const gridTemplate = columns.map(column => {
    const width = clampTaskColumnWidth(column.key, liveWidths[column.key], column.width);
    return ["check", "starred", "actions"].includes(column.key) ? `${width}px` : `minmax(${width}px, ${width}fr)`;
  }).join(" ");
  const minTableWidth = columns.reduce((sum, column) => sum + clampTaskColumnWidth(column.key, liveWidths[column.key], column.width), 0);
  const titleLeft = clampTaskColumnWidth("check", liveWidths.check, defaultColumnWidths.check);
  const allVisibleSelected = tasks.length > 0 && tasks.every(task => selectedTaskIds.has(task.id));
  const resizeColumn = (event, column) => {
    event.preventDefault();
    event.stopPropagation();
    if (locked) return;
    const startX = event.clientX;
    const startWidth = clampTaskColumnWidth(column.key, liveWidths[column.key], column.width);
    let nextWidth = startWidth;
    const onMove = moveEvent => {
      nextWidth = clampTaskColumnWidth(column.key, startWidth + moveEvent.clientX - startX, column.width);
      setLiveWidths(current => ({
        ...current,
        [column.key]: nextWidth
      }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onColumnResize(column.key, nextWidth);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, {
      once: true
    });
  };
  const adjustColumnWithKeyboard = (event, column) => {
    if (locked || !["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const current = clampTaskColumnWidth(column.key, liveWidths[column.key], column.width);
    const next = event.key === "Home" ? column.width : current + (event.key === "ArrowRight" ? 16 : -16);
    const width = clampTaskColumnWidth(column.key, next, column.width);
    setLiveWidths(value => ({
      ...value,
      [column.key]: width
    }));
    onColumnResize(column.key, width);
  };
  const resetColumnWidth = (event, column) => {
    event.preventDefault();
    event.stopPropagation();
    if (locked) return;
    setLiveWidths(current => ({
      ...current,
      [column.key]: column.width
    }));
    onColumnResize(column.key, column.width);
  };
  const toggleExpand = task => {
    const needsExpand = task.title.includes("\n") || task.title.length > 58;
    if (!needsExpand) return;
    setExpandedRows(current => {
      const next = new Set(current);
      if (next.has(task.id)) next.delete(task.id);else next.add(task.id);
      return next;
    });
  };
  useEffect(() => {
    const onKeyDown = async event => {
      if (!selectedCell || ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier || !["c", "v"].includes(event.key.toLowerCase())) return;
      const task = tasks.find(item => item.id === selectedCell.taskId);
      if (!task || selectedCell.type === "check") return;
      if (event.key.toLowerCase() === "c") {
        event.preventDefault();
        const text = cellText(task, selectedCell.type);
        copiedCellRef.current = {
          type: selectedCell.type,
          text
        };
        await copyText(text, onNotify);
        return;
      }
      if (locked) {
        onNotify("当前视图已锁定，不能粘贴修改");
        return;
      }
      event.preventDefault();
      let text = copiedCellRef.current?.type === selectedCell.type ? copiedCellRef.current.text : "";
      if (!text && navigator.clipboard?.readText && window.isSecureContext) {
        try {
          text = await navigator.clipboard.readText();
        } catch {
          text = "";
        }
      }
      const patch = pastePatch(task, selectedCell.type, text, meta);
      if (!patch) {
        onNotify("只能把有效内容粘贴到同一种字段");
        return;
      }
      await commitEdit(task, patch, "单元格已粘贴修改");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [locked, meta, onNotify, selectedCell, tasks]);
  const renderRow = task => {
    const rowFill = fillFor(task, "row", fillRules);
    return <div className={`task-row wx-library-row ${task.status === "已完成" ? "done" : ""} ${expandedRows.has(task.id) ? "expanded" : ""} ${task.isPinned ? "pinned" : ""} ${selectedTaskIds.has(task.id) ? "selected" : ""} ${completionExitingIds.has(task.id) ? "completion-exit" : ""}`} key={task.id} onContextMenu={event => openMenu(event, task)} ref={node => {
      if (node) rowNodesRef.current.set(task.id, node);else rowNodesRef.current.delete(task.id);
    }} role="row" tabIndex={0} onKeyDown={event => event.key === "Enter" && event.target === event.currentTarget && onOpen(task)} style={rowFill ? {
      "--row-fill": rowFill
    } : undefined}>
      {columns.map(column => <div className={`task-data-cell wx-library-cell column-${column.key} ${selectedCell?.taskId === task.id && selectedCell?.type === column.key ? "cell-selected" : ""}`} key={column.key} onClick={event => {
        event.stopPropagation();
        setSelectedCell({
          taskId: task.id,
          type: column.key
        });
        if (column.key === "title") toggleExpand(task);
      }} style={fillFor(task, column.key, fillRules) ? {
        "--cell-fill": fillFor(task, column.key, fillRules)
      } : undefined}>
          <TaskCell batchMode={batchMode} completionExiting={completionExitingIds.has(task.id)} completionPending={completionPendingIds.has(task.id)} editing={editingCell?.taskId === task.id && editingCell?.type === column.key} expanded={expandedRows.has(task.id)} meta={meta} onBeginEdit={event => beginEdit(event, task, column.key)} onCancelEdit={() => setEditingCell(null)} onCommit={(patch, message) => commitEdit(task, patch, message)} onCopy={copyText} onEditTask={event => beginEdit(event, task, "title")} onMore={event => openMenu(event, task)} onNotify={onNotify} onOpenTask={() => onOpen(task)} onSelect={checked => onSelectTask(task.id, checked)} onToggleComplete={anchor => toggleTaskComplete(task, anchor)} selected={selectedTaskIds.has(task.id)} showTitleMeta={showTitleMeta} task={task} type={column.key} />
        </div>)}
    </div>;
  };
  const pinnedTasks = sort.includes(":") ? [] : tasks.filter(task => task.isPinned);
  const regularTasks = sort.includes(":") ? tasks : tasks.filter(task => !task.isPinned);
  const groups = buildTaskGroups(tasks, groupBy, groupMetadata);
  return <div className="task-table-shell" aria-busy={loading}>
    {loading && <div className="table-update-indicator" role="status">更新中</div>}
    <LibraryScroll label="任务清单列表" className={`table-scroll ${horizontallyScrolled ? "is-horizontally-scrolled" : ""}`} onScroll={event => setHorizontallyScrolled(event.currentTarget.scrollLeft > 2)}>
      <div className="task-table wx-library-grid" role="table" style={{
        "--columns": gridTemplate,
        "--title-left": `${titleLeft}px`,
        minWidth: minTableWidth
      }}>
        <div className="task-table-head wx-library-head" role="row">
          {columns.map(column => <span className={`column-head column-${column.key}`} key={column.key} role="columnheader" aria-sort={libraryAriaSort(sort, column.key)}>
              {column.key === "check" ? batchMode ? <OkrButton className={`batch-select-all ${allVisibleSelected ? "checked" : ""}`} onClick={() => onSelectVisible(!allVisibleSelected)} title={allVisibleSelected ? "取消选择本页" : "选择本页任务"}>
                  {allVisibleSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                </OkrButton> : <span className="completion-column-label">完成</span> : column.key === "actions" ? <span>{column.label}</span> : <LibrarySortButton field={column.key} label={column.label} sort={sort} onSort={onSort} disabled={locked} />}
              {!column.locked && <OkrButton aria-label={`调整${column.label}列宽`} aria-orientation="vertical" aria-valuemax={column.key === "title" ? 800 : 800} aria-valuemin={column.key === "title" ? 220 : 56} aria-valuenow={clampTaskColumnWidth(column.key, liveWidths[column.key], column.width)} className="column-resizer" disabled={locked} onDoubleClick={event => resetColumnWidth(event, column)} onKeyDown={event => adjustColumnWithKeyboard(event, column)} onPointerDown={event => resizeColumn(event, column)} role="separator" title={locked ? "视图已锁定" : "拖动调整列宽；双击恢复默认"} type="button" />}
            </span>)}
        </div>
        <div className="task-table-body">
          {!tasks.length && (loading ? <div className="table-skeleton" aria-label="正在读取任务">{Array.from({
              length: 8
            }, (_, index) => <div key={index}><i /><i /><i /></div>)}</div> : <div className="table-state empty"><Circle size={20} />当前条件下没有任务</div>)}
          {groupBy ? groups.map(group => <section className="task-group" key={group.key}>
              <OkrButton className="task-group-header" onClick={() => setCollapsedGroups(current => {
              const next = new Set(current);
              if (next.has(group.key)) next.delete(group.key);else next.add(group.key);
              return next;
            })}>
                <ChevronDown className={collapsedGroups.has(group.key) ? "collapsed" : ""} size={14} />
                <i style={{
                background: group.color
              }} />
                <strong>{group.label}</strong>
                <span>{group.count === undefined ? `本页 ${group.tasks.length}` : group.count} 条</span>
              </OkrButton>
              {!collapsedGroups.has(group.key) && group.tasks.map(renderRow)}
            </section>) : <>
            {pinnedTasks.length > 0 && <div className="pinned-task-rows">{pinnedTasks.map(renderRow)}</div>}
            {regularTasks.map(renderRow)}
          </>}
        </div>
      </div>
      {!locked && <TaskContextMenu lists={meta.lists} menu={menu} onClose={() => setMenu(null)} onDelete={onDelete} onOpen={onOpen} onPatch={onPatch} onTransfer={onTransfer} />}
    </LibraryScroll>
    <footer className="admin-table-footer okr-table-pagination">
      <Pagination page={page + 1} pageSize={TASK_PAGE_SIZE} total={total} onChange={next => onPage(next - 1)} />
    </footer>
    </div>;
}
function TaskCell({
  batchMode,
  completionExiting,
  completionPending,
  editing,
  expanded,
  meta,
  onBeginEdit,
  onCancelEdit,
  onCommit,
  onCopy,
  onEditTask,
  onMore,
  onNotify,
  onOpenTask,
  onSelect,
  onToggleComplete,
  selected,
  showTitleMeta,
  task,
  type
}) {
  if (type === "check") {
    if (!batchMode) {
      const completed = task.status === "已完成";
      const visuallyCompleted = completed || completionExiting;
      return <OkrButton aria-label={completed ? "恢复为未完成" : "标记完成"} aria-busy={completionPending ? "true" : undefined} className={`task-check completion-check ${visuallyCompleted ? "checked" : ""} ${completionPending ? "is-pending" : ""}`} disabled={completionPending} onClick={event => {
        event.stopPropagation();
        onToggleComplete(event.currentTarget);
      }} title={completed ? "点击恢复为未完成" : "点击标记完成"}>
          {completionPending && !completionExiting ? <LoaderCircle className="spin" size={12} /> : visuallyCompleted && <Check className="completion-checkmark" size={12} strokeWidth={3} />}
        </OkrButton>;
    }
    return <OkrButton aria-label={selected ? "取消选择任务" : "选择任务"} className={`task-check batch-check ${selected ? "checked" : ""}`} onClick={event => {
      event.stopPropagation();
      onSelect(!selected);
    }} title={selected ? "取消选择" : "选择任务"}>
        {selected && <Check size={12} strokeWidth={3} />}
      </OkrButton>;
  }
  if (editing) {
    return <InlineCellEditor meta={meta} onCancel={onCancelEdit} onCommit={onCommit} task={task} type={type} />;
  }
  if (type === "title") {
    return <div className={`title-cell editable-cell ${expanded ? "expanded" : ""}`} onDoubleClick={onBeginEdit} title="单击展开，双击编辑任务内容">
        <span className="task-list-mark" style={{
        "--list-color": task.listColor
      }} aria-hidden="true" />
        <span className="task-main-copy">
          <strong>{task.isPinned && <Pin className="pinned-icon" size={12} />}{task.title}</strong>
          {showTitleMeta && <span className="title-meta">
            <small>{task.listName || "未归属清单"}</small>
            <code>{task.taskNo || `#${task.id}`}</code>
          </span>}
        </span>
        <OkrButton className="copy-title" onClick={event => {
        event.stopPropagation();
        onCopy(task.title, onNotify);
      }} onDoubleClick={event => event.stopPropagation()} title="复制任务内容">
          <Clipboard size={12} />
        </OkrButton>
      </div>;
  }
  if (type === "list") {
    return <span className="okr-cell-badge editable-cell" onDoubleClick={onBeginEdit} title="双击修改所属清单"><Badge tone="neutral"><i className="option-color-dot" style={{
          background: task.listColor
        }} />{task.listName}</Badge></span>;
  }
  if (type === "status") return <div className="editable-cell" onDoubleClick={onBeginEdit} title="双击修改状态"><StatusPill status={task.status} /></div>;
  if (type === "priority") {
    return <span className="okr-cell-badge editable-cell" onDoubleClick={onBeginEdit} title="双击修改优先标记">
        <Badge tone={task.important ? "error" : task.urgent ? "warning" : "neutral"}>{taskPriority(task)}</Badge>
      </span>;
  }
  if (type === "project") return <span className="okr-cell-badge editable-cell" onDoubleClick={onBeginEdit} title="双击修改项目">{task.projectName ? <Badge tone="neutral"><i className="option-color-dot" style={{
        background: task.projectColor || task.listColor
      }} />{task.projectName}</Badge> : <span className="empty-cell" aria-label="未归属项目">—</span>}</span>;
  if (type === "tags") {
    return <div className="tag-cell editable-cell" onDoubleClick={onBeginEdit} title="双击修改标签">
        {(task.tagDetails || []).slice(0, 2).map(tag => <Badge key={tag.id} tone="neutral"><i className="option-color-dot" style={{
          background: tag.color
        }} />{tag.name}</Badge>)}
        {task.tags.length > 2 && <em>+{task.tags.length - 2}</em>}
        {task.tags.length === 0 && <small className="empty-cell" aria-label="无标签">—</small>}
      </div>;
  }
  if (type === "startAt") return <time className="editable-cell" onDoubleClick={onBeginEdit} title="双击修改开始时间">{task.startAt ? formatTaskTime(task.startAt, task.startPrecision) : <span className="empty-cell" aria-label="未设置开始时间">—</span>}</time>;
  if (type === "dueAt") {
    return <time className={`editable-cell ${isOverdue(task) ? "overdue" : ""}`} onDoubleClick={onBeginEdit} title="双击修改截止时间">{task.dueAt ? formatTaskTime(task.dueAt, task.duePrecision) : <span className="empty-cell" aria-label="未设置截止时间">—</span>}</time>;
  }
  if (type === "createdAt") return <time title={formatDateTime(task.createdAt)}>{formatDateTime(task.createdAt)}</time>;
  if (type === "source") return <span className="truncate editable-cell" onDoubleClick={onBeginEdit} title="双击修改来源">{task.source}</span>;
  if (type === "taskNo") return <code onClick={onBeginEdit} title="点击复制系统编号">{task.taskNo}</code>;
  if (type === "databaseId") return <code onClick={onBeginEdit} title="点击复制数据库 ID">#{task.id}</code>;
  if (type === "starred") {
    return <div className="editable-cell" onDoubleClick={onBeginEdit} title="双击修改星标">
        <Star className={task.starred ? "starred" : ""} fill={task.starred ? "currentColor" : "none"} size={15} />
      </div>;
  }
  if (type === "actions") {
    return <div className="task-row-actions">
      <OkrButton onClick={event => {
        event.stopPropagation();
        onOpenTask();
      }} title="查看任务"><FileSearch size={14} /></OkrButton>
      <OkrButton onClick={onEditTask} title="编辑任务"><Pencil size={14} /></OkrButton>
      <OkrButton onClick={onMore} title="更多操作"><MoreHorizontal size={15} /></OkrButton>
    </div>;
  }
  return <span />;
}
function InlineCellEditor({
  meta,
  onCancel,
  onCommit,
  task,
  type
}) {
  const priorityValue = task.important && task.urgent ? "both" : task.important ? "important" : task.urgent ? "urgent" : "normal";
  const initialValue = type === "title" ? task.title : type === "list" ? String(task.listId) : type === "status" ? task.status : type === "priority" ? priorityValue : type === "project" ? String(task.projectId || "") : type === "tags" ? (task.tagDetails || []).map(tag => tag.id) : type === "startAt" ? toTaskTimeInput(task.startAt, task.startPrecision) : type === "dueAt" ? toTaskTimeInput(task.dueAt, task.duePrecision) : type === "source" ? task.source : type === "starred" ? String(Boolean(task.starred)) : "";
  const [value, setValue] = useState(initialValue);
  const savingRef = useRef(false);
  const cancelledRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const stop = event => event.stopPropagation();
  const saveText = async () => {
    if (savingRef.current || cancelledRef.current) return;
    const normalized = String(value).trim();
    if (type === "title" && !normalized) {
      setError("任务内容不能为空");
      return;
    }
    if (normalized === initialValue) {
      onCancel();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const saved = await onCommit({
        [type]: normalized
      }, type === "title" ? "任务内容已修改" : "来源已修改");
      if (saved === false) setError("保存失败，按回车重试");
    } catch {
      setError("保存失败，按回车重试");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const commitSelect = nextValue => {
    if (type === "list") onCommit({
      listId: Number(nextValue),
      projectId: null
    }, "所属清单已修改");else if (type === "status") onCommit({
      status: nextValue
    }, "任务状态已修改");else if (type === "priority") onCommit({
      important: ["important", "both"].includes(nextValue),
      urgent: ["urgent", "both"].includes(nextValue)
    }, "优先标记已修改");else if (type === "project") onCommit({
      projectId: nextValue ? Number(nextValue) : null
    }, "所属项目已修改");else if (type === "starred") onCommit({
      starred: nextValue === "true"
    }, "星标已修改");
  };
  const handleKey = event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      cancelledRef.current = true;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
    if (event.key === "Enter" && !event.shiftKey && ["title", "source"].includes(type)) {
      event.preventDefault();
      event.stopPropagation();
      saveText();
    }
  };
  if (["title", "source"].includes(type)) {
    const InputComponent = type === "title" ? OkrTextarea : OkrInput;
    return <span className="inline-edit-field" aria-busy={saving}>
      <InputComponent className={`inline-cell-input ${type === "title" ? "inline-title-input" : ""}`} autoFocus readOnly={saving} onBlur={saveText} onClick={stop} onDoubleClick={stop} onChange={event => setValue(event.target.value)} onKeyDown={handleKey} rows={type === "title" ? 3 : undefined} value={value} />
      {(saving || error) && <small className={error ? "is-error" : ""} role={error ? "alert" : "status"}>{error || "保存中"}</small>}
    </span>;
  }
  if (["startAt", "dueAt"].includes(type)) {
    const precisionKey = type === "startAt" ? "startPrecision" : "duePrecision";
    const precision = inferTaskTimePrecision(task[type], task[precisionKey]);
    return <OkrInput className="inline-cell-input" autoFocus onClick={stop} onDoubleClick={stop} onKeyDown={handleKey} onChange={event => {
      setValue(event.target.value);
      onCommit({
        [type]: taskTimeApiValue(event.target.value, precision),
        [precisionKey]: event.target.value ? precision : null
      }, type === "startAt" ? "开始时间已修改" : "截止时间已修改");
    }} type={precision === "date" ? "date" : "datetime-local"} value={value} />;
  }
  if (type === "tags") {
    const options = tagsForList(meta.tags, task.listId);
    return <OkrCellPopover onClose={onCancel} label="修改任务标签">
      <div className="inline-tag-editor" onClick={stop} onDoubleClick={stop}>
        <div>{options.map(tag => <label key={tag.id}><OkrInput checked={value.includes(tag.id)} onChange={event => setValue(current => event.target.checked ? [...current, tag.id] : current.filter(id => id !== tag.id))} type="checkbox" /><i style={{
              background: tag.color
            }} />{tag.name}</label>)}</div>
        <footer><OkrButton onClick={onCancel}>取消</OkrButton><OkrButton className="primary-button confirm-action" onClick={() => onCommit({
            tagIds: value
          }, "任务标签已修改")}>确认</OkrButton></footer>
      </div>
      </OkrCellPopover>;
  }
  const options = type === "list" ? meta.lists.map(item => [item.id, item.name, item.color]) : type === "status" ? statuses.map(item => [item, item, ""]) : type === "priority" ? [["normal", "普通", ""], ["important", "重要", "#dc2626"], ["urgent", "紧急", "#ca8a19"], ["both", "重要且紧急", "#b91c1c"]] : type === "project" ? [["", "未归属", "#77736d"], ...projectsForList(meta.projects, task.listId).map(item => [item.id, item.name, item.color])] : [["false", "否", "#77736d"], ["true", "是", "#ca8a19"]];
  return <OkrCellPopover onClose={onCancel} label="修改任务字段">
    <div className="inline-option-editor okr-option-menu" role="listbox" aria-label="选择字段值" onClick={stop} onDoubleClick={stop}>
      {options.map(([optionValue, label, color]) => <OkrButton role="option" aria-selected={String(value) === String(optionValue)} className={String(value) === String(optionValue) ? "selected" : ""} key={String(optionValue)} onClick={() => {
        setValue(String(optionValue));
        commitSelect(String(optionValue));
      }}>
          {type === "status" ? <StatusPill status={label} /> : <Badge tone={type === "priority" && color ? "warning" : type === "starred" ? "neutral" : "brand"}>{label}</Badge>}
          {String(value) === String(optionValue) && <Check size={12} />}
        </OkrButton>)}
      <OkrButton className="inline-editor-cancel" onClick={onCancel}>取消</OkrButton>
    </div>
    </OkrCellPopover>;
}
function isOverdue(task) {
  if (!task.dueAt || ["已完成", "已废弃"].includes(task.status)) return false;
  return new Date(task.dueAt) < new Date(new Date().toDateString());
}
function StatusPill({
  status
}) {
  const tone = {
    未完成: "neutral",
    进行中: "brand",
    已完成: "success",
    已废弃: "error",
    暂搁置: "warning"
  }[status];
  return <Badge tone={tone || "neutral"}>{status}</Badge>;
}
const datePresetOptions = [["today", "今日"], ["yesterday", "昨日"], ["last7", "近 7 日"], ["last30", "近 30 日"], ["thisWeek", "本周"], ["lastWeek", "上周"], ["thisMonth", "本月"], ["next7", "未来 7 日"]];
function DateFilterField({
  draft,
  field,
  label,
  setDraft
}) {
  const fromKey = `${field}From`;
  const toKey = `${field}To`;
  const presetKey = `${field}Preset`;
  const updatePreset = preset => setDraft({
    ...draft,
    [presetKey]: preset,
    [fromKey]: "",
    [toKey]: ""
  });
  const updateDate = (key, value) => setDraft({
    ...draft,
    [key]: value,
    [presetKey]: ""
  });
  return <fieldset className="created-filter-block date-filter-block">
      <legend>{label}</legend>
      <div className="quick-date-filters">
        <OkrButton className={!draft[presetKey] && !draft[fromKey] && !draft[toKey] ? "selected" : ""} onClick={() => updatePreset("")}>全部</OkrButton>
        {datePresetOptions.map(([value, text]) => <OkrButton className={draft[presetKey] === value ? "selected" : ""} key={value} onClick={() => updatePreset(value)}>{text}</OkrButton>)}
      </div>
      <div className="filter-date-grid">
        <label>{label}从<OkrInput type="date" value={draft[fromKey] || ""} onChange={event => updateDate(fromKey, event.target.value)} /></label>
        <label>{label}到<OkrInput type="date" value={draft[toKey] || ""} onChange={event => updateDate(toKey, event.target.value)} /></label>
      </div>
      {draft[presetKey] && <small className="dynamic-date-hint">动态日期：每次打开或使用模板时都会按当天重新计算</small>}
    </fieldset>;
}
function FilterPanel({
  filters,
  meta,
  onApply,
  onClose
}) {
  const [draft, setDraft] = useState(() => normalizeTaskFilters(filters));
  return <OkrDialogSurface asChild title="筛选条件" onClose={onClose}>
      <section className="small-dialog filter-builder-dialog" role="dialog" aria-modal="true">
        <header>
          <div><h2>筛选条件</h2></div>
          <OkrButton className="icon-only" onClick={onClose} title="关闭"><X size={18} /></OkrButton>
        </header>
        <TaskConditionRows meta={meta} onChange={setDraft} value={draft} />
        <footer>
          <OkrButton onClick={() => setDraft({
          logic: "and",
          conditions: [],
          sort: draft.sort || "created"
        })}>清空条件</OkrButton>
          <OkrButton className="primary-button" onClick={() => onApply(normalizeTaskFilters(draft))}>应用筛选</OkrButton>
        </footer>
      </section>
    </OkrDialogSurface>;
}
function TaskTimeField({
  label,
  value,
  precision,
  onChange
}) {
  const setQuick = mode => {
    const now = new Date();
    const beijingToday = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(now);
    const base = new Date(`${beijingToday}T12:00:00Z`);
    const weekday = base.getUTCDay();
    const offsets = {
      today: 0,
      tomorrow: 1,
      nextWeek: 7,
      weekend: weekday === 6 ? 0 : 6 - weekday
    };
    base.setUTCDate(base.getUTCDate() + offsets[mode]);
    const date = base.toISOString().slice(0, 10);
    onChange(precision === "date" ? date : `${date}T09:00`, precision);
  };
  const changePrecision = nextPrecision => {
    if (!value) return onChange("", nextPrecision);
    const date = value.slice(0, 10);
    onChange(nextPrecision === "date" ? date : `${date}T09:00`, nextPrecision);
  };
  return <div className="task-time-field">
      <div className="task-time-label"><span>{label}</span><div className="segmented"><OkrButton className={precision === "date" ? "active" : ""} type="button" onClick={() => changePrecision("date")}>仅日期</OkrButton><OkrButton className={precision === "datetime" ? "active" : ""} type="button" onClick={() => changePrecision("datetime")}>具体时间</OkrButton></div></div>
      <div className="task-time-input"><OkrInput type={precision === "date" ? "date" : "datetime-local"} value={value} onChange={event => onChange(event.target.value, precision)} /><OkrButton className="icon-only" type="button" onClick={() => onChange("", precision)} title={`清除${label}`}><X size={14} /></OkrButton></div>
      <div className="task-time-quick"><OkrButton type="button" onClick={() => setQuick("today")}>今天</OkrButton><OkrButton type="button" onClick={() => setQuick("tomorrow")}>明天</OkrButton><OkrButton type="button" onClick={() => setQuick("nextWeek")}>下周</OkrButton><OkrButton type="button" onClick={() => setQuick("weekend")}>本周末</OkrButton></div>
    </div>;
}
function TaskModal({
  meta,
  onClose,
  onDeleted,
  onSaved,
  readOnly = false,
  task
}) {
  const dialog = useAppDialog();
  const [tab, setTab] = useState("info");
  const [draft, setDraft] = useState({
    title: task.title,
    status: task.status,
    listId: task.listId,
    projectId: task.projectId || "",
    startAt: toTaskTimeInput(task.startAt, task.startPrecision),
    dueAt: toTaskTimeInput(task.dueAt, task.duePrecision),
    startPrecision: inferTaskTimePrecision(task.startAt, task.startPrecision),
    duePrecision: inferTaskTimePrecision(task.dueAt, task.duePrecision),
    starred: task.starred,
    important: task.important,
    urgent: task.urgent,
    isPinned: task.isPinned,
    source: task.source,
    notes: task.notes || "",
    tagIds: (task.tagDetails || []).map(tag => tag.id)
  });
  const [logs, setLogs] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const originalDraft = useRef(JSON.stringify(draft));
  const saveInFlight = useRef(false);
  const requestClose = async () => {
    if (saveInFlight.current) return;
    if (!readOnly && originalDraft.current !== JSON.stringify(draft)) {
      if (!(await dialog.confirm({
        title: "放弃未保存的修改？",
        confirmLabel: "放弃修改"
      }))) return;
    }
    onClose();
  };
  useEffect(() => {
    if (tab !== "logs") return;
    api(`/api/tasks/${task.id}/logs`).then(result => setLogs(result.data));
  }, [tab, task.id]);
  const save = async () => {
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    setSaveError("");
    try {
      await api(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...draft,
          projectId: draft.projectId || null,
          startAt: taskTimeApiValue(draft.startAt, draft.startPrecision),
          dueAt: taskTimeApiValue(draft.dueAt, draft.duePrecision),
          startPrecision: draft.startAt ? draft.startPrecision : null,
          duePrecision: draft.dueAt ? draft.duePrecision : null
        })
      });
      onSaved();
    } catch (error) {
      setSaveError(error.message || "保存失败，修改内容已保留");
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };
  const draftProjects = projectsForList(meta.projects, draft.listId);
  const draftTags = tagsForList(meta.tags, draft.listId);
  return <OkrDialogSurface asChild title="任务详情" onClose={requestClose}>
      <section className="task-modal" role="dialog" aria-modal="true">
        <header>
          <div>
            <div className="task-identities">
              <code>{task.taskNo}</code>
              <code>DB #{task.id}</code>
              
            </div>
            <span>创建于 {formatDateTime(task.createdAt)}</span>
          </div>
          <OkrButton className="icon-only" onClick={requestClose} title="关闭">
            <X size={19} />
          </OkrButton>
        </header>
        <div className="modal-tabs">
          <OkrButton className={tab === "info" ? "active" : ""} onClick={() => setTab("info")}>
            任务信息
          </OkrButton>
          <OkrButton className={tab === "logs" ? "active" : ""} onClick={() => setTab("logs")}>
            操作日志
          </OkrButton>
        </div>
        {tab === "info" ? <fieldset className="task-form task-form-lock" disabled={readOnly}>
            <label className="title-input">
              任务内容
              <OkrTextarea onChange={event => setDraft({
            ...draft,
            title: event.target.value
          })} rows={2} value={draft.title} />
            </label>
            <div className="form-grid">
              <label>
                状态
                <OkrSelect value={draft.status} onChange={event => setDraft({
              ...draft,
              status: event.target.value
            })}>
                  {statuses.map(status => <option key={status}>{status}</option>)}
                </OkrSelect>
              </label>
              <label>
                所属清单
                <OkrSelect value={draft.listId} onChange={event => setDraft({
              ...draft,
              listId: Number(event.target.value),
              projectId: "",
              tagIds: []
            })}>
                  {meta.lists.map(list => <option key={list.id} value={list.id}>
                      {list.name}
                    </option>)}
                </OkrSelect>
              </label>
              <label>
                项目
                <OkrSelect value={draft.projectId} onChange={event => setDraft({
              ...draft,
              projectId: event.target.value
            })}>
                  <option value="">未归属项目</option>
                  {draftProjects.map(project => <option key={project.id} value={project.id}>
                      {project.name}
                    </option>)}
                </OkrSelect>
              </label>
              <TaskTimeField label="开始时间" value={draft.startAt} precision={draft.startPrecision} onChange={(startAt, startPrecision) => setDraft({
            ...draft,
            startAt,
            startPrecision
          })} />
              <TaskTimeField label="截止时间" value={draft.dueAt} precision={draft.duePrecision} onChange={(dueAt, duePrecision) => setDraft({
            ...draft,
            dueAt,
            duePrecision
          })} />
            </div>
            <div className="flag-grid">
              <label>
                <OkrInput checked={draft.starred} onChange={event => setDraft({
              ...draft,
              starred: event.target.checked
            })} type="checkbox" />
                <Star size={15} />
                已加星标
              </label>
              <label>
                <OkrInput checked={draft.important} onChange={event => setDraft({
              ...draft,
              important: event.target.checked
            })} type="checkbox" />
                <Flag size={15} />
                重要
              </label>
              <label>
                <OkrInput checked={draft.urgent} onChange={event => setDraft({
              ...draft,
              urgent: event.target.checked
            })} type="checkbox" />
                <Clock3 size={15} />
                紧急
              </label>
              <label>
                <OkrInput checked={draft.isPinned} onChange={event => setDraft({
              ...draft,
              isPinned: event.target.checked
            })} type="checkbox" />
                <Pin size={15} />
                置顶
              </label>
            </div>
            <fieldset className="tag-picker">
              <legend>标签</legend>
              <div>
                {draftTags.map(tag => <label key={tag.id}>
                    <OkrInput checked={draft.tagIds.includes(tag.id)} onChange={event => setDraft({
                ...draft,
                tagIds: event.target.checked ? [...draft.tagIds, tag.id] : draft.tagIds.filter(id => id !== tag.id)
              })} type="checkbox" />
                    <i style={{
                background: tag.color
              }} />
                    {tag.name}
                  </label>)}
                {draftTags.length === 0 && <small>当前清单尚无标签</small>}
              </div>
            </fieldset>
            <label>
              备注 / 下一步
              <OkrTextarea onChange={event => setDraft({
            ...draft,
            notes: event.target.value
          })} placeholder="补充背景、下一步或需要注意的事项" rows={4} value={draft.notes} />
            </label>
          </fieldset> : <LogTimeline logs={logs} />}
        {saveError && <p className="form-error" role="alert">{saveError}</p>}
        <footer>
          {!readOnly && <OkrButton className="danger-button" onClick={async () => {
          const confirmed = await dialog.confirm({
            title: "移入回收区",
            message: "确认将这条任务移入回收区？",
            confirmLabel: "移入回收区",
            danger: true
          });
          if (!confirmed) return;
          await api(`/api/tasks/${task.id}`, {
            method: "DELETE"
          });
          onDeleted();
        }} title="删除任务">
            <Trash2 size={16} />
            删除
          </OkrButton>}
          <div>
            <OkrButton onClick={requestClose}>{readOnly ? "关闭" : "取消"}</OkrButton>
            {tab === "info" && !readOnly && <OkrButton className="primary-button" disabled={saving || !draft.title.trim()} onClick={save}>
                {saving && <LoaderCircle className="spin" size={15} />}
                保存任务
              </OkrButton>}
          </div>
        </footer>
      </section>
    </OkrDialogSurface>;
}
function LogTimeline({
  logs
}) {
  if (logs.length === 0) {
    return <div className="table-state empty">暂无操作日志</div>;
  }
  return <div className="log-timeline">
      {logs.map(log => <article key={log.id}>
          <i />
          <div>
            <header>
              <strong>{log.eventType}</strong>
              <time>{formatDateTime(log.occurredAt)}</time>
            </header>
            <p>{log.message || `${log.oldValue || "空"} → ${log.newValue || "空"}`}</p>
            <small>{log.source}</small>
          </div>
        </article>)}
    </div>;
}
function NotificationPanel({
  onClose
}) {
  const [logs, setLogs] = useState([]);
  useEffect(() => {
    api("/api/logs?limit=30").then(result => setLogs(result.data));
  }, []);
  return <div className="side-overlay" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <aside className="side-panel notifications">
        <header>
          <div>
            <span>系统动态</span>
            <h2>最近操作</h2>
          </div>
          <OkrButton className="icon-only" onClick={onClose} title="关闭">
            <X size={18} />
          </OkrButton>
        </header>
        <LogTimeline logs={logs} />
      </aside>
    </div>;
}
function ListDialog({
  onClose,
  onCreated
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(listColors[0]);
  return <OkrDialogSurface asChild title="新建任务清单" onClose={onClose}>
      <section className="small-dialog" role="dialog" aria-modal="true">
        <header>
          <div>
            <span>清单列表</span>
            <h2>新建任务清单</h2>
          </div>
          <OkrButton className="icon-only" onClick={onClose} title="关闭">
            <X size={18} />
          </OkrButton>
        </header>
        <label>
          清单名称
          <OkrInput autoFocus onChange={event => setName(event.target.value)} placeholder="例如：客户跟进" value={name} />
        </label>
        <fieldset className="color-picker">
          <legend>标识颜色</legend>
          {listColors.map(item => <label key={item} title={item}>
              <OkrInput checked={color === item} name="list-color" onChange={() => setColor(item)} type="radio" />
              <i style={{
            background: item
          }}>
                {color === item && <Check size={13} />}
              </i>
            </label>)}
        </fieldset>
        <footer>
          <OkrButton onClick={onClose}>取消</OkrButton>
          <OkrButton className="primary-button" disabled={!name.trim()} onClick={async () => {
          const list = await api("/api/lists", {
            method: "POST",
            body: JSON.stringify({
              name: name.trim(),
              color
            })
          });
          onCreated(list);
        }}>
            创建清单
          </OkrButton>
        </footer>
      </section>
    </OkrDialogSurface>;
}
function ProjectManagerPage({
  initialListId,
  meta,
  onNotice,
  onRefresh
}) {
  const dialog = useAppDialog();
  const defaultListId = initialListId || meta.lists[0]?.id || "";
  const [selectedListId, setSelectedListId] = useState(defaultListId);
  const [projects, setProjects] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    name: "",
    color: listColors[1]
  });
  const loadProjects = useCallback(async () => {
    if (!selectedListId) return;
    const result = await api(`/api/projects?listId=${selectedListId}`);
    setProjects(result.data);
  }, [selectedListId]);
  useEffect(() => {
    loadProjects().catch(error => onNotice(error.message));
  }, [loadProjects, onNotice]);
  const reset = () => {
    setEditing(null);
    setForm({
      name: "",
      color: listColors[1]
    });
  };
  const save = async () => {
    const body = JSON.stringify({
      listId: Number(selectedListId),
      name: form.name.trim(),
      color: form.color
    });
    if (editing) {
      await api(`/api/projects/${editing.id}`, {
        method: "PATCH",
        body
      });
      onNotice("项目已更新");
    } else {
      await api("/api/projects", {
        method: "POST",
        body
      });
      onNotice("项目已创建");
    }
    reset();
    await loadProjects();
    await onRefresh();
  };
  return <section className="management-page">
      <header>
        <div>
          <span>清单项目</span>
          <h2>项目管理</h2>
        </div>
        <label>
          所属清单
          <OkrSelect value={selectedListId} onChange={event => {
          setSelectedListId(Number(event.target.value));
          reset();
        }}>
            {meta.lists.map(list => <option key={list.id} value={list.id}>
                {list.name}
              </option>)}
          </OkrSelect>
        </label>
      </header>
      <div className="management-grid">
        <section className="management-editor">
          <h3>{editing ? "编辑项目" : "新建项目"}</h3>
          <label>
            项目名称
            <OkrInput onChange={event => setForm({
            ...form,
            name: event.target.value
          })} placeholder="例如：家庭事务、服务器维护" value={form.name} />
          </label>
          <fieldset className="color-picker expanded">
            <legend>项目颜色</legend>
            {listColors.map(color => <label key={color} title={color}>
                <OkrInput checked={form.color === color} name="project-color" onChange={() => setForm({
              ...form,
              color
            })} type="radio" />
                <i style={{
              background: color
            }}>
                  {form.color === color && <Check size={13} />}
                </i>
              </label>)}
          </fieldset>
          <footer>
            <OkrButton onClick={reset}>清空</OkrButton>
            <OkrButton className="primary-button" disabled={!form.name.trim()} onClick={save}>
              {editing ? "保存项目" : "创建项目"}
            </OkrButton>
          </footer>
        </section>
        <section className="management-list">
          {projects.map(project => <article key={project.id}>
              <i style={{
            background: project.color
          }} />
              <strong>{project.name}</strong>
              <OkrButton onClick={() => {
            setEditing(project);
            setForm({
              name: project.name,
              color: project.color
            });
          }}>
                编辑
              </OkrButton>
              <OkrButton className="danger-text" onClick={async () => {
            const confirmed = await dialog.confirm({
              title: "删除项目",
              message: "确认删除这个项目？已有任务会变为未归属。",
              confirmLabel: "删除项目",
              danger: true
            });
            if (!confirmed) return;
            await api(`/api/projects/${project.id}`, {
              method: "DELETE"
            });
            await loadProjects();
            await onRefresh();
            onNotice("项目已删除");
          }}>
                删除
              </OkrButton>
            </article>)}
          {projects.length === 0 && <div className="table-state empty">当前清单还没有项目</div>}
        </section>
      </div>
    </section>;
}
const emptyRuleForm = {
  name: "",
  field: "title",
  operator: "contains",
  value: "",
  status: "",
  projectId: "",
  tagIds: [],
  starred: "",
  important: "",
  urgent: "",
  active: true
};
function RuleManagerPage({
  initialListId,
  meta,
  onNotice,
  onRefresh
}) {
  const dialog = useAppDialog();
  const defaultListId = initialListId || meta.lists[0]?.id || "";
  const [selectedListId, setSelectedListId] = useState(defaultListId);
  const [rules, setRules] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyRuleForm);
  const projectOptions = projectsForList(meta.projects, selectedListId);
  const tagOptions = tagsForList(meta.tags, selectedListId);
  const loadRules = useCallback(async () => {
    if (!selectedListId) return;
    const result = await api(`/api/rules?listId=${selectedListId}`);
    setRules(result.data);
  }, [selectedListId]);
  useEffect(() => {
    loadRules().catch(error => onNotice(error.message));
  }, [loadRules, onNotice]);
  const reset = () => {
    setEditing(null);
    setForm(emptyRuleForm);
  };
  const buildActions = () => {
    const actions = {};
    if (form.status) actions.status = form.status;
    if (form.projectId) actions.projectId = Number(form.projectId);
    if (form.tagIds.length > 0) actions.tagIds = form.tagIds;
    for (const key of ["starred", "important", "urgent"]) {
      if (form[key] !== "") actions[key] = form[key] === "true";
    }
    return actions;
  };
  const save = async () => {
    const payload = {
      listId: Number(selectedListId),
      name: form.name.trim(),
      field: form.field,
      operator: form.operator,
      value: form.value.trim(),
      active: form.active,
      actions: buildActions()
    };
    if (editing) {
      await api(`/api/rules/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      onNotice("规则已更新");
    } else {
      await api("/api/rules", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      onNotice("规则已创建");
    }
    reset();
    await loadRules();
    await onRefresh();
  };
  const loadForEdit = rule => {
    const actions = rule.actions || {};
    setEditing(rule);
    setForm({
      name: rule.name,
      field: rule.field,
      operator: rule.operator,
      value: rule.value,
      status: actions.status || "",
      projectId: actions.projectId || "",
      tagIds: actions.tagIds || [],
      starred: actions.starred === undefined ? "" : String(Boolean(actions.starred)),
      important: actions.important === undefined ? "" : String(Boolean(actions.important)),
      urgent: actions.urgent === undefined ? "" : String(Boolean(actions.urgent)),
      active: rule.active
    });
  };
  return <section className="management-page">
      <header>
        <div>
          <span>任务自动化</span>
          <h2>规则管理</h2>
        </div>
        <label>
          所属清单
          <OkrSelect value={selectedListId} onChange={event => {
          setSelectedListId(Number(event.target.value));
          reset();
        }}>
            {meta.lists.map(list => <option key={list.id} value={list.id}>
                {list.name}
              </option>)}
          </OkrSelect>
        </label>
      </header>
      <div className="management-grid rules-grid">
        <section className="management-editor">
          <h3>{editing ? "编辑规则" : "新建规则"}</h3>
          <div className="form-grid">
            <label>
              规则名称
              <OkrInput onChange={event => setForm({
              ...form,
              name: event.target.value
            })} placeholder="例如：网址自动加星" value={form.name} />
            </label>
            <label>
              条件字段
              <OkrSelect value={form.field} onChange={event => setForm({
              ...form,
              field: event.target.value
            })}>
                <option value="title">任务内容</option>
                <option value="source">来源</option>
                <option value="notes">备注</option>
              </OkrSelect>
            </label>
            <label>
              匹配方式
              <OkrSelect value={form.operator} onChange={event => setForm({
              ...form,
              operator: event.target.value
            })}>
                <option value="contains">包含</option>
                <option value="equals">等于</option>
                <option value="startsWith">开头是</option>
                <option value="endsWith">结尾是</option>
                <option value="regex">正则表达式</option>
              </OkrSelect>
            </label>
            <label>
              匹配内容
              <OkrInput onChange={event => setForm({
              ...form,
              value: event.target.value
            })} placeholder="例如：https:// 或 服务器" value={form.value} />
            </label>
            <label>
              自动状态
              <OkrSelect value={form.status} onChange={event => setForm({
              ...form,
              status: event.target.value
            })}>
                <option value="">不修改</option>
                {statuses.map(status => <option key={status}>{status}</option>)}
              </OkrSelect>
            </label>
            <label>
              自动项目
              <OkrSelect value={form.projectId} onChange={event => setForm({
              ...form,
              projectId: event.target.value
            })}>
                <option value="">不修改</option>
                {projectOptions.map(project => <option key={project.id} value={project.id}>
                    {project.name}
                  </option>)}
              </OkrSelect>
            </label>
          </div>
          <fieldset className="tag-picker compact">
            <legend>自动标签</legend>
            <div>
              {tagOptions.map(tag => <label key={tag.id}>
                  <OkrInput checked={form.tagIds.includes(tag.id)} onChange={event => setForm({
                ...form,
                tagIds: event.target.checked ? [...form.tagIds, tag.id] : form.tagIds.filter(id => id !== tag.id)
              })} type="checkbox" />
                  <i style={{
                background: tag.color
              }} />
                  {tag.name}
                </label>)}
            </div>
          </fieldset>
          <div className="form-grid">
            {["starred", "important", "urgent"].map(key => <label key={key}>
                {key === "starred" ? "星标" : key === "important" ? "重要" : "紧急"}
                <OkrSelect value={form[key]} onChange={event => setForm({
              ...form,
              [key]: event.target.value
            })}>
                  <option value="">不修改</option>
                  <option value="true">设为是</option>
                  <option value="false">设为否</option>
                </OkrSelect>
              </label>)}
            <label className="toggle-line">
              <span>启用规则</span>
              <OkrInput checked={form.active} onChange={event => setForm({
              ...form,
              active: event.target.checked
            })} type="checkbox" />
            </label>
          </div>
          <footer>
            <OkrButton onClick={reset}>清空</OkrButton>
            <OkrButton className="primary-button" disabled={!form.name.trim() || !form.value.trim()} onClick={save}>
              {editing ? "保存规则" : "创建规则"}
            </OkrButton>
          </footer>
        </section>
        <section className="management-list">
          {rules.map(rule => <article key={rule.id}>
              <i className={rule.active ? "rule-dot active" : "rule-dot"} />
              <strong>{rule.name}</strong>
              <span>{rule.field} {rule.operator} {rule.value}</span>
              <OkrButton onClick={() => loadForEdit(rule)}>编辑</OkrButton>
              <OkrButton onClick={async () => {
            await api(`/api/rules/${rule.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                active: !rule.active
              })
            });
            await loadRules();
            onNotice(rule.active ? "规则已停用" : "规则已启用");
          }}>
                {rule.active ? "停用" : "启用"}
              </OkrButton>
              <OkrButton className="danger-text" onClick={async () => {
            const confirmed = await dialog.confirm({
              title: "删除规则",
              message: "确认删除这条自动规则？",
              confirmLabel: "删除规则",
              danger: true
            });
            if (!confirmed) return;
            await api(`/api/rules/${rule.id}`, {
              method: "DELETE"
            });
            await loadRules();
            onNotice("规则已删除");
          }}>
                删除
              </OkrButton>
            </article>)}
          {rules.length === 0 && <div className="table-state empty">当前清单还没有自动规则</div>}
        </section>
      </div>
    </section>;
}
class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      error: null
    };
  }
  static getDerivedStateFromError(error) {
    return {
      error
    };
  }
  componentDidCatch(error, details) {
    console.error("任务系统界面异常", error, details);
    trackAnalyticsEvent({
      module: "system",
      eventName: "frontend.render_crash",
      result: "failed",
      errorCode: error?.name || "react_render_error",
      metadata: {
        componentStackLines: String(details?.componentStack || "").split("\n").filter(Boolean).length
      }
    });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <main className="app-error-screen" role="alert">
        <div>
          <RefreshCw size={22} />
          <h1>页面刚才没有正常刷新</h1>
          <p>任务数据仍然保存在服务器中，重新载入即可继续使用。</p>
          <OkrButton type="button" onClick={() => window.location.reload()}>
            <RefreshCw size={15} />重新载入
          </OkrButton>
        </div>
      </main>;
  }
}
createRoot(document.getElementById("root")).render(<React.StrictMode>
    <AppErrorBoundary>
      <OkrProvider>
        <DialogProvider>
          <App />
        </DialogProvider>
      </OkrProvider>
    </AppErrorBoundary>
  </React.StrictMode>);
