import { OkrSelect } from "./okr-ui.jsx";
import { OkrButton } from "./okr-ui.jsx";
import React, { useEffect, useMemo, useState } from "react";
import { DndContext, PointerSensor, closestCenter, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronRight, Folder, GripVertical, Pin } from "lucide-react";
import { api } from "./api.js";
import { useAppDialog } from "./DialogContext.jsx";
const sidebarListColors = ["#e11d48", "#dc2626", "#f97316", "#ca8a19", "#eab308", "#65a30d", "#16a34a", "#059669", "#0d9488", "#0891b2", "#0284c7", "#2563eb", "#4f46e5", "#7c3aed", "#9333ea", "#c026d3", "#db2777", "#be123c", "#9c5a43", "#475569", "#77736d", "#2877d4", "#3c8b62", "#0f766e"];
function SortableList({
  active,
  list,
  onContextMenu,
  onPin,
  onSelect
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: list.id
  });
  return <div className={`sortable-list ${active ? "active" : ""} ${isDragging ? "dragging" : ""}`} onContextMenu={event => onContextMenu(event, list)} ref={setNodeRef} style={{
    transform: CSS.Transform.toString(transform),
    transition
  }}>
      <OkrButton className="drag-handle" title="拖动排序" {...attributes} {...listeners}>
        <GripVertical size={13} />
      </OkrButton>
      <OkrButton className="list-main" onClick={() => onSelect(list.id)}>
        <i style={{
        background: list.color
      }} />
        <span>{list.name}</span>
        <em>{list.taskCount}</em>
      </OkrButton>
      <OkrButton className={`pin-list ${list.isPinned ? "active" : ""}`} onClick={() => onPin(list)} title={list.isPinned ? "取消置顶" : "置顶清单"}>
        <Pin size={12} />
      </OkrButton>
    </div>;
}
function FolderDropZone({
  children,
  folder,
  onContextMenu,
  onToggle
}) {
  const {
    isOver,
    setNodeRef
  } = useDroppable({
    id: `folder-${folder.id}`
  });
  return <div className={`sidebar-folder ${isOver ? "is-over" : ""}`} onContextMenu={event => onContextMenu(event, folder)} ref={setNodeRef}>
      <OkrButton className="folder-toggle" onClick={onToggle}>
        {folder.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        <Folder size={13} />
        <span>{folder.name}</span>
        <em>{children.length}</em>
      </OkrButton>
      {!folder.collapsed && children}
    </div>;
}
function UnfiledDropZone({
  children,
  enabled
}) {
  const {
    isOver,
    setNodeRef
  } = useDroppable({
    id: "folder-null"
  });
  if (!enabled) return children;
  return <div className={`unfiled-drop-zone ${isOver ? "is-over" : ""}`} ref={setNodeRef}>
      <div className="list-group-label">未分类</div>
      {children}
    </div>;
}
export function SidebarLists({
  activeListId,
  activeModeId,
  folders,
  lists,
  modeItems,
  modes,
  onModeChange,
  onNotify,
  onRefresh,
  onSelectList,
  view
}) {
  const dialog = useAppDialog();
  const sensors = useSensors(useSensor(PointerSensor, {
    activationConstraint: {
      distance: 5
    }
  }));
  const [menu, setMenu] = useState(null);
  const visibleLists = useMemo(() => {
    const positions = new Map(modeItems.filter(item => item.modeId === activeModeId).map(item => [item.listId, item.position]));
    return lists.filter(list => positions.has(list.id)).sort((left, right) => {
      if (left.isPinned !== right.isPinned) return left.isPinned ? -1 : 1;
      return (positions.get(left.id) ?? left.position) - (positions.get(right.id) ?? right.position);
    });
  }, [activeModeId, lists, modeItems]);
  const sortedIds = visibleLists.map(list => list.id);
  const listById = useMemo(() => new Map(visibleLists.map(list => [list.id, list])), [visibleLists]);
  const pinned = visibleLists.filter(list => list.isPinned);
  const unfiled = visibleLists.filter(list => !list.isPinned && !list.folderId);
  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    const onScroll = event => {
      if (event.target instanceof Element && event.target.closest(".context-menu")) return;
      close();
    };
    const onKeyDown = event => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);
  const pinList = async list => {
    await api(`/api/lists/${list.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        isPinned: !list.isPinned
      })
    });
    await onRefresh();
    onNotify?.(list.isPinned ? "已取消置顶" : "清单已置顶");
  };
  const patchList = async (list, patch, message) => {
    await api(`/api/lists/${list.id}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
    await onRefresh();
    if (message) onNotify?.(message);
  };
  const openListMenu = (event, list) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({
      list,
      x: Math.min(event.clientX, window.innerWidth - 190),
      y: Math.min(event.clientY, window.innerHeight - 280)
    });
  };
  const openFolderMenu = (event, folder) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({
      folder,
      x: Math.min(event.clientX, window.innerWidth - 190),
      y: Math.min(event.clientY, window.innerHeight - 180)
    });
  };
  const renderList = list => <SortableList active={view === "all" && activeListId === list.id} key={list.id} list={list} onContextMenu={openListMenu} onPin={pinList} onSelect={onSelectList} />;
  return <>
      <label className="mode-select">
        <OkrSelect aria-label="清单显示模式" value={activeModeId || ""} onChange={event => onModeChange(Number(event.target.value))}>
          {modes.map(mode => <option key={mode.id} value={mode.id}>{mode.name}</option>)}
        </OkrSelect>
        <ChevronDown size={12} />
      </label>
      <DndContext collisionDetection={closestCenter} onDragEnd={async ({
      active,
      over
    }) => {
      if (!over || active.id === over.id) return;
      const activeId = Number(active.id);
      const activeList = listById.get(activeId);
      if (!activeList) return;
      const overId = String(over.id);
      if (overId.startsWith("folder-")) {
        const folderId = overId === "folder-null" ? null : Number(overId.replace("folder-", ""));
        await patchList(activeList, {
          folderId
        }, folderId ? "清单已移入文件夹" : "清单已移出文件夹");
        return;
      }
      const oldIndex = sortedIds.indexOf(activeId);
      const targetId = Number(over.id);
      const newIndex = sortedIds.indexOf(targetId);
      if (oldIndex < 0 || newIndex < 0) return;
      const targetList = listById.get(targetId);
      if (targetList && activeList.folderId !== targetList.folderId) {
        await patchList(activeList, {
          folderId: targetList.folderId || null
        });
      }
      const nextIds = arrayMove(sortedIds, oldIndex, newIndex);
      await api("/api/lists/reorder", {
        method: "PUT",
        body: JSON.stringify({
          modeId: activeModeId,
          listIds: nextIds
        })
      });
      await onRefresh();
      onNotify?.("清单顺序已更新");
    }} sensors={sensors}>
        <SortableContext items={sortedIds} strategy={verticalListSortingStrategy}>
          <div className="list-nav">
            {pinned.length > 0 && <div className="list-group-label"><Pin size={11} />置顶</div>}
            {pinned.map(renderList)}
            {folders.map(folder => {
            const children = visibleLists.filter(list => !list.isPinned && list.folderId === folder.id);
            return <FolderDropZone folder={folder} key={folder.id} onContextMenu={openFolderMenu} onToggle={async () => {
              await api(`/api/list-folders/${folder.id}`, {
                method: "PATCH",
                body: JSON.stringify({
                  collapsed: !folder.collapsed
                })
              });
              await onRefresh();
            }}>
                  {children.map(renderList)}
                </FolderDropZone>;
          })}
            <UnfiledDropZone enabled={folders.length > 0}>
              {unfiled.map(renderList)}
            </UnfiledDropZone>
            {visibleLists.length === 0 && <div className="empty-list-mode">此模式尚未选择清单</div>}
          </div>
        </SortableContext>
      </DndContext>
      {menu && <SidebarContextMenu folders={folders} menu={menu} onClose={() => setMenu(null)} onDeleteFolder={async folder => {
      const confirmed = await dialog.confirm({
        title: "删除文件夹",
        message: "确认删除这个文件夹？清单会自动移出。",
        confirmLabel: "删除文件夹",
        danger: true
      });
      if (!confirmed) return;
      await api(`/api/list-folders/${folder.id}`, {
        method: "DELETE"
      });
      await onRefresh();
      onNotify?.("文件夹已删除");
    }} onPatchFolder={async (folder, patch, message) => {
      await api(`/api/list-folders/${folder.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
      });
      await onRefresh();
      if (message) onNotify?.(message);
    }} onPatchList={patchList} onSelectList={onSelectList} />}
    </>;
}
function SidebarContextMenu({
  folders,
  menu,
  onClose,
  onDeleteFolder,
  onPatchFolder,
  onPatchList,
  onSelectList
}) {
  const dialog = useAppDialog();
  const run = async action => {
    await action();
    onClose();
  };
  if (menu.folder) {
    const folder = menu.folder;
    return <div className="context-menu sidebar-context-menu" style={{
      left: menu.x,
      top: menu.y
    }}>
        <OkrButton onClick={() => run(async () => {
        const name = await dialog.askText({
          title: "重命名文件夹",
          label: "文件夹名称",
          initialValue: folder.name
        });
        if (!name?.trim()) return Promise.resolve();
        return onPatchFolder(folder, {
          name: name.trim()
        }, "文件夹已重命名");
      })}>
          重命名文件夹
        </OkrButton>
        <OkrButton onClick={() => run(() => onPatchFolder(folder, {
        collapsed: !folder.collapsed
      }, folder.collapsed ? "文件夹已展开" : "文件夹已收起"))}>
          {folder.collapsed ? "展开文件夹" : "收起文件夹"}
        </OkrButton>
        <OkrButton className="danger" onClick={() => run(() => onDeleteFolder(folder))}>
          删除文件夹
        </OkrButton>
      </div>;
  }
  const list = menu.list;
  if (!list) return null;
  return <div className="context-menu sidebar-context-menu" style={{
    left: menu.x,
    top: menu.y
  }}>
      <OkrButton onClick={() => run(() => onSelectList(list.id))}>打开清单</OkrButton>
      <OkrButton onClick={() => run(async () => {
      const name = await dialog.askText({
        title: "重命名清单",
        label: "清单名称",
        initialValue: list.name
      });
      if (!name?.trim()) return Promise.resolve();
      return onPatchList(list, {
        name: name.trim()
      }, "清单已重命名");
    })}>
        重命名清单
      </OkrButton>
      <OkrButton onClick={() => run(() => onPatchList(list, {
      isPinned: !list.isPinned
    }, list.isPinned ? "已取消置顶" : "清单已置顶"))}>
        {list.isPinned ? "取消置顶" : "置顶清单"}
      </OkrButton>
      <div className="sidebar-color-editor" onClick={event => event.stopPropagation()}>
        <span>编辑颜色</span>
        <div>
          {sidebarListColors.map(color => <OkrButton aria-label={`设置清单颜色 ${color}`} className={list.color === color ? "selected" : ""} key={color} onClick={() => run(() => onPatchList(list, {
          color
        }, "清单颜色已修改"))} style={{
          "--swatch-color": color
        }} title={color} />)}
        </div>
      </div>
      <OkrButton onClick={() => run(() => onPatchList(list, {
      folderId: null
    }, "清单已移出文件夹"))}>
        移出文件夹
      </OkrButton>
      {folders.map(folder => <OkrButton key={folder.id} onClick={() => run(() => onPatchList(list, {
      folderId: folder.id
    }, `已移入 ${folder.name}`))}>
          移入 {folder.name}
        </OkrButton>)}
    </div>;
}
