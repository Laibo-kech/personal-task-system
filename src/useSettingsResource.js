import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { createSettingsQueue, validateSettingsPatch } from './settings-state.js';
export function useSettingsResource(endpoint, {
  initial,
  kind,
  onNotice,
  onSaved,
  selectResponse,
  writeEndpoint = endpoint,
  completePayload = false
} = {}) {
  const [state, setState] = useState(initial || null);
  const [loading, setLoading] = useState(!initial);
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const active = useRef(false);
  const revision = useRef(0);
  const callbacks = useRef({
    onNotice,
    onSaved,
    selectResponse
  });
  callbacks.current = {
    onNotice,
    onSaved,
    selectResponse
  };
  const queue = useMemo(() => createSettingsQueue({
    initial,
    write: async (patch, confirmed) => {
      const result = await api(writeEndpoint, {
        method: 'PATCH',
        body: JSON.stringify(completePayload ? {
          ...confirmed,
          ...patch
        } : patch)
      });
      return result?.ok === true ? {
        ...confirmed,
        ...patch
      } : result;
    },
    onChange: (value, count) => {
      if (active.current) {
        setState(value);
        setSaving(count);
      }
    }
  }), [endpoint, writeEndpoint, completePayload]);
  const reload = useCallback(async () => {
    const requestedRevision = revision.current;
    setLoading(true);
    setError('');
    try {
      const result = await api(endpoint);
      if (active.current && requestedRevision === revision.current) queue.replace(callbacks.current.selectResponse?.(result) || result);
    } catch (err) {
      if (active.current) setError(err.message || '读取失败，请重试');
    } finally {
      if (active.current) setLoading(false);
    }
  }, [endpoint, queue]);
  useEffect(() => {
    active.current = true;
    reload();
    return () => {
      active.current = false;
    };
  }, [reload]);
  const save = useCallback(async patch => {
    const validation = validateSettingsPatch(kind, patch, queue.value());
    if (validation) {
      setSaveError(validation);
      callbacks.current.onNotice?.(validation);
      return false;
    }
    if (Object.entries(patch).every(([key, value]) => Object.is(queue.value()[key], value))) return true;
    revision.current += 1;
    setSaveError('');
    try {
      const result = await queue.save(patch);
      if (active.current) {
        setSaveError('');
        callbacks.current.onNotice?.('设置已保存');
      }
      try {
        await callbacks.current.onSaved?.(result);
      } catch {
        if (active.current) setSaveError('设置已保存，刷新失败，请重新打开页面');
      }
      return true;
    } catch (err) {
      if (active.current) {
        setSaveError(err.message || '保存失败');
        callbacks.current.onNotice?.(err.message || '保存失败');
      }
      return false;
    }
  }, [kind, queue]);
  return {
    state,
    loading,
    saving: saving > 0,
    error,
    saveError,
    save,
    reload
  };
}
