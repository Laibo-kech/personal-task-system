import { useEffect, useMemo, useRef, useState } from "react";
import { previewStorageKey } from "./okr-preview.js";
import { normalizeTablePreferences as normalize } from "./table-preferences.js";
export function useLocalTablePreferences(storageKey, columns) {
  storageKey = previewStorageKey(storageKey);
  const read = () => {
    try {
      return normalize(columns, JSON.parse(window.localStorage.getItem(storageKey) || "{}"));
    } catch {
      return normalize(columns);
    }
  };
  const [stored, setStored] = useState(() => ({
    key: storageKey,
    settings: read()
  }));
  const settings = stored.key === storageKey ? stored.settings : read();
  const setSettings = update => setStored(current => ({
    key: storageKey,
    settings: normalize(columns, update(current.key === storageKey ? current.settings : read()))
  }));
  const resizeRef = useRef(null);
  useEffect(() => {
    if (stored.key !== storageKey) {
      setStored({
        key: storageKey,
        settings: read()
      });
      return;
    }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(stored.settings));
    } catch {}
  }, [stored, storageKey]);
  useEffect(() => {
    const sync = event => {
      if (event.key === storageKey || event.key === null) setStored({
        key: storageKey,
        settings: read()
      });
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [storageKey, columns]);
  useEffect(() => {
    const move = event => {
      if (!resizeRef.current) return;
      const {
        key,
        startX,
        startWidth
      } = resizeRef.current;
      setSettings(current => ({
        ...current,
        columnWidths: {
          ...current.columnWidths,
          [key]: Math.max(56, Math.min(startWidth + event.clientX - startX, 800))
        }
      }));
    };
    const stop = () => {
      resizeRef.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [storageKey, columns]);
  const visibleColumns = useMemo(() => columns.filter(column => settings.visibleColumns.includes(column.key)), [columns, settings.visibleColumns]);
  const gridTemplateColumns = visibleColumns.map(column => `${settings.columnWidths[column.key]}px`).join(" ");
  const tableWidth = visibleColumns.reduce((total, column) => total + settings.columnWidths[column.key], 0);
  return {
    settings,
    visibleColumns,
    gridTemplateColumns,
    tableWidth,
    toggleColumn(key) {
      if (!columns.some(column => column.key === key) || columns.find(column => column.key === key)?.required) return;
      setSettings(current => {
        const visible = current.visibleColumns.includes(key) ? current.visibleColumns.filter(item => item !== key) : [...current.visibleColumns, key];
        return visible.length ? {
          ...current,
          visibleColumns: visible
        } : current;
      });
    },
    startResize(key, event) {
      event.preventDefault();
      resizeRef.current = {
        key,
        startX: event.clientX,
        startWidth: settings.columnWidths[key]
      };
    }
  };
}
