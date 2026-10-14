import { OkrSelect } from "./okr-ui.jsx";
import { OkrButton, OkrInput } from "./okr-ui.jsx";
import React, { useEffect, useMemo, useState } from "react";
import { Activity, Check, CircleX, Copy, Cloud, Database, FileClock, FolderPlus, Gauge, KeyRound, ListFilter, LoaderCircle, MonitorCog, Moon, Pin, Plus, RefreshCw, ScrollText, ShieldCheck, Sun, Sunrise, Trash2, TriangleAlert } from "lucide-react";
import { api, trackAnalyticsEvent } from "./api.js";
import { AnimatedChart, AnimatedKpi } from "./AnimatedChart.jsx";
import { useSettingsResource } from "./useSettingsResource.js";
import { ResourceState, SettingsFeedback, SettingTimeInput } from "./WorkspaceControls.jsx";
const dateFields = [["startAt", "开始时间"], ["dueAt", "截止时间"], ["createdAt", "创建时间"], ["updatedAt", "更新时间"], ["completedAt", "完成时间"]];
const changelog = [{
  version: "0.1.0",
  title: "独立社区版",
  items: ["任务与清单、日程、SOP、文档中心和基础设置", "空白数据初始化，不包含私人集成"]
}];
export function ListDisplaySettings({
  meta,
  onRefresh,
  onNotice
}) {
  const [modeName, setModeName] = useState("");
  const [selectedModeId, setSelectedModeId] = useState(meta.modes.find(item => item.isDefault)?.id || meta.modes[0]?.id || null);
  const selectedModeItems = useMemo(() => meta.modeItems.filter(item => item.modeId === selectedModeId), [meta.modeItems, selectedModeId]);
  const selectedListIds = new Set(selectedModeItems.map(item => item.listId));
  useEffect(() => {
    if (!meta.modes.some(mode => mode.id === selectedModeId)) {
      setSelectedModeId(meta.modes.find(mode => mode.isDefault)?.id || meta.modes[0]?.id || null);
    }
  }, [meta.modes, selectedModeId]);
  const toggleModeList = async listId => {
    const next = selectedListIds.has(listId) ? selectedModeItems.filter(item => item.listId !== listId).map(item => item.listId) : [...selectedModeItems.map(item => item.listId), listId];
    await api(`/api/list-modes/${selectedModeId}/lists`, {
      method: "PUT",
      body: JSON.stringify({
        listIds: next
      })
    });
    await onRefresh();
    onNotice?.("清单显示模式已保存");
  };
  return <section className="settings-section embedded-settings-section">
      <header><div><span>清单系统</span><h2>不同模式显示不同清单</h2></div></header>
      <form className="inline-create" onSubmit={async event => {
      event.preventDefault();
      if (!modeName.trim()) return;
      const mode = await api("/api/list-modes", {
        method: "POST",
        body: JSON.stringify({
          name: modeName.trim()
        })
      });
      setModeName("");
      setSelectedModeId(mode.id);
      await onRefresh();
      onNotice?.("显示模式已创建");
    }}>
        <Plus size={16} />
        <OkrInput aria-label="新模式名称" placeholder="例如：工作模式" value={modeName} onChange={event => setModeName(event.target.value)} />
        <OkrButton disabled={!modeName.trim()} title="新建模式"><Plus size={15} /></OkrButton>
      </form>
      <div className="mode-editor">
        <div className="mode-list">
          {meta.modes.map(mode => <OkrButton className={selectedModeId === mode.id ? "active" : ""} key={mode.id} onClick={() => setSelectedModeId(mode.id)}>
              <span>{mode.name}</span>{mode.isDefault && <small>默认</small>}
            </OkrButton>)}
        </div>
        <div className="mode-checklist">
          {meta.lists.map(list => <label key={list.id}>
              <OkrInput checked={selectedListIds.has(list.id)} onChange={() => toggleModeList(list.id)} type="checkbox" />
              <i style={{
            background: list.color
          }} />
              <span>{list.name}</span>
            </label>)}
        </div>
      </div>
      {!meta.modes.find(mode => mode.id === selectedModeId)?.isDefault && selectedModeId && <OkrButton className="danger-text-button" onClick={async () => {
      await api(`/api/list-modes/${selectedModeId}`, {
        method: "DELETE"
      });
      setSelectedModeId(meta.modes.find(mode => mode.isDefault)?.id || null);
      await onRefresh();
      onNotice?.("显示模式已删除");
    }}><Trash2 size={14} />删除当前模式</OkrButton>}
    </section>;
}
const analyticsModuleLabels = {
  task: "任务系统",
  calendar: "日程系统",
  sop: "SOP系统",
  settings: "系统设置",
  system: "系统稳定性"
};
const analyticsSourceLabels = {
  web: "网页"
};
const analyticsEventLabels = {
  "page.open": "打开页面",
  "task.create": "新建任务",
  "task.update": "修改任务",
  "task.complete": "完成任务",
  "task.discard": "放弃任务",
  "task.delete": "删除任务",
  "task.schedule": "调整任务时间",
  "task.transfer": "转移任务",
  "task.view_switch": "切换任务视图",
  "filter_template.apply": "使用筛选模板",
  "clipboard.quick_add": "剪切板快速添加",
  "calendar.event_create": "新建普通日程",
  "calendar.recurring_create": "新建重复日程",
  "calendar.event_update": "修改日程",
  "calendar.event_cancel": "取消日程",
  "calendar.convert_to_task": "日程转任务",
  "calendar.view_switch": "切换日历视图",
  "sop.execution_complete": "完成SOP事件",
  "sop.theme_complete": "完成SOP主题",
  "sop.theme_trigger": "运行SOP主题",
  "sop.scheduler_run": "运行SOP调度",
  "frontend.error": "前端页面异常",
  "frontend.unhandled_rejection": "前端程序异常",
  "frontend.render_crash": "页面渲染空白",
  "api.read_failed": "读取接口失败",
  "api.slow_read": "读取接口缓慢"
};
function analyticsLabel(value, labels) {
  return labels[value] || String(value || "未知").replaceAll("_", " ");
}
function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
function formatDuration(value) {
  const duration = Number(value || 0);
  return duration >= 1000 ? `${(duration / 1000).toFixed(1)} 秒` : `${duration} 毫秒`;
}
function AnalyticsPage({
  embedded = false
}) {
  const [days, setDays] = useState(30);
  const [moduleFilter, setModuleFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      days: String(days)
    });
    if (moduleFilter) params.set("module", moduleFilter);
    if (sourceFilter) params.set("source", sourceFilter);
    api(`/api/analytics/overview?${params}`).then(result => active && setData(result)).catch(nextError => active && setError(nextError.message || "使用统计读取失败")).finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [days, moduleFilter, sourceFilter, reloadKey]);
  const maxTrend = Math.max(1, ...(data?.trend || []).map(item => Number(item.count || 0)));
  const maxFeature = Math.max(1, ...(data?.features || []).map(item => Number(item.count || 0)));
  const maxModule = Math.max(1, ...(data?.modules || []).map(item => Number(item.count || 0)));
  const maxSource = Math.max(1, ...(data?.sources || []).map(item => Number(item.count || 0)));
  const trendChart = data ? {
    labels: data.trend.map(item => item.date.slice(5)),
    datasets: [{
      label: "有效操作",
      data: data.trend.map(item => Number(item.count || 0)),
      borderColor: "#3976e8",
      backgroundColor: "#3976e824",
      fill: true,
      tension: 0.36,
      pointRadius: 0,
      pointHoverRadius: 4
    }, {
      label: "失败",
      data: data.trend.map(item => Number(item.failed || 0)),
      borderColor: "#e5484d",
      backgroundColor: "transparent",
      tension: 0.3,
      pointRadius: 0,
      pointHoverRadius: 4
    }]
  } : {
    labels: [],
    datasets: []
  };
  const moduleChart = data ? {
    labels: data.modules.map(item => analyticsLabel(item.name, analyticsModuleLabels)),
    datasets: [{
      data: data.modules.map(item => Number(item.count || 0)),
      backgroundColor: ["#3976e8", "#22a06b", "#8b5cf6", "#e6a23c", "#32ade6", "#64748b", "#f472b6"],
      borderWidth: 0
    }]
  } : {
    labels: [],
    datasets: []
  };
  const sourceChart = data ? {
    labels: data.sources.map(item => analyticsLabel(item.name, analyticsSourceLabels)),
    datasets: [{
      label: "使用次数",
      data: data.sources.map(item => Number(item.count || 0)),
      backgroundColor: "#32ade6",
      borderRadius: 4
    }]
  } : {
    labels: [],
    datasets: []
  };
  return <section className="settings-section analytics-section">
      <header>
        {!embedded && <h2>使用统计</h2>}
        <OkrButton onClick={() => setReloadKey(value => value + 1)} title="刷新使用统计"><RefreshCw className={loading ? "spin" : ""} size={15} /></OkrButton>
      </header>
      <div className="analytics-toolbar">
        <div className="analytics-segments" aria-label="统计范围">
          {[7, 30, 90, 365].map(value => <OkrButton className={days === value ? "active" : ""} key={value} onClick={() => setDays(value)}>近 {value} 天</OkrButton>)}
        </div>
        <OkrSelect aria-label="筛选功能模块" value={moduleFilter} onChange={event => setModuleFilter(event.target.value)}>
          <option value="">全部模块</option>
          {Object.entries(analyticsModuleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </OkrSelect>
        <OkrSelect aria-label="筛选使用渠道" value={sourceFilter} onChange={event => setSourceFilter(event.target.value)}>
          <option value="">全部渠道</option>
          {Object.entries(analyticsSourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </OkrSelect>
      </div>

      {loading && !data ? <div className="table-state"><LoaderCircle className="spin" size={18} />正在汇总使用统计</div> : error ? <div className="analytics-error"><TriangleAlert size={18} /><span>{error}</span></div> : data && <>
        <div className="analytics-metrics">
          <article><Activity size={16} /><span>有效操作</span><strong><AnimatedKpi value={data.summary.total} /></strong></article>
          <article><Check size={16} /><span>成功率</span><strong><AnimatedKpi value={data.summary.successRate} suffix="%" /></strong></article>
          <article><TriangleAlert size={16} /><span>失败次数</span><strong><AnimatedKpi value={data.summary.failed} /></strong></article>
          <article><Gauge size={16} /><span>平均响应</span><strong>{formatDuration(data.summary.averageDurationMs)}</strong></article>
          <article><Gauge size={16} /><span>95%响应</span><strong>{formatDuration(data.summary.p95DurationMs)}</strong></article>
          <article><Database size={16} /><span>永久明细</span><strong><AnimatedKpi value={data.storage.eventCount} suffix=" 条" /></strong><small>预计 {formatBytes(data.storage.estimatedBytes)}</small></article>
        </div>

        <section className="analytics-panel analytics-trend-panel">
          <header><div><span>每日有效操作</span><h3>使用趋势</h3></div><b>{data.range.startDate} 至 {data.range.endDate}</b></header>
          {data.trend.length === 0 ? <div className="analytics-empty">埋点从本版本上线后开始累计</div> : <AnimatedChart ariaLabel="系统使用与失败趋势" data={trendChart} height={250} type="line" options={{
          scales: {
            x: {
              grid: {
                display: false
              },
              ticks: {
                maxTicksLimit: 8
              }
            },
            y: {
              beginAtZero: true,
              ticks: {
                precision: 0
              }
            }
          }
        }} />}
        </section>

        <div className="analytics-split">
          <section className="analytics-panel"><header><div><span>各系统使用量</span><h3>模块分布</h3></div></header><AnimatedChart ariaLabel="使用模块分布" data={moduleChart} height={230} type="doughnut" options={{
            cutout: "64%",
            plugins: {
              legend: {
                display: true,
                position: "bottom",
                labels: {
                  boxWidth: 8,
                  usePointStyle: true
                }
              }
            }
          }} /></section>
          <section className="analytics-panel"><header><div><span>操作来源</span><h3>渠道分布</h3></div></header><AnimatedChart ariaLabel="使用渠道排名" data={sourceChart} height={230} type="bar" options={{
            indexAxis: "y",
            scales: {
              x: {
                beginAtZero: true,
                ticks: {
                  precision: 0
                }
              },
              y: {
                grid: {
                  display: false
                }
              }
            }
          }} /></section>
        </div>

        <section className="analytics-panel">
          <header><div><span>按实际使用次数排序</span><h3>功能使用排名</h3></div></header>
          <div className="analytics-feature-table"><div className="head"><span>功能</span><span>模块</span><span>使用量</span><span>失败</span><span>占比</span></div>{data.features.map(item => <div key={`${item.module}-${item.eventName}`}><b>{analyticsLabel(item.eventName, analyticsEventLabels)}</b><span>{analyticsLabel(item.module, analyticsModuleLabels)}</span><strong>{Number(item.count).toLocaleString()}</strong><em>{Number(item.failed).toLocaleString()}</em><i><b style={{
                width: `${Number(item.count) / maxFeature * 100}%`
              }} /></i></div>)}</div>
        </section>

        <section className="analytics-panel">
          <header><div><span>最近20条，仅保存错误类型</span><h3>失败记录</h3></div></header>
          {data.recentFailures.length === 0 ? <div className="analytics-empty success"><Check size={16} />当前范围没有失败记录</div> : <div className="analytics-failures"><div className="head"><span>时间</span><span>功能</span><span>渠道</span><span>错误</span><span>耗时</span></div>{data.recentFailures.map(item => <div key={item.id}><time>{new Date(item.occurredAt).toLocaleString("zh-CN", {
                hour12: false
              })}</time><b>{analyticsLabel(item.eventName, analyticsEventLabels)}</b><span>{analyticsLabel(item.source, analyticsSourceLabels)}</span><code>{item.errorCode || "unknown"}</code><span>{formatDuration(item.durationMs)}</span></div>)}</div>}
        </section>
      </>}
    </section>;
}
function SystemLogPage({
  embedded = false
}) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = () => {
    setLoading(true);
    setError("");
    Promise.all([api("/api/analytics/events?limit=50&offset=0"), api("/api/logs?limit=50&offset=0")]).then(([events, logs]) => setState({
      events: events.data || [],
      logs: logs.data || []
    })).catch(nextError => setError(nextError.message || "系统日志读取失败")).finally(() => setLoading(false));
  };
  useEffect(load, []);
  const timeLabel = value => value ? new Date(value).toLocaleString("zh-CN", {
    hour12: false
  }) : "-";
  return <section className="settings-section system-log-page">
    <header>{!embedded && <h2>系统日志</h2>}<OkrButton onClick={load} title="刷新系统日志"><RefreshCw className={loading ? "spin" : ""} size={15} /></OkrButton></header>
    {loading && !state ? <div className="table-state"><LoaderCircle className="spin" size={18} />正在读取系统日志</div> : error ? <div className="analytics-error"><TriangleAlert size={18} /><span>{error}</span></div> : state && <div className="system-log-grid">
      <section><header><b>最近功能事件</b><span>{state.events.length} 条</span></header><div>{state.events.map(item => <article key={`event-${item.id}`}><time>{timeLabel(item.occurredAt)}</time><span><b>{item.eventName}</b><small>{item.module} · {item.source} · {item.page || "未标记页面"}</small></span><IntegrationBadge active={item.result !== "failed"}>{item.result}</IntegrationBadge></article>)}{state.events.length === 0 && <p>暂无功能事件</p>}</div></section>
      <section><header><b>最近任务日志</b><span>{state.logs.length} 条</span></header><div>{state.logs.map(item => <article key={`log-${item.id}`}><time>{timeLabel(item.occurredAt)}</time><span><b>{item.eventType || "任务事件"}</b><small>{item.taskNo || "无任务号"} · {item.source || "系统"}</small></span><em>{item.taskStatus || "-"}</em></article>)}{state.logs.length === 0 && <p>暂无任务日志</p>}</div></section>
    </div>}
  </section>;
}
const settingsTabs = [["appearance", "外观", MonitorCog], ["task", "任务视图", ListFilter], ["lists", "清单整理", FolderPlus], ["analytics", "使用统计", Activity], ["changelog", "更新日志", ScrollText], ["system-log", "系统日志", FileClock]];
const completionCelebrationKey = "life-task-okr:completion-celebration";
function IntegrationBadge({
  active,
  children
}) {
  return <span className={`integration-badge ${active ? "active" : "inactive"}`}>{children}</span>;
}
export function SettingsPage({
  activeTab = "appearance",
  hideTabs = false,
  meta,
  onRefresh,
  onTabChange = () => {},
  onThemeChanged,
  onNotice
}) {
  const [folderName, setFolderName] = useState("");
  const resource = useSettingsResource("/api/meta", {
    initial: meta.settings || {},
    selectResponse: value => value.settings,
    writeEndpoint: "/api/settings",
    onNotice,
    onSaved: async () => {
      await onRefresh();
      onThemeChanged?.();
    }
  });
  const settings = resource.state || meta.settings || {};
  const [taskFontSize, setTaskFontSize] = useState(() => Math.max(13, Number(settings.task_table_font_size) || 13));
  const [sopFontSize, setSopFontSize] = useState(() => Number(settings.sop_table_font_size) || 11);
  const [completionCelebration, setCompletionCelebration] = useState(() => {
    try {
      return localStorage.getItem(completionCelebrationKey) === "true";
    } catch {
      return false;
    }
  });
  const [appearanceNotice, setAppearanceNotice] = useState("");
  useEffect(() => {
    setTaskFontSize(Math.max(13, Number(settings.task_table_font_size) || 13));
    setSopFontSize(Number(settings.sop_table_font_size) || 11);
  }, [settings.task_table_font_size, settings.sop_table_font_size]);
  const saveSettings = resource.save;
  const patchList = async (listId, patch) => {
    await api(`/api/lists/${listId}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
    await onRefresh();
  };
  return <section className="settings-page settings-workspace workspace-settings-form">
      <SettingsFeedback saving={resource.saving} error={resource.saveError} />
      {resource.error && <ResourceState error={resource.error} onRetry={resource.reload} />}
      {!hideTabs && <nav className="settings-tabs" aria-label="设置分类">
        {settingsTabs.map(([id, label, Icon]) => <OkrButton className={activeTab === id ? "active" : ""} key={id} onClick={() => {
        onTabChange(id);
        trackAnalyticsEvent({
          module: "settings",
          eventName: "settings.tab_open",
          metadata: {
            tab: id
          }
        });
      }}>
            <Icon size={15} /><span>{label}</span>
          </OkrButton>)}
      </nav>}

      {activeTab === "appearance" && <section className="settings-section workspace-appearance">
          {!hideTabs && <header><h2>外观</h2></header>}
          <section className="workspace-appearance-section">
          <h3>界面主题</h3>
          <div className="theme-options" role="group" aria-label="界面主题">
            {[["light", "白天", Sun], ["dark", "黑夜", Moon], ["auto", "自动", Sunrise]].map(([value, label, Icon]) => <OkrButton className={settings.theme_mode === value ? "active" : ""} key={value} onClick={() => saveSettings({
            theme_mode: value
          })}>
                <Icon size={17} /><span>{label}</span>{settings.theme_mode === value && <Check size={14} />}
              </OkrButton>)}
          </div>
          {settings.theme_mode === "auto" && <div className="time-settings">
              <label>白天开始<SettingTimeInput value={settings.light_start || "07:00"} onCommit={value => saveSettings({
              light_start: value
            })} /></label>
              <label>黑夜开始<SettingTimeInput value={settings.dark_start || "19:00"} onCommit={value => saveSettings({
              dark_start: value
            })} /></label>
            </div>}
          </section>
          <section className="workspace-appearance-section">
          <h3>数据库字号</h3>
          <div className="font-size-settings">
            <label>
              <span><b>任务</b><output>{Number(taskFontSize.toFixed(2))} px</output></span>
              <OkrInput aria-label="任务数据库字体大小" max="16" min="13" onChange={event => setTaskFontSize(Number(event.target.value))} onPointerUp={() => saveSettings({
              task_table_font_size: taskFontSize
            })} onKeyUp={() => saveSettings({
              task_table_font_size: taskFontSize
            })} step="0.25" type="range" value={taskFontSize} />
            </label>
            <label>
              <span><b>SOP</b><output>{Number(sopFontSize.toFixed(2))} px</output></span>
              <OkrInput aria-label="SOP 数据库字体大小" max="16" min="9" onChange={event => setSopFontSize(Number(event.target.value))} onPointerUp={() => saveSettings({
              sop_table_font_size: sopFontSize
            })} onKeyUp={() => saveSettings({
              sop_table_font_size: sopFontSize
            })} step="0.25" type="range" value={sopFontSize} />
            </label>
          </div>
          <div className="font-preview" aria-label="数据库字体预览">
            <div><span>任务内容</span><span>状态</span><span>创建时间</span></div>
            <div style={{
            fontSize: `${taskFontSize}px`
          }}><b>整理本周工作任务与后续计划</b><em>未完成</em><time>今天 09:20</time></div>
            <div style={{
            fontSize: `${sopFontSize}px`
          }}><b>检查每日 SOP 执行事项</b><em>待处理</em><time>今天 10:00</time></div>
          </div>
          </section>
          <section className="workspace-appearance-section">
            <h3>完成反馈</h3>
            <label className="workspace-celebration-option"><span>完成庆祝效果</span><OkrInput type="checkbox" checked={completionCelebration} onChange={event => {
            const enabled = event.target.checked;
            try {
              localStorage.setItem(completionCelebrationKey, String(enabled));
              setCompletionCelebration(enabled);
              setAppearanceNotice("");
            } catch {
              setAppearanceNotice("设置未保存，请检查浏览器存储权限");
            }
          }} /></label>
            {appearanceNotice && <p role="alert">{appearanceNotice}</p>}
          </section>
        </section>}

      {activeTab === "task" && <section className="settings-section">
          <header><h2>默认视图与日期字段</h2></header>
          <div className="settings-form-grid">
            <label>默认任务视图<OkrSelect value={settings.default_task_view || "table"} onChange={event => saveSettings({
            default_task_view: event.target.value
          })}><option value="table">数据库表格</option><option value="calendar">日历</option><option value="gantt">甘特图</option></OkrSelect></label>
            <label>日历日期字段<OkrSelect value={settings.calendar_date_field || "dueAt"} onChange={event => saveSettings({
            calendar_date_field: event.target.value
          })}>{dateFields.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</OkrSelect></label>
            <label>甘特开始字段<OkrSelect value={settings.gantt_start_field || "startAt"} onChange={event => saveSettings({
            gantt_start_field: event.target.value
          })}>{dateFields.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</OkrSelect></label>
            <label>甘特结束字段<OkrSelect value={settings.gantt_end_field || "dueAt"} onChange={event => saveSettings({
            gantt_end_field: event.target.value
          })}>{dateFields.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</OkrSelect></label>
          </div>
        </section>}

      {activeTab === "lists" && <section className="settings-section">
          <header><h2>置顶与文件夹</h2></header>
          <form className="inline-create" onSubmit={async event => {
        event.preventDefault();
        if (!folderName.trim()) return;
        await api("/api/list-folders", {
          method: "POST",
          body: JSON.stringify({
            name: folderName.trim()
          })
        });
        setFolderName("");
        await onRefresh();
      }}>
            <FolderPlus size={16} /><OkrInput aria-label="新文件夹名称" placeholder="新文件夹名称" value={folderName} onChange={event => setFolderName(event.target.value)} /><OkrButton disabled={!folderName.trim()} title="新建文件夹"><Plus size={15} /></OkrButton>
          </form>
          <div className="list-settings-table">
            {meta.lists.map(list => <div key={list.id}>
                <i style={{
            background: list.color
          }} /><b>{list.name}</b><span>{Number(list.taskCount || 0).toLocaleString()} 条</span>
                <OkrButton className={list.isPinned ? "active" : ""} onClick={() => patchList(list.id, {
            isPinned: !list.isPinned
          })} title={list.isPinned ? "取消置顶" : "置顶清单"}><Pin size={15} /></OkrButton>
                <OkrSelect aria-label={`${list.name}所属文件夹`} value={list.folderId || ""} onChange={event => patchList(list.id, {
            folderId: event.target.value ? Number(event.target.value) : null
          })}><option value="">无文件夹</option>{meta.folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</OkrSelect>
              </div>)}
          </div>
          {meta.folders.length > 0 && <div className="folder-admin">{meta.folders.map(folder => <span key={folder.id}>{folder.name}<OkrButton onClick={async () => {
            await api(`/api/list-folders/${folder.id}`, {
              method: "DELETE"
            });
            await onRefresh();
          }} title="删除文件夹"><Trash2 size={13} /></OkrButton></span>)}</div>}
        </section>}

      

      {activeTab === "analytics" && <AnalyticsPage embedded={hideTabs} />}

      {activeTab === "changelog" && <section className="settings-section changelog-section">
          <header><div><span>当前版本 1.19.0</span>{!hideTabs && <h2>更新日志</h2>}</div></header>
          <div className="changelog-list">{changelog.map((entry, index) => <article key={entry.version}><div><b>v{entry.version}</b>{index === 0 && <em>当前版本</em>}</div><section><h3>{entry.title}</h3><ul>{entry.items.map(item => <li key={item}>{item}</li>)}</ul></section></article>)}</div>
        </section>}

      

      {activeTab === "system-log" && <SystemLogPage embedded={hideTabs} />}
    </section>;
}
