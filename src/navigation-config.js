export const navigationRegistry = [{
  id: "tasks",
  label: "任务中心",
  icon: "ListChecks",
  pages: [{
    id: "today",
    label: "今天",
    icon: "CalendarDays",
    target: {
      view: "today",
      taskView: "table"
    }
  }, {
    id: "upcoming",
    label: "即将到来",
    icon: "Clock3",
    target: {
      view: "upcoming",
      taskView: "table"
    }
  }, {
    id: "starred",
    label: "已加星标",
    icon: "Star",
    target: {
      view: "starred",
      taskView: "table"
    }
  }, {
    id: "all",
    label: "全部任务",
    icon: "ListChecks",
    target: {
      view: "all",
      taskView: "table"
    }
  }, {
    id: "task-calendar",
    label: "任务日历",
    icon: "CalendarDays",
    target: {
      view: "all",
      taskView: "calendar"
    }
  }, {
    id: "task-gantt",
    label: "任务甘特图",
    icon: "ChartGantt",
    target: {
      view: "all",
      taskView: "gantt"
    }
  }]
}, {
  id: "lists",
  label: "清单系统",
  icon: "LayoutList",
  pages: [{
    id: "list-stats",
    label: "统计图表",
    icon: "BarChart3",
    target: {
      view: "list-system",
      tab: "stats"
    }
  }, {
    id: "list-logs",
    label: "日志统计",
    icon: "ScrollText",
    target: {
      view: "list-system",
      tab: "logs"
    }
  }, {
    id: "list-projects",
    label: "项目管理",
    icon: "Tags",
    target: {
      view: "list-system",
      tab: "projects"
    }
  }, {
    id: "list-tags",
    label: "标签管理",
    icon: "Tag",
    target: {
      view: "list-system",
      tab: "tags"
    }
  }, {
    id: "list-rules",
    label: "规则管理",
    icon: "SlidersHorizontal",
    target: {
      view: "list-system",
      tab: "rules"
    }
  }, {
    id: "list-display",
    label: "显示设置",
    icon: "LayoutList",
    target: {
      view: "list-system",
      tab: "display"
    }
  }, {
    id: "list-cards",
    label: "卡片批阅",
    icon: "CheckSquare",
    target: {
      view: "list-system",
      tab: "cards"
    }
  }]
}, {
  id: "calendar",
  label: "日程系统",
  icon: "CalendarRange",
  pages: [{
    id: "calendar-workspace",
    label: "日程工作台",
    icon: "CalendarRange",
    target: {
      view: "calendar-system",
      tab: "workspace"
    }
  }, {
    id: "calendar-list",
    label: "日程列表",
    icon: "LayoutList",
    target: {
      view: "calendar-system",
      tab: "list"
    }
  }, {
    id: "calendar-series",
    label: "重复日程",
    icon: "Repeat2",
    target: {
      view: "calendar-system",
      tab: "series"
    }
  }, {
    id: "calendar-calendars",
    label: "日历管理",
    icon: "CalendarDays",
    target: {
      view: "calendar-system",
      tab: "calendars"
    }
  }, {
    id: "calendar-settings",
    label: "日程设置",
    icon: "Settings",
    target: {
      view: "settings",
      tab: "calendar"
    }
  }]
}, {
  id: "sop",
  label: "SOP系统",
  icon: "Workflow",
  pages: [{
    id: "sop-today",
    label: "待处理",
    icon: "ListChecks",
    target: {
      view: "sop",
      tab: "today"
    }
  }, {
    id: "sop-future",
    label: "未来发生",
    icon: "CalendarClock",
    target: {
      view: "sop",
      tab: "future"
    }
  }, {
    id: "sop-configs",
    label: "主题与事件",
    icon: "LayoutList",
    target: {
      view: "sop",
      tab: "configs"
    }
  }, {
    id: "sop-calendar",
    label: "日历维护",
    icon: "CalendarDays",
    target: {
      view: "sop",
      tab: "calendar"
    }
  }, {
    id: "sop-history",
    label: "历史记录",
    icon: "ScrollText",
    target: {
      view: "sop",
      tab: "history"
    }
  }, {
    id: "sop-stats",
    label: "统计图表",
    icon: "BarChart3",
    target: {
      view: "sop",
      tab: "stats"
    }
  }, {
    id: "sop-logs",
    label: "运行日志",
    icon: "FileClock",
    target: {
      view: "sop",
      tab: "logs"
    }
  }, {
    id: "sop-settings",
    label: "SOP 设置",
    icon: "Settings",
    target: {
      view: "settings",
      tab: "sop"
    }
  }]
}, {
  id: "documents",
  label: "文档中心",
  icon: "BookOpenText",
  pages: [{
    id: "documents-overview",
    label: "文档总览",
    icon: "LayoutDashboard",
    target: {
      view: "documents",
      tab: "overview"
    }
  }, {
    id: "documents-editor",
    label: "文档编辑",
    icon: "FileText",
    target: {
      view: "documents",
      tab: "editor"
    }
  }, {
    id: "documents-search",
    label: "全文搜索",
    icon: "FileSearch",
    target: {
      view: "documents",
      tab: "search"
    }
  }, {
    id: "documents-revisions",
    label: "版本记录",
    icon: "ScrollText",
    target: {
      view: "documents",
      tab: "revisions"
    }
  }, {
    id: "documents-trash",
    label: "回收站",
    icon: "Trash2",
    target: {
      view: "documents",
      tab: "trash"
    }
  }]
}, {
  id: "system",
  label: "系统与设置",
  icon: "Settings",
  required: true,
  pages: [{
    id: "settings-home",
    label: "设置中心",
    icon: "Settings",
    required: true,
    target: {
      view: "settings",
      tab: "home"
    }
  }, {
    id: "settings-appearance",
    label: "外观与显示",
    icon: "MonitorCog",
    target: {
      view: "settings",
      tab: "appearance"
    }
  }, {
    id: "settings-task",
    label: "任务与数据库",
    icon: "Filter",
    target: {
      view: "settings",
      tab: "task"
    }
  }, {
    id: "settings-navigation",
    label: "导航与页面",
    icon: "PanelLeft",
    target: {
      view: "settings",
      tab: "navigation"
    }
  }, {
    id: "settings-lists",
    label: "清单与项目",
    icon: "FolderPlus",
    target: {
      view: "settings",
      tab: "lists"
    }
  }, {
    id: "settings-calendar",
    label: "日程与提醒",
    icon: "CalendarRange",
    target: {
      view: "settings",
      tab: "calendar"
    }
  }, {
    id: "settings-sop",
    label: "SOP\u8BBE\u7F6E",
    icon: "Workflow",
    target: {
      view: "settings",
      tab: "sop"
    }
  }, {
    id: "settings-analytics",
    label: "使用统计",
    icon: "Activity",
    target: {
      view: "settings",
      tab: "analytics"
    }
  }, {
    id: "settings-changelog",
    label: "更新与版本",
    icon: "UploadCloud",
    target: {
      view: "settings",
      tab: "changelog"
    }
  }, {
    id: "settings-system-log",
    label: "系统日志与诊断",
    icon: "FileClock",
    target: {
      view: "settings",
      tab: "system-log"
    }
  }]
}];
export function defaultNavigationConfig() {
  return {
    version: 1,
    groups: navigationRegistry.map(group => ({
      id: group.id,
      visible: true,
      defaultOpen: group.id === "tasks",
      pages: group.pages.map(page => ({
        id: page.id,
        visible: true
      }))
    }))
  };
}
export function normalizeNavigationConfig(input) {
  let value = input;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  const savedGroups = Array.isArray(value?.groups) ? value.groups : [];
  const savedById = new Map(savedGroups.map(group => [String(group.id), group]));
  const orderedIds = [...savedGroups.map(group => String(group.id)).filter((id, index, ids) => navigationRegistry.some(item => item.id === id) && ids.indexOf(id) === index), ...navigationRegistry.map(group => group.id).filter(id => !savedById.has(id))];
  const registryById = new Map(navigationRegistry.map(group => [group.id, group]));
  return {
    version: 1,
    groups: orderedIds.map(id => {
      const group = registryById.get(id);
      const saved = savedById.get(id) || {};
      const savedPages = Array.isArray(saved.pages) ? saved.pages : [];
      const savedPageById = new Map(savedPages.map(page => [String(page.id), page]));
      const orderedPageIds = [...savedPages.map(page => String(page.id)).filter((pageId, index, ids) => group.pages.some(page => page.id === pageId) && ids.indexOf(pageId) === index), ...group.pages.map(page => page.id).filter(pageId => !savedPageById.has(pageId))];
      let pages = orderedPageIds.map(pageId => {
        const page = group.pages.find(item => item.id === pageId);
        const savedPage = savedPageById.get(pageId) || {};
        return {
          id: pageId,
          visible: page.required ? true : savedPage.visible !== false
        };
      });
      if (!pages.some(page => page.visible)) pages = pages.map((page, index) => ({
        ...page,
        visible: index === 0
      }));
      return {
        id,
        visible: group.required ? true : saved.visible !== false,
        defaultOpen: Boolean(saved.defaultOpen ?? id === "tasks"),
        pages
      };
    })
  };
}
export function configuredNavigation(input) {
  const config = normalizeNavigationConfig(input);
  const registryById = new Map(navigationRegistry.map(group => [group.id, group]));
  return config.groups.flatMap(savedGroup => {
    const group = registryById.get(savedGroup.id);
    if (!group || !savedGroup.visible) return [];
    const pageById = new Map(group.pages.map(page => [page.id, page]));
    const pages = savedGroup.pages.filter(page => page.visible && pageById.has(page.id)).map(page => pageById.get(page.id));
    return pages.length ? [{
      ...group,
      defaultOpen: savedGroup.defaultOpen,
      pages
    }] : [];
  });
}
export function primaryNavigationPage(group, rememberedPageId) {
  if (!group?.pages?.length) return null;
  return group.pages.find(page => page.id === rememberedPageId) || group.pages[0];
}
