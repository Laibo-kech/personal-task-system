import React, { useEffect, useState } from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { OkrInput } from './okr-ui.jsx';
import './library-surface.css';
export function LibraryScroll({
  children,
  className = '',
  label = '数据列表',
  ...props
}) {
  return <div {...props} className={`wx-library-scroll ${className}`} role="region" aria-label={label} tabIndex={0}>{children}</div>;
}
export function useLibraryState(key, initial) {
  const storageKey = `life-library:v1:${key}`;
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const saved = raw === null ? initial : JSON.parse(raw);
      if (initial === null) return saved === null || Number.isSafeInteger(saved) ? saved : initial;
      if (typeof saved !== typeof initial || saved === null || Array.isArray(saved)) return initial;
      return typeof initial === "object" ? {
        ...initial,
        ...saved
      } : saved;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {}
  }, [storageKey, value]);
  return [value, setValue];
}
const legacySorts = {
  created: 'createdAt:desc',
  updated: 'updatedAt:desc',
  due: 'dueAt:asc',
  number: 'databaseId:desc',
  dateDesc: 'date:desc',
  dateAsc: 'date:asc'
};
export function libraryAriaSort(sort, field) {
  const [key, direction] = (legacySorts[sort] || sort || '').split(':');
  return key === field && ['asc', 'desc'].includes(direction) ? direction === 'asc' ? 'ascending' : 'descending' : 'none';
}
export function LibrarySortButton({
  field,
  label,
  sort,
  onSort,
  disabled = false
}) {
  const direction = libraryAriaSort(sort, field);
  const Icon = direction === 'ascending' ? ArrowUp : direction === 'descending' ? ArrowDown : ArrowUpDown;
  return <button type="button" className="library-sort" aria-label={`按${label}排序`} disabled={disabled} onClick={() => onSort(`${field}:${direction === 'ascending' ? 'desc' : 'asc'}`)}>
    <span>{label}</span><Icon size={13} />
  </button>;
}
export function LibraryDateRange({
  label = '截止日期',
  from,
  to,
  onFrom,
  onTo
}) {
  return <div className="library-date-filter"><span>{label}</span>
    <OkrInput aria-label={`${label}起始`} type="date" value={from} max={to || undefined} onChange={e => onFrom(e.target.value)} />
    <span>至</span><OkrInput aria-label={`${label}结束`} type="date" value={to} min={from || undefined} onChange={e => onTo(e.target.value)} />
  </div>;
}
