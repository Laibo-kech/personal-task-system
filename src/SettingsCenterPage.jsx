import { OkrSelect } from "./okr-ui.jsx";
import { OkrButton, OkrInput } from "./okr-ui.jsx";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, Bot, CalendarRange, CheckCircle2, Cloud, Database, FileClock, Filter, FolderPlus, GripVertical, Link2, LoaderCircle, MonitorCog, PanelLeft, Pause, Play, RefreshCw, RotateCcw, Search, ShieldCheck, UploadCloud, Workflow, X } from "lucide-react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api, trackAnalyticsEvent } from "./api.js";
import { SettingsPage as LegacySettingsPage } from "./SettingsPage.jsx";
import { defaultNavigationConfig, navigationRegistry, normalizeNavigationConfig } from "./navigation-config.js";
import { routeHash, settingsRouteFromHash } from "./settings-routes.js";
import { useSettingsResource } from "./useSettingsResource.js";
import { ResourceState, SettingsFeedback, SettingTimeInput } from "./WorkspaceControls.jsx";
import { useAppDialog } from "./DialogContext.jsx";
import { navigationIcon } from "./navigation-ui.js";
import "./workspace-panels.css";
const themeSections = [{
  label: "界面与组织",
  themes: [{
    id: "appearance",
    title: "外观与显示",
    subtitle: "主题、时间与数据库字号",
    icon: MonitorCog,
    tone: "blue",
    items: [{
      id: "interface",
      title: "界面主题与数据库字号",
      subtitle: "白天、黑夜、自动切换和字号",
      legacyTab: "appearance"
    }]
  }, {
    id: "task",
    title: "任务与数据库",
    subtitle: "默认视图、字段和日期逻辑",
    icon: Filter,
    tone: "orange",
    items: [{
      id: "task-defaults",
      title: "默认视图与日期字段",
      subtitle: "数据库、日历和甘特图默认行为",
      legacyTab: "task"
    }]
  }, {
    id: "navigation",
    title: "导航与页面",
    subtitle: "一级菜单与顶部二级页面",
    icon: PanelLeft,
    tone: "indigo",
    items: [{
      id: "primary-navigation",
      title: "一级菜单",
      subtitle: "排序和显示状态",
      custom: "navigation-primary"
    }, {
      id: "secondary-navigation",
      title: "顶部二级页面",
      subtitle: "按系统配置页面顺序和显隐",
      custom: "navigation-secondary"
    }, {
      id: "navigation-reset",
      title: "恢复默认导航",
      subtitle: "恢复系统菜单与页面布局",
      custom: "navigation-reset"
    }]
  }, {
    id: "lists",
    title: "清单与项目",
    subtitle: "清单、文件夹、置顶和颜色",
    icon: FolderPlus,
    tone: "green",
    items: [{
      id: "list-organization",
      title: "清单组织",
      subtitle: "置顶、文件夹和清单归属",
      legacyTab: "lists"
    }]
  }]
}, {
  label: "业务系统",
  themes: [{
    id: "calendar",
    title: "日程与提醒",
    subtitle: "默认视图、时间、提醒和显示范围",
    icon: CalendarRange,
    tone: "red",
    items: [{
      id: "calendar-defaults",
      title: "日程默认行为",
      subtitle: "视图、开始时间、持续时间和提醒",
      custom: "calendar"
    }]
  }, {
    id: "sop",
    title: "SOP\u8BBE\u7F6E",
    subtitle: "\u8C03\u5EA6\u4E0E\u7EF4\u62A4",
    icon: Workflow,
    tone: "purple",
    items: [{
      id: "sop-scheduler",
      title: "SOP 调度",
      subtitle: "生成、维护和默认页面",
      custom: "sop"
    }]
  }]
}, {
  label: "系统",
  themes: [{
    id: "analytics",
    title: "使用统计",
    subtitle: "功能、渠道和失败趋势",
    icon: Activity,
    tone: "blue",
    items: [{
      id: "usage-analytics",
      title: "使用统计详情",
      subtitle: "趋势、功能和渠道分析",
      legacyTab: "analytics"
    }]
  }, {
    id: "changelog",
    title: "更新与版本",
    subtitle: "当前版本和历史更新",
    icon: UploadCloud,
    tone: "gray",
    items: [{
      id: "version-history",
      title: "版本记录",
      subtitle: "发布版本和变更说明",
      legacyTab: "changelog"
    }]
  }, {
    id: "system-log",
    title: "系统日志与诊断",
    subtitle: "功能事件、任务日志和运行状态",
    icon: FileClock,
    tone: "gray",
    items: [{
      id: "system-diagnostics",
      title: "系统日志",
      subtitle: "最近事件、错误和任务日志",
      legacyTab: "system-log"
    }]
  }]
}];
const registeredSettings = navigationRegistry.find(group => group.id === "system").pages;
for (const section of themeSections) for (const theme of section.themes) {
  const page = registeredSettings.find(item => item.target.tab === theme.id);
  if (page) {
    theme.title = page.label;
    theme.icon = navigationIcon(page.icon);
  }
}
const allThemes = themeSections.flatMap(section => section.themes);
const displayHourOptions = Array.from({
  length: 25
}, (_, hour) => ({
  value: `${String(hour).padStart(2, "0")}:00:00`,
  label: `${String(hour).padStart(2, "0")}:00`
}));
function themeById(id) {
  return allThemes.find(theme => theme.id === id) || allThemes[0];
}
function PcControlSection({
  children,
  footer,
  title
}) {
  return <section className="pc-control-section">
    {title && <header><h3>{title}</h3></header>}
    <div className="pc-control-body">{children}</div>
    {footer && <p>{footer}</p>}
  </section>;
}
function PcValueRow({
  children,
  label
}) {
  return <label className="pc-value-row"><span>{label}</span><div>{React.Children.map(children, child => React.isValidElement(child) ? React.cloneElement(child, {
        'aria-label': child.props['aria-label'] || label
      }) : child)}</div></label>;
}
function SettingsSidebar({
  onSelect,
  query,
  selectedThemeId,
  setQuery
}) {
  const normalized = query.trim().toLowerCase();
  const searchResults = useMemo(() => normalized ? allThemes.flatMap(theme => [...(`${theme.title}${theme.subtitle}`.toLowerCase().includes(normalized) ? [{
    theme,
    item: null,
    title: theme.title,
    subtitle: theme.subtitle
  }] : []), ...theme.items.filter(item => `${item.title}${item.subtitle}`.toLowerCase().includes(normalized)).map(item => ({
    theme,
    item,
    title: item.title,
    subtitle: item.subtitle
  }))]) : [], [normalized]);
  return <aside className="pc-settings-sidebar">
    <div className="pc-settings-sidebar-head">
      <h1>设置</h1>
      <label className="pc-settings-search"><Search size={16} /><OkrInput aria-label="搜索设置" placeholder="搜索设置" value={query} onChange={event => setQuery(event.target.value)} />{query && <OkrButton onClick={() => setQuery("")} title="清除搜索" type="button"><X size={14} /></OkrButton>}</label>
    </div>
    <nav aria-label="设置主题">
      {normalized ? <section><h2>搜索结果</h2>{searchResults.map(result => {
          const Icon = result.theme.icon;
          return <OkrButton key={`${result.theme.id}-${result.item?.id || "theme"}`} onClick={() => onSelect(result.theme.id, result.item?.id || null)} type="button">
          <span className="pc-setting-icon"><Icon size={17} /></span>
          <span><b>{result.title}</b>{result.item && <small>{result.theme.title}</small>}</span>
        </OkrButton>;
        })}{searchResults.length === 0 && <div className="pc-settings-empty"><Search size={20} /><b>没有找到设置</b><span>尝试搜索“日程”“导航”或“字号”</span></div>}</section> : themeSections.map(section => {
        return <section key={section.label}><h2>{section.label}</h2>{section.themes.map(theme => {
            const Icon = theme.icon;
            return <OkrButton aria-current={selectedThemeId === theme.id ? "page" : undefined} className={selectedThemeId === theme.id ? "active" : ""} key={theme.id} onClick={() => onSelect(theme.id)} type="button">
            <span className="pc-setting-icon"><Icon size={17} /></span>
            <span><b>{theme.title}</b></span>
          </OkrButton>;
          })}</section>;
      })}
    </nav>
  </aside>;
}
function CalendarSettingsDetail({
  onNotice
}) {
  const {
    state,
    save,
    loading,
    error,
    saveError,
    saving,
    reload
  } = useSettingsResource("/api/calendar/settings", {
    kind: "calendar",
    onNotice
  });
  if (!state || error) return <ResourceState loading={loading} error={error} onRetry={reload} />;
  return <>
    <SettingsFeedback saving={saving} error={saveError} />
    <PcControlSection title="默认行为">
      <PcValueRow label="默认视图"><OkrSelect value={state.default_view || "dayGridMonth"} onChange={event => save({
          default_view: event.target.value
        })}><option value="timeGridDay">日</option><option value="timeGridWeek">周</option><option value="dayGridMonth">月</option><option value="listMonth">议程</option></OkrSelect></PcValueRow>
      <PcValueRow label="默认开始时间"><SettingTimeInput value={state.default_start_time || "09:00"} onCommit={value => save({
          default_start_time: value
        })} /></PcValueRow>
      <PcValueRow label="默认持续时间"><OkrSelect value={state.default_duration_minutes || "60"} onChange={event => save({
          default_duration_minutes: event.target.value
        })}><option value="15">15 分钟</option><option value="30">30 分钟</option><option value="60">1 小时</option><option value="90">90 分钟</option><option value="120">2 小时</option></OkrSelect></PcValueRow>
      <PcValueRow label="默认提醒"><OkrSelect value={state.default_reminder_minutes ?? "10"} onChange={event => save({
          default_reminder_minutes: event.target.value
        })}><option value="0">不提醒</option><option value="10">提前 10 分钟</option><option value="30">提前 30 分钟</option><option value="60">提前 1 小时</option></OkrSelect></PcValueRow>
    </PcControlSection>
    <PcControlSection title="显示内容">
      <PcValueRow label="显示已完成任务"><OkrInput type="checkbox" checked={state.show_completed !== "0"} onChange={event => save({
          show_completed: event.target.checked ? "1" : "0"
        })} /></PcValueRow>
      <PcValueRow label="显示已废弃任务"><OkrInput type="checkbox" checked={state.show_discarded === "1"} onChange={event => save({
          show_discarded: event.target.checked ? "1" : "0"
        })} /></PcValueRow>
      <PcValueRow label="显示起始时间"><OkrSelect value={state.display_start_time || "06:00:00"} onChange={event => save({
          display_start_time: event.target.value
        })}>{displayHourOptions.slice(0, -1).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</OkrSelect></PcValueRow>
      <PcValueRow label="显示结束时间"><OkrSelect value={state.display_end_time || "24:00:00"} onChange={event => save({
          display_end_time: event.target.value
        })}>{displayHourOptions.slice(1).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</OkrSelect></PcValueRow>
    </PcControlSection>
  </>;
}
function SopSettingsDetail({
  onNotice
}) {
  const {
    state,
    save,
    loading,
    error,
    saveError,
    saving,
    reload
  } = useSettingsResource("/api/sop/settings", {
    kind: "sop",
    onNotice
  });
  if (!state || error) return <ResourceState loading={loading} error={error} onRetry={reload} />;
  return <><SettingsFeedback saving={saving} error={saveError} /><PcControlSection title="自动调度" footer="关闭后不会自动生成或维护执行事项。">
    <PcValueRow label="启用调度"><OkrInput type="checkbox" checked={state.scheduler_enabled === "1"} onChange={event => save({
          scheduler_enabled: event.target.checked ? "1" : "0"
        })} /></PcValueRow>
    <PcValueRow label="每日生成时间"><SettingTimeInput value={state.generation_time || "04:00"} onCommit={value => save({
          generation_time: value
        })} /></PcValueRow>
    <PcValueRow label="凌晨维护时间"><SettingTimeInput value={state.maintenance_time || "00:05"} onCommit={value => save({
          maintenance_time: value
        })} /></PcValueRow>
    <PcValueRow label="默认页面"><OkrSelect value={state.default_sop_tab || "today"} onChange={event => save({
          default_sop_tab: event.target.value
        })}><option value="today">待处理</option><option value="configs">主题与事件</option><option value="calendar">日历维护</option><option value="history">历史记录</option></OkrSelect></PcValueRow>
  </PcControlSection></>;
}
function SortableNavigationRow({
  children,
  id
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id
  });
  return <div className={`pc-navigation-row ${isDragging ? "dragging" : ""}`} ref={setNodeRef} style={{
    transform: CSS.Transform.toString(transform),
    transition
  }}><OkrButton className="pc-drag-handle" {...attributes} {...listeners} title="拖动排序"><GripVertical size={16} /></OkrButton>{children}</div>;
}
function NavigationPreview({
  group,
  registry
}) {
  const pageById = new Map(registry.pages.map(page => [page.id, page]));
  return <div className="pc-secondary-nav-preview"><span>顶部二级导航预览</span><div>{group.pages.filter(page => page.visible).map((page, index) => <OkrButton className={index === 0 ? "active" : ""} key={page.id} type="button">{pageById.get(page.id)?.label || page.id}</OkrButton>)}</div></div>;
}
function NavigationEditor({
  config,
  mode,
  onSave
}) {
  const sensors = useSensors(useSensor(PointerSensor, {
    activationConstraint: {
      distance: 5
    }
  }), useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates
  }));
  const [selectedGroup, setSelectedGroup] = useState(config.groups[0]?.id || "tasks");
  const registryById = new Map(navigationRegistry.map(group => [group.id, group]));
  const saveGroups = groups => onSave(normalizeNavigationConfig({
    version: 1,
    groups
  }));
  if (mode === "primary") {
    const ids = config.groups.map(group => group.id);
    return <PcControlSection title="一级菜单" footer="左侧只显示一级菜单；系统与设置始终保留。"><DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({
        active,
        over
      }) => {
        if (!over || active.id === over.id) return;
        saveGroups(arrayMove(config.groups, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
      }}><SortableContext items={ids} strategy={verticalListSortingStrategy}>{config.groups.map(group => {
            const registry = registryById.get(group.id);
            return <SortableNavigationRow id={group.id} key={group.id}><span className="pc-navigation-name"><b>{registry?.label || group.id}</b><small>{group.pages.filter(page => page.visible).length} 个顶部页面</small></span><label><span>显示</span><OkrInput type="checkbox" checked={group.visible} disabled={registry?.required} onChange={event => saveGroups(config.groups.map(item => item.id === group.id ? {
                  ...item,
                  visible: event.target.checked
                } : item))} /></label></SortableNavigationRow>;
          })}</SortableContext></DndContext></PcControlSection>;
  }
  const group = config.groups.find(item => item.id === selectedGroup) || config.groups[0];
  const registry = registryById.get(group.id);
  const pageById = new Map(registry.pages.map(page => [page.id, page]));
  const ids = group.pages.map(page => page.id);
  const visibleCount = group.pages.filter(page => page.visible).length;
  const savePages = pages => saveGroups(config.groups.map(item => item.id === group.id ? {
    ...item,
    pages
  } : item));
  return <>
    <PcControlSection title="选择一级菜单"><PcValueRow label="系统"><OkrSelect value={group.id} onChange={event => setSelectedGroup(event.target.value)}>{config.groups.map(item => <option key={item.id} value={item.id}>{registryById.get(item.id)?.label || item.id}</option>)}</OkrSelect></PcValueRow></PcControlSection>
<PcControlSection title="顶部二级页面" footer="每个显示中的一级菜单至少保留一个页面。"><DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({
        active,
        over
      }) => {
        if (!over || active.id === over.id) return;
        savePages(arrayMove(group.pages, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
      }}><SortableContext items={ids} strategy={verticalListSortingStrategy}>{group.pages.map(page => {
            const registered = pageById.get(page.id);
            return <SortableNavigationRow id={page.id} key={page.id}><span className="pc-navigation-name"><b>{registered?.label || page.id}</b></span><label><span>显示</span><OkrInput type="checkbox" checked={page.visible} disabled={registered?.required || page.visible && visibleCount <= 1} onChange={event => savePages(group.pages.map(item => item.id === page.id ? {
                  ...item,
                  visible: event.target.checked
                } : item))} /></label></SortableNavigationRow>;
          })}</SortableContext></DndContext>
      <NavigationPreview group={group} registry={registry} />
    </PcControlSection>
  </>;
}
function DetailPage({
  item,
  legacyProps,
  navigationConfig,
  onNavigationSave,
  onNotice
}) {
  const dialog = useAppDialog();
  if (item.legacyTab) return <div className="pc-legacy-detail"><LegacySettingsPage {...legacyProps} activeTab={item.legacyTab} hideTabs /></div>;
  if (item.custom === "calendar") return <CalendarSettingsDetail onNotice={onNotice} />;
  if (item.custom === "sop") return <SopSettingsDetail onNotice={onNotice} />;
  if (item.custom === "navigation-primary") return <NavigationEditor config={navigationConfig} mode="primary" onSave={onNavigationSave} />;
  if (item.custom === "navigation-secondary") return <NavigationEditor config={navigationConfig} mode="secondary" onSave={onNavigationSave} />;
  if (item.custom === "navigation-reset") return <PcControlSection title="恢复默认"><div className="pc-reset-panel"><RotateCcw size={26} /><b>恢复系统默认导航</b><p>一级菜单与顶部二级页面的顺序和显隐都会恢复；任务和业务数据不会改变。</p><OkrButton type="button" onClick={async () => {
        if (await dialog.confirm({
          title: "恢复默认导航？",
          message: "将重置菜单顺序和显示状态，业务数据不变。",
          confirmLabel: "恢复默认"
        })) await onNavigationSave(defaultNavigationConfig());
      }}><RotateCcw size={15} />恢复默认</OkrButton></div></PcControlSection>;
  return null;
}
function selectedFromLocation(activeTab) {
  const route = settingsRouteFromHash(window.location.hash);
  const themeId = route?.themeId || (allThemes.some(theme => theme.id === activeTab) ? activeTab : "appearance");
  return {
    themeId: themeById(themeId).id,
    itemId: route?.itemId || null
  };
}
export function SettingsCenterPage({
  activeTab = "home",
  meta,
  onRefresh,
  onTabChange = () => {},
  onThemeChanged,
  onNotice
}) {
  const initial = selectedFromLocation(activeTab);
  const [selectedThemeId, setSelectedThemeId] = useState(initial.themeId);
  const [focusItemId, setFocusItemId] = useState(initial.itemId);
  const [selectedItemId, setSelectedItemId] = useState(initial.itemId);
  const [query, setQuery] = useState("");
  const navigationResource = useSettingsResource('/api/meta', {
    initial: meta.settings || {},
    selectResponse: value => value.settings,
    writeEndpoint: '/api/settings',
    onNotice,
    onSaved: onRefresh
  });
  const navigationConfig = useMemo(() => normalizeNavigationConfig(navigationResource.state?.navigation_config), [navigationResource.state?.navigation_config]);
  const saveState = navigationResource.saving ? '正在保存' : navigationResource.saveError ? '保存失败' : '';
  const pageRef = useRef(null);
  const theme = themeById(selectedThemeId);
  const selectedItem = theme.items.find(item => item.id === selectedItemId) || theme.items[0];
  useEffect(() => {
    const next = selectedFromLocation(activeTab);
    setSelectedThemeId(next.themeId);
    setFocusItemId(next.itemId);
    setSelectedItemId(next.itemId);
  }, [activeTab]);
  useEffect(() => {
    const onPop = () => {
      const next = selectedFromLocation(activeTab);
      setSelectedThemeId(next.themeId);
      setFocusItemId(next.itemId);
      setSelectedItemId(next.itemId);
      onTabChange(next.themeId);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [activeTab, onTabChange]);
  useEffect(() => {
    if (!focusItemId) return;
    window.requestAnimationFrame(() => {
      const node = document.getElementById(`setting-${focusItemId}`);
      node?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
      node?.querySelector("button, input, select, textarea")?.focus({
        preventScroll: true
      });
      setFocusItemId(null);
    });
  }, [focusItemId, selectedThemeId]);
  const selectTheme = (themeId, itemId = null, replace = false) => {
    const nextTheme = themeById(themeId);
    const nextRoute = itemId ? {
      level: "item",
      themeId: nextTheme.id,
      itemId
    } : {
      level: "theme",
      themeId: nextTheme.id,
      itemId: null
    };
    history[replace ? "replaceState" : "pushState"]({
      lifeTaskSettings: nextRoute
    }, "", routeHash(nextRoute));
    setSelectedThemeId(nextTheme.id);
    setFocusItemId(itemId);
    setSelectedItemId(itemId);
    onTabChange(nextTheme.id);
    trackAnalyticsEvent({
      module: "settings",
      eventName: "settings.theme_open",
      metadata: {
        theme: nextTheme.id,
        item: itemId
      }
    });
    if (pageRef.current) pageRef.current.scrollTop = 0;
  };
  const saveNavigation = async next => {
    const normalized = normalizeNavigationConfig(next);
    await navigationResource.save({
      navigation_config: normalized
    });
  };
  const legacyProps = {
    meta,
    onRefresh,
    onTabChange,
    onThemeChanged,
    onNotice
  };
  return <section className="pc-settings-page workspace-settings" ref={pageRef}>
    <div className="pc-settings-mobile-select"><label>设置主题<OkrSelect aria-label="设置主题" value={selectedThemeId} onChange={event => selectTheme(event.target.value)}>{allThemes.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</OkrSelect></label></div>
    <SettingsSidebar onSelect={selectTheme} query={query} selectedThemeId={selectedThemeId} setQuery={setQuery} />
    <main className="pc-settings-detail">
      <header className="pc-settings-detail-head"><h1>{theme.title}</h1>{saveState && <em role="status" className={saveState === "保存失败" ? "error" : ""}>{saveState}</em>}</header>
      {theme.items.length > 1 && <nav className="workspace-settings-tabs" aria-label={`${theme.title}分类`}>{theme.items.map(item => <OkrButton type="button" key={item.id} aria-current={selectedItem.id === item.id ? "page" : undefined} className={selectedItem.id === item.id ? "active" : ""} onClick={() => selectTheme(theme.id, item.id)}>{item.title}</OkrButton>)}</nav>}
      <div className="pc-settings-detail-body">
        <section className="pc-setting-item" id={`setting-${selectedItem.id}`} key={selectedItem.id} data-setting-item={selectedItem.id}>
          <DetailPage item={selectedItem} legacyProps={legacyProps} navigationConfig={navigationConfig} onNavigationSave={saveNavigation} onNotice={onNotice} />
        </section>
      </div>
    </main>
  </section>;
}
