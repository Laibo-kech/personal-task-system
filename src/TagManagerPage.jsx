import { OkrSelect } from "./okr-ui.jsx";
import { OkrButton, OkrInput } from "./okr-ui.jsx";
import React, { useCallback, useEffect, useState } from "react";
import { Check, Tag } from "lucide-react";
import { api } from "./api.js";
import { useAppDialog } from "./DialogContext.jsx";
const colors = ["#9c5a43", "#2877d4", "#3c8b62", "#ca8a19", "#77736d", "#8b5cf6", "#db2777", "#0f766e", "#2563eb", "#b45309", "#475569", "#dc2626", "#16a34a", "#7c3aed"];
export function TagManagerPage({
  initialListId,
  meta,
  onNotice,
  onRefresh
}) {
  const dialog = useAppDialog();
  const defaultListId = initialListId || meta.lists[0]?.id || "";
  const [selectedListId, setSelectedListId] = useState(defaultListId);
  const [tags, setTags] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    name: "",
    color: colors[4]
  });
  const loadTags = useCallback(async () => {
    if (!selectedListId) return;
    const result = await api(`/api/tags?listId=${selectedListId}`);
    setTags(result.data);
  }, [selectedListId]);
  useEffect(() => {
    loadTags().catch(error => onNotice(error.message));
  }, [loadTags, onNotice]);
  const reset = () => {
    setEditing(null);
    setForm({
      name: "",
      color: colors[4]
    });
  };
  const save = async () => {
    const body = JSON.stringify({
      listId: Number(selectedListId),
      name: form.name.trim(),
      color: form.color
    });
    if (editing) {
      await api(`/api/tags/${editing.id}`, {
        method: "PATCH",
        body
      });
      onNotice("标签已更新");
    } else {
      await api("/api/tags", {
        method: "POST",
        body
      });
      onNotice("标签已创建");
    }
    reset();
    await loadTags();
    await onRefresh();
  };
  return <section className="management-page">
      <header>
        <div><span>清单标签</span><h2>标签管理</h2></div>
        <label>
          所属清单
          <OkrSelect value={selectedListId} onChange={event => {
          setSelectedListId(Number(event.target.value));
          reset();
        }}>
            {meta.lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}
          </OkrSelect>
        </label>
      </header>
      <div className="management-grid">
        <section className="management-editor">
          <h3>{editing ? "编辑标签" : "新建标签"}</h3>
          <label>
            标签名称
            <OkrInput value={form.name} onChange={event => setForm({
            ...form,
            name: event.target.value
          })} placeholder="例如：等待回复、服务器、家庭" />
          </label>
          <fieldset className="color-picker expanded">
            <legend>标签颜色</legend>
            {colors.map(color => <label key={color} title={color}>
                <OkrInput checked={form.color === color} name="tag-color" onChange={() => setForm({
              ...form,
              color
            })} type="radio" />
                <i style={{
              background: color
            }}>{form.color === color && <Check size={13} />}</i>
              </label>)}
          </fieldset>
          <footer>
            <OkrButton onClick={reset}>清空</OkrButton>
            <OkrButton className="primary-button" disabled={!form.name.trim()} onClick={save}>{editing ? "保存标签" : "创建标签"}</OkrButton>
          </footer>
        </section>
        <section className="management-list tag-management-list">
          {tags.map(item => <article key={item.id}>
              <i style={{
            background: item.color
          }} />
              <strong>{item.name}</strong>
              <span>{Number(item.taskCount || 0).toLocaleString()} 个任务</span>
              <OkrButton onClick={() => {
            setEditing(item);
            setForm({
              name: item.name,
              color: item.color
            });
          }}>编辑</OkrButton>
              <OkrButton className="danger-text" onClick={async () => {
            const confirmed = await dialog.confirm({
              title: "删除标签",
              message: `确认删除标签“${item.name}”？任务会保留，只移除这个标签。`,
              confirmLabel: "删除标签",
              danger: true
            });
            if (!confirmed) return;
            await api(`/api/tags/${item.id}`, {
              method: "DELETE"
            });
            await loadTags();
            await onRefresh();
            onNotice("标签已删除");
          }}>删除</OkrButton>
            </article>)}
          {tags.length === 0 && <div className="table-state empty"><Tag size={18} />当前清单还没有标签</div>}
        </section>
      </div>
    </section>;
}
