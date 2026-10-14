import { OkrSelect } from "./okr-ui.jsx";
import { OkrButton, OkrInput } from "./okr-ui.jsx";
import React, { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Columns3, FileClock, LoaderCircle, Search } from "lucide-react";
import { api } from "./api.js";
import { useLocalTablePreferences } from "./useLocalTablePreferences.js";
import { FieldVisibilityMenu, ResourceState, TablePager } from "./WorkspaceControls.jsx";
const pageSize = 50;
const logColumns = [{
  key: "list",
  label: "所属清单",
  width: 125
}, {
  key: "taskId",
  label: "任务 ID",
  width: 130
}, {
  key: "title",
  label: "任务内容",
  width: 280
}, {
  key: "status",
  label: "完成状态",
  width: 105
}, {
  key: "change",
  label: "变动内容",
  width: 250
}, {
  key: "time",
  label: "日志时间",
  width: 170
}];
function formatDateTime(value) {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}
export function LogPage({
  lists,
  onOpenTask
}) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({
    listId: "",
    status: "",
    eventType: "",
    from: "",
    to: ""
  });
  const params = useMemo(() => {
    const value = new URLSearchParams({
      limit: String(pageSize),
      offset: String(page * pageSize)
    });
    if (query.trim()) value.set("q", query.trim());
    for (const [key, item] of Object.entries(filters)) {
      if (item) value.set(key, item);
    }
    return value;
  }, [filters, page, query]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api(`/api/logs?${params}`, {
      signal: controller.signal
    }).then(setResult).catch(error => {
      if (error.name !== "AbortError") {
        setError(error.message || "日志读取失败");
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [params, refreshKey]);
  const updateFilter = (key, value) => {
    setPage(0);
    setFilters(current => ({
      ...current,
      [key]: value
    }));
  };
  const pageCount = Math.max(Math.ceil((result?.total || 0) / pageSize), 1);
  const table = useLocalTablePreferences("life-task-table:task-logs", logColumns);
  const renderCell = (log, key) => {
    if (key === "list") return <span><i className="list-dot" />{log.listName}</span>;
    if (key === "taskId") return <span className="identity-cell"><code>{log.taskNo || "无编号"}</code>{log.databaseTaskId && <small>DB #{log.databaseTaskId}</small>}</span>;
    if (key === "title") return <span className="log-title"><b>{log.title}</b><small>{log.source}</small></span>;
    if (key === "status") return <span><em className={`status-text status-${log.taskStatus}`}>{log.taskStatus}</em></span>;
    if (key === "change") return <span className="change-cell"><b>{log.eventType}</b><small>{log.oldValue && `${log.oldValue} → `}{log.newValue || log.message || "已记录"}</small></span>;
    if (key === "time") return <time>{formatDateTime(log.occurredAt)}</time>;
    return <span>-</span>;
  };
  return <section className="log-page">
      <div className="log-summary">
        <span>全部日志 <b>{Number(result?.summary?.total || 0).toLocaleString()}</b></span>
        <span>今日 <b>{Number(result?.summary?.today || 0).toLocaleString()}</b></span>
        <span>任务新建 <b>{Number(result?.summary?.created || 0).toLocaleString()}</b></span>
        <span>状态变化 <b>{Number(result?.summary?.statusChanged || 0).toLocaleString()}</b></span>
        <span>涉及任务 <b>{Number(result?.summary?.affectedTasks || 0).toLocaleString()}</b></span>
      </div>

      <div className="log-filters">
        <label className="search-field">
          <Search size={16} />
          <OkrInput aria-label="搜索日志" onChange={event => {
          setPage(0);
          setQuery(event.target.value);
        }} placeholder="搜索任务 ID、内容或变动类型" value={query} />
        </label>
        <OkrSelect aria-label="所属清单" onChange={event => updateFilter("listId", event.target.value)} value={filters.listId}>
          <option value="">全部清单</option>
          {lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}
        </OkrSelect>
        <OkrSelect aria-label="完成状态" onChange={event => updateFilter("status", event.target.value)} value={filters.status}>
          <option value="">全部状态</option>
          {['未完成', '进行中', '已完成', '已废弃', '暂搁置'].map(status => <option key={status}>{status}</option>)}
        </OkrSelect>
        <OkrSelect aria-label="日志类型" onChange={event => updateFilter("eventType", event.target.value)} value={filters.eventType}>
          <option value="">全部变动</option>
          {(result?.eventTypes || []).map(item => <option key={item.eventType} value={item.eventType}>
              {item.eventType} ({item.count})
            </option>)}
        </OkrSelect>
        <OkrInput aria-label="日志开始日期" onChange={event => updateFilter("from", event.target.value)} type="date" value={filters.from} />
        <OkrInput aria-label="日志结束日期" onChange={event => updateFilter("to", event.target.value)} type="date" value={filters.to} />
        <FieldVisibilityMenu columns={logColumns} visibleKeys={table.visibleColumns.map(column => column.key)} onToggle={table.toggleColumn} />
        <div className="log-filter-spacer" />
        <div className="log-pagination inline">
          <span>{page + 1} / {pageCount}</span>
          <div>
            <OkrButton disabled={page === 0} onClick={() => setPage(value => value - 1)} title="上一页">
              <ChevronLeft size={16} />
            </OkrButton>
            <OkrButton disabled={page + 1 >= pageCount} onClick={() => setPage(value => value + 1)} title="下一页">
              <ChevronRight size={16} />
            </OkrButton>
          </div>
        </div>
      </div>

      <div className="log-table-wrap">
        <div className="log-table configurable-table" role="table" style={{
        minWidth: table.tableWidth,
        width: table.tableWidth
      }}>
          <div className="log-table-head" role="row" style={{
          gridTemplateColumns: table.gridTemplateColumns
        }}>
            {table.visibleColumns.map(column => <span className="configurable-column-head" key={column.key}>{column.label}<i onPointerDown={event => table.startResize(column.key, event)} /></span>)}
          </div>
          {error ? <ResourceState error={error} onRetry={() => setRefreshKey(value => value + 1)} /> : loading && !result ? <div className="table-state"><LoaderCircle className="spin" size={20} />正在读取日志</div> : (result?.data || []).length === 0 ? <div className="table-state empty"><FileClock size={20} />当前条件下没有日志</div> : <div className="log-table-body">
              {result.data.map(log => <OkrButton className="log-row" disabled={!log.databaseTaskId} key={log.id} onClick={() => log.databaseTaskId && onOpenTask(log.databaseTaskId)} role="row" style={{
            gridTemplateColumns: table.gridTemplateColumns
          }}>
                  {table.visibleColumns.map(column => <React.Fragment key={column.key}>{renderCell(log, column.key)}</React.Fragment>)}
                </OkrButton>)}
            </div>}
        </div>
      </div>

      <TablePager offset={page * pageSize} total={result?.total || 0} limit={pageSize} loading={loading} onChange={offset => setPage(Math.floor(offset / pageSize))} />
    </section>;
}
