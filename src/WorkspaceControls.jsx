import React, { useEffect, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { AlertCircle, ChevronLeft, ChevronRight, Columns3, LoaderCircle, RefreshCw, Search } from 'lucide-react';
import { OkrButton, OkrInput } from './okr-ui.jsx';
export function ResourceState({
  loading,
  error,
  onRetry,
  children
}) {
  if (!loading && !error) return children;
  return <div className="workspace-resource-state" role={error ? 'alert' : 'status'}>
    {error ? <AlertCircle size={20} /> : <LoaderCircle className="spin" size={20} />}
    <span>{error || '正在读取'}</span>
    {error && onRetry && <OkrButton type="button" onClick={onRetry}><RefreshCw size={15} />重试</OkrButton>}
  </div>;
}
export function SettingsFeedback({
  saving,
  error
}) {
  return <div className={`workspace-save-state ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>
    {saving ? <><LoaderCircle className="spin" size={14} />正在保存</> : error ? <><AlertCircle size={14} />{error}</> : null}
  </div>;
}
export function SettingTimeInput({
  value,
  onCommit,
  ...props
}) {
  const [draft, setDraft] = useState(value || '');
  const cancelled = React.useRef(false);
  useEffect(() => setDraft(value || ''), [value]);
  return <OkrInput {...props} type="time" value={draft} onChange={event => setDraft(event.target.value)} onBlur={async () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (draft !== value && (await onCommit(draft)) === false) setDraft(value || '');
  }} onKeyDown={event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    }
    if (event.key === 'Escape') {
      cancelled.current = true;
      setDraft(value || '');
      event.currentTarget.blur();
    }
  }} />;
}
export function FieldVisibilityMenu({
  columns,
  visibleKeys,
  onToggle,
  label = '字段配置',
  disabled = false
}) {
  const [query, setQuery] = useState('');
  return <Popover.Root onOpenChange={open => !open && setQuery('')}>
    <Popover.Trigger asChild><OkrButton type="button" disabled={disabled} title={label}><Columns3 size={16} /><span>字段</span></OkrButton></Popover.Trigger>
    <Popover.Portal><div className="okr-preview okr-cell-portal"><Popover.Content className="wx-ui workspace-field-menu" align="end" sideOffset={6} collisionPadding={12} aria-label={label}>
      <header><b>{label}</b><span>{visibleKeys.length} / {columns.length}</span></header>
      {columns.length > 7 && <label className="workspace-field-search"><Search size={15} /><OkrInput aria-label="搜索字段" value={query} placeholder="搜索字段" onChange={event => setQuery(event.target.value)} /></label>}
      <div className="workspace-field-options">{columns.filter(column => column.label.includes(query.trim())).map(column => {
              const checked = visibleKeys.includes(column.key);
              return <label key={column.key}><OkrInput type="checkbox" checked={checked} disabled={column.required || checked && visibleKeys.length === 1} onChange={() => onToggle(column.key)} /><span>{column.label}</span></label>;
            })}</div>
    </Popover.Content></div></Popover.Portal>
  </Popover.Root>;
}
export function TablePager({
  offset = 0,
  total = 0,
  limit = 50,
  onChange,
  loading = false,
  className = ''
}) {
  const count = Math.max(0, Number(total) || 0);
  const pages = Math.max(1, Math.ceil(count / limit));
  const page = Math.max(1, Math.floor(offset / limit) + 1);
  return <footer className={`workspace-table-pager ${className}`}>
    <span>共 {count.toLocaleString('zh-CN')} 条</span>
    <div><span>每页 {limit} 条</span><OkrButton type="button" title="上一页" disabled={loading || offset <= 0} onClick={() => onChange(Math.max(0, offset - limit))}><ChevronLeft size={16} /></OkrButton>
      <span aria-live="polite">{page} / {pages}</span><OkrButton type="button" title="下一页" disabled={loading || offset + limit >= count} onClick={() => onChange(offset + limit)}><ChevronRight size={16} /></OkrButton></div>
  </footer>;
}
export function ConfigurableTable({
  table,
  rows,
  renderCell,
  rowClassName = () => '',
  label
}) {
  return <table className="workspace-data-table" aria-label={label} style={{
    width: table.tableWidth,
    minWidth: '100%',
    tableLayout: 'fixed'
  }}>
    <colgroup>{table.visibleColumns.map(column => <col key={column.key} style={{
        width: table.settings.columnWidths[column.key]
      }} />)}</colgroup>
    <thead><tr>{table.visibleColumns.map(column => <th key={column.key} scope="col">{column.label}<span className="workspace-column-resize" role="separator" aria-label={`调整${column.label}宽度`} aria-orientation="vertical" onPointerDown={event => table.startResize(column.key, event)} /></th>)}</tr></thead>
    <tbody>{rows.map(row => <tr key={row.id} className={rowClassName(row)}>{table.visibleColumns.map(column => <td key={column.key}>{renderCell(row, column.key)}</td>)}</tr>)}</tbody>
  </table>;
}
