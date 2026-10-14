import { LibraryScroll, LibrarySortButton, libraryAriaSort, LibraryDateRange, useLibraryState } from "./LibrarySurface";
import { OkrSelect, OkrDialogSurface } from "./okr-ui.jsx";
import { Badge } from "./okr-ui.jsx";
import { OkrActivityChart } from "./okr-charts.jsx";
import { OkrButton, OkrInput, OkrTextarea } from "./okr-ui.jsx";
import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Activity, Archive, ArrowDown, ArrowUp, ArrowUpDown, BarChart3, CalendarClock, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CirclePause, ClipboardList, Clock3, Columns3, Copy, ExternalLink, FileClock, Filter, GripVertical, History, LayoutTemplate, ListChecks, LoaderCircle, MoreHorizontal, Pencil, Play, Plus, RefreshCw, Repeat2, RotateCcw, Search, Settings, Star, Trash2, X } from "lucide-react";
import { api, trackAnalyticsEvent } from "./api.js";
import { AnimatedChart, AnimatedKpi } from "./AnimatedChart.jsx";
import { useLocalTablePreferences } from "./useLocalTablePreferences.js";
import { FieldVisibilityMenu, TablePager } from "./WorkspaceControls.jsx";
import { animateTaskRowReflow, captureTaskRowPositions, taskCompletionExitDuration } from "./task-completion-motion.js";
import { launchCompletionParticles } from "./completion-particles.js";
const tabs = [["today", "待处理", ListChecks], ["future", "未来发生", CalendarClock], ["configs", "主题与事件", LayoutTemplate], ["calendar", "日历维护", CalendarDays], ["history", "历史记录", History], ["stats", "统计图表", BarChart3], ["logs", "运行日志", FileClock]];
const statusLabels = {
  pending: "未完成",
  completed: "已完成",
  discarded: "已废弃",
  deferred: "稍后处理"
};
const triggerOptions = [["daily", "每日"], ["workday", "每个工作日"], ["restday", "每个休息日"], ["weekly", "指定星期"], ["monthly_day", "每月第几号"], ["monthly_last_day", "每月最后一天"], ["first_workday", "每月首个工作日（默认周一）"], ["nth_workday", "每月第几个工作日"], ["nth_restday", "每月第几个休息日"], ["last_workday", "每月最后一个工作日"], ["last_restday", "每月最后一个休息日"], ["day_before_workday", "次日为工作日"], ["day_before_restday", "次日为休息日"], ["day_after_workday", "前一日为工作日"], ["day_after_rest", "前一日为休息日"], ["interval", "间隔天数"], ["custom_dates", "自定义日期（完全手动）"], ["manual", "仅手动触发"], ["none", "不自动创建"]];
const weekdayOptions = [[1, "周一"], [2, "周二"], [3, "周三"], [4, "周四"], [5, "周五"], [6, "周六"], [0, "周日"]];
const runtimeTypeLabels = {
  theme_generated: "主题生成",
  scheduler_generation: "定时调度生成",
  scheduler_error: "定时调度错误",
  theme_created: "新建主题",
  theme_updated: "更新主题",
  theme_archived: "废弃主题",
  theme_reordered: "主题排序",
  event_created: "新建事件",
  event_updated: "更新事件",
  event_reordered: "事件排序",
  calendar_updated: "日历维护",
  manual_calendar_created: "新建手动日期日历",
  manual_calendar_updated: "更新手动日期日历",
  manual_calendar_date_added: "加入手动日期",
  manual_calendar_date_removed: "移除手动日期",
  batch_completed: "批量完成",
  batch_discarded: "批量放弃",
  recurring_events_generated: "重复事件生成",
  follow_generated: "跟随产生"
};
const recurringTriggerOptions = triggerOptions.filter(([value]) => !["manual", "none"].includes(value));
function recurrenceLabel(item) {
  if (!item?.recurrenceType) return "";
  const label = triggerOptions.find(([value]) => value === item.recurrenceType)?.[1] || "自定义循环";
  const continuous = item.continuousEnabled ? ` · 连续 ${item.continuousDays} 天` : "";
  const firstTrigger = item.recurrenceStartDate ? ` · 首次 ${item.recurrenceStartDate}` : "";
  if (item.recurrenceEndType === "count") return `${label}${firstTrigger}${continuous} · ${item.recurrenceCount} 期后停止`;
  if (item.recurrenceEndType === "date") return `${label}${firstTrigger}${continuous} · ${item.recurrenceEndDate} 后停止`;
  return `${label}${firstTrigger}${continuous}`;
}
function FollowEventSelect({
  events,
  value,
  onChange,
  excludeId,
  excludeThemeId
}) {
  const options = events.filter(item => item.id !== excludeId && item.themeId !== excludeThemeId && item.generationEnabled);
  return <label className="wide"><span>跟随来源事件</span><OkrSelect required value={value || ""} onChange={event => onChange(Number(event.target.value))}><option value="">请选择产生后触发跟随的事件</option>{options.map(item => <option key={item.id} value={item.id}>{item.themeName} / {item.title}</option>)}</OkrSelect></label>;
}
function ManualCalendarSelect({
  value,
  onChange
}) {
  const [calendars, setCalendars] = useState([]);
  useEffect(() => {
    let active = true;
    api("/api/sop/manual-calendars").then(result => {
      if (!active) return;
      setCalendars(result.data || []);
      if (!value && result.data?.[0]) onChange(result.data[0].id);
    }).catch(() => setCalendars([]));
    return () => {
      active = false;
    };
  }, []);
  return <label className="wide sop-manual-calendar-field"><span>关联手动日期日历</span><OkrSelect required value={value || ""} onChange={event => onChange(Number(event.target.value))}><option value="">{calendars.length ? "请选择手动日期日历" : "暂无手动日期日历"}</option>{calendars.map(item => <option key={item.id} value={item.id}>{item.name} · {item.dateCount || 0} 个日期</option>)}</OkrSelect></label>;
}
const executionColumns = [{
  key: "select",
  label: "批量选择",
  width: 44,
  defaultVisible: false
}, {
  key: "complete",
  label: "完成",
  width: 58,
  defaultVisible: true
}, {
  key: "title",
  label: "事件",
  width: 300,
  defaultVisible: true
}, {
  key: "note",
  label: "备注",
  width: 260,
  defaultVisible: true
}, {
  key: "theme",
  label: "SOP 主题",
  width: 160,
  defaultVisible: true
}, {
  key: "priority",
  label: "等级",
  width: 82,
  defaultVisible: true
}, {
  key: "status",
  label: "状态",
  width: 96,
  defaultVisible: true
}, {
  key: "scheduledDate",
  label: "计划日期",
  width: 108,
  defaultVisible: true
}, {
  key: "dueAt",
  label: "截止日期",
  width: 108,
  defaultVisible: true
}, {
  key: "specialLabel",
  label: "特殊标签",
  width: 130,
  defaultVisible: false
}, {
  key: "source",
  label: "来源记录",
  width: 165,
  defaultVisible: false
}, {
  key: "actions",
  label: "操作",
  width: 142,
  defaultVisible: true
}];
const executionColumnMap = Object.fromEntries(executionColumns.map(column => [column.key, column]));
const historyColumns = [{
  key: "date",
  label: "计划日期",
  width: 115
}, {
  key: "title",
  label: "事件",
  width: 280
}, {
  key: "theme",
  label: "主题",
  width: 170
}, {
  key: "status",
  label: "状态",
  width: 105
}, {
  key: "completedAt",
  label: "完成时间",
  width: 170
}];
const runtimeLogColumns = [{
  key: "time",
  label: "时间",
  width: 170
}, {
  key: "type",
  label: "类型",
  width: 135
}, {
  key: "theme",
  label: "主题",
  width: 170
}, {
  key: "event",
  label: "事件",
  width: 190
}, {
  key: "message",
  label: "内容",
  width: 340
}, {
  key: "source",
  label: "来源记录",
  width: 170
}];
function TableFieldControl({
  columns,
  table
}) {
  return <FieldVisibilityMenu columns={columns} visibleKeys={table.visibleColumns.map(column => column.key)} onToggle={table.toggleColumn} />;
}
function normalizeExecutionViewSettings(value = {}) {
  const keys = executionColumns.map(column => column.key);
  const savedOrder = Array.isArray(value.columnOrder) ? [...new Set(value.columnOrder.filter(key => keys.includes(key)))] : [];
  const columnOrder = [...savedOrder, ...keys.filter(key => !savedOrder.includes(key))];
  const savedVisible = Array.isArray(value.visibleColumns) ? [...new Set(value.visibleColumns.filter(key => keys.includes(key)))] : executionColumns.filter(column => column.defaultVisible).map(column => column.key);
  return {
    scope: "executions",
    columnOrder,
    visibleColumns: savedVisible.length ? savedVisible : ["complete", "title"],
    columnWidths: Object.fromEntries(executionColumns.map(column => {
      const width = Number(value.columnWidths?.[column.key] ?? column.width);
      return [column.key, Math.max(42, Math.min(Number.isFinite(width) ? width : column.width, 800))];
    })),
    groupBy: value.groupBy === "" ? "" : "theme"
  };
}
const defaultExecutionViewSettings = normalizeExecutionViewSettings();
function todayString() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}
function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).replace("T", " ").slice(0, 16);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}
function addDays(date, amount) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
function SopStatus({
  status
}) {
  return <Badge tone={status === "completed" ? "success" : status === "discarded" ? "error" : status === "pending" ? "neutral" : "brand"}>{statusLabels[status] || status}</Badge>;
}
function ThemeChip({
  name,
  color
}) {
  return <Badge tone="brand">{name || "未归属"}</Badge>;
}
function SearchableThemeSelect({
  themes,
  value,
  onChange,
  allLabel = "全部主题"
}) {
  const listId = useId().replace(/:/g, "");
  const selected = themes.find(theme => String(theme.id) === String(value));
  const [query, setQuery] = useState(selected?.name || "");
  useEffect(() => setQuery(selected?.name || ""), [selected?.name, value]);
  return <label className="sop-theme-search-select">
      <Search size={14} />
      <OkrInput aria-label={allLabel} list={listId} onChange={event => {
      const next = event.target.value;
      setQuery(next);
      if (!next) onChange("");
      const match = themes.find(theme => theme.name === next);
      if (match) onChange(String(match.id));
    }} onFocus={event => event.currentTarget.select()} placeholder={allLabel} value={query} />
      <datalist id={listId}>{themes.map(theme => <option key={theme.id} value={theme.name} />)}</datalist>
      {value && <OkrButton type="button" onClick={() => {
      setQuery("");
      onChange("");
    }} title={`清除${allLabel}`}><X size={13} /></OkrButton>}
    </label>;
}
function EmptyState({
  loading,
  label = "暂无数据"
}) {
  return <div className="sop-empty">
      {loading ? <LoaderCircle className="spin" size={20} /> : <ClipboardList size={20} />}
      <span>{loading ? "正在读取" : label}</span>
    </div>;
}
function Pager({
  offset,
  limit = 50,
  total,
  onChange
}) {
  return <TablePager offset={offset} limit={limit} total={total} onChange={onChange} />;
}
function SopDialog({
  title,
  children,
  onClose,
  onSubmit,
  submitLabel = "保存"
}) {
  return <OkrDialogSurface asChild title={title} onClose={onClose}>
      <form className="sop-dialog" onMouseDown={event => event.stopPropagation()} onSubmit={onSubmit}>
        <header><h3>{title}</h3><OkrButton type="button" onClick={onClose} title="关闭"><X size={17} /></OkrButton></header>
        <div className="sop-dialog-body">{children}</div>
        <footer><OkrButton type="button" onClick={onClose}>取消</OkrButton><OkrButton className="primary-button" type="submit">{submitLabel}</OkrButton></footer>
      </form>
    </OkrDialogSurface>;
}
function LinkifiedText({
  value
}) {
  const text = String(value || "").trim();
  if (!text) return <span className="sop-empty-value">-</span>;
  const matcher = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+)/g;
  const parts = [];
  let cursor = 0;
  let match;
  while (match = matcher.exec(text)) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    const href = match[2] || match[3];
    parts.push(<a key={`${match.index}-${href}`} href={href} target="_blank" rel="noreferrer noopener" onClick={event => event.stopPropagation()}>
        {match[1] || href}<ExternalLink size={11} />
      </a>);
    cursor = matcher.lastIndex;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <span className="sop-linkified-text">{parts}</span>;
}
function ExecutionNote({
  value,
  onNotice
}) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const contentRef = useRef(null);
  const contentId = useId();
  const text = String(value || "").trim();
  useEffect(() => {
    setExpanded(false);
    const node = contentRef.current;
    if (!node) return;
    const measure = () => setOverflowing(node.scrollHeight > parseFloat(getComputedStyle(node).lineHeight) * 2 + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [text]);
  if (!text) return <span className="sop-empty-value">-</span>;
  return <span className="sop-note-content">
    <span className={`sop-note-copy ${expanded ? "is-expanded" : ""}`} id={contentId} ref={contentRef}><LinkifiedText value={text} /></span>
    <span className="sop-note-tools">
      {overflowing && <OkrButton type="button" aria-controls={contentId} aria-expanded={expanded} title={expanded ? "收起备注" : "展开完整备注"} onClick={() => setExpanded(value => !value)}>{expanded ? <ChevronDown size={13} className="sop-note-collapse" /> : <ChevronRight size={13} />}</OkrButton>}
      <OkrButton type="button" title="复制完整备注" onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          onNotice("完整备注已复制");
        } catch {
          onNotice("复制失败，请展开备注后手动复制");
        }
      }}><Copy size={13} /></OkrButton>
    </span>
  </span>;
}
function ExecutionCell({
  columnKey,
  item,
  selected,
  setSelected,
  runAction,
  date,
  onNotice,
  pending,
  exiting
}) {
  if (columnKey === "select") {
    return <span className="sop-checkbox-cell">
        <OkrInput type="checkbox" aria-label={`批量选择 ${item.title}`} checked={selected.has(item.id)} onChange={event => setSelected(current => {
        const next = new Set(current);
        event.target.checked ? next.add(item.id) : next.delete(item.id);
        return next;
      })} />
      </span>;
  }
  if (columnKey === "complete") {
    return <span className="sop-checkbox-cell sop-complete-cell">
        <OkrButton className={`task-check completion-check ${item.status === "completed" || exiting ? "checked" : ""} ${pending ? "is-pending" : ""}`} type="button" role="checkbox" aria-label={item.status === "completed" ? `重新打开 ${item.title}` : `完成 ${item.title}`} aria-checked={item.status === "completed" || exiting} aria-busy={pending ? "true" : undefined} disabled={pending} onClick={event => runAction(item.id, item.status === "completed" ? "reopen" : "complete", {}, event.currentTarget)}>
          {pending && !exiting ? <LoaderCircle className="spin" size={12} /> : (item.status === "completed" || exiting) && <Check className="completion-checkmark" size={12} strokeWidth={3} />}
        </OkrButton>
      </span>;
  }
  if (columnKey === "title") {
    return <span className="sop-title-cell"><b title={`${item.title}\n执行 #${item.id}`}>{item.title}</b></span>;
  }
  if (columnKey === "note") {
    return <span className="sop-note-cell"><ExecutionNote value={item.note} onNotice={onNotice} /></span>;
  }
  if (columnKey === "theme") {
    return <span><ThemeChip name={item.themeName} color={item.themeColor} /></span>;
  }
  if (columnKey === "priority") {
    return <span><span className={`sop-priority ${item.priority}`}>{item.priority}</span>{item.isImportant && <Star size={13} fill="currentColor" />}</span>;
  }
  if (columnKey === "status") return <span><SopStatus status={item.status} /></span>;
  if (columnKey === "scheduledDate") return <span className={item.isCarryover ? "sop-carryover-date" : ""}>{item.scheduledDate || "-"}{item.isCarryover && <em>结转</em>}</span>;
  if (columnKey === "dueAt") return <span>{item.dueAt ? String(item.dueAt).slice(0, 10) : "-"}</span>;
  if (columnKey === "specialLabel") {
    return <span>{item.specialLabel ? <span className="sop-field-chip">{item.specialLabel}</span> : <span className="sop-empty-value">-</span>}</span>;
  }
  if (columnKey === "source") return <span className="sop-source-cell">{item.sourceLogNumber || item.sourceRecordId || "-"}</span>;
  if (columnKey === "actions") {
    return <span className="sop-row-actions">
        {item.status !== "completed" ? <OkrButton disabled={pending} onClick={event => runAction(item.id, "complete", {}, event.currentTarget)} title="完成"><Check size={15} /></OkrButton> : <OkrButton disabled={pending} onClick={() => runAction(item.id, "reopen")} title="重新打开"><RotateCcw size={14} /></OkrButton>}
        <OkrButton disabled={pending} onClick={() => runAction(item.id, "defer", {
        deferredUntil: addDays(date, 1)
      })} title="稍后处理"><CirclePause size={14} /></OkrButton>
        <OkrButton disabled={pending} onClick={() => runAction(item.id, "discard")} title="废弃"><Archive size={14} /></OkrButton>
        <OkrButton disabled={pending} onClick={() => runAction(item.id, "permanent-disable")} title="完成并永久停用事件"><Trash2 size={14} /></OkrButton>
      </span>;
  }
  return <span />;
}
function TodayPage({
  themes,
  meta,
  onNotice,
  refreshMeta
}) {
  const [themeId, setThemeId] = useLibraryState("sop-pending:themeId", "");
  const [priority, setPriority] = useLibraryState("sop-pending:priority", "");
  const [importantOnly, setImportantOnly] = useLibraryState("sop-pending:importantOnly", false);
  const [sort, setSort] = useLibraryState("sop-pending:sort", "theme");
  const [query, setQuery] = useLibraryState("sop-pending:query", "");
  const [dateFrom, setDateFrom] = useLibraryState("sop-pending:from", "");
  const [dateTo, setDateTo] = useLibraryState("sop-pending:to", "");
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState(() => new Set());
  const [batchMode, setBatchMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [specialLabel, setSpecialLabel] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [viewSettings, setViewSettings] = useState(defaultExecutionViewSettings);
  const [columnPanelOpen, setColumnPanelOpen] = useState(false);
  const [showGroupedTheme, setShowGroupedTheme] = useState(false);
  const [draggedColumn, setDraggedColumn] = useState("");
  const [draggedEventId, setDraggedEventId] = useState(null);
  const [draggedThemeId, setDraggedThemeId] = useState(null);
  const [sortMode, setSortMode] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const [contextMenu, setContextMenu] = useState(null);
  const [completeGroup, setCompleteGroup] = useState(null);
  const [discardGroup, setDiscardGroup] = useState(null);
  const [eventEditor, setEventEditor] = useState(null);
  const [leavingIds, setLeavingIds] = useState(() => new Set());
  const [pendingIds, setPendingIds] = useState(() => new Set());
  const actionInFlightRef = useRef(new Set());
  const actionRevisionRef = useRef(0);
  const rowNodesRef = useRef(new Map());
  const pendingReflowPositionsRef = useRef(null);
  const reflowAnimationsRef = useRef([]);
  const columnPanelRef = useRef(null);
  const resizeRef = useRef(null);
  const viewSettingsRef = useRef(defaultExecutionViewSettings);
  const date = meta?.today || todayString();
  const refresh = useCallback(() => setRefreshKey(value => value + 1), []);
  useLayoutEffect(() => {
    const positions = pendingReflowPositionsRef.current;
    if (!positions) return;
    pendingReflowPositionsRef.current = null;
    reflowAnimationsRef.current.forEach(animation => animation.cancel());
    reflowAnimationsRef.current = animateTaskRowReflow(positions, rowNodesRef.current);
  }, [items]);
  useEffect(() => () => {
    reflowAnimationsRef.current.forEach(animation => animation.cancel());
  }, []);
  const persistViewSettings = useCallback(next => {
    viewSettingsRef.current = next;
    setViewSettings(next);
    api("/api/sop/view-settings", {
      method: "PATCH",
      body: JSON.stringify(next)
    }).catch(error => onNotice(`字段设置保存失败：${error.message}`));
  }, [onNotice]);
  useEffect(() => {
    api("/api/sop/view-settings").then(result => {
      const next = normalizeExecutionViewSettings(result);
      viewSettingsRef.current = next;
      setViewSettings(next);
    }).catch(error => onNotice(`字段设置读取失败：${error.message}`));
  }, [onNotice]);
  useEffect(() => {
    const close = event => {
      if (!columnPanelRef.current?.contains(event.target)) setColumnPanelOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  useEffect(() => {
    const onPointerMove = event => {
      if (!resizeRef.current) return;
      const {
        key,
        startX,
        startWidth
      } = resizeRef.current;
      const width = Math.max(42, Math.min(startWidth + event.clientX - startX, 800));
      const next = {
        ...viewSettingsRef.current,
        columnWidths: {
          ...viewSettingsRef.current.columnWidths,
          [key]: Math.round(width)
        }
      };
      viewSettingsRef.current = next;
      setViewSettings(next);
    };
    const onPointerUp = () => {
      if (!resizeRef.current) return;
      resizeRef.current = null;
      document.body.classList.remove("sop-column-resizing");
      persistViewSettings(viewSettingsRef.current);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      document.body.classList.remove("sop-column-resizing");
    };
  }, [persistViewSettings]);
  useEffect(() => {
    let cancelled = false;
    const actionRevision = actionRevisionRef.current;
    setLoading(true);
    const params = new URLSearchParams({
      scope: "pending",
      limit: "50",
      offset: String(offset),
      sort
    });
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (themeId) params.set("themeId", themeId);
    if (query) params.set("q", query);
    if (priority) params.set("priority", priority);
    if (importantOnly) params.set("important", "true");
    if (viewSettings.groupBy) params.set("groupBy", viewSettings.groupBy);
    api(`/api/sop/executions?${params}`).then(result => {
      if (cancelled || actionInFlightRef.current.size || actionRevision !== actionRevisionRef.current) return;
      setItems(result.data);
      setTotal(result.total);
    }).catch(error => {
      if (!cancelled) onNotice(error.message);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, themeId, priority, importantOnly, query, sort, offset, refreshKey, viewSettings.groupBy, onNotice]);
  useEffect(() => {
    setOffset(0);
    setSelected(new Set());
  }, [dateFrom, dateTo, themeId, priority, importantOnly, query, sort]);
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
  const runAction = async (id, action, body = {}, anchor) => {
    if (actionInFlightRef.current.has(id)) return;
    const rect = anchor?.getBoundingClientRect?.();
    actionInFlightRef.current.add(id);
    actionRevisionRef.current += 1;
    setPendingIds(current => new Set(current).add(id));
    try {
      await api(`/api/sop/executions/${id}/${action}`, {
        method: "POST",
        body: JSON.stringify(body)
      });
      if (action === "complete") {
        setLeavingIds(current => new Set(current).add(id));
        if (rect) launchCompletionParticles(rect);
        await new Promise(resolve => window.setTimeout(resolve, taskCompletionExitDuration()));
        pendingReflowPositionsRef.current = captureTaskRowPositions(rowNodesRef.current);
        setItems(current => current.filter(item => item.id !== id));
        setTotal(current => Math.max(0, current - 1));
        setSelected(current => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
      onNotice(action === "complete" ? "SOP 事项已完成" : "SOP 事项已更新");
      refresh();
      refreshMeta();
    } catch (error) {
      onNotice(error.message || "SOP 状态修改失败，请重试");
    } finally {
      actionInFlightRef.current.delete(id);
      setPendingIds(current => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      setLeavingIds(current => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };
  const moveColumn = (source, target) => {
    if (!source || source === target) return;
    const order = [...viewSettingsRef.current.columnOrder];
    const sourceIndex = order.indexOf(source);
    const targetIndex = order.indexOf(target);
    if (sourceIndex < 0 || targetIndex < 0) return;
    order.splice(sourceIndex, 1);
    order.splice(targetIndex, 0, source);
    persistViewSettings(normalizeExecutionViewSettings({
      ...viewSettingsRef.current,
      columnOrder: order
    }));
  };
  const toggleColumn = (key, checked) => {
    const current = viewSettingsRef.current.visibleColumns;
    const visibleColumns = checked ? [...new Set([...current, key])] : current.filter(item => item !== key);
    if (!visibleColumns.length) return onNotice("至少保留一个字段");
    if (key === "select" && !checked) setSelected(new Set());
    persistViewSettings(normalizeExecutionViewSettings({
      ...viewSettingsRef.current,
      visibleColumns
    }));
  };
  const visibleColumns = useMemo(() => {
    const columns = viewSettings.columnOrder.filter(key => key !== "select" && viewSettings.visibleColumns.includes(key));
    if (batchMode) columns.unshift("select");
    return viewSettings.groupBy === "theme" && !showGroupedTheme && columns.length > 1 ? columns.filter(key => key !== "theme") : columns;
  }, [viewSettings, showGroupedTheme, batchMode]);
  const gridTemplateColumns = visibleColumns.map(key => ["select", "complete", "actions"].includes(key) ? `${viewSettings.columnWidths[key]}px` : `minmax(${viewSettings.columnWidths[key]}px, ${viewSettings.columnWidths[key]}fr)`).join(" ");
  const tableWidth = visibleColumns.reduce((sum, key) => sum + viewSettings.columnWidths[key], 0);
  const groups = useMemo(() => {
    if (viewSettings.groupBy !== "theme") return [{
      key: "all",
      name: "全部事项",
      color: "#77736d",
      items
    }];
    const result = new Map();
    for (const item of items) {
      const key = String(item.themeId || "none");
      if (!result.has(key)) result.set(key, {
        key,
        name: item.themeName || "未归属主题",
        color: item.themeColor || "#77736d",
        isSystem: themes.some(theme => String(theme.id) === key && theme.isSystem),
        items: []
      });
      result.get(key).items.push(item);
    }
    return [...result.values()];
  }, [items, themes, viewSettings.groupBy]);
  const reorderEvents = async (group, targetEventId) => {
    const sourceId = Number(draggedEventId);
    const targetId = Number(targetEventId);
    if (!sourceId || !targetId || sourceId === targetId) return;
    const eventIds = [...new Set(group.items.map(item => Number(item.eventId)).filter(Boolean))];
    const from = eventIds.indexOf(sourceId);
    const to = eventIds.indexOf(targetId);
    if (from < 0 || to < 0) return;
    eventIds.splice(to, 0, eventIds.splice(from, 1)[0]);
    await api("/api/sop/events/reorder", {
      method: "PUT",
      body: JSON.stringify({
        themeId: Number(group.key),
        eventIds
      })
    });
    setDraggedEventId(null);
    onNotice("事件顺序已保存，将用于当前和未来执行");
    refresh();
  };
  const reorderThemes = async targetThemeId => {
    const sourceId = Number(draggedThemeId);
    const targetId = Number(targetThemeId);
    if (!sourceId || !targetId || sourceId === targetId) return;
    const ids = themes.map(theme => Number(theme.id));
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    await api("/api/sop/themes/reorder", {
      method: "PUT",
      body: JSON.stringify({
        themeIds: ids
      })
    });
    setDraggedThemeId(null);
    onNotice("主题顺序已保存，将用于当前和未来执行");
    refreshMeta();
    refresh();
  };
  const editFutureEvent = async item => {
    if (!item.eventId) return onNotice("该历史事件没有可编辑的事件模板");
    const event = await api(`/api/sop/events/${item.eventId}`);
    setEventEditor(event);
  };
  const todayCounts = meta?.todaySummary || {};
  const pendingCounts = meta?.pendingSummary || {};
  const completionRate = Number(todayCounts.total || 0) > 0 ? Math.round(Number(todayCounts.completed || 0) / Number(todayCounts.total || 0) * 100) : 0;
  const allCompleted = Number(todayCounts.total || 0) > 0 && Number(todayCounts.completed || 0) === Number(todayCounts.total || 0);
  return <section className="sop-page-band sop-pending-page">
      <div className="sop-metrics compact">
        <article><span>待处理总数</span><strong>{Number(pendingCounts.total || 0).toLocaleString()}</strong></article>
        <article><span>今日待处理</span><strong>{Number(pendingCounts.today || 0).toLocaleString()}</strong></article>
        <article><span>历史重要未完成</span><strong>{Number(pendingCounts.carryover || 0).toLocaleString()}</strong></article>
        <article><span>今日已完成</span><strong>{Number(todayCounts.completed || 0).toLocaleString()}</strong></article>
        <article className={`completion-rate ${allCompleted ? "all-complete" : ""}`}><span>当日完成率</span><strong>{allCompleted ? "全部完成" : `${completionRate}%`}</strong></article>
      </div>
      <div className="sop-toolbar sop-pending-toolbar">
        <div className="sop-toolbar-filters library-filters">
        <label className="sop-search"><Search size={15} /><OkrInput aria-label="搜索事件或主题" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索事件或主题" /></label>
        <SearchableThemeSelect themes={themes} value={themeId} onChange={setThemeId} />
        <OkrSelect aria-label="等级筛选" className="sop-priority-filter" value={priority} onChange={event => setPriority(event.target.value)}><option value="">全部等级</option>{["P0", "P1", "P2", "P3", "P4"].map(value => <option key={value}>{value}</option>)}</OkrSelect>
        <label className="sop-filter-check"><OkrInput type="checkbox" checked={importantOnly} onChange={event => setImportantOnly(event.target.checked)} />重要</label>
        <LibraryDateRange label="计划日期" from={dateFrom} to={dateTo} onFrom={setDateFrom} onTo={setDateTo} />
        <OkrButton type="button" onClick={() => {
          setQuery("");
          setThemeId("");
          setPriority("");
          setImportantOnly(false);
          setDateFrom("");
          setDateTo("");
        }}>重置筛选</OkrButton>

        </div>
        <div className="sop-toolbar-actions">
        <OkrSelect aria-label="分组条件" className="sop-group-filter" value={viewSettings.groupBy} onChange={event => persistViewSettings(normalizeExecutionViewSettings({
          ...viewSettingsRef.current,
          groupBy: event.target.value
        }))}><option value="theme">按主题分组</option><option value="">不分组</option></OkrSelect>
        <OkrButton type="button" className="library-batch-toggle" aria-pressed={batchMode} onClick={() => {
          setBatchMode(!batchMode);
          setSelected(new Set());
        }}>{batchMode ? "退出批量编辑" : "批量编辑"}</OkrButton>
        {themeId && <OkrButton onClick={async () => {
          const result = await api("/api/sop/batch/complete", {
            method: "POST",
            body: JSON.stringify({
              themeId: Number(themeId),
              scope: "pending"
            })
          });
          onNotice(`该主题已完成 ${result.updated} 条事项`);
          refresh();
          refreshMeta();
        }} title="完成该主题"><CheckCircle2 size={15} /></OkrButton>}
        <div className="sop-column-menu" ref={columnPanelRef}>
          <OkrButton type="button" title="字段配置" aria-expanded={columnPanelOpen} onClick={() => setColumnPanelOpen(value => !value)}><Columns3 size={15} /></OkrButton>
          {columnPanelOpen && <div className="sop-column-panel">
              <header><b>显示字段</b><span>拖动可调整顺序</span></header>
              {viewSettings.columnOrder.filter(key => key !== "select").map(key => <label className={draggedColumn === key ? "dragging" : ""} draggable key={key} onDragStart={() => setDraggedColumn(key)} onDragEnd={() => setDraggedColumn("")} onDragOver={event => event.preventDefault()} onDrop={() => {
              moveColumn(draggedColumn, key);
              setDraggedColumn("");
            }}>
                  <GripVertical size={14} />
                  <OkrInput type="checkbox" checked={viewSettings.visibleColumns.includes(key)} onChange={event => toggleColumn(key, event.target.checked)} />
                  <span>{executionColumnMap[key].label}</span>
                </label>)}
              {viewSettings.groupBy === "theme" && <label className="sop-group-column-option"><OkrInput type="checkbox" checked={showGroupedTheme} disabled={!viewSettings.visibleColumns.includes("theme")} onChange={event => setShowGroupedTheme(event.target.checked)} /><span>分组时显示主题列</span></label>}
            </div>}
        </div>
        <OkrButton className={sortMode ? "active" : ""} aria-pressed={sortMode} onClick={() => {
          setSortMode(value => !value);
          setSort("theme");
        }} title="调整主题与事件顺序"><ArrowUpDown size={15} /></OkrButton>
        <OkrButton className="icon-button" onClick={refresh} title="刷新"><RefreshCw size={15} /></OkrButton>
        </div>
      </div>
      {batchMode && selected.size > 0 && <div className="sop-batch-bar">
          <b>已选 {selected.size} 条</b>
          <OkrButton className="primary-button" onClick={async () => {
        await api("/api/sop/batch/complete", {
          method: "POST",
          body: JSON.stringify({
            ids: [...selected]
          })
        });
        setSelected(new Set());
        refresh();
        refreshMeta();
        onNotice("所选 SOP 事项已完成");
      }}><CheckCircle2 size={15} />批量完成</OkrButton>
          <OkrButton onClick={() => setSelected(new Set())}>取消选择</OkrButton>
        </div>}
      <LibraryScroll className="sop-table-wrap" label="SOP 数据列表">
        <div className="wx-library-grid sop-table sop-execution-table" style={{
        minWidth: tableWidth,
        width: "100%"
      }}>
          <div className="sop-table-head wx-library-head" style={{
          gridTemplateColumns
        }}>
            {visibleColumns.map(key => <span className="sop-column-head" role="columnheader" aria-sort={libraryAriaSort(sort, key)} draggable key={key} onDragStart={() => setDraggedColumn(key)} onDragEnd={() => setDraggedColumn("")} onDragOver={event => event.preventDefault()} onDrop={() => {
            moveColumn(draggedColumn, key);
            setDraggedColumn("");
          }}>
                {key === "select" ? <OkrInput type="checkbox" aria-label="选择本页" checked={items.length > 0 && items.every(item => selected.has(item.id))} onChange={event => setSelected(event.target.checked ? new Set(items.map(item => item.id)) : new Set())} /> : ["complete", "actions"].includes(key) ? <span>{executionColumnMap[key].label}</span> : <LibrarySortButton field={key} label={executionColumnMap[key].label} sort={sort} onSort={value => {
              setSort(value);
              setSortMode(false);
            }} />}
                <i className="sop-column-resizer" onPointerDown={event => {
              event.preventDefault();
              event.stopPropagation();
              resizeRef.current = {
                key,
                startX: event.clientX,
                startWidth: viewSettings.columnWidths[key]
              };
              document.body.classList.add("sop-column-resizing");
            }} />
              </span>)}
          </div>
          {loading && items.length === 0 ? <EmptyState loading /> : items.length === 0 ? <EmptyState label="当前没有未完成事项" /> : groups.map(group => <React.Fragment key={group.key}>
              {viewSettings.groupBy === "theme" && <div className="sop-group-row" ref={node => {
            const key = `group:${group.key}`;
            if (node) rowNodesRef.current.set(key, node);else rowNodesRef.current.delete(key);
          }} draggable={sortMode && !group.isSystem} onContextMenu={event => {
            event.preventDefault();
            setContextMenu({
              type: "group",
              group,
              x: event.clientX,
              y: event.clientY
            });
          }} onDragStart={() => !group.isSystem && setDraggedThemeId(Number(group.key))} onDragOver={event => sortMode && event.preventDefault()} onDrop={() => sortMode && reorderThemes(Number(group.key))} style={{
            minWidth: tableWidth,
            width: "100%"
          }}>
                  {sortMode && !group.isSystem && <GripVertical size={15} />}
                  <OkrButton className="sop-group-toggle" onClick={() => setCollapsedGroups(current => {
              const next = new Set(current);
              next.has(group.key) ? next.delete(group.key) : next.add(group.key);
              return next;
            })}>
                    {collapsedGroups.has(group.key) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    <ThemeChip name={group.name} color={group.color} /><b>{group.items.length} 条</b>
                  </OkrButton>
                </div>}
              {!collapsedGroups.has(group.key) && group.items.map(item => <div className={`sop-table-row wx-library-row ${item.status} ${sortMode ? "sorting" : ""} ${leavingIds.has(item.id) ? "completion-exit" : ""}`} ref={node => {
            if (node) rowNodesRef.current.set(item.id, node);else rowNodesRef.current.delete(item.id);
          }} data-execution-id={item.id} draggable={sortMode && Boolean(item.eventId)} key={item.id} onContextMenu={event => {
            event.preventDefault();
            setContextMenu({
              type: "event",
              item,
              x: event.clientX,
              y: event.clientY
            });
          }} onDragStart={() => setDraggedEventId(Number(item.eventId))} onDragOver={event => sortMode && event.preventDefault()} onDrop={() => sortMode && reorderEvents(group, item.eventId)} style={{
            gridTemplateColumns
          }}>
                  {sortMode && <span className="sop-row-sort-grip" title="拖动调整事件顺序"><GripVertical size={14} /></span>}
                  {visibleColumns.map(key => <ExecutionCell key={key} columnKey={key} item={item} selected={selected} setSelected={setSelected} runAction={runAction} date={date} onNotice={onNotice} pending={pendingIds.has(item.id)} exiting={leavingIds.has(item.id)} />)}
                </div>)}
            </React.Fragment>)}
        </div>
      </LibraryScroll>
      <div className="sop-footer-tools">
        <Pager offset={offset} total={total} onChange={setOffset} />
        <div className="sop-special-complete"><OkrInput value={specialLabel} onChange={event => setSpecialLabel(event.target.value)} placeholder="特殊标签" /><OkrButton disabled={!specialLabel.trim()} onClick={async () => {
          const result = await api(`/api/sop/special-labels/${encodeURIComponent(specialLabel.trim())}/complete`, {
            method: "POST",
            body: JSON.stringify({
              scope: "pending"
            })
          });
          onNotice(`已完成 ${result.updated} 条匹配事项`);
          setSpecialLabel("");
          refresh();
          refreshMeta();
        }}>完成匹配事项</OkrButton></div>
      </div>
      {contextMenu?.type === "event" && <div className="sop-context-menu" style={{
      left: contextMenu.x,
      top: contextMenu.y
    }}><OkrButton onClick={() => editFutureEvent(contextMenu.item)}><Pencil size={14} />编辑事件模板</OkrButton><small>修改只影响当前及未来循环，不改变历史记录</small></div>}
      {contextMenu?.type === "group" && <div className="sop-context-menu" style={{
      left: contextMenu.x,
      top: contextMenu.y
    }}><OkrButton onClick={() => {
        setCompleteGroup(contextMenu.group);
        setContextMenu(null);
      }}><CheckCircle2 size={14} />批量勾选完成</OkrButton><OkrButton className="danger" onClick={() => {
        setDiscardGroup(contextMenu.group);
        setContextMenu(null);
      }}><Archive size={14} />批量放弃当日事件</OkrButton>{!contextMenu.group.isSystem && <OkrButton onClick={() => {
        setSortMode(true);
        setContextMenu(null);
      }}><ArrowUpDown size={14} />拖动调整主题顺序</OkrButton>}{!contextMenu.group.isSystem && <OkrButton className="danger" onClick={async () => {
        await api(`/api/sop/themes/${contextMenu.group.key}`, {
          method: "DELETE"
        });
        setContextMenu(null);
        onNotice("主题已标记为废弃");
        refreshMeta();
        refresh();
      }}><Archive size={14} />标记主题为废弃</OkrButton>}</div>}
      {completeGroup && <SopDialog title="确认完成整个主题" submitLabel="确认完成" onClose={() => setCompleteGroup(null)} onSubmit={async event => {
      event.preventDefault();
      const result = await api("/api/sop/batch/complete", {
        method: "POST",
        body: JSON.stringify({
          themeId: Number(completeGroup.key),
          scope: "pending"
        })
      });
      setCompleteGroup(null);
      onNotice(`已完成 ${result.updated} 条事项`);
      refresh();
      refreshMeta();
    }}><div className="sop-confirm-copy"><CheckCircle2 size={22} /><div><b>{completeGroup.name}</b><p>确认后，该主题在待处理工作台中的今日事项和历史重要未完成事项都会标记为已完成。</p></div></div></SopDialog>}
      {discardGroup && <SopDialog title="确认放弃当日事件" submitLabel="确认放弃" onClose={() => setDiscardGroup(null)} onSubmit={async event => {
      event.preventDefault();
      const result = await api("/api/sop/batch/discard", {
        method: "POST",
        body: JSON.stringify({
          themeId: Number(discardGroup.key),
          date
        })
      });
      setDiscardGroup(null);
      onNotice(`已放弃当日 ${result.updated} 条事项，不计入完成统计`);
      refresh();
      refreshMeta();
    }}><div className="sop-confirm-copy danger"><Archive size={22} /><div><b>{discardGroup.name}</b><p>仅放弃这个主题今天尚未结束的事件。历史重要未完成事项、事件模板和未来循环都不受影响，也不会增加完成数量。</p></div></div></SopDialog>}
      {eventEditor && <EventEditor themes={themes} item={eventEditor} onClose={() => setEventEditor(null)} onNotice={onNotice} onSaved={() => {
      setEventEditor(null);
      refresh();
      refreshMeta();
    }} />}
    </section>;
}
function futureDateLabel(value) {
  const date = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric"
  }).format(date);
}
function FuturePage({
  onNotice
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [collapsedDates, setCollapsedDates] = useState(() => new Set());
  useEffect(() => {
    setLoading(true);
    api("/api/sop/future-occurrences?days=45").then(result => {
      setData(result);
      setCollapsedDates(new Set(result.groups.slice(7).map(group => group.date)));
    }).catch(error => onNotice(error.message)).finally(() => setLoading(false));
  }, [refreshKey, onNotice]);
  const groups = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return (data?.groups || []).map(group => ({
      ...group,
      items: keyword ? group.items.filter(item => `${item.title} ${item.themeName} ${item.ruleLabel || ""} ${item.category || ""} ${item.specialLabel || ""}`.toLowerCase().includes(keyword)) : group.items
    })).filter(group => group.items.length > 0);
  }, [data, query]);
  const summary = data?.summary || {};
  return <section className="sop-page-band sop-future-page">
      <div className="sop-future-summary" aria-label="未来45天发生频率">
        <div><span>预览范围</span><b>{data?.days || 45} 天</b></div>
        <div><span>发生日期</span><b>{summary.activeDates || 0} 天</b></div>
        <div><span>主题触发</span><b>{Number(summary.themeOccurrences || 0).toLocaleString()} 次</b></div>
        <div><span>事件发生</span><b>{Number(summary.eventOccurrences || 0).toLocaleString()} 次</b></div>
        <div><span>已提前生成</span><b>{Number(summary.alreadyGeneratedEvents || 0).toLocaleString()} 条</b></div>
      </div>
      <div className="sop-toolbar sop-future-toolbar">
        <div className="sop-section-title"><CalendarClock size={18} /><div><b>未来发生</b><span>{data ? `${data.from} 至 ${data.to}` : "正在计算未来规则"}</span></div></div>
        <label className="sop-search"><Search size={16} /><OkrInput value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索主题、事件或规则" /></label>
        <OkrButton onClick={() => setCollapsedDates(current => current.size ? new Set() : new Set((data?.groups || []).map(group => group.date)))} title={collapsedDates.size ? "展开全部日期" : "收起全部日期"}>{collapsedDates.size ? <ChevronDown size={16} /> : <ChevronRight size={16} />}{collapsedDates.size ? "全部展开" : "全部收起"}</OkrButton>
        <OkrButton disabled={loading} onClick={() => setRefreshKey(value => value + 1)} title="重新读取当前触发规则"><RefreshCw className={loading ? "spin" : ""} size={16} />刷新</OkrButton>
      </div>
      {loading && !data ? <EmptyState loading /> : groups.length === 0 ? <EmptyState label={query ? "没有符合搜索条件的未来事项" : "未来45天没有自动发生事项"} /> : <div className="sop-future-timeline">
          {groups.map(group => {
        const collapsed = !query.trim() && collapsedDates.has(group.date);
        const themeGroups = [];
        for (const item of group.items) {
          let theme = themeGroups.find(entry => String(entry.id) === String(item.themeId));
          if (!theme) {
            theme = {
              id: item.themeId,
              name: item.themeName,
              items: []
            };
            themeGroups.push(theme);
          }
          theme.items.push(item);
        }
        const eventCount = group.items.filter(item => item.kind === "event").length;
        return <article className="sop-future-day" key={group.date}>
                <header>
                  <span className="sop-future-dot" />
                  <OkrButton className="sop-future-day-toggle" onClick={() => setCollapsedDates(current => {
              const next = new Set(current);
              next.has(group.date) ? next.delete(group.date) : next.add(group.date);
              return next;
            })} title={collapsed ? "展开这一天" : "收起这一天"}>{collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}<span><b>{futureDateLabel(group.date)}</b><small>{group.weekday}</small></span></OkrButton>
                  <em>{group.daysFromToday}天后</em>
                  <small>{themeGroups.length} 个主题 · {eventCount} 个事件</small>
                </header>
                {!collapsed && <div className="sop-future-day-content">
                  {themeGroups.map(theme => {
              const themeTrigger = theme.items.find(item => item.kind === "theme");
              const events = theme.items.filter(item => item.kind === "event");
              return <section className="sop-future-theme" key={`${group.date}-${theme.id}`}>
                        <header>
                          <span className="sop-config-theme-name enabled"><i /><b>{theme.name}</b></span>
                          <em>{themeTrigger ? "主题触发" : "独立事件"}</em>
                          <small>{events.length} 个事件</small>
                        </header>
                        {themeTrigger && <div className="sop-future-trigger"><Repeat2 size={16} /><span><b>{themeTrigger.ruleLabel}</b>{themeTrigger.sourceEventTitle && <small>来源：{themeTrigger.sourceEventTitle}</small>}</span></div>}
                        <div className="sop-future-events">
                          {events.map(item => <div className={item.alreadyGenerated ? "generated" : "planned"} key={item.key}>
                              <span className="sop-future-event-mark" />
                              <span><b>{item.title}</b><small>{item.ruleLabel}{item.specialLabel ? ` · ${item.specialLabel}` : ""}</small></span>
                              <em>{item.alreadyGenerated ? "已生成" : "预计发生"}</em>
                            </div>)}
                          {events.length === 0 && <span className="sop-future-no-events">当前没有参与创建的事件</span>}
                        </div>
                      </section>;
            })}
                </div>}
              </article>;
      })}
        </div>}
    </section>;
}
function ThemeEditor({
  categories = [],
  events = [],
  item,
  onClose,
  onSaved,
  onNotice
}) {
  const systemTheme = Boolean(item?.isSystem);
  const [form, setForm] = useState({
    name: item?.name || "",
    color: item?.color || "#9c5a43",
    category: item?.category || "",
    priority: item?.priority || "P4",
    isImportant: Boolean(item?.isImportant),
    ruleType: item?.ruleType || "manual",
    ruleConfig: item?.ruleConfig || {},
    intervalDays: item?.intervalDays || "",
    delayDiscardHours: item?.delayDiscardHours ?? "",
    startDate: item?.startDate || todayString(),
    generationMode: item?.generationMode || "schedule",
    continuousEnabled: Boolean(item?.continuousEnabled),
    continuousDays: item?.continuousDays || 1,
    followSourceEventId: item?.followSourceEventId || "",
    followDelayDays: item?.followDelayDays || 0,
    generationEnabled: item ? Boolean(item.generationEnabled) : true
  });
  const set = (key, value) => setForm(current => ({
    ...current,
    [key]: value
  }));
  const setRule = (key, value) => setForm(current => ({
    ...current,
    ruleConfig: {
      ...current.ruleConfig,
      [key]: value
    }
  }));
  const intervalDays = Math.max(1, Number(form.ruleConfig.intervalDays || form.intervalDays || 1));
  const continuousConflict = form.generationMode === "schedule" && form.ruleType === "interval" && form.continuousEnabled && Number(form.continuousDays) > intervalDays;
  const customDates = form.generationMode === "schedule" && form.ruleType === "custom_dates";
  const needsFirstTrigger = form.generationMode === "schedule" && !["manual", "none", "custom_dates"].includes(form.ruleType);
  return <SopDialog title={item ? "编辑 SOP 主题" : "新建 SOP 主题"} onClose={onClose} onSubmit={async event => {
    event.preventDefault();
    try {
      if (continuousConflict) throw new Error(`持续生成天数不能超过间隔天数（当前间隔 ${intervalDays} 天）`);
      await api(item ? `/api/sop/themes/${item.id}` : "/api/sop/themes", {
        method: item ? "PATCH" : "POST",
        body: JSON.stringify({
          ...form,
          frequencyLabel: systemTheme ? "事件独立循环" : form.generationMode === "follow" ? "跟随事件产生" : triggerOptions.find(([value]) => value === form.ruleType)?.[1] || "自定义触发",
          intervalDays: form.ruleType === "interval" ? Number(form.ruleConfig.intervalDays || form.intervalDays || 1) : null,
          delayDiscardHours: form.delayDiscardHours === "" ? null : Number(form.delayDiscardHours),
          startDate: needsFirstTrigger ? form.startDate : null,
          continuousEnabled: customDates ? false : form.continuousEnabled,
          continuousDays: customDates ? 1 : form.continuousDays
        })
      });
      onNotice(item ? "SOP 主题已保存" : "SOP 主题已创建");
      onSaved();
    } catch (error) {
      onNotice(error.message);
    }
  }}>
      <div className="sop-form-grid">
        <label className="wide"><span>主题名称</span><OkrInput autoFocus required disabled={systemTheme} value={form.name} onChange={event => set("name", event.target.value)} /></label>
        <label><span>主题颜色</span><div className="sop-color-input"><OkrInput type="color" value={form.color} onChange={event => set("color", event.target.value)} /><b>{form.color}</b></div></label>
        <label><span>分类</span><OkrSelect value={categories.includes(form.category) ? form.category : "__new__"} onChange={event => set("category", event.target.value === "__new__" ? "" : event.target.value)}><option value="__new__">新建分类</option>{categories.map(value => <option key={value} value={value}>{value}</option>)}</OkrSelect></label>
        {!categories.includes(form.category) && <label><span>新分类名称</span><OkrInput autoFocus={!form.name} value={form.category} onChange={event => set("category", event.target.value)} placeholder="输入新的分类名称" /></label>}
        <label><span>等级</span><OkrSelect value={form.priority} onChange={event => set("priority", event.target.value)}>{["P0", "P1", "P2", "P3", "P4"].map(value => <option key={value}>{value}</option>)}</OkrSelect></label>
        {systemTheme ? <div className="wide sop-system-theme-note"><Repeat2 size={17} /><div><b>系统固定主题</b><span>该主题没有统一触发方式。下属每个事件必须单独配置循环周期，并由系统自动生成。</span></div></div> : <>
          <label className="wide"><span>产生方式</span><OkrSelect value={form.generationMode} onChange={event => set("generationMode", event.target.value)}><option value="schedule">按日期周期产生</option><option value="follow">跟随事件产生</option></OkrSelect></label>
          {form.generationMode === "follow" ? <>
            <FollowEventSelect events={events} value={form.followSourceEventId} onChange={value => set("followSourceEventId", value)} excludeThemeId={item?.id} />
            <label><span>延迟产生天数</span><OkrInput min="0" max="3650" type="number" value={form.followDelayDays} onChange={event => set("followDelayDays", Number(event.target.value))} /></label>
            <div className="wide sop-follow-note"><Repeat2 size={16} /><span>所选事件每产生一条执行事项，本主题内参与创建的事件就跟随产生一次。0 天表示同日产生。</span></div>
          </> : <>
          <label className="wide"><span>日期触发条件</span><OkrSelect value={form.ruleType} onChange={event => set("ruleType", event.target.value)}>{triggerOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</OkrSelect></label>
          {customDates && <ManualCalendarSelect value={form.ruleConfig.calendarId} onChange={value => setRule("calendarId", value)} />}
          {needsFirstTrigger && <label><span>首次触发日期</span><OkrInput required type="date" value={form.startDate} onChange={event => set("startDate", event.target.value)} /></label>}
          {form.ruleType === "weekly" && <fieldset className="wide sop-weekday-picker"><legend>选择星期</legend>{weekdayOptions.map(([value, label]) => <label key={value}><OkrInput type="checkbox" checked={(form.ruleConfig.weekdays || []).map(Number).includes(value)} onChange={event => {
                const current = (form.ruleConfig.weekdays || []).map(Number);
                setRule("weekdays", event.target.checked ? [...new Set([...current, value])] : current.filter(day => day !== value));
              }} />{label}</label>)}</fieldset>}
          {form.ruleType === "monthly_day" && <label><span>每月第几号</span><OkrInput min="1" max="31" type="number" value={form.ruleConfig.day || 1} onChange={event => setRule("day", Number(event.target.value))} /></label>}
          {["nth_workday", "nth_restday"].includes(form.ruleType) && <label><span>第几个</span><OkrInput min="1" max="23" type="number" value={form.ruleConfig.nth || 1} onChange={event => setRule("nth", Number(event.target.value))} /></label>}
          {form.ruleType === "interval" && <label><span>间隔天数</span><OkrInput min="1" type="number" value={form.ruleConfig.intervalDays || form.intervalDays || 1} onChange={event => setRule("intervalDays", Number(event.target.value))} /></label>}
          {form.ruleType === "interval" && <><label className="sop-check"><OkrInput type="checkbox" checked={form.continuousEnabled} onChange={event => set("continuousEnabled", event.target.checked)} /><span>持续性生成</span></label>{form.continuousEnabled && <label><span>每期连续生成天数</span><OkrInput min="1" max={intervalDays} type="number" value={form.continuousDays} onChange={event => set("continuousDays", Number(event.target.value))} /></label>}{continuousConflict && <div className="wide sop-inline-error">持续生成天数不能超过间隔天数，否则前后周期会发生冲突。</div>}</>}
          <label><span>延迟废弃小时</span><OkrInput min="0" type="number" value={form.delayDiscardHours} onChange={event => set("delayDiscardHours", event.target.value)} /></label>
          </>}
        </>}
        <label className="sop-check"><OkrInput type="checkbox" checked={form.isImportant} onChange={event => set("isImportant", event.target.checked)} /><span>重要主题</span></label>
        {!systemTheme && <label className="sop-check"><OkrInput type="checkbox" checked={form.generationEnabled} onChange={event => set("generationEnabled", event.target.checked)} /><span>启用自动创建</span></label>}
      </div>
    </SopDialog>;
}
function ConfigPage({
  themes,
  onReload,
  onNotice
}) {
  const [events, setEvents] = useState([]);
  const [selectedThemeId, setSelectedThemeId] = useState(themes[0]?.id || "");
  const [themeEditor, setThemeEditor] = useState(null);
  const [eventEditor, setEventEditor] = useState(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("position");
  const [eventStatus, setEventStatus] = useState("enabled");
  const [contextMenu, setContextMenu] = useState(null);
  const [draggedThemeId, setDraggedThemeId] = useState(null);
  const [draggedEventId, setDraggedEventId] = useState(null);
  const refreshEvents = useCallback(() => api("/api/sop/events?limit=5000").then(result => setEvents(result.data)).catch(error => onNotice(error.message)), [onNotice]);
  useEffect(() => {
    refreshEvents();
  }, [refreshEvents]);
  useEffect(() => {
    if (!themes.some(theme => theme.id === selectedThemeId)) setSelectedThemeId(themes[0]?.id || "");
  }, [themes, selectedThemeId]);
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
  const categories = [...new Set(themes.map(theme => theme.category).filter(Boolean))];
  const shownThemes = themes.filter(theme => status === "all" || (status === "enabled" ? theme.generationEnabled : !theme.generationEnabled)).filter(theme => !priority || theme.priority === priority).filter(theme => !category || theme.category === category).filter(theme => {
    if (!query.trim()) return true;
    const text = `${theme.name} ${theme.category || ""} ${events.filter(item => item.themeId === theme.id).map(item => `${item.title} ${item.note || ""}`).join(" ")}`;
    return text.toLowerCase().includes(query.trim().toLowerCase());
  }).sort((left, right) => {
    if (left.isSystem !== right.isSystem) return left.isSystem ? -1 : 1;
    return sort === "name" ? left.name.localeCompare(right.name, "zh-CN") : sort === "events" ? right.eventCount - left.eventCount : left.position - right.position;
  });
  const selectedTheme = themes.find(theme => theme.id === selectedThemeId) || shownThemes[0] || null;
  const allSelectedThemeEvents = events.filter(item => item.themeId === selectedTheme?.id).sort((left, right) => left.sortOrder - right.sortOrder);
  const selectedEvents = allSelectedThemeEvents.filter(item => eventStatus === "all" || (eventStatus === "enabled" ? item.generationEnabled : !item.generationEnabled)).filter(item => !query.trim() || `${item.title} ${item.note || ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const reloadAll = () => {
    refreshEvents();
    onReload();
  };
  const triggerTheme = async theme => {
    const result = await api(`/api/sop/themes/${theme.id}/trigger`, {
      method: "POST",
      body: JSON.stringify({
        date: todayString()
      })
    });
    onNotice(`本次运行已新建 ${result.created} 条当日事项`);
    onReload();
  };
  const reorderThemes = async targetId => {
    if (!draggedThemeId || draggedThemeId === targetId || sort !== "position") return;
    const ids = [...themes].sort((left, right) => left.position - right.position).map(theme => theme.id);
    const from = ids.indexOf(draggedThemeId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    await api("/api/sop/themes/reorder", {
      method: "PUT",
      body: JSON.stringify({
        themeIds: ids
      })
    });
    setDraggedThemeId(null);
    onNotice("主题顺序已保存");
    onReload();
  };
  const reorderEvents = async targetId => {
    if (!draggedEventId || draggedEventId === targetId || !selectedTheme) return;
    const visibleIds = selectedEvents.map(item => item.id);
    const from = visibleIds.indexOf(draggedEventId);
    const to = visibleIds.indexOf(targetId);
    if (from < 0 || to < 0) return;
    visibleIds.splice(to, 0, visibleIds.splice(from, 1)[0]);
    const visibleSet = new Set(visibleIds);
    let visibleIndex = 0;
    const ids = allSelectedThemeEvents.map(item => visibleSet.has(item.id) ? visibleIds[visibleIndex++] : item.id);
    await api("/api/sop/events/reorder", {
      method: "PUT",
      body: JSON.stringify({
        themeId: selectedTheme.id,
        eventIds: ids
      })
    });
    setDraggedEventId(null);
    onNotice("事件顺序已保存");
    refreshEvents();
  };
  return <section className="sop-page-band sop-config-page">
      <div className="sop-toolbar sop-config-toolbar">
        <label className="sop-search"><Search size={15} /><OkrInput value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索主题、事件或备注" /></label>
        <OkrSelect value={status} onChange={event => setStatus(event.target.value)}><option value="all">全部状态</option><option value="enabled">运行中</option><option value="disabled">已停用</option></OkrSelect>
        <OkrSelect value={priority} onChange={event => setPriority(event.target.value)}><option value="">全部等级</option>{["P0", "P1", "P2", "P3", "P4"].map(value => <option key={value}>{value}</option>)}</OkrSelect>
        <OkrSelect value={category} onChange={event => setCategory(event.target.value)}><option value="">全部分类</option>{categories.map(value => <option key={value}>{value}</option>)}</OkrSelect>
        <OkrSelect aria-label="事件启用状态" value={eventStatus} onChange={event => setEventStatus(event.target.value)}><option value="enabled">已启用事件</option><option value="disabled">已停用事件</option><option value="all">全部事件</option></OkrSelect>
        <OkrSelect value={sort} onChange={event => setSort(event.target.value)}><option value="position">当前固定顺序</option><option value="name">主题名称</option><option value="events">事件数量</option></OkrSelect>
        <OkrButton className="primary-button" onClick={() => setThemeEditor({})}><Plus size={15} />新建主题</OkrButton>
      </div>
      <div className="sop-config-split">
        <aside className="sop-theme-manager">
          <header><div><b>主题管理与排序</b><span>{shownThemes.length} 个主题</span></div><small>拖动左侧图标调整固定顺序</small></header>
          <div className="sop-theme-manager-list">
            {shownThemes.map(theme => <article className={`${selectedTheme?.id === theme.id ? "active" : ""} ${theme.isSystem ? "system-theme" : ""} ${theme.generationEnabled ? "enabled" : "disabled"}`} draggable={sort === "position" && !theme.isSystem} key={theme.id} onClick={() => setSelectedThemeId(theme.id)} onContextMenu={event => {
            event.preventDefault();
            setContextMenu({
              theme,
              x: event.clientX,
              y: event.clientY
            });
          }} onDragStart={() => !theme.isSystem && setDraggedThemeId(theme.id)} onDragOver={event => sort === "position" && !theme.isSystem && event.preventDefault()} onDrop={() => !theme.isSystem && reorderThemes(theme.id)}>
                {theme.isSystem ? <Repeat2 size={16} /> : <GripVertical size={16} />}<span className="sop-config-theme-name"><i /><b>{theme.name}</b></span><span>{theme.eventCount} 个事件</span><em className={`sop-priority ${theme.priority}`}>{theme.priority}</em><OkrButton onClick={event => {
              event.stopPropagation();
              setThemeEditor(theme);
            }} title="编辑主题"><Pencil size={15} /></OkrButton>
              </article>)}
          </div>
        </aside>
        <section className="sop-event-manager">
          <header><div>{selectedTheme ? <span className={`sop-config-theme-name ${selectedTheme.generationEnabled ? "enabled" : "disabled"}`}><i /><b>{selectedTheme.name}</b></span> : <b>请选择主题</b>}<span>{selectedEvents.length} 个事件</span></div><div>{selectedTheme && <>{!selectedTheme.isSystem && <OkrButton onClick={() => triggerTheme(selectedTheme)} title="立即运行"><Play size={15} />立即运行</OkrButton>}<OkrButton className="primary-button" onClick={() => setEventEditor({
                themeId: selectedTheme.id
              })}><Plus size={15} />新建事件</OkrButton></>}</div></header>
          <div className="sop-event-manager-table">
            <div className="sop-event-manager-head wx-library-head"><span>排序</span><span>事件与备注</span><span>分类</span><span>标签</span><span>状态</span><span>操作</span></div>
            {selectedEvents.map((item, index) => <div className={`sop-event-manager-row wx-library-row ${item.generationEnabled ? "enabled" : "disabled"}`} draggable key={item.id} onDragStart={() => setDraggedEventId(item.id)} onDragOver={event => event.preventDefault()} onDrop={() => reorderEvents(item.id)}>
                <span><GripVertical size={15} /><em>{String(index + 1).padStart(2, "0")}</em></span><span className="sop-title-cell"><b>{item.title}</b><small>{selectedTheme?.isSystem && <em className="sop-recurrence-summary">{recurrenceLabel(item)}</em>}{item.generationMode === "follow" && <em className="sop-recurrence-summary">跟随事件产生 · 延迟 {item.followDelayDays || 0} 天</em>}<LinkifiedText value={item.note} /></small></span><span>{item.category || "-"}</span><span>{item.specialLabel || "-"}</span><span><span className={`sop-switch-label ${item.generationEnabled ? "on" : ""}`}>{item.generationEnabled ? "参与循环" : "已停用"}</span></span><span className="sop-row-actions"><OkrButton onClick={() => setEventEditor(item)} title="编辑事件"><Pencil size={15} /></OkrButton><OkrButton onClick={async () => {
                await api(`/api/sop/events/${item.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({
                    generationEnabled: !item.generationEnabled
                  })
                });
                refreshEvents();
              }} title={item.generationEnabled ? "停用事件" : "启用事件"}>{item.generationEnabled ? <CirclePause size={15} /> : <Play size={15} />}</OkrButton></span>
              </div>)}
            {!selectedEvents.length && <EmptyState label={selectedTheme ? "该主题暂无事件" : "请先选择一个主题"} />}
          </div>
        </section>
      </div>
      {contextMenu && <div className="sop-context-menu" style={{
      left: contextMenu.x,
      top: contextMenu.y
    }}><OkrButton onClick={() => setThemeEditor(contextMenu.theme)}><Pencil size={14} />编辑主题</OkrButton>{!contextMenu.theme.isSystem && <OkrButton onClick={() => triggerTheme(contextMenu.theme)}><Play size={14} />立即运行</OkrButton>}{!contextMenu.theme.isSystem && <OkrButton onClick={async () => {
        await api(`/api/sop/themes/${contextMenu.theme.id}/clone`, {
          method: "POST"
        });
        setContextMenu(null);
        reloadAll();
        onNotice("主题副本已创建");
      }}><Copy size={14} />复制主题</OkrButton>}{!contextMenu.theme.isSystem && <OkrButton className="danger" onClick={async () => {
        await api(`/api/sop/themes/${contextMenu.theme.id}`, {
          method: "DELETE"
        });
        setContextMenu(null);
        onReload();
        onNotice("主题已标记为废弃");
      }}><Archive size={14} />标记为废弃</OkrButton>}</div>}
      {themeEditor && <ThemeEditor categories={categories} events={events} item={themeEditor.id ? themeEditor : null} onClose={() => setThemeEditor(null)} onNotice={onNotice} onSaved={() => {
      setThemeEditor(null);
      reloadAll();
    }} />}
      {eventEditor && <EventEditor themes={themes} events={events} item={eventEditor.id ? eventEditor : {
      themeId: eventEditor.themeId
    }} onClose={() => setEventEditor(null)} onNotice={onNotice} onSaved={() => {
      setEventEditor(null);
      reloadAll();
    }} />}
    </section>;
}
function EventEditor({
  themes,
  events = [],
  item,
  onClose,
  onSaved,
  onNotice
}) {
  const existing = Boolean(item?.id);
  const [form, setForm] = useState({
    themeId: item?.themeId || themes[0]?.id || "",
    title: item?.title || "",
    note: item?.note || "",
    category: item?.category || "",
    specialLabel: item?.specialLabel || "",
    earlyCompletion: Boolean(item?.earlyCompletion),
    generationEnabled: item ? Boolean(item.generationEnabled) : true,
    activeUntil: item?.activeUntil || "",
    recurrenceType: item?.recurrenceType || "daily",
    recurrenceConfig: item?.recurrenceConfig || {},
    recurrenceStartDate: item?.recurrenceStartDate || todayString(),
    recurrenceEndType: item?.recurrenceEndType || "never",
    recurrenceCount: item?.recurrenceCount || 1,
    recurrenceEndDate: item?.recurrenceEndDate || "",
    generationMode: item?.generationMode || "inherit",
    continuousEnabled: Boolean(item?.continuousEnabled),
    continuousDays: item?.continuousDays || 1,
    followSourceEventId: item?.followSourceEventId || "",
    followDelayDays: item?.followDelayDays || 0
  });
  const set = (key, value) => setForm(current => ({
    ...current,
    [key]: value
  }));
  const setRecurrence = (key, value) => setForm(current => ({
    ...current,
    recurrenceConfig: {
      ...current.recurrenceConfig,
      [key]: value
    }
  }));
  const selectedTheme = themes.find(theme => String(theme.id) === String(form.themeId));
  const recurringEvent = Boolean(selectedTheme?.isSystem);
  const customDates = recurringEvent && form.recurrenceType === "custom_dates";
  const intervalDays = Math.max(1, Number(form.recurrenceConfig.intervalDays || 1));
  const continuousConflict = recurringEvent && form.recurrenceType === "interval" && form.continuousEnabled && Number(form.continuousDays) > intervalDays;
  return <SopDialog title={existing ? "编辑 SOP 事件" : "新建 SOP 事件"} onClose={onClose} onSubmit={async event => {
    event.preventDefault();
    try {
      if (continuousConflict) throw new Error(`持续生成天数不能超过间隔天数（当前间隔 ${intervalDays} 天）`);
      await api(existing ? `/api/sop/events/${item.id}` : "/api/sop/events", {
        method: existing ? "PATCH" : "POST",
        body: JSON.stringify({
          ...form,
          themeId: Number(form.themeId),
          recurrenceStartDate: customDates ? null : form.recurrenceStartDate,
          recurrenceEndType: customDates ? "never" : form.recurrenceEndType,
          recurrenceCount: customDates ? null : form.recurrenceCount,
          recurrenceEndDate: customDates ? null : form.recurrenceEndDate,
          continuousEnabled: customDates ? false : form.continuousEnabled,
          continuousDays: customDates ? 1 : form.continuousDays
        })
      });
      onNotice(existing ? "SOP 事件已保存，历史记录保持不变" : "SOP 事件已创建");
      onSaved();
    } catch (error) {
      onNotice(error.message);
    }
  }}>
      <div className="sop-form-grid">
        <label><span>所属主题</span><OkrSelect required value={form.themeId} onChange={event => set("themeId", event.target.value)}>{themes.map(theme => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</OkrSelect></label>
        <label><span>分类</span><OkrInput value={form.category} onChange={event => set("category", event.target.value)} /></label>
        <label className="wide"><span>事件内容</span><OkrInput required value={form.title} onChange={event => set("title", event.target.value)} /></label>
        <label className="wide"><span>备注</span><OkrTextarea rows="4" value={form.note} onChange={event => set("note", event.target.value)} /></label>
        <label><span>特殊标签</span><OkrInput value={form.specialLabel} onChange={event => set("specialLabel", event.target.value)} /></label>
        {!recurringEvent && <><label><span>产生方式</span><OkrSelect value={form.generationMode} onChange={event => set("generationMode", event.target.value)}><option value="inherit">跟随所属主题</option><option value="follow">跟随指定事件</option></OkrSelect></label>{form.generationMode === "follow" && <><FollowEventSelect events={events} value={form.followSourceEventId} onChange={value => set("followSourceEventId", value)} excludeId={item?.id} /><label><span>延迟产生天数</span><OkrInput min="0" max="3650" type="number" value={form.followDelayDays} onChange={event => set("followDelayDays", Number(event.target.value))} /></label></>}<label><span>运行截止日期</span><OkrInput type="date" value={form.activeUntil} onChange={event => set("activeUntil", event.target.value)} /></label></>}
        {recurringEvent && <fieldset className="wide sop-recurrence-fieldset"><legend><Repeat2 size={15} />独立循环周期</legend><div className="sop-form-grid">
          <label><span>循环方式</span><OkrSelect required value={form.recurrenceType} onChange={event => set("recurrenceType", event.target.value)}>{recurringTriggerOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</OkrSelect></label>
          {customDates && <ManualCalendarSelect value={form.recurrenceConfig.calendarId} onChange={value => setRecurrence("calendarId", value)} />}
          {!customDates && <label><span>首次触发日期</span><OkrInput required type="date" value={form.recurrenceStartDate} onChange={event => set("recurrenceStartDate", event.target.value)} /></label>}
          {form.recurrenceType === "weekly" && <fieldset className="wide sop-weekday-picker"><legend>选择星期</legend>{weekdayOptions.map(([value, label]) => <label key={value}><OkrInput type="checkbox" checked={(form.recurrenceConfig.weekdays || []).map(Number).includes(value)} onChange={event => {
                const current = (form.recurrenceConfig.weekdays || []).map(Number);
                setRecurrence("weekdays", event.target.checked ? [...new Set([...current, value])] : current.filter(day => day !== value));
              }} />{label}</label>)}</fieldset>}
          {form.recurrenceType === "monthly_day" && <label><span>每月第几号</span><OkrInput required min="1" max="31" type="number" value={form.recurrenceConfig.day || 1} onChange={event => setRecurrence("day", Number(event.target.value))} /></label>}
          {["nth_workday", "nth_restday"].includes(form.recurrenceType) && <label><span>第几个</span><OkrInput required min="1" max="23" type="number" value={form.recurrenceConfig.nth || 1} onChange={event => setRecurrence("nth", Number(event.target.value))} /></label>}
          {form.recurrenceType === "interval" && <label><span>间隔天数</span><OkrInput required min="1" type="number" value={form.recurrenceConfig.intervalDays || 1} onChange={event => setRecurrence("intervalDays", Number(event.target.value))} /></label>}
          {form.recurrenceType === "interval" && <><label className="sop-check"><OkrInput type="checkbox" checked={form.continuousEnabled} onChange={event => set("continuousEnabled", event.target.checked)} /><span>持续性生成</span></label>{form.continuousEnabled && <label><span>每期连续生成天数</span><OkrInput required min="1" max={intervalDays} type="number" value={form.continuousDays} onChange={event => set("continuousDays", Number(event.target.value))} /></label>}{continuousConflict && <div className="wide sop-inline-error">持续生成天数不能超过间隔天数，否则前后周期会发生冲突。</div>}</>}
          {!customDates && <><label><span>停止方式</span><OkrSelect value={form.recurrenceEndType} onChange={event => set("recurrenceEndType", event.target.value)}><option value="never">不自动停止</option><option value="count">执行指定次数后停止</option><option value="date">到指定日期后停止</option></OkrSelect></label>
          {form.recurrenceEndType === "count" && <label><span>执行次数</span><OkrInput required min="1" type="number" value={form.recurrenceCount} onChange={event => set("recurrenceCount", Number(event.target.value))} /></label>}
          {form.recurrenceEndType === "date" && <label><span>停止日期</span><OkrInput required min={form.recurrenceStartDate} type="date" value={form.recurrenceEndDate} onChange={event => set("recurrenceEndDate", event.target.value)} /></label>}</>}
        </div><p>该事件按自己的周期自动生成，不支持通过“立即运行主题”手动触发。</p></fieldset>}
        <label className="sop-check"><OkrInput type="checkbox" checked={form.earlyCompletion} onChange={event => set("earlyCompletion", event.target.checked)} /><span>允许提前完成</span></label>
        <label className="sop-check"><OkrInput type="checkbox" checked={form.generationEnabled} onChange={event => set("generationEnabled", event.target.checked)} /><span>参与自动创建</span></label>
      </div>
    </SopDialog>;
}
function EventsPage({
  themes,
  onNotice
}) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [themeId, setThemeId] = useState("");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => setRefreshKey(value => value + 1);
  useEffect(() => {
    const params = new URLSearchParams({
      limit: "50",
      offset: String(offset)
    });
    if (themeId) params.set("themeId", themeId);
    if (query) params.set("q", query);
    api(`/api/sop/events?${params}`).then(result => {
      setItems(result.data);
      setTotal(result.total);
    }).catch(error => onNotice(error.message));
  }, [themeId, query, offset, refreshKey, onNotice]);
  return <section className="sop-page-band"><div className="sop-toolbar"><label className="sop-search"><Search size={15} /><OkrInput value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索事件" /></label><SearchableThemeSelect themes={themes} value={themeId} onChange={setThemeId} /><OkrButton className="primary-button" onClick={() => setEditor({})}><Plus size={15} />新建事件</OkrButton></div>
      <LibraryScroll className="sop-table-wrap" label="SOP 数据列表"><div className="wx-library-grid sop-table sop-event-table"><div className="sop-table-head wx-library-head"><span>序号</span><span>事件内容</span><span>所属主题</span><span>分类</span><span>标签</span><span>能力</span><span>状态</span><span>操作</span></div>{items.map(item => <div className={`sop-table-row wx-library-row ${item.generationEnabled ? "enabled" : "disabled"}`} key={item.id}><span>{item.sortOrder}</span><span className="sop-title-cell"><b>{item.title}</b><small>{item.recurrenceType && <em className="sop-recurrence-summary">{recurrenceLabel(item)}</em>}{item.note || !item.recurrenceType && `事件 #${item.id}`}</small></span><span><ThemeChip name={item.themeName} color={item.themeColor} /></span><span>{item.category || "-"}</span><span>{item.specialLabel || "-"}</span><span className="sop-capabilities">{item.earlyCompletion && <Clock3 size={14} title="允许提前完成" />}</span><span><span className={`sop-switch-label ${item.generationEnabled ? "on" : ""}`}>{item.generationEnabled ? "启用" : "停用"}</span></span><span className="sop-row-actions"><OkrButton onClick={() => setEditor({
              item
            })} title="编辑"><MoreHorizontal size={15} /></OkrButton><OkrButton onClick={async () => {
              await api(`/api/sop/events/${item.id}`, {
                method: "PATCH",
                body: JSON.stringify({
                  generationEnabled: !item.generationEnabled
                })
              });
              refresh();
            }} title={item.generationEnabled ? "停用" : "启用"}>{item.generationEnabled ? <CirclePause size={14} /> : <Play size={14} />}</OkrButton></span></div>)}</div></LibraryScroll>
      <Pager offset={offset} total={total} onChange={setOffset} />{editor && <EventEditor themes={themes} events={items} item={editor.item} onClose={() => setEditor(null)} onNotice={onNotice} onSaved={() => {
      setEditor(null);
      refresh();
    }} />}
    </section>;
}
function CalendarTemplateEditor({
  item,
  onClose,
  onSaved,
  onNotice
}) {
  const [form, setForm] = useState({
    name: item?.name || "",
    color: item?.color || "#2877d4",
    weekdayConfig: item?.weekdayConfig || {
      0: "restday",
      1: "workday",
      2: "workday",
      3: "workday",
      4: "workday",
      5: "workday",
      6: "restday"
    }
  });
  return <SopDialog title={item?.id ? "编辑日历模板" : "新建日历模板"} onClose={onClose} onSubmit={async event => {
    event.preventDefault();
    try {
      await api(item?.id ? `/api/sop/calendar-templates/${item.id}` : "/api/sop/calendar-templates", {
        method: item?.id ? "PATCH" : "POST",
        body: JSON.stringify(form)
      });
      onNotice("日历模板已保存");
      onSaved();
    } catch (error) {
      onNotice(error.message);
    }
  }}><div className="sop-form-grid"><label className="wide"><span>模板名称</span><OkrInput autoFocus required value={form.name} onChange={event => setForm({
          ...form,
          name: event.target.value
        })} /></label><label><span>模板颜色</span><div className="sop-color-input"><OkrInput type="color" value={form.color} onChange={event => setForm({
            ...form,
            color: event.target.value
          })} /><b>{form.color}</b></div></label><fieldset className="wide sop-template-weekdays"><legend>每周默认工休</legend>{weekdayOptions.map(([value, label]) => <OkrButton className={form.weekdayConfig[value] === "workday" ? "workday" : "restday"} key={value} onClick={event => {
          event.preventDefault();
          setForm({
            ...form,
            weekdayConfig: {
              ...form.weekdayConfig,
              [value]: form.weekdayConfig[value] === "workday" ? "restday" : "workday"
            }
          });
        }}>{label}<small>{form.weekdayConfig[value] === "workday" ? "工作日" : "休息日"}</small></OkrButton>)}</fieldset></div></SopDialog>;
}
function ManualCalendarEditor({
  item,
  onClose,
  onSaved,
  onNotice
}) {
  const [form, setForm] = useState({
    name: item?.name || "",
    color: item?.color || "#2877d4"
  });
  return <SopDialog title={item?.id ? "编辑手动日期日历" : "新建手动日期日历"} onClose={onClose} onSubmit={async event => {
    event.preventDefault();
    try {
      const saved = await api(item?.id ? `/api/sop/manual-calendars/${item.id}` : "/api/sop/manual-calendars", {
        method: item?.id ? "PATCH" : "POST",
        body: JSON.stringify(form)
      });
      onNotice(item?.id ? "手动日期日历已保存" : "手动日期日历已创建");
      onSaved(saved);
    } catch (error) {
      onNotice(error.message);
    }
  }}><div className="sop-form-grid"><label className="wide"><span>日历名称</span><OkrInput autoFocus required value={form.name} onChange={event => setForm({
          ...form,
          name: event.target.value
        })} /></label><label><span>日期标记颜色</span><div className="sop-color-input"><OkrInput type="color" value={form.color} onChange={event => setForm({
            ...form,
            color: event.target.value
          })} /><b>{form.color}</b></div></label><div className="wide sop-manual-calendar-badge"><CalendarDays size={16} /><b>完全手动</b></div></div></SopDialog>;
}
function CalendarDayEditor({
  cell,
  templates,
  onClose,
  onSaved,
  onNotice
}) {
  const [form, setForm] = useState({
    dayType: cell.dayType,
    templateId: cell.source?.templateId || "",
    firstWorkday: Boolean(cell.source?.firstWorkday || dayOfWeek(cell.date) === 1 && cell.dayType === "workday"),
    dayAfterRest: Boolean(cell.source?.dayAfterRest),
    note: cell.source?.note || ""
  });
  return <SopDialog title={`维护 ${cell.date}`} onClose={onClose} onSubmit={async event => {
    event.preventDefault();
    try {
      await api(`/api/sop/calendar/${cell.date}`, {
        method: "PUT",
        body: JSON.stringify({
          ...form,
          templateId: form.templateId || null
        })
      });
      onNotice(`${cell.date} 日历设置已保存`);
      onSaved();
    } catch (error) {
      onNotice(error.message);
    }
  }}><div className="sop-form-grid"><label><span>日期类型</span><OkrSelect value={form.dayType} onChange={event => setForm({
          ...form,
          dayType: event.target.value
        })}><option value="workday">工作日</option><option value="restday">休息日</option><option value="holiday">节假日</option><option value="adjusted_workday">调休上班</option></OkrSelect></label><label><span>关联模板</span><OkrSelect value={form.templateId} onChange={event => {
          const template = templates.find(item => String(item.id) === event.target.value);
          const nextType = template?.weekdayConfig?.[dayOfWeek(cell.date)] || form.dayType;
          setForm({
            ...form,
            templateId: event.target.value,
            dayType: nextType
          });
        }}><option value="">不关联模板</option>{templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</OkrSelect></label><label className="wide"><span>备注</span><OkrTextarea rows="3" value={form.note} onChange={event => setForm({
          ...form,
          note: event.target.value
        })} /></label><label className="sop-check"><OkrInput type="checkbox" checked={form.firstWorkday} onChange={event => setForm({
          ...form,
          firstWorkday: event.target.checked
        })} /><span>标记为首个工作日</span></label><label className="sop-check"><OkrInput type="checkbox" checked={form.dayAfterRest} onChange={event => setForm({
          ...form,
          dayAfterRest: event.target.checked
        })} /><span>前一日为休息日</span></label></div></SopDialog>;
}
function CalendarPage({
  onNotice
}) {
  const [mode, setMode] = useState("workdays");
  const [month, setMonth] = useState(todayString().slice(0, 7));
  const [rows, setRows] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [manualCalendars, setManualCalendars] = useState([]);
  const [manualDates, setManualDates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedManualCalendarId, setSelectedManualCalendarId] = useState("");
  const [templateEditor, setTemplateEditor] = useState(null);
  const [manualEditor, setManualEditor] = useState(null);
  const [dayEditor, setDayEditor] = useState(null);
  const [busyDate, setBusyDate] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const first = `${month}-01`;
  const leading = dayOfWeek(first);
  const gridStart = addDays(first, -leading);
  const gridEnd = addDays(gridStart, 41);
  useEffect(() => {
    Promise.all([api(`/api/sop/calendar?from=${gridStart}&to=${gridEnd}`), api("/api/sop/calendar-templates"), api("/api/sop/manual-calendars")]).then(([calendar, templateResult, manualResult]) => {
      setRows(calendar.data);
      setTemplates(templateResult.data);
      setManualCalendars(manualResult.data || []);
      setSelectedTemplateId(current => current || String(templateResult.data[0]?.id || ""));
      setSelectedManualCalendarId(current => manualResult.data?.some(item => String(item.id) === String(current)) ? current : String(manualResult.data?.[0]?.id || ""));
    }).catch(error => onNotice(error.message));
  }, [gridStart, gridEnd, refreshKey, onNotice]);
  useEffect(() => {
    if (!selectedManualCalendarId) {
      setManualDates([]);
      return;
    }
    api(`/api/sop/manual-calendars/${selectedManualCalendarId}/dates?from=${gridStart}&to=${gridEnd}`).then(result => setManualDates(result.data || [])).catch(error => onNotice(error.message));
  }, [selectedManualCalendarId, gridStart, gridEnd, refreshKey, onNotice]);
  const rowMap = useMemo(() => new Map(rows.map(row => [row.calendarDate, row])), [rows]);
  const manualDateSet = useMemo(() => new Set(manualDates.map(row => row.calendarDate)), [manualDates]);
  const cells = Array.from({
    length: 42
  }, (_, index) => {
    const date = addDays(gridStart, index);
    const source = rowMap.get(date);
    const fallbackRest = [0, 6].includes(dayOfWeek(date));
    return {
      date,
      dayType: source?.dayType || (fallbackRest ? "restday" : "workday"),
      source
    };
  });
  const moveMonth = amount => {
    const date = new Date(`${first}T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + amount);
    setMonth(date.toISOString().slice(0, 7));
  };
  const selectedTemplate = templates.find(item => String(item.id) === String(selectedTemplateId));
  const selectedManualCalendar = manualCalendars.find(item => String(item.id) === String(selectedManualCalendarId));
  const toggleManualDate = async cell => {
    if (!selectedManualCalendar || busyDate) return;
    const selected = manualDateSet.has(cell.date);
    setBusyDate(cell.date);
    try {
      await api(`/api/sop/manual-calendars/${selectedManualCalendar.id}/dates/${cell.date}`, {
        method: selected ? "DELETE" : "PUT",
        body: selected ? undefined : JSON.stringify({})
      });
      onNotice(selected ? `${cell.date} 已移出手动日期日历` : `${cell.date} 已加入手动日期日历`);
      setRefreshKey(value => value + 1);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setBusyDate("");
    }
  };
  return <section className="sop-page-band sop-calendar-page">
    <div className="sop-toolbar">
      <div className="sop-month-switch"><OkrButton onClick={() => moveMonth(-1)} title="上个月"><ChevronLeft size={15} /></OkrButton><b>{month.replace("-", " 年 ")} 月</b><OkrButton onClick={() => moveMonth(1)} title="下个月"><ChevronRight size={15} /></OkrButton></div>
      <OkrButton onClick={() => setMonth(todayString().slice(0, 7))}>回到本月</OkrButton>
      <div className="sop-calendar-mode"><OkrButton className={mode === "workdays" ? "active" : ""} onClick={() => setMode("workdays")}>工休维护</OkrButton><OkrButton className={mode === "manual" ? "active" : ""} onClick={() => setMode("manual")}>手动日期</OkrButton></div>
      <span className="sop-toolbar-spacer" />
      {mode === "workdays" ? <><OkrSelect aria-label="日历模板" value={selectedTemplateId} onChange={event => setSelectedTemplateId(event.target.value)}>{templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</OkrSelect>{selectedTemplate && <OkrButton onClick={() => setTemplateEditor(selectedTemplate)}><Pencil size={14} />编辑模板</OkrButton>}<OkrButton className="primary-button" onClick={() => setTemplateEditor({})}><Plus size={14} />新建日历模板</OkrButton></> : <><OkrSelect aria-label="手动日期日历" value={selectedManualCalendarId} onChange={event => setSelectedManualCalendarId(event.target.value)}><option value="">选择手动日期日历</option>{manualCalendars.map(item => <option key={item.id} value={item.id}>{item.name} · {item.dateCount || 0} 日</option>)}</OkrSelect>{selectedManualCalendar && <OkrButton onClick={() => setManualEditor(selectedManualCalendar)}><Pencil size={14} />编辑日历</OkrButton>}<OkrButton className="primary-button" onClick={() => setManualEditor({})}><Plus size={14} />新建手动日历</OkrButton></>}
    </div>
    {mode === "manual" && selectedManualCalendar && <div className="sop-manual-calendar-strip" style={{
      "--manual-color": selectedManualCalendar.color
    }}><i /><b>{selectedManualCalendar.name}</b><span>完全手动</span><em>{selectedManualCalendar.dateCount || 0} 个日期</em><small>{selectedManualCalendar.linkedThemeCount || 0} 个主题 · {selectedManualCalendar.linkedEventCount || 0} 个事件</small></div>}
    <div className={`sop-calendar ${mode === "manual" ? "manual-mode" : ""}`} style={selectedManualCalendar ? {
      "--manual-color": selectedManualCalendar.color
    } : undefined}>
      <header>{["日", "一", "二", "三", "四", "五", "六"].map(day => <span key={day}>周{day}</span>)}</header>
      <div>{cells.map(cell => mode === "manual" ? <OkrButton className={`${cell.date.slice(0, 7) === month ? "" : "outside"} manual-date ${manualDateSet.has(cell.date) ? "manual-selected" : ""}`} disabled={!selectedManualCalendar || busyDate === cell.date} key={cell.date} onClick={() => toggleManualDate(cell)}><b>{Number(cell.date.slice(8))}</b>{manualDateSet.has(cell.date) && <span><Check size={12} />已选日期</span>}{busyDate === cell.date && <small>保存中</small>}</OkrButton> : <OkrButton className={`${cell.date.slice(0, 7) === month ? "" : "outside"} ${cell.dayType}`} key={cell.date} onClick={() => setDayEditor(cell)}><b>{Number(cell.date.slice(8))}</b><span>{cell.dayType === "adjusted_workday" ? "调休上班" : cell.dayType === "workday" ? "工作日" : cell.dayType === "holiday" ? "节假日" : "休息日"}</span>{(cell.source?.firstWorkday || dayOfWeek(cell.date) === 1 && cell.dayType === "workday") && <small>首个工作日</small>}{cell.source?.templateId && <small>模板维护</small>}</OkrButton>)}</div>
    </div>
    {templateEditor && <CalendarTemplateEditor item={templateEditor.id ? templateEditor : null} onClose={() => setTemplateEditor(null)} onNotice={onNotice} onSaved={() => {
      setTemplateEditor(null);
      setRefreshKey(value => value + 1);
    }} />}
    {manualEditor && <ManualCalendarEditor item={manualEditor.id ? manualEditor : null} onClose={() => setManualEditor(null)} onNotice={onNotice} onSaved={saved => {
      setManualEditor(null);
      setSelectedManualCalendarId(String(saved.id));
      setMode("manual");
      setRefreshKey(value => value + 1);
    }} />}
    {dayEditor && <CalendarDayEditor cell={dayEditor} templates={templates} onClose={() => setDayEditor(null)} onNotice={onNotice} onSaved={() => {
      setDayEditor(null);
      setRefreshKey(value => value + 1);
    }} />}
  </section>;
}
function HistoryPage({
  themes,
  onNotice
}) {
  const [dateFrom, setDateFrom] = useLibraryState("sop-history:from", "");
  const [dateTo, setDateTo] = useLibraryState("sop-history:to", "");
  const [sort, setSort] = useLibraryState("sop-history:sort", "date:desc");
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [themeId, setThemeId] = useLibraryState("sop-history:themeId", "");
  const [status, setStatus] = useLibraryState("sop-history:status", "all");
  const [query, setQuery] = useLibraryState("sop-history:query", "");
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({
      limit: "50",
      offset: String(offset),
      sort
    });
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (themeId) params.set("themeId", themeId);
    if (status !== "all") params.set("status", status);
    if (query) params.set("q", query);
    api(`/api/sop/executions?${params}`).then(result => {
      if (active) {
        setItems(result.data);
        setTotal(result.total);
      }
    }).catch(error => onNotice(error.message));
    return () => {
      active = false;
    };
  }, [dateFrom, dateTo, themeId, status, query, offset, sort, onNotice]);
  useEffect(() => setOffset(0), [themeId, status, query, dateFrom, dateTo, sort]);
  const table = useLocalTablePreferences("life-task-table:sop-history", historyColumns);
  const cell = (item, key) => {
    if (key === "date") return <span>{item.scheduledDate}</span>;
    if (key === "title") return <span className="sop-title-cell"><b>{item.title}</b><small>系统 #{item.id}</small></span>;
    if (key === "theme") return <span><ThemeChip name={item.themeName} color={item.themeColor} /></span>;
    if (key === "status") return <span><SopStatus status={item.status} /></span>;
    if (key === "completedAt") return <span>{formatDateTime(item.completedAt || item.discardedAt || item.updatedAt)}</span>;
    return <span>{item.sourceRecordId || "服务器新建"}</span>;
  };
  return <section className="sop-page-band"><div className="sop-toolbar library-filters"><label className="sop-search"><Search size={15} /><OkrInput value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索历史记录" /></label><SearchableThemeSelect themes={themes} value={themeId} onChange={setThemeId} /><OkrSelect value={status} onChange={event => setStatus(event.target.value)}><option value="all">全部状态</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</OkrSelect><LibraryDateRange label="计划日期" from={dateFrom} to={dateTo} onFrom={setDateFrom} onTo={setDateTo} /><OkrButton type="button" onClick={() => {
        setQuery("");
        setThemeId("");
        setStatus("all");
        setDateFrom("");
        setDateTo("");
      }}>重置筛选</OkrButton><TableFieldControl columns={historyColumns} table={table} /></div><LibraryScroll className="sop-table-wrap" label="SOP 数据列表"><div className="wx-library-grid sop-table sop-history-table" style={{
        minWidth: table.tableWidth,
        width: "100%"
      }}><div className="sop-table-head wx-library-head" style={{
          gridTemplateColumns: table.visibleColumns.map(c => `minmax(${table.settings.columnWidths[c.key]}px, ${table.settings.columnWidths[c.key]}fr)`).join(" ")
        }}>{table.visibleColumns.map(column => <span className="configurable-column-head" key={column.key} role="columnheader" aria-sort={libraryAriaSort(sort, column.key)}><LibrarySortButton field={column.key} label={column.label} sort={sort} onSort={setSort} /><i onPointerDown={event => table.startResize(column.key, event)} /></span>)}</div>{items.map(item => <div className="sop-table-row wx-library-row" key={item.id} style={{
          gridTemplateColumns: table.visibleColumns.map(c => `minmax(${table.settings.columnWidths[c.key]}px, ${table.settings.columnWidths[c.key]}fr)`).join(" ")
        }}>{table.visibleColumns.map(column => <React.Fragment key={column.key}>{cell(item, column.key)}</React.Fragment>)}</div>)}</div></LibraryScroll><Pager offset={offset} total={total} onChange={setOffset} /></section>;
}
function StatsPage({
  themes,
  onNotice
}) {
  const [themeId, setThemeId] = useState("");
  const [data, setData] = useState(null);
  useEffect(() => {
    api(`/api/sop/stats${themeId ? `?themeId=${themeId}` : ""}`).then(setData).catch(error => onNotice(error.message));
  }, [themeId, onNotice]);
  if (!data) return <EmptyState loading />;
  const chartData = {
    labels: data.daily.map(row => row.date.slice(5)),
    datasets: [{
      label: "创建",
      data: data.daily.map(row => Number(row.created || 0)),
      backgroundColor: "#3976e8",
      borderRadius: 4,
      maxBarThickness: 18
    }, {
      label: "完成",
      data: data.daily.map(row => Number(row.completed || 0)),
      backgroundColor: "#22a06b",
      borderRadius: 4,
      maxBarThickness: 18
    }]
  };
  return <section className="sop-page-band"><div className="sop-toolbar"><div className="sop-section-title"><Activity size={17} /><b>SOP 运行概览</b></div><SearchableThemeSelect themes={themes} value={themeId} onChange={setThemeId} /></div><div className="sop-metrics"><article><span>历史执行</span><strong><AnimatedKpi value={data.summary.total} /></strong></article><article><span>历史完成</span><strong><AnimatedKpi value={data.summary.completed} /></strong></article><article><span>待处理</span><strong><AnimatedKpi value={data.summary.pending} /></strong></article><article><span>已废弃</span><strong><AnimatedKpi value={data.summary.discarded} /></strong></article></div><div className="sop-chart-grid"><section><header><b>近 30 日执行</b><span><i className="created" />创建 <i className="completed" />完成</span></header><OkrActivityChart label="SOP 近 30 日创建与完成" type="bar" height={250} series={[{
          name: "创建",
          points: data.daily.map(row => ({
            date: row.date,
            value: Number(row.created || 0)
          }))
        }, {
          name: "完成",
          points: data.daily.map(row => ({
            date: row.date,
            value: Number(row.completed || 0)
          }))
        }]} /></section><section><header><b>主题执行量</b></header><div className="sop-ranking">{data.themes.map((theme, index) => <article key={theme.id}><b>{String(index + 1).padStart(2, "0")}</b><ThemeChip name={theme.name} color={theme.color} /><span>{theme.completed} / {theme.total}</span></article>)}</div></section></div></section>;
}
function LogsPage({
  onNotice
}) {
  const [sort, setSort] = useLibraryState("sop-logs:sort", "time:desc");
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useLibraryState("sop-logs:query", "");
  const [type, setType] = useLibraryState("sop-logs:type", "");
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({
      limit: "50",
      offset: String(offset),
      sort
    });
    if (query) params.set("q", query);
    if (type) params.set("type", type);
    api(`/api/sop/logs?${params}`).then(result => {
      if (active) {
        setItems(result.data);
        setTotal(result.total);
      }
    }).catch(error => onNotice(error.message));
    return () => {
      active = false;
    };
  }, [query, type, offset, sort, onNotice]);
  useEffect(() => setOffset(0), [query, type, sort]);
  const table = useLocalTablePreferences("life-task-table:sop-runtime-logs", runtimeLogColumns);
  const cell = (item, key) => {
    if (key === "time") return <span>{formatDateTime(item.occurredAt)}</span>;
    if (key === "type") return <span>{runtimeTypeLabels[item.logType] || item.logType || "系统事件"}</span>;
    if (key === "theme") return <span>{item.themeName || "-"}</span>;
    if (key === "event") return <span>{item.eventName || "-"}</span>;
    if (key === "message") return <span className="sop-title-cell"><b>{item.message}</b></span>;
    return <span>{item.sourceRecordId || "服务器"}</span>;
  };
  return <section className="sop-page-band"><div className="sop-toolbar library-filters"><label className="sop-search"><Search size={15} /><OkrInput value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索运行日志" /></label><OkrSelect value={type} onChange={event => setType(event.target.value)}><option value="">全部类型</option>{Object.entries(runtimeTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</OkrSelect><OkrButton type="button" onClick={() => {
        setQuery("");
        setType("");
      }}>重置筛选</OkrButton><TableFieldControl columns={runtimeLogColumns} table={table} /></div><LibraryScroll className="sop-table-wrap" label="SOP 数据列表"><div className="wx-library-grid sop-table sop-log-table" style={{
        minWidth: table.tableWidth,
        width: "100%"
      }}><div className="sop-table-head wx-library-head" style={{
          gridTemplateColumns: table.visibleColumns.map(c => `minmax(${table.settings.columnWidths[c.key]}px, ${table.settings.columnWidths[c.key]}fr)`).join(" ")
        }}>{table.visibleColumns.map(column => <span className="configurable-column-head" key={column.key} role="columnheader" aria-sort={libraryAriaSort(sort, column.key)}><LibrarySortButton field={column.key} label={column.label} sort={sort} onSort={setSort} /><i onPointerDown={event => table.startResize(column.key, event)} /></span>)}</div>{items.map(item => <div className={`sop-table-row wx-library-row ${item.level}`} key={item.id} style={{
          gridTemplateColumns: table.visibleColumns.map(c => `minmax(${table.settings.columnWidths[c.key]}px, ${table.settings.columnWidths[c.key]}fr)`).join(" ")
        }}>{table.visibleColumns.map(column => <React.Fragment key={column.key}>{cell(item, column.key)}</React.Fragment>)}</div>)}</div></LibraryScroll><Pager offset={offset} total={total} onChange={setOffset} /></section>;
}
function SettingsPage({
  meta,
  onNotice,
  refreshMeta
}) {
  const [settings, setSettings] = useState(meta?.settings || {});
  const [running, setRunning] = useState(false);
  useEffect(() => setSettings(meta?.settings || {}), [meta]);
  const update = async patch => {
    const next = await api("/api/sop/settings", {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
    setSettings(next);
    refreshMeta();
    onNotice("SOP 设置已保存");
  };
  return <section className="sop-settings-page"><div className="sop-settings-section"><header><div><b>自动调度</b><span>Asia/Shanghai</span></div><label className="sop-toggle"><OkrInput type="checkbox" checked={settings.scheduler_enabled === "1"} onChange={event => update({
            scheduler_enabled: event.target.checked ? "1" : "0"
          })} /><i /></label></header><div className="sop-settings-grid"><label><span>每日生成时间</span><OkrInput type="time" value={settings.generation_time || "04:00"} onChange={event => setSettings(current => ({
            ...current,
            generation_time: event.target.value
          }))} onBlur={event => update({
            generation_time: event.target.value
          })} /></label><label><span>凌晨维护时间</span><OkrInput type="time" value={settings.maintenance_time || "00:05"} onChange={event => setSettings(current => ({
            ...current,
            maintenance_time: event.target.value
          }))} onBlur={event => update({
            maintenance_time: event.target.value
          })} /></label><label><span>调度最后心跳</span><b>{formatDateTime(settings.scheduler_last_seen_at)}</b></label><label><span>最近生成日期</span><b>{settings.last_generation_date || "尚未运行"}</b></label></div><OkrButton className="primary-button" disabled={running} onClick={async () => {
        setRunning(true);
        try {
          const result = await api("/api/sop/scheduler/run", {
            method: "POST",
            body: JSON.stringify({
              date: todayString(),
              maintenance: true
            })
          });
          onNotice(`调度完成，新建 ${result.generation.executionsCreated} 条事项`);
          refreshMeta();
        } catch (error) {
          onNotice(error.message);
        } finally {
          setRunning(false);
        }
      }}>{running ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}立即运行今日调度</OkrButton></div></section>;
}
function dayOfWeek(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}
export function SopPage({
  activeTab = "today",
  onOpenSettings,
  onTabChange = () => {},
  onNotice
}) {
  const [meta, setMeta] = useState(null);
  const [themes, setThemes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey(value => value + 1), []);
  useEffect(() => {
    setLoading(true);
    Promise.all([api("/api/sop/meta"), api("/api/sop/themes")]).then(([nextMeta, nextThemes]) => {
      setMeta(nextMeta);
      setThemes(nextThemes.data);
    }).catch(error => onNotice(error.message)).finally(() => setLoading(false));
  }, [refreshKey, onNotice]);
  if (loading && !meta) return <EmptyState loading />;
  return <div className="sop-workspace" data-library-tab={activeTab}><nav className="sop-tabs">{tabs.map(([id, label, Icon]) => <OkrButton className={activeTab === id ? "active" : ""} key={id} onClick={() => {
        onTabChange(id);
        trackAnalyticsEvent({
          module: "sop",
          eventName: "sop.tab_open",
          metadata: {
            tab: id
          }
        });
      }}><Icon size={15} /><span>{label}</span>{id === "today" && Number(meta?.pendingSummary?.total || 0) > 0 && <em>{meta.pendingSummary.total}</em>}</OkrButton>)}<OkrButton className="sop-settings-link" onClick={onOpenSettings}><Settings size={15} /><span>SOP 设置</span></OkrButton></nav><div className="sop-content">{activeTab === "today" ? <TodayPage themes={themes} meta={meta} onNotice={onNotice} refreshMeta={reload} /> : activeTab === "future" ? <FuturePage onNotice={onNotice} /> : activeTab === "configs" ? <ConfigPage themes={themes} onReload={reload} onNotice={onNotice} /> : activeTab === "calendar" ? <CalendarPage onNotice={onNotice} /> : activeTab === "history" ? <HistoryPage themes={themes} onNotice={onNotice} /> : activeTab === "stats" ? <StatsPage themes={themes} onNotice={onNotice} /> : activeTab === "logs" ? <LogsPage onNotice={onNotice} /> : <TodayPage themes={themes} meta={meta} onNotice={onNotice} refreshMeta={reload} />}</div></div>;
}
