import { OkrSelect, OkrDialogSurface } from "./okr-ui.jsx";
import { OkrButton, OkrInput, OkrTextarea } from "./okr-ui.jsx";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import listPlugin from "@fullcalendar/react/list";
import interactionPlugin, { Draggable } from "@fullcalendar/react/interaction";
import classicThemePlugin from "@fullcalendar/react/themes/classic";
import zhCnLocale from "@fullcalendar/react/locales/zh-cn";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, ExternalLink, Filter, GripVertical, LayoutList, Link2, ListRestart, LoaderCircle, MapPin, Plus, RefreshCw, Repeat2, Save, Trash2, X } from "lucide-react";
import { api, trackAnalyticsEvent } from "./api.js";
import { defaultCalendarView } from "./calendar-defaults.js";
import { calendarDateKey, miniMonthCells, monthApiRange, nearestUpcoming, nextDaysRange } from "./calendar-utils.js";
import { useAppDialog } from "./DialogContext.jsx";
import { validateSettingsPatch } from "./settings-state.js";
const viewOptions = [["timeGridDay", "日"], ["timeGridWeek", "周"], ["dayGridMonth", "月"], ["listMonth", "议程"]];
const hourOptions = Array.from({
  length: 25
}, (_, hour) => ({
  value: `${String(hour).padStart(2, "0")}:00:00`,
  label: `${hour}时`
}));
const recurrenceOptions = [["", "不重复"], ["daily", "每隔若干天"], ["weekly", "每周指定星期"], ["monthly_day", "每月指定日期"], ["monthly_weekday", "每月第几个星期几"], ["yearly_solar", "每年公历日期"], ["lunar_monthly", "每月农历日期"], ["lunar_yearly", "每年农历日期"], ["yearly_day_type", "每年第几个工作日或休息日"], ["holiday_offset", "节假日前后"], ["custom", "自定义多个日期"]];
const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];
function localDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}
function toLocalInput(value) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return `${value}T09:00`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(item => [item.type, item.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
}
function inputToIso(value) {
  return value ? new Date(`${value}:00+08:00`).toISOString() : null;
}
function addHour(value) {
  return toLocalInput(new Date(new Date(`${value}:00+08:00`).getTime() + 3600000));
}
function readableTime(value, allDay = false) {
  if (!value) return "未设置";
  if (allDay || /^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date(value));
}
function newEventDraft(listId, start = "") {
  const startValue = start || `${localDate()}T09:00`;
  return {
    id: null,
    title: "",
    listId: listId || "",
    startAt: startValue,
    endAt: addHour(startValue),
    allDay: false,
    notes: "",
    location: "",
    linkUrl: "",
    reminderMinutes: 10,
    recurrenceType: "",
    interval: 1,
    weekdays: [new Date(`${startValue}:00+08:00`).getDay()],
    endDate: "",
    maxOccurrences: "",
    scope: "occurrence",
    seriesId: null,
    lunarMonth: 1,
    lunarDay: 1,
    includeLeap: false,
    nth: 1,
    dayType: "workday",
    holidayName: "",
    offsetDays: 0,
    customDates: "",
    excludeDates: ""
  };
}
function buildRecurrence(draft) {
  if (!draft.recurrenceType) return null;
  return {
    type: draft.recurrenceType,
    interval: Number(draft.interval) || 1,
    weekdays: draft.weekdays,
    lunarMonth: Number(draft.lunarMonth) || 1,
    lunarDay: Number(draft.lunarDay) || 1,
    includeLeap: Boolean(draft.includeLeap),
    nth: Number(draft.nth) || 1,
    dayType: draft.dayType,
    holidayName: draft.holidayName,
    offsetDays: Number(draft.offsetDays) || 0,
    customDates: draft.customDates.split(/[,，\s]+/).filter(Boolean),
    excludeDates: draft.excludeDates.split(/[,，\s]+/).filter(Boolean),
    month: Number(draft.startAt.slice(5, 7)),
    day: Number(draft.startAt.slice(8, 10)),
    weekday: new Date(`${draft.startAt}:00+08:00`).getDay()
  };
}
function CalendarEventDialog({
  draft: initial,
  lists,
  onClose,
  onDeleted,
  onSaved,
  onNotice
}) {
  const [draft, setDraft] = useState(initial);
  const [preview, setPreview] = useState([]);
  const [saving, setSaving] = useState(false);
  const update = patch => setDraft(current => ({
    ...current,
    ...patch
  }));
  const recurrence = buildRecurrence(draft);
  const save = async () => {
    if (!draft.title.trim() || !draft.listId || !draft.startAt || !draft.endAt) return onNotice("请填写名称、日历和时间");
    setSaving(true);
    try {
      const body = {
        title: draft.title.trim(),
        listId: Number(draft.listId),
        notes: draft.notes,
        location: draft.location,
        linkUrl: draft.linkUrl,
        allDay: draft.allDay,
        startAt: draft.allDay ? draft.startAt.slice(0, 10) : inputToIso(draft.startAt),
        endAt: draft.allDay ? draft.endAt.slice(0, 10) : inputToIso(draft.endAt),
        durationMinutes: Math.max(1, Math.round((new Date(`${draft.endAt}:00+08:00`) - new Date(`${draft.startAt}:00+08:00`)) / 60000)),
        reminderMinutes: Number(draft.reminderMinutes) || 0,
        recurrence,
        endDate: draft.endDate || null,
        maxOccurrences: Number(draft.maxOccurrences) || null,
        scope: draft.scope
      };
      if (draft.id) await api(`/api/calendar/events/${draft.id}`, {
        method: "PATCH",
        body: JSON.stringify(body)
      });else await api("/api/calendar/events", {
        method: "POST",
        body: JSON.stringify(body)
      });
      onSaved();
    } catch (error) {
      onNotice(error.message);
    } finally {
      setSaving(false);
    }
  };
  const previewRule = async () => {
    try {
      const result = await api("/api/calendar/recurrence/preview", {
        method: "POST",
        body: JSON.stringify({
          startDate: draft.startAt.slice(0, 10),
          endDate: draft.endDate || undefined,
          maxOccurrences: Number(draft.maxOccurrences) || undefined,
          recurrence
        })
      });
      setPreview(result.dates);
    } catch (error) {
      onNotice(error.message);
    }
  };
  return <OkrDialogSurface asChild title={draft.id ? "编辑日程" : "新建日程"} onClose={onClose}>
      <section className="calendar-event-dialog" onMouseDown={event => event.stopPropagation()}>
        <header><div><small>{draft.id ? "编辑日程" : "新建日程"}</small><h2>{draft.id ? draft.title : "安排一段时间"}</h2></div><OkrButton className="icon-only" onClick={onClose} title="关闭"><X size={18} /></OkrButton></header>
        <div className="calendar-form-grid">
          <label className="span-2">日程名称<OkrInput autoFocus value={draft.title} onChange={event => update({
            title: event.target.value
          })} /></label>
          <label>所属日历<OkrSelect value={draft.listId} onChange={event => update({
            listId: event.target.value
          })}>{lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</OkrSelect></label>
          <label>提醒<OkrSelect value={draft.reminderMinutes} onChange={event => update({
            reminderMinutes: event.target.value
          })}><option value="0">不提醒</option><option value="10">提前 10 分钟</option><option value="30">提前 30 分钟</option><option value="60">提前 1 小时</option><option value="1440">提前 1 天</option></OkrSelect></label>
          <label>开始时间<OkrInput type="datetime-local" value={draft.startAt} onChange={event => update({
            startAt: event.target.value,
            endAt: draft.endAt <= event.target.value ? addHour(event.target.value) : draft.endAt
          })} /></label>
          <label>结束时间<OkrInput type="datetime-local" value={draft.endAt} onChange={event => update({
            endAt: event.target.value
          })} /></label>
          <label className="calendar-check"><OkrInput type="checkbox" checked={draft.allDay} onChange={event => update({
            allDay: event.target.checked
          })} />全天日程</label>
          <label>地点<div className="input-with-icon"><MapPin size={14} /><OkrInput value={draft.location} onChange={event => update({
              location: event.target.value
            })} /></div></label>
          <label className="span-2">链接<div className="input-with-icon"><Link2 size={14} /><OkrInput type="url" value={draft.linkUrl} onChange={event => update({
              linkUrl: event.target.value
            })} /></div></label>
          <label className="span-2">备注<OkrTextarea rows="3" value={draft.notes} onChange={event => update({
            notes: event.target.value
          })} /></label>
        </div>
        {!draft.id && <section className="recurrence-builder">
          <div className="calendar-form-grid">
            <label>重复规则<OkrSelect value={draft.recurrenceType} onChange={event => update({
              recurrenceType: event.target.value,
              preview: []
            })}>{recurrenceOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</OkrSelect></label>
            {draft.recurrenceType && <label>间隔<OkrInput min="1" max="365" type="number" value={draft.interval} onChange={event => update({
              interval: event.target.value
            })} /></label>}
            {draft.recurrenceType === "weekly" && <div className="weekday-picker span-2">{weekdayLabels.map((label, index) => <OkrButton className={draft.weekdays.includes(index) ? "active" : ""} key={label} onClick={() => update({
              weekdays: draft.weekdays.includes(index) ? draft.weekdays.filter(item => item !== index) : [...draft.weekdays, index]
            })}>{label}</OkrButton>)}</div>}
            {["lunar_monthly", "lunar_yearly"].includes(draft.recurrenceType) && <><label>农历月<OkrInput min="1" max="12" type="number" value={draft.lunarMonth} onChange={event => update({
                lunarMonth: event.target.value
              })} /></label><label>农历日<OkrInput min="1" max="30" type="number" value={draft.lunarDay} onChange={event => update({
                lunarDay: event.target.value
              })} /></label><label className="calendar-check"><OkrInput type="checkbox" checked={draft.includeLeap} onChange={event => update({
                includeLeap: event.target.checked
              })} />闰月也执行</label></>}
            {draft.recurrenceType === "yearly_day_type" && <><label>日期类型<OkrSelect value={draft.dayType} onChange={event => update({
                dayType: event.target.value
              })}><option value="workday">工作日</option><option value="restday">休息日</option></OkrSelect></label><label>第几个<OkrInput min="1" type="number" value={draft.nth} onChange={event => update({
                nth: event.target.value
              })} /></label></>}
            {draft.recurrenceType === "holiday_offset" && <><label>节假日名称<OkrInput value={draft.holidayName} onChange={event => update({
                holidayName: event.target.value
              })} /></label><label>前后天数<OkrInput type="number" value={draft.offsetDays} onChange={event => update({
                offsetDays: event.target.value
              })} /></label></>}
            {draft.recurrenceType === "custom" && <label className="span-2">自定义日期<OkrInput placeholder="2026-08-01, 2026-08-15" value={draft.customDates} onChange={event => update({
              customDates: event.target.value
            })} /></label>}
            {draft.recurrenceType && <><label>结束日期<OkrInput type="date" value={draft.endDate} onChange={event => update({
                endDate: event.target.value
              })} /></label><label>重复次数<OkrInput min="1" type="number" value={draft.maxOccurrences} onChange={event => update({
                maxOccurrences: event.target.value
              })} /></label><label className="span-2">排除日期<OkrInput placeholder="多个日期用逗号分开" value={draft.excludeDates} onChange={event => update({
                excludeDates: event.target.value
              })} /></label></>}
          </div>
          {draft.recurrenceType && <div className="recurrence-preview"><OkrButton onClick={previewRule}><RefreshCw size={14} />预览未来日期</OkrButton>{preview.length > 0 && <span>{preview.slice(0, 8).join("、")}{preview.length > 8 ? ` 等 ${preview.length} 次` : ""}</span>}</div>}
        </section>}
        {draft.seriesId && <label className="series-scope">修改范围<OkrSelect value={draft.scope} onChange={event => update({
          scope: event.target.value
        })}><option value="occurrence">仅修改本次</option><option value="future">修改本次及以后</option><option value="series">修改整个系列</option></OkrSelect></label>}
        <footer>{draft.id && <OkrButton className="danger" onClick={() => onDeleted(draft)}>取消日程</OkrButton>}<OkrButton onClick={onClose}>返回</OkrButton><OkrButton className="primary-button" disabled={saving} onClick={save}>{saving ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}保存日程</OkrButton></footer>
      </section>
    </OkrDialogSurface>;
}
function TaskQuickDialog({
  item,
  lists,
  onClose,
  onOpenTask,
  onSaved,
  onNotice
}) {
  const dialog = useAppDialog();
  const [title, setTitle] = useState(item.title);
  const [listId, setListId] = useState(item.listId);
  const [status, setStatus] = useState(item.status);
  const [startAt, setStartAt] = useState(toLocalInput(item.rawStartAt || item.startAt));
  const [dueAt, setDueAt] = useState(toLocalInput(item.rawDueAt || item.endAt));
  const save = async () => {
    try {
      await api(`/api/tasks/${item.taskId}`, {
        method: "PATCH",
        body: JSON.stringify({
          title,
          listId: Number(listId),
          status,
          startAt: inputToIso(startAt),
          dueAt: inputToIso(dueAt),
          startPrecision: "datetime",
          duePrecision: "datetime",
          mutationSource: "日程系统"
        })
      });
      onSaved();
    } catch (error) {
      onNotice(error.message);
    }
  };
  const clearTime = async () => {
    try {
      await api(`/api/tasks/${item.taskId}`, {
        method: "PATCH",
        body: JSON.stringify({
          startAt: null,
          dueAt: null,
          startPrecision: null,
          duePrecision: null,
          mutationSource: "日程系统"
        })
      });
      onSaved();
      onNotice("任务已移回待安排区域");
    } catch (error) {
      onNotice(error.message);
    }
  };
  const removeTask = async () => {
    const confirmed = await dialog.confirm({
      title: "删除任务",
      message: "任务将进入回收区，操作日志会保留。",
      confirmLabel: "删除任务",
      danger: true
    });
    if (!confirmed) return;
    try {
      await api(`/api/tasks/${item.taskId}`, {
        method: "DELETE"
      });
      onSaved();
      onNotice("任务已移入回收区");
    } catch (error) {
      onNotice(error.message);
    }
  };
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="task-calendar-dialog" onMouseDown={event => event.stopPropagation()}><header><div><small>{item.taskNo}</small><h2>快速编辑任务</h2></div><OkrButton className="icon-only" onClick={onClose}><X size={18} /></OkrButton></header><label>任务内容<OkrTextarea rows="3" value={title} onChange={event => setTitle(event.target.value)} /></label><div className="calendar-form-grid"><label>所属日历<OkrSelect value={listId} onChange={event => setListId(event.target.value)}>{lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</OkrSelect></label><label>状态<OkrSelect value={status} onChange={event => setStatus(event.target.value)}>{["未完成", "进行中", "已完成", "已废弃", "暂搁置"].map(value => <option key={value}>{value}</option>)}</OkrSelect></label><label>开始时间<OkrInput type="datetime-local" value={startAt} onChange={event => setStartAt(event.target.value)} /></label><label>截止时间<OkrInput type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)} /></label></div>{item.timeWarning && <p className="calendar-warning">历史时间范围异常，请重新选择开始和截止时间。</p>}<footer><OkrButton className="danger" onClick={removeTask}>删除任务</OkrButton><OkrButton onClick={clearTime}>仅清除时间</OkrButton><OkrButton onClick={() => onOpenTask(item.taskId)}>完整详情</OkrButton><OkrButton className="primary-button" onClick={save}><Save size={15} />保存修改</OkrButton></footer></section></div>;
}
function CalendarHourFilter({
  start,
  end,
  onChange
}) {
  const startIndex = Math.max(0, hourOptions.findIndex(option => option.value === start));
  return <div className="calendar-hour-filter" title="筛选日历显示的小时范围">
    <Clock3 size={14} />
    <OkrSelect aria-label="显示开始小时" value={start} onChange={event => onChange("start", event.target.value)}>
      {hourOptions.slice(0, -1).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </OkrSelect>
    <span>至</span>
    <OkrSelect aria-label="显示结束小时" value={end} onChange={event => onChange("end", event.target.value)}>
      {hourOptions.slice(startIndex + 1).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </OkrSelect>
  </div>;
}
function MiniCalendar({
  markerDates,
  month,
  onMonthChange,
  onSelectDate,
  selectedDate
}) {
  const cells = useMemo(() => miniMonthCells(month), [month]);
  const monthLabel = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long"
  }).format(month);
  const moveMonth = offset => onMonthChange(new Date(month.getFullYear(), month.getMonth() + offset, 1, 12));
  return <div className="cal-mini-calendar">
    <header className="cal-rail-head">
      <b>{monthLabel}</b>
      <div>
        <OkrButton onClick={() => moveMonth(-1)} title="上个月"><ChevronLeft size={14} /></OkrButton>
        <OkrButton onClick={() => moveMonth(1)} title="下个月"><ChevronRight size={14} /></OkrButton>
      </div>
    </header>
    <div className="cal-mini-weekdays">{["一", "二", "三", "四", "五", "六", "日"].map(day => <span key={day}>{day}</span>)}</div>
    <div className="cal-mini-days">{cells.map(cell => <OkrButton className={`${cell.inMonth ? "" : "outside"} ${cell.today ? "today" : ""} ${selectedDate === cell.key ? "selected" : ""} ${markerDates.has(cell.key) ? "has-events" : ""}`} key={cell.key} onClick={() => onSelectDate(cell.key)} title={markerDates.has(cell.key) ? `${cell.key} 有日程` : cell.key}>{cell.day}</OkrButton>)}</div>
  </div>;
}
function calendarSoftColor(color, strength = 13) {
  return `color-mix(in srgb, ${color || "#2563eb"} ${strength}%, var(--bg-card))`;
}
function upcomingDateParts(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return {
    day: "--",
    month: "--"
  };
  return {
    day: new Intl.DateTimeFormat("zh-CN", {
      day: "2-digit",
      timeZone: "Asia/Shanghai"
    }).format(date),
    month: new Intl.DateTimeFormat("zh-CN", {
      month: "short",
      timeZone: "Asia/Shanghai"
    }).format(date)
  };
}
function CalendarWorkspace({
  lists,
  initialListId,
  onNotice,
  onOpenTask
}) {
  const calendarRef = useRef(null);
  const unscheduledRef = useRef(null);
  const [items, setItems] = useState([]);
  const [unscheduled, setUnscheduled] = useState([]);
  const [settings, setSettings] = useState({
    default_view: defaultCalendarView,
    show_completed: "1",
    show_discarded: "0",
    visible_list_ids: "[]",
    display_start_time: "06:00:00",
    display_end_time: "24:00:00"
  });
  const [visibleIds, setVisibleIds] = useState(null);
  const loadSequence = useRef(0);
  const [range, setRange] = useState({
    from: localDate(),
    to: localDate(new Date(Date.now() + 7 * 86400000))
  });
  const [view, setView] = useState(defaultCalendarView);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [eventDraft, setEventDraft] = useState(null);
  const [taskItem, setTaskItem] = useState(null);
  const [showUnscheduled, setShowUnscheduled] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [miniMonth, setMiniMonth] = useState(() => new Date());
  const [miniItems, setMiniItems] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [selectedDate, setSelectedDate] = useState(() => localDate());
  const [calendarHeight, setCalendarHeight] = useState(() => Math.max(420, Math.min(900, window.innerHeight - 220)));
  const compactScreen = window.matchMedia("(max-width: 680px)").matches;
  useEffect(() => {
    const calendar = calendarRef.current?.getApi();
    calendar?.setOption("height", "100%");
    calendar?.setOption("expandRows", true);
    calendar?.setOption("slotMinHeight", 34);
    calendar?.setOption("slotMinTime", settings.display_start_time || "06:00:00");
    calendar?.setOption("slotMaxTime", settings.display_end_time || "24:00:00");
  }, [calendarHeight, settings.display_start_time, settings.display_end_time]);
  const effectiveIds = visibleIds || [];
  const markerDates = useMemo(() => new Set(miniItems.map(item => calendarDateKey(item.startAt)).filter(Boolean)), [miniItems]);
  const load = useCallback(async (targetRange = range, ids = effectiveIds) => {
    const sequence = ++loadSequence.current;
    if (!ids.length) {
      setItems([]);
      setUnscheduled([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        from: targetRange.from,
        to: targetRange.to,
        listIds: ids.join(","),
        showCompleted: settings.show_completed || "1",
        showDiscarded: settings.show_discarded || "0"
      });
      const [calendar, pending] = await Promise.all([api(`/api/calendar/items?${params}`), api(`/api/calendar/unscheduled-tasks?listIds=${ids.join(",")}&limit=200`)]);
      if (sequence === loadSequence.current) {
        setItems(calendar.data);
        setUnscheduled(pending.data);
      }
    } catch (error) {
      if (sequence === loadSequence.current) onNotice(error.message);
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [effectiveIds.join(","), lists.length, onNotice, range.from, range.to, settings.show_completed, settings.show_discarded]);
  useEffect(() => {
    if (!effectiveIds.length) {
      setMiniItems([]);
      setUpcoming([]);
      return undefined;
    }
    let active = true;
    const monthRange = monthApiRange(miniMonth);
    const futureRange = nextDaysRange(120);
    const common = {
      listIds: effectiveIds.join(","),
      showCompleted: settings.show_completed || "1",
      showDiscarded: settings.show_discarded || "0"
    };
    const monthParams = new URLSearchParams({
      ...common,
      ...monthRange,
      limit: "500"
    });
    const futureParams = new URLSearchParams({
      ...common,
      ...futureRange,
      limit: "100"
    });
    Promise.all([api(`/api/calendar/items?${monthParams}`), api(`/api/calendar/items?${futureParams}`)]).then(([monthResult, futureResult]) => {
      if (!active) return;
      setMiniItems(monthResult.data || []);
      setUpcoming(nearestUpcoming(futureResult.data, new Date(), 5));
    }).catch(error => onNotice(error.message));
    return () => {
      active = false;
    };
  }, [effectiveIds.join(","), miniMonth.getFullYear(), miniMonth.getMonth(), settings.show_completed, settings.show_discarded]);
  useEffect(() => {
    api("/api/calendar/settings").then(next => {
      const nextView = compactScreen ? "listMonth" : next.default_view || defaultCalendarView;
      setSettings(next);
      setView(nextView);
      setCalendarHeight(Math.max(360, Math.min(1400, Number(next.calendar_view_height) || Math.max(420, Math.min(900, window.innerHeight - 220)))));
      window.requestAnimationFrame(() => calendarRef.current?.getApi().changeView(nextView));
      const saved = JSON.parse(next.visible_list_ids || "[]");
      setVisibleIds(Array.isArray(saved) && (saved.length || next.visible_selection_configured === "1") ? saved : initialListId ? [initialListId] : lists.map(list => list.id));
    }).catch(error => onNotice(error.message));
  }, []);
  useEffect(() => {
    if (visibleIds !== null) load();
    return () => {
      loadSequence.current += 1;
    };
  }, [visibleIds?.join(","), range.from, range.to, settings.show_completed, settings.show_discarded]);
  useEffect(() => {
    if (!unscheduledRef.current) return undefined;
    const draggable = new Draggable(unscheduledRef.current, {
      itemSelector: ".unscheduled-task",
      eventData: element => ({
        id: `pending:${element.dataset.taskId}`,
        title: element.dataset.title,
        duration: "01:00"
      })
    });
    return () => draggable.destroy();
  }, [unscheduled.length]);
  useEffect(() => {
    const check = () => {
      const now = Date.now();
      for (const item of items) {
        if (item.sourceType !== "event" || !item.reminderMinutes || item.status !== "scheduled") continue;
        const reminderAt = new Date(item.startAt).getTime() - Number(item.reminderMinutes) * 60000;
        if (now < reminderAt || now > reminderAt + 60000) continue;
        const key = `life-task-okr:calendar-reminder:${item.id}:${item.startAt}`;
        if (sessionStorage.getItem(key)) continue;
        sessionStorage.setItem(key, "1");
        onNotice(`日程提醒：${item.title}`);
      }
    };
    check();
    const timer = window.setInterval(check, 30000);
    return () => window.clearInterval(timer);
  }, [items, onNotice]);
  const saveVisible = async ids => {
    const previous = effectiveIds;
    setVisibleIds(ids);
    try {
      await api("/api/calendar/settings", {
        method: "PATCH",
        body: JSON.stringify({
          visible_list_ids: JSON.stringify(ids),
          visible_selection_configured: "1"
        })
      });
    } catch (error) {
      setVisibleIds(previous);
      onNotice(error.message || "日历选择保存失败");
    }
  };
  const saveDisplayHours = async (side, value) => {
    const start = side === "start" ? value : settings.display_start_time || "06:00:00";
    const end = side === "end" ? value : settings.display_end_time || "24:00:00";
    const patch = {
      display_start_time: start,
      display_end_time: end
    };
    const error = validateSettingsPatch("calendar", patch, settings);
    if (error) {
      onNotice(error);
      return;
    }
    const previous = {
      display_start_time: settings.display_start_time,
      display_end_time: settings.display_end_time
    };
    setSettings(current => ({
      ...current,
      ...patch
    }));
    try {
      await api("/api/calendar/settings", {
        method: "PATCH",
        body: JSON.stringify(patch)
      });
    } catch (error) {
      setSettings(current => ({
        ...current,
        ...previous
      }));
      onNotice(error.message);
    }
  };
  const beginCalendarResize = event => {
    event.preventDefault();
    const startY = event.clientY;
    const canvas = event.currentTarget.parentElement.querySelector(".cal-canvas");
    const startHeight = canvas?.clientHeight || calendarHeight;
    const maxHeight = Math.max(240, window.innerHeight - (canvas?.getBoundingClientRect().top || 200) - 24);
    const move = moveEvent => setCalendarHeight(Math.max(240, Math.min(maxHeight, startHeight + moveEvent.clientY - startY)));
    const finish = async upEvent => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      const height = Math.round(Math.max(240, Math.min(maxHeight, startHeight + upEvent.clientY - startY)));
      setCalendarHeight(height);
      try {
        await api("/api/calendar/settings", {
          method: "PATCH",
          body: JSON.stringify({
            calendar_view_height: height
          })
        });
      } catch (error) {
        onNotice(error.message);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, {
      once: true
    });
  };
  const moveTask = async (item, start, end) => {
    await api(`/api/tasks/${item.taskId}`, {
      method: "PATCH",
      body: JSON.stringify({
        startAt: start.toISOString(),
        dueAt: (end || new Date(start.getTime() + 3600000)).toISOString(),
        startPrecision: "datetime",
        duePrecision: "datetime",
        mutationSource: "日程系统"
      })
    });
  };
  const persistCalendarMove = async info => {
    const item = info.event.extendedProps.item;
    try {
      if (item.sourceType === "task") await moveTask(item, info.event.start, info.event.end);else await api(`/api/calendar/events/${item.eventId}`, {
        method: "PATCH",
        body: JSON.stringify({
          startAt: info.event.start.toISOString(),
          endAt: (info.event.end || new Date(info.event.start.getTime() + 3600000)).toISOString()
        })
      });
      onNotice(item.sourceType === "task" ? "任务时间已同步" : "日程时间已更新");
      await load();
    } catch (error) {
      info.revert();
      onNotice(error.message);
    }
  };
  const receivePending = async info => {
    const taskId = Number(info.event.id.replace("pending:", ""));
    const item = {
      taskId
    };
    try {
      await moveTask(item, info.event.start, info.event.end);
      info.event.remove();
      onNotice("任务已安排到日历");
      await load();
    } catch (error) {
      info.event.remove();
      onNotice(error.message);
    }
  };
  const calendarEvents = useMemo(() => items.map(item => ({
    id: item.id,
    title: item.title,
    start: item.startAt,
    end: item.endAt,
    allDay: item.allDay,
    editable: item.status !== "已废弃" && item.status !== "cancelled",
    backgroundColor: item.status === "已完成" ? "var(--bg-muted)" : calendarSoftColor(item.listColor),
    borderColor: item.timeWarning ? "#c43131" : item.listColor,
    textColor: item.status === "已完成" ? "var(--t-muted)" : item.listColor,
    classNames: [`calendar-source-${item.sourceType}`, item.timeWarning ? "has-time-warning" : "", item.status === "已完成" ? "is-completed" : ""],
    extendedProps: {
      item
    }
  })), [items]);
  const switchView = next => {
    setView(next);
    calendarRef.current?.getApi().changeView(next);
    trackAnalyticsEvent({
      module: "calendar",
      eventName: "calendar.view_switch",
      metadata: {
        view: next
      }
    });
  };
  const openDate = date => {
    setSelectedDate(date);
    setMiniMonth(new Date(`${date}T12:00:00+08:00`));
    calendarRef.current?.getApi().gotoDate(date);
  };
  const patchVisibilitySetting = async (key, checked) => {
    const value = checked ? "1" : "0";
    setSettings(current => ({
      ...current,
      [key]: value
    }));
    try {
      await api("/api/calendar/settings", {
        method: "PATCH",
        body: JSON.stringify({
          [key]: value
        })
      });
    } catch (error) {
      onNotice(error.message);
    }
  };
  const currentMonthLabel = title || new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long"
  }).format(miniMonth);
  const heroDate = new Intl.DateTimeFormat("zh-CN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Shanghai"
  }).format(new Date());
  return <section className="calendar-admin-page" style={{
    "--calendar-view-height": `${calendarHeight}px`
  }}>
    <header className="calendar-admin-hero">
      <div><h1>日程工作台</h1><span>{items.length} 条日程</span></div>
      <div><OkrButton onClick={() => setShowUnscheduled(true)}><LayoutList size={15} />待安排任务</OkrButton></div>
    </header>
    <section className={`cal-shell ${showUnscheduled ? "with-pending" : ""}`}>
      <aside className="cal-rail">
        <section className="cal-rail-card"><MiniCalendar markerDates={markerDates} month={miniMonth} onMonthChange={setMiniMonth} onSelectDate={openDate} selectedDate={selectedDate} /></section>
        <section className="cal-rail-card">
          <header className="cal-rail-head"><b>我的日历</b><OkrButton onClick={() => saveVisible(lists.map(list => list.id))} title="显示全部日历"><Plus size={13} /></OkrButton></header>
          <div className="cal-list">{lists.map(list => {
              const checked = effectiveIds.includes(list.id);
              return <label className={`cal-list-item ${checked ? "" : "is-off"}`} key={list.id}><OkrInput type="checkbox" checked={checked} onChange={event => saveVisible(event.target.checked ? [...new Set([...effectiveIds, list.id])] : effectiveIds.filter(id => id !== list.id))} /><span className={`cal-list-check ${checked ? "" : "is-off"}`} style={{
                  color: list.color
                }} /><span className="cal-list-name">{list.name}</span><span className="cal-list-count">{list.taskCount ?? 0}</span></label>;
            })}</div>
        </section>
        <section className="cal-rail-card">
          <header className="cal-rail-head"><b>近期日程</b><span>{upcoming.length} 条</span></header>
          <div className="cal-upcoming-list">{upcoming.length ? upcoming.map(item => {
              const date = upcomingDateParts(item.startAt);
              return <OkrButton className="cal-upcoming-item" key={item.id} onClick={() => openDate(calendarDateKey(item.startAt))}><span className="cal-upcoming-date"><b>{date.day}</b><small>{date.month}</small></span><span><b>{item.title}</b><small><i style={{
                      background: item.listColor
                    }} />{readableTime(item.startAt, item.allDay)} · {item.listName}</small></span></OkrButton>;
            }) : <p>未来 120 天暂无日程</p>}</div>
        </section>
      </aside>
      <section className="cal-main">
        {visibleIds !== null && !effectiveIds.length && <div className="cal-empty-selection" role="status">未选择日历</div>}
        <div className="cal-toolbar">
          <div className="cal-toolbar-left"><h2>{currentMonthLabel}</h2><div className="cal-nav"><OkrButton onClick={() => calendarRef.current?.getApi().prev()} title="上一周期"><ChevronLeft size={15} /></OkrButton><OkrButton onClick={() => calendarRef.current?.getApi().today()}>今天</OkrButton><OkrButton onClick={() => calendarRef.current?.getApi().next()} title="下一周期"><ChevronRight size={15} /></OkrButton></div></div>
          <div className="cal-views">{viewOptions.map(([value, label]) => <OkrButton className={view === value ? "active" : ""} key={value} onClick={() => switchView(value)}>{label}</OkrButton>)}</div>
          <div className="cal-toolbar-right">
            <div className="calendar-filter-wrap"><OkrButton className={filterOpen ? "is-active" : ""} onClick={() => setFilterOpen(current => !current)}><Filter size={15} />筛选</OkrButton>{filterOpen && <div className="calendar-filter-popover"><b>日历显示</b><label><OkrInput type="checkbox" checked={settings.show_completed !== "0"} onChange={event => patchVisibilitySetting("show_completed", event.target.checked)} />显示已完成任务</label><label><OkrInput type="checkbox" checked={settings.show_discarded === "1"} onChange={event => patchVisibilitySetting("show_discarded", event.target.checked)} />显示已废弃任务</label><CalendarHourFilter start={settings.display_start_time || "06:00:00"} end={settings.display_end_time || "24:00:00"} onChange={saveDisplayHours} /></div>}</div>
            <OkrButton className="primary-button" onClick={() => setEventDraft(newEventDraft(effectiveIds[0] || lists[0]?.id, `${selectedDate}T09:00`))}><Plus size={15} />新建日程</OkrButton>
          </div>
        </div>
        <div className="cal-canvas">{loading && <div className="calendar-loading"><LoaderCircle className="spin" size={18} />更新日程</div>}<FullCalendar ref={calendarRef} plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, classicThemePlugin]} locale={zhCnLocale} initialView={view} headerToolbar={false} firstDay={1} nowIndicator selectable editable droppable eventResizableFromStart eventMaxStack={3} dayMaxEvents={4} scrollTime="07:00:00" slotDuration="01:00:00" snapDuration="00:15:00" slotMinTime="00:00:00" slotMaxTime="24:00:00" height="100%" events={calendarEvents} dayHeaderContent={info => <span className="fc-dow">{info.view.type.startsWith("timeGrid") && `${new Intl.DateTimeFormat("zh-CN", {
              month: "numeric",
              day: "numeric"
            }).format(info.date)} `}{new Intl.DateTimeFormat("zh-CN", {
              weekday: "short"
            }).format(info.date)}</span>} datesSet={info => {
            const next = {
              from: info.startStr.slice(0, 10),
              to: info.endStr.slice(0, 10)
            };
            const focus = info.view.calendar.getDate?.() || info.view.currentStart || info.start;
            setRange(next);
            setTitle(info.view.title);
            setView(info.view.type);
            setMiniMonth(new Date(focus));
            setSelectedDate(calendarDateKey(focus));
          }} dateClick={info => {
            setSelectedDate(info.dateStr.slice(0, 10));
            setEventDraft(newEventDraft(effectiveIds[0] || lists[0]?.id, `${info.dateStr.slice(0, 10)}T${info.dateStr.includes("T") ? info.dateStr.slice(11, 16) : "09:00"}`));
          }} select={info => setEventDraft({
            ...newEventDraft(effectiveIds[0] || lists[0]?.id, toLocalInput(info.start)),
            endAt: toLocalInput(info.end)
          })} eventDrop={persistCalendarMove} eventResize={persistCalendarMove} eventReceive={receivePending} eventClick={info => {
            const item = info.event.extendedProps.item;
            if (!item) return;
            if (item.sourceType === "task") {
              if (info.jsEvent.detail > 1) onOpenTask(item.taskId);else setTaskItem(item);
            } else setEventDraft({
              ...newEventDraft(item.listId, toLocalInput(item.startAt)),
              id: item.eventId,
              title: item.title,
              endAt: toLocalInput(item.endAt),
              allDay: item.allDay,
              notes: item.notes,
              location: item.location,
              linkUrl: item.linkUrl,
              reminderMinutes: item.reminderMinutes,
              seriesId: item.seriesId
            });
          }} eventContent={info => <div className="cal-event-content">{info.timeText && <time>{info.timeText}</time>}{info.event.extendedProps.item?.sourceType === "task" && <Check size={10} />}<span>{info.event.title}</span>{info.event.extendedProps.item?.timeWarning && <b>!</b>}</div>} /></div>
        <div className="calendar-resize-handle" onPointerDown={beginCalendarResize} role="separator" aria-label="拖动调整日历视图高度" aria-orientation="horizontal" title="上下拖动调整日历高度"><span /></div>
      </section>
      {showUnscheduled && <><OkrButton className="calendar-drawer-scrim" onClick={() => setShowUnscheduled(false)} aria-label="关闭待安排任务" /><aside className="unscheduled-panel" ref={unscheduledRef}><header><div><small>待安排任务</small><b>{unscheduled.length} 条</b></div><span><OkrButton className="icon-only" onClick={() => load()} title="刷新"><RefreshCw size={15} /></OkrButton><OkrButton className="icon-only" onClick={() => setShowUnscheduled(false)} title="关闭"><X size={16} /></OkrButton></span></header><p>拖到日历即可安排时间；手机端可点开任务后设置时间。</p><div>{unscheduled.map(task => <article className="unscheduled-task" data-task-id={task.id} data-title={task.title} key={task.id} onClick={() => setTaskItem({
              ...task,
              taskId: task.id,
              rawStartAt: task.startAt,
              rawDueAt: task.dueAt
            })}><GripVertical size={14} /><span><b>{task.title}</b><small><i style={{
                    background: task.listColor
                  }} />{task.listName} · {task.taskNo}</small></span></article>)}</div></aside></>}
    </section>
    {eventDraft && <CalendarEventDialog draft={eventDraft} lists={lists} onClose={() => setEventDraft(null)} onDeleted={async draft => {
      try {
        await api(`/api/calendar/events/${draft.id}?scope=${draft.scope || "occurrence"}`, {
          method: "DELETE"
        });
        setEventDraft(null);
        await load();
        onNotice("日程已取消，日志已保留");
      } catch (error) {
        onNotice(error.message);
      }
    }} onNotice={onNotice} onSaved={() => {
      setEventDraft(null);
      load();
      onNotice("日程已保存");
    }} />}
    {taskItem && <TaskQuickDialog item={taskItem} lists={lists} onClose={() => setTaskItem(null)} onNotice={onNotice} onOpenTask={onOpenTask} onSaved={() => {
      setTaskItem(null);
      load();
      onNotice("任务已从日历更新");
    }} />}
  </section>;
}
function CalendarListPage({
  lists,
  onNotice,
  onOpenTask
}) {
  const [items, setItems] = useState([]);
  const [listId, setListId] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [eventDraft, setEventDraft] = useState(null);
  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        from: "2000-01-01",
        to: "2100-01-01",
        limit: "50",
        offset: String(page * 50)
      });
      if (listId) params.set("listIds", listId);
      if (search) params.set("q", search);
      const result = await api(`/api/calendar/items?${params}`);
      setItems(result.data);
      setTotal(result.total);
    } catch (error) {
      onNotice(error.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [listId, page, search]);
  const pageCount = Math.max(1, Math.ceil(total / 50));
  return <section className="calendar-database-page"><div className="calendar-db-toolbar"><form onSubmit={event => {
        event.preventDefault();
        setPage(0);
        setSearch(query.trim());
      }}><OkrInput placeholder="搜索日程、备注或日历" value={query} onChange={event => setQuery(event.target.value)} /><OkrButton type="submit">搜索</OkrButton></form><OkrSelect value={listId} onChange={event => {
        setPage(0);
        setListId(event.target.value);
      }}><option value="">全部日历</option>{lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}</OkrSelect><OkrButton className="icon-only" onClick={load}><RefreshCw size={15} /></OkrButton></div><div className="calendar-db"><div className="calendar-db-head"><span>类型</span><span>日程名称</span><span>所属日历</span><span>开始</span><span>结束</span><span>状态</span><span>备注 / 链接</span></div>{loading ? <div className="table-state"><LoaderCircle className="spin" size={18} />读取日程</div> : items.length ? items.map(item => <OkrButton className="calendar-db-row" key={item.id} onClick={() => item.sourceType === "task" ? onOpenTask(item.taskId) : setEventDraft({
        ...newEventDraft(item.listId, toLocalInput(item.startAt)),
        id: item.eventId,
        title: item.title,
        endAt: toLocalInput(item.endAt),
        allDay: item.allDay,
        notes: item.notes,
        location: item.location,
        linkUrl: item.linkUrl,
        reminderMinutes: item.reminderMinutes,
        seriesId: item.seriesId
      })}><span>{item.sourceType === "task" ? "任务" : item.isRecurring ? "重复日程" : "普通日程"}</span><b>{item.title}{item.timeWarning && <em>时间异常</em>}</b><span><i style={{
            background: item.listColor
          }} />{item.listName}</span><time>{readableTime(item.startAt, item.allDay)}</time><time>{readableTime(item.endAt, item.allDay)}</time><span>{item.status}</span><span>{item.notes || "-"}{item.linkUrl && <a href={item.linkUrl} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}><ExternalLink size={13} /></a>}</span></OkrButton>) : <div className="table-state empty"><CalendarDays size={20} />当前条件下没有日程</div>}</div><footer><span>第 {page + 1} / {pageCount} 页，每页 50 条，共 {total.toLocaleString()} 条</span><div><OkrButton disabled={page === 0} onClick={() => setPage(value => Math.max(0, value - 1))}><ChevronLeft size={14} />上一页</OkrButton><OkrButton disabled={page + 1 >= pageCount} onClick={() => setPage(value => value + 1)}>下一页<ChevronRight size={14} /></OkrButton></div></footer>{eventDraft && <CalendarEventDialog draft={eventDraft} lists={lists} onClose={() => setEventDraft(null)} onDeleted={async draft => {
      await api(`/api/calendar/events/${draft.id}?scope=${draft.scope || "occurrence"}`, {
        method: "DELETE"
      });
      setEventDraft(null);
      await load();
      onNotice("日程已取消");
    }} onNotice={onNotice} onSaved={() => {
      setEventDraft(null);
      load();
      onNotice("日程已保存");
    }} />}</section>;
}
function SeriesPage({
  lists,
  onNotice
}) {
  const [series, setSeries] = useState([]);
  const [draft, setDraft] = useState(null);
  const dialog = useAppDialog();
  const load = () => api("/api/calendar/series").then(result => setSeries(result.data)).catch(error => onNotice(error.message));
  useEffect(() => {
    load();
  }, []);
  const remove = async item => {
    const confirmed = await dialog.confirm({
      title: "停止重复日程",
      message: `确认停止“${item.title}”的后续日程？`,
      confirmLabel: "停止后续日程",
      danger: true
    });
    if (!confirmed) return;
    const occurrences = await api(`/api/calendar/items?from=${localDate()}&to=${localDate(new Date(Date.now() + 370 * 86400000))}&listIds=${item.listId}`);
    const first = occurrences.data.find(event => event.seriesId === item.id);
    if (first) await api(`/api/calendar/events/${first.eventId}?scope=series`, {
      method: "DELETE"
    });
    load();
    onNotice("重复日程已停止");
  };
  return <section className="calendar-database-page"><div className="section-command-bar"><div><small>重复模板</small><h2>重复日程</h2></div><OkrButton onClick={() => setDraft(newEventDraft(lists[0]?.id))}><Plus size={15} />新建重复日程</OkrButton></div><div className="calendar-db series-db"><div className="calendar-db-head"><span>状态</span><span>名称</span><span>所属日历</span><span>规则</span><span>开始日期</span><span>结束条件</span><span>操作</span></div>{series.length === 0 && <div className="table-state empty"><Repeat2 size={20} />暂无重复日程，点击右上角新建</div>}{series.map(item => <div className="calendar-db-row" key={item.id}><span>{item.status === "active" ? "运行中" : "已停止"}</span><b>{item.title}</b><span><i style={{
            background: item.listColor
          }} />{item.listName}</span><span>{recurrenceOptions.find(([value]) => value === item.ruleType)?.[1] || item.ruleType}</span><time>{item.startDate} {item.startTime}</time><span>{item.endDate || (item.maxOccurrences ? `${item.maxOccurrences} 次` : "长期")}</span><span><OkrButton className="icon-only danger" onClick={() => remove(item)} title="停止"><Trash2 size={14} /></OkrButton></span></div>)}</div>{draft && <CalendarEventDialog draft={{
      ...draft,
      recurrenceType: "weekly"
    }} lists={lists} onClose={() => setDraft(null)} onDeleted={() => {}} onNotice={onNotice} onSaved={() => {
      setDraft(null);
      load();
      onNotice("重复日程已创建");
    }} />}</section>;
}
function CalendarManagement({
  lists,
  onRefresh,
  onNotice
}) {
  const [day, setDay] = useState(localDate());
  const [dayType, setDayType] = useState("workday");
  const [holidayName, setHolidayName] = useState("");
  const [days, setDays] = useState([]);
  const loadDays = () => api(`/api/calendar/day-types?from=${localDate().slice(0, 4)}-01-01&to=${localDate().slice(0, 4)}-12-31`).then(result => setDays(result.data));
  useEffect(() => {
    loadDays();
  }, []);
  const patchList = async (list, patch) => {
    try {
      await api(`/api/lists/${list.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
      });
      await onRefresh();
      onNotice("日历与任务清单已同步");
    } catch (error) {
      onNotice(error.message);
    }
  };
  return <section className="calendar-management"><div className="section-command-bar"><div><small>同一份清单数据</small><h2>日历与任务清单</h2></div><span>修改名称或颜色会同时影响任务系统</span></div><div className="calendar-management-grid"><section><h3>日历清单</h3><div className="calendar-list-editor">{lists.map(list => <div key={list.id}><OkrInput type="color" value={list.color || "#2877d4"} onChange={event => patchList(list, {
              color: event.target.value
            })} /><OkrInput defaultValue={list.name} onBlur={event => event.target.value.trim() && event.target.value !== list.name && patchList(list, {
              name: event.target.value.trim()
            })} /><span>{Number(list.taskCount || 0).toLocaleString()} 条任务</span></div>)}</div></section><section><h3>工作日与节假日维护</h3><div className="day-type-form"><label>日期<OkrInput type="date" value={day} onChange={event => setDay(event.target.value)} /></label><label>类型<OkrSelect value={dayType} onChange={event => setDayType(event.target.value)}><option value="workday">工作日</option><option value="restday">休息日</option><option value="holiday">节假日</option></OkrSelect></label>{dayType === "holiday" && <label>节假日名称<OkrInput value={holidayName} onChange={event => setHolidayName(event.target.value)} /></label>}<OkrButton className="primary-button" onClick={async () => {
            await api(`/api/calendar/day-types/${day}`, {
              method: "PUT",
              body: JSON.stringify({
                dayType,
                holidayName
              })
            });
            loadDays();
            onNotice("日期类型已保存");
          }}><Save size={15} />保存日期</OkrButton></div><div className="day-type-list">{days.slice(-12).reverse().map(item => <span key={item.date}><b>{item.date}</b>{item.dayType === "workday" ? "工作日" : item.dayType === "restday" ? "休息日" : item.holidayName || "节假日"}</span>)}</div></section></div></section>;
}
export function CalendarSystemPage({
  activeTab = "workspace",
  lists,
  initialListId,
  onNotice,
  onOpenTask,
  onRefreshMeta
}) {
  return <div className="calendar-system-page"><div className="calendar-system-content">{activeTab === "workspace" ? <CalendarWorkspace lists={lists} initialListId={initialListId} onNotice={onNotice} onOpenTask={onOpenTask} /> : activeTab === "list" ? <CalendarListPage lists={lists} onNotice={onNotice} onOpenTask={onOpenTask} /> : activeTab === "series" ? <SeriesPage lists={lists} onNotice={onNotice} /> : activeTab === "calendars" ? <CalendarManagement lists={lists} onRefresh={onRefreshMeta} onNotice={onNotice} /> : <CalendarWorkspace lists={lists} initialListId={initialListId} onNotice={onNotice} onOpenTask={onOpenTask} />}</div></div>;
}
