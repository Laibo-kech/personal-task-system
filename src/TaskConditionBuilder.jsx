import { OkrSelect } from "./okr-ui.jsx";
import { OkrButton, OkrInput } from "./okr-ui.jsx";
import React from "react";
import { Plus, SlidersHorizontal, Trash2 } from "lucide-react";
const statuses = ["未完成", "进行中", "已完成", "已废弃", "暂搁置"];
export const taskFilterFields = [{
  key: "title",
  label: "任务内容",
  type: "text"
}, {
  key: "status",
  label: "任务状态",
  type: "select"
}, {
  key: "listId",
  label: "所属清单",
  type: "select"
}, {
  key: "priority",
  label: "优先级",
  type: "select"
}, {
  key: "projectId",
  label: "项目",
  type: "select"
}, {
  key: "tagId",
  label: "标签",
  type: "select"
}, {
  key: "startAt",
  label: "开始时间",
  type: "date"
}, {
  key: "dueAt",
  label: "截止时间",
  type: "date"
}, {
  key: "createdAt",
  label: "创建时间",
  type: "date"
}, {
  key: "updatedAt",
  label: "更新时间",
  type: "date"
}, {
  key: "completedAt",
  label: "完成时间",
  type: "date"
}, {
  key: "source",
  label: "来源",
  type: "text"
}, {
  key: "taskNo",
  label: "系统编号",
  type: "text"
}, {
  key: "databaseId",
  label: "数据库 ID",
  type: "number"
}, {
  key: "notes",
  label: "备注",
  type: "text"
}, {
  key: "starred",
  label: "星标",
  type: "boolean"
}, {
  key: "important",
  label: "重要",
  type: "boolean"
}, {
  key: "urgent",
  label: "紧急",
  type: "boolean"
}, {
  key: "isPinned",
  label: "置顶",
  type: "boolean"
}];
const operators = {
  text: [["contains", "包含"], ["not_contains", "不包含"], ["equals", "是"], ["not_equals", "不是"], ["starts_with", "开头是"], ["ends_with", "结尾是"], ["is_empty", "为空"], ["not_empty", "不为空"]],
  select: [["equals", "是"], ["not_equals", "不是"], ["is_empty", "为空"], ["not_empty", "不为空"]],
  number: [["equals", "等于"], ["not_equals", "不等于"], ["greater", "大于"], ["greater_equal", "大于等于"], ["less", "小于"], ["less_equal", "小于等于"], ["between", "介于"], ["is_empty", "为空"], ["not_empty", "不为空"]],
  date: [["in_preset", "属于动态日期"], ["not_in_preset", "不属于动态日期"], ["on", "是"], ["not_on", "不是"], ["before", "早于"], ["on_or_before", "早于或等于"], ["after", "晚于"], ["on_or_after", "晚于或等于"], ["between", "介于"], ["is_empty", "为空"], ["not_empty", "不为空"]],
  boolean: [["is_true", "是"], ["is_false", "否"]]
};
export const dynamicDateOptions = [["today", "今日"], ["yesterday", "昨日"], ["tomorrow", "明日"], ["last7", "近 7 日"], ["last30", "近 30 日"], ["thisWeek", "本周"], ["lastWeek", "上周"], ["thisMonth", "本月"], ["next7", "未来 7 日"], ["next30", "未来 30 日"], ["thisYear", "今年"], ["lastYear", "去年"]];
function conditionId() {
  return globalThis.crypto?.randomUUID?.() || `condition-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function fieldDefinition(field) {
  return taskFilterFields.find(item => item.key === field) || taskFilterFields[0];
}
export function createTaskCondition(field = "status", patch = {}) {
  const definition = fieldDefinition(field);
  const operator = operators[definition.type][0][0];
  const defaults = field === "status" ? {
    value: "未完成"
  } : definition.type === "date" ? {
    value: "today"
  } : definition.type === "number" ? {
    value: ""
  } : {
    value: ""
  };
  return {
    id: conditionId(),
    field,
    operator,
    ...defaults,
    ...patch
  };
}
export function defaultTaskFilterState() {
  return {
    logic: "and",
    conditions: [createTaskCondition("status")],
    sort: "created"
  };
}
function legacyConditions(filters = {}) {
  const rows = [];
  const add = (field, operator, value, value2) => {
    if (value === "" || value === null || value === undefined || value === false) return;
    rows.push(createTaskCondition(field, {
      operator,
      value,
      value2
    }));
  };
  add("status", "equals", filters.status);
  add("projectId", "equals", filters.projectId);
  add("tagId", "equals", filters.tagId);
  add("source", "contains", filters.source);
  add("taskNo", "contains", filters.taskNo);
  add("databaseId", "equals", filters.databaseId);
  for (const [prefix, field] of [["start", "startAt"], ["due", "dueAt"], ["created", "createdAt"]]) {
    if (filters[`${prefix}Preset`]) add(field, "in_preset", filters[`${prefix}Preset`]);else if (filters[`${prefix}From`] && filters[`${prefix}To`]) add(field, "between", filters[`${prefix}From`], filters[`${prefix}To`]);else if (filters[`${prefix}From`]) add(field, "on_or_after", filters[`${prefix}From`]);else if (filters[`${prefix}To`]) add(field, "on_or_before", filters[`${prefix}To`]);
  }
  if (filters.starred) rows.push(createTaskCondition("starred", {
    operator: "is_true"
  }));
  if (filters.important) rows.push(createTaskCondition("important", {
    operator: "is_true"
  }));
  if (filters.urgent) rows.push(createTaskCondition("urgent", {
    operator: "is_true"
  }));
  return rows;
}
export function normalizeTaskFilters(filters) {
  if (Array.isArray(filters?.conditions)) {
    return {
      logic: filters.logic === "or" ? "or" : "and",
      conditions: filters.conditions.slice(0, 30).map(condition => ({
        ...createTaskCondition(condition.field),
        ...condition,
        id: condition.id || conditionId()
      })),
      sort: filters.sort || "created"
    };
  }
  const conditions = legacyConditions(filters);
  return {
    logic: "and",
    conditions: conditions.length ? conditions : [],
    sort: filters?.sort || "created"
  };
}
function selectOptions(field, meta) {
  if (field === "status") return statuses.map(value => [value, value]);
  if (field === "listId") return (meta.lists || []).map(item => [String(item.id), item.name]);
  if (field === "projectId") return (meta.projects || []).map(item => [String(item.id), item.name]);
  if (field === "tagId") return (meta.tags || []).map(item => [String(item.id), item.name]);
  if (field === "priority") return [["normal", "普通"], ["important", "重要"], ["urgent", "紧急"], ["both", "重要且紧急"]];
  return [];
}
function needsValue(operator) {
  return !["is_empty", "not_empty", "is_true", "is_false"].includes(operator);
}
function ConditionValue({
  condition,
  definition,
  meta,
  onPatch
}) {
  if (!needsValue(condition.operator)) return <span className="condition-no-value">无需填写值</span>;
  if (definition.type === "select") {
    return <OkrSelect value={condition.value ?? ""} onChange={event => onPatch({
      value: event.target.value
    })}>
        <option value="">请选择</option>
        {selectOptions(condition.field, meta).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </OkrSelect>;
  }
  if (definition.type === "date" && ["in_preset", "not_in_preset"].includes(condition.operator)) {
    return <OkrSelect value={condition.value || "today"} onChange={event => onPatch({
      value: event.target.value
    })}>{dynamicDateOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</OkrSelect>;
  }
  const inputType = definition.type === "date" ? "date" : definition.type === "number" ? "number" : "text";
  return <div className={`condition-value ${condition.operator === "between" ? "between" : ""}`}>
      <OkrInput type={inputType} value={condition.value ?? ""} onChange={event => onPatch({
      value: event.target.value
    })} placeholder="输入筛选值" />
      {condition.operator === "between" && <><span>至</span><OkrInput type={inputType} value={condition.value2 ?? ""} onChange={event => onPatch({
        value2: event.target.value
      })} /></>}
    </div>;
}
export function TaskConditionRows({
  value,
  onChange,
  meta,
  emptyLabel = "还没有筛选条件"
}) {
  const state = normalizeTaskFilters(value);
  const updateCondition = (id, patch) => onChange({
    ...state,
    conditions: state.conditions.map(condition => {
      if (condition.id !== id) return condition;
      if (patch.field) return createTaskCondition(patch.field, {
        id,
        field: patch.field
      });
      return {
        ...condition,
        ...patch
      };
    })
  });
  return <div className="condition-builder">
      <div className="condition-builder-heading">
        <SlidersHorizontal size={15} />
        <span>符合</span>
        <OkrSelect aria-label="筛选关系" value={state.logic} onChange={event => onChange({
        ...state,
        logic: event.target.value
      })}>
          <option value="and">全部条件</option>
          <option value="or">任一条件</option>
        </OkrSelect>
      </div>
      <div className="condition-rows">
        {state.conditions.map((condition, index) => {
        const definition = fieldDefinition(condition.field);
        return <div className="condition-row" key={condition.id}>
              <span className="condition-index">{index + 1}</span>
              <OkrSelect aria-label={`条件 ${index + 1} 字段`} value={condition.field} onChange={event => updateCondition(condition.id, {
            field: event.target.value
          })}>
                {taskFilterFields.map(field => <option key={field.key} value={field.key}>{field.label}</option>)}
              </OkrSelect>
              <OkrSelect aria-label={`条件 ${index + 1} 逻辑`} value={condition.operator} onChange={event => updateCondition(condition.id, {
            operator: event.target.value,
            value2: ""
          })}>
                {operators[definition.type].map(([operator, label]) => <option key={operator} value={operator}>{label}</option>)}
              </OkrSelect>
              <ConditionValue condition={condition} definition={definition} meta={meta} onPatch={patch => updateCondition(condition.id, patch)} />
              <OkrButton className="icon-only danger-text" onClick={() => onChange({
            ...state,
            conditions: state.conditions.filter(item => item.id !== condition.id)
          })} title="删除条件"><Trash2 size={14} /></OkrButton>
            </div>;
      })}
        {!state.conditions.length && <div className="condition-empty">{emptyLabel}</div>}
      </div>
      <OkrButton className="condition-add" onClick={() => onChange({
      ...state,
      conditions: [...state.conditions, createTaskCondition(state.conditions.length ? "title" : "status")]
    })}><Plus size={14} />新增筛选条件</OkrButton>
    </div>;
}
function beijingDay(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}
function shiftDay(day, amount) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
function dynamicRange(preset) {
  const today = beijingDay(new Date());
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const monthStart = `${today.slice(0, 8)}01`;
  const monthEndDate = new Date(`${monthStart}T12:00:00Z`);
  monthEndDate.setUTCMonth(monthEndDate.getUTCMonth() + 1);
  monthEndDate.setUTCDate(0);
  const ranges = {
    today: [today, today],
    yesterday: [shiftDay(today, -1), shiftDay(today, -1)],
    tomorrow: [shiftDay(today, 1), shiftDay(today, 1)],
    last7: [shiftDay(today, -6), today],
    last30: [shiftDay(today, -29), today],
    next7: [today, shiftDay(today, 6)],
    next30: [today, shiftDay(today, 29)],
    thisWeek: [shiftDay(today, mondayOffset), shiftDay(today, mondayOffset + 6)],
    lastWeek: [shiftDay(today, mondayOffset - 7), shiftDay(today, mondayOffset - 1)],
    thisMonth: [monthStart, monthEndDate.toISOString().slice(0, 10)],
    thisYear: [`${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`],
    lastYear: [`${Number(today.slice(0, 4)) - 1}-01-01`, `${Number(today.slice(0, 4)) - 1}-12-31`]
  };
  return ranges[preset] || null;
}
function taskFieldValue(task, field) {
  if (field === "title") return task.title || "";
  if (field === "status") return task.status || "";
  if (field === "listId") return String(task.listId || "");
  if (field === "projectId") return String(task.projectId || "");
  if (field === "tagId") return (task.tagDetails || []).map(item => String(item.id));
  if (field === "priority") return task.important && task.urgent ? "both" : task.important ? "important" : task.urgent ? "urgent" : "normal";
  if (["startAt", "dueAt"].includes(field)) return String(task[field] || "").slice(0, 10);
  if (["createdAt", "updatedAt", "completedAt"].includes(field)) return beijingDay(task[field]);
  if (field === "source") return task.source || "";
  if (field === "taskNo") return task.taskNo || "";
  if (field === "databaseId") return Number(task.id);
  if (field === "notes") return task.notes || "";
  if (["starred", "important", "urgent", "isPinned"].includes(field)) return Boolean(task[field]);
  return "";
}
export function taskConditionMatches(task, condition) {
  const definition = fieldDefinition(condition.field);
  const actual = taskFieldValue(task, condition.field);
  const expected = condition.value;
  const empty = Array.isArray(actual) ? actual.length === 0 : actual === "" || actual === null || actual === undefined;
  if (condition.operator === "is_empty") return empty;
  if (condition.operator === "not_empty") return !empty;
  if (condition.operator === "is_true") return actual === true;
  if (condition.operator === "is_false") return actual === false;
  if (Array.isArray(actual)) return condition.operator === "not_equals" ? !actual.includes(String(expected)) : actual.includes(String(expected));
  if (definition.type === "text") {
    const left = String(actual).toLocaleLowerCase("zh-CN");
    const right = String(expected ?? "").toLocaleLowerCase("zh-CN");
    if (condition.operator === "contains") return left.includes(right);
    if (condition.operator === "not_contains") return !left.includes(right);
    if (condition.operator === "starts_with") return left.startsWith(right);
    if (condition.operator === "ends_with") return left.endsWith(right);
  }
  if (definition.type === "date" && ["in_preset", "not_in_preset"].includes(condition.operator)) {
    const range = dynamicRange(expected);
    const match = Boolean(range && actual && actual >= range[0] && actual <= range[1]);
    return condition.operator === "not_in_preset" ? !match : match;
  }
  if (condition.operator === "between") return actual >= condition.value && actual <= condition.value2;
  if (["equals", "on"].includes(condition.operator)) return String(actual) === String(expected);
  if (["not_equals", "not_on"].includes(condition.operator)) return String(actual) !== String(expected);
  if (["greater", "after"].includes(condition.operator)) return actual > expected;
  if (["greater_equal", "on_or_after"].includes(condition.operator)) return actual >= expected;
  if (["less", "before"].includes(condition.operator)) return actual < expected;
  if (["less_equal", "on_or_before"].includes(condition.operator)) return actual <= expected;
  return false;
}
export function taskFilterMatches(task, filter) {
  const state = normalizeTaskFilters(filter);
  if (!state.conditions.length) return true;
  return state.logic === "or" ? state.conditions.some(condition => taskConditionMatches(task, condition)) : state.conditions.every(condition => taskConditionMatches(task, condition));
}
