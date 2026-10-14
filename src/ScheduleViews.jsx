import { OkrButton } from "./okr-ui.jsx";
import React, { useCallback, useEffect, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import classicThemePlugin from "@fullcalendar/react/themes/classic";
import Gantt from "frappe-gantt";
import { CalendarDays, LoaderCircle } from "lucide-react";
import { api } from "./api.js";
export const dateFieldOptions = [["startAt", "开始日期"], ["dueAt", "截止日期"], ["createdAt", "创建时间"], ["updatedAt", "更新时间"], ["completedAt", "完成时间"]];
const editableDateFields = new Set(["startAt", "dueAt"]);
function dateOnly(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString("sv-SE", {
    timeZone: "Asia/Shanghai"
  });
}
function addDays(value, days) {
  const date = new Date(`${value}T12:00:00+08:00`);
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString("sv-SE", {
    timeZone: "Asia/Shanghai"
  });
}
async function loadSchedule({
  listId,
  startField,
  endField,
  from,
  to,
  limit = 2000
}) {
  const params = new URLSearchParams({
    listId: String(listId),
    startField,
    endField,
    limit: String(limit)
  });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return api(`/api/task-schedule?${params}`);
}
export function CalendarView({
  dateField,
  listId,
  onChanged,
  onOpenTask
}) {
  const editable = editableDateFields.has(dateField);
  const events = useCallback(async (info, success, failure) => {
    try {
      const result = await loadSchedule({
        listId,
        startField: dateField,
        endField: dateField,
        from: info.startStr,
        to: info.endStr
      });
      success(result.data.map(task => ({
        id: String(task.id),
        title: task.title,
        start: dateOnly(task[dateField]),
        allDay: true,
        backgroundColor: task.listColor,
        borderColor: task.listColor,
        editable,
        extendedProps: {
          task
        }
      })));
    } catch (error) {
      failure(error);
    }
  }, [dateField, editable, listId]);
  return <div className="calendar-view">
      <FullCalendar dayMaxEvents={4} editable={editable} eventClick={info => onOpenTask(info.event.extendedProps.task)} eventDrop={async info => {
      try {
        await api(`/api/tasks/${info.event.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            [dateField]: info.event.startStr.slice(0, 10)
          })
        });
        onChanged();
      } catch {
        info.revert();
      }
    }} events={events} firstDay={1} fixedWeekCount={false} headerToolbar={{
      left: "prev,next today",
      center: "title",
      right: ""
    }} height="auto" initialView="dayGridMonth" locale="zh-cn" plugins={[dayGridPlugin, interactionPlugin, classicThemePlugin]} />
    </div>;
}
export function GanttView({
  endField,
  listId,
  onChanged,
  onOpenTask,
  startField
}) {
  const hostRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [mode, setMode] = useState("Week");
  useEffect(() => {
    let active = true;
    const today = dateOnly(new Date());
    setLoading(true);
    loadSchedule({
      listId,
      startField,
      endField,
      from: addDays(today, -180),
      to: addDays(today, 366),
      limit: 400
    }).then(result => {
      if (!active) return;
      const todayTime = new Date(`${today}T12:00:00+08:00`).getTime();
      const byDistance = [...result.data].sort((left, right) => {
        const leftDate = dateOnly(left[startField] || left[endField]);
        const rightDate = dateOnly(right[startField] || right[endField]);
        const leftDistance = Math.abs(new Date(`${leftDate}T12:00:00+08:00`).getTime() - todayTime);
        const rightDistance = Math.abs(new Date(`${rightDate}T12:00:00+08:00`).getTime() - todayTime);
        return leftDistance - rightDistance;
      });
      setTasks(byDistance);
    }).finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [endField, listId, startField]);
  useEffect(() => {
    if (!hostRef.current || loading) return;
    hostRef.current.innerHTML = "";
    const source = new Map(tasks.map(task => [String(task.id), task]));
    const ganttTasks = tasks.map(task => {
      const rawStart = dateOnly(task[startField]);
      const rawEnd = dateOnly(task[endField]);
      if (!rawStart && !rawEnd) return null;
      const start = rawStart || addDays(rawEnd, -1);
      const end = rawEnd || addDays(rawStart, 1);
      return {
        id: String(task.id),
        name: task.title,
        start,
        end: end < start ? start : end,
        progress: task.status === "已完成" ? 100 : task.status === "进行中" ? 45 : 0,
        custom_class: task.status === "已完成" ? "gantt-complete" : ""
      };
    }).filter(Boolean);
    if (ganttTasks.length === 0) return;
    const chart = new Gantt(hostRef.current, ganttTasks, {
      view_mode: mode,
      date_format: "YYYY-MM-DD",
      language: "zh",
      readonly_progress: true,
      scroll_to: "today",
      on_click: task => onOpenTask(source.get(String(task.id))),
      on_date_change: async (task, start, end) => {
        const patch = {};
        if (editableDateFields.has(startField)) patch[startField] = dateOnly(start);
        if (editableDateFields.has(endField)) patch[endField] = dateOnly(end);
        if (Object.keys(patch).length === 0) return;
        await api(`/api/tasks/${task.id}`, {
          method: "PATCH",
          body: JSON.stringify(patch)
        });
        onChanged();
      }
    });
    return () => {
      chart?.clear?.();
      if (hostRef.current) hostRef.current.innerHTML = "";
    };
  }, [endField, loading, mode, onChanged, onOpenTask, startField, tasks]);
  return <div className="gantt-view">
      <div className="gantt-toolbar">
        <div className="segmented compact">
          {["Day", "Week", "Month"].map(item => <OkrButton className={mode === item ? "active" : ""} key={item} onClick={() => setMode(item)}>{item === "Day" ? "日" : item === "Week" ? "周" : "月"}</OkrButton>)}
        </div>
        <span>{tasks.length.toLocaleString()} 条带日期任务</span>
      </div>
      {loading ? <div className="table-state"><LoaderCircle className="spin" size={20} />正在生成甘特图</div> : tasks.length === 0 ? <div className="table-state empty"><CalendarDays size={20} />当前日期字段没有任务</div> : <div className="gantt-scroll"><div ref={hostRef} /></div>}
    </div>;
}
