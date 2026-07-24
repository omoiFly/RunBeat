import { lazy, Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { DEFAULT_PROJECT_NAME } from "../domain/types";
import { useI18n } from "../i18n";
import { useProjectStore } from "../store/projectStore";
import { ClassicIcon, type ClassicIconName } from "./ClassicIcon";
import { CONTEXT_HELP } from "./contextHelp";
import { LazyDialogFallback } from "./LazyDialogFallback";

const HelpTopicsDialog = lazy(() => import("./HelpSystem").then((module) => ({ default: module.HelpTopicsDialog })));
const AboutDialog = lazy(() => import("./HelpSystem").then((module) => ({ default: module.AboutDialog })));
const ContextHelpPopup = lazy(() => import("./HelpSystem").then((module) => ({ default: module.ContextHelpPopup })));

const MENU_ORDER = ["file", "edit", "view", "project", "help"] as const;
type MenuName = (typeof MENU_ORDER)[number];

export type AppCommand =
  | "new-project"
  | "open-project"
  | "save-project"
  | "save-project-as"
  | "add-tracks"
  | "import-project"
  | "backup-project"
  | "export-audio"
  | "close-project"
  | "select-all"
  | "include-selected"
  | "exclude-selected"
  | "move-up"
  | "move-down"
  | "delete-selected"
  | "delete-project"
  | "track-properties"
  | "project-properties"
  | "reset-selection"
  | "reanalyze-selected"
  | "relink-files";

interface MenuItem {
  id?: string;
  label: ReactNode;
  ariaLabel?: string;
  command?: AppCommand;
  shortcut?: string;
  separator?: boolean;
  checked?: boolean;
  radio?: boolean;
  disabled?: boolean;
  description?: string;
  action?: () => void;
  children?: MenuItem[];
}

const UI_PREFS_KEY = "runbeat.classic-ui.v1";

function dispatchCommand(command: AppCommand): void {
  window.dispatchEvent(new CustomEvent("runbeat:command", { detail: command }));
}

function readUiPrefs(): { toolbar: boolean; statusbar: boolean; inspector: boolean } {
  try {
    return {
      toolbar: true,
      statusbar: true,
      inspector: true,
      ...JSON.parse(localStorage.getItem(UI_PREFS_KEY) ?? "{}")
    };
  } catch {
    return { toolbar: true, statusbar: true, inspector: true };
  }
}

function timeLabel(timestamp: number | undefined, language: "zh-CN" | "en"): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString(language === "en" ? "en-US" : "zh-CN", { hour: "2-digit", minute: "2-digit" });
}

export function AppLayout() {
  const { language, setLanguage, t, translateMessage } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const menuBarRef = useRef<HTMLDivElement>(null);
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const [menuStatus, setMenuStatus] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [helpMode, setHelpMode] = useState(false);
  const [helpPopup, setHelpPopup] = useState<{ text: string; x: number; y: number }>();
  const [uiPrefs, setUiPrefs] = useState(readUiPrefs);
  const project = useProjectStore((state) => state.project);
  const busy = useProjectStore((state) => state.busy);
  const notice = useProjectStore((state) => state.notice);
  const isDirty = useProjectStore((state) => state.isDirty);
  const hasSavedRecord = useProjectStore((state) => state.hasSavedRecord);
  const saveState = useProjectStore((state) => state.saveState);
  const lastSavedAt = useProjectStore((state) => state.lastSavedAt);
  const completedCount = project.tracks.filter((track) => track.status === "complete").length;
  const inStudio = location.pathname === "/studio" || location.pathname === "/";
  const inProjects = location.pathname === "/projects";
  const projectTitle = project.name === DEFAULT_PROJECT_NAME ? t("未命名项目") : project.name;
  const title = inStudio
    ? `${projectTitle}${isDirty ? " *" : ""} - RunBeat`
    : `${location.pathname === "/projects" ? t("本地项目") : location.pathname === "/guide" ? t("帮助") : t("关于")} - RunBeat`;
  const saveStatus = saveState === "saving"
    ? t("正在保存...")
    : isDirty
      ? t("未保存")
      : hasSavedRecord
        ? t("已保存 {time}", { time: timeLabel(lastSavedAt, language) })
        : t("尚未保存");
  const primaryStatus = menuStatus || translateMessage(notice) || (busy
    ? t("正在分析歌曲：{done}/{total}", { done: completedCount, total: project.tracks.length })
    : t("就绪"));

  const setPreference = (name: keyof typeof uiPrefs, value: boolean) => {
    setUiPrefs((current) => {
      const next = { ...current, [name]: value };
      try { localStorage.setItem(UI_PREFS_KEY, JSON.stringify(next)); } catch { /* Preferences remain session-local. */ }
      return next;
    });
    if (name === "inspector") {
      window.dispatchEvent(new CustomEvent("runbeat:inspector", { detail: value }));
    }
  };

  const showHelpForElement = useCallback((element: Element | null) => {
    const target = element?.closest<HTMLElement>("[data-help]");
    const key = target?.dataset.help;
    const sourceText = key ? CONTEXT_HELP[key] : undefined;
    const text = sourceText ? t(sourceText) : undefined;
    if (!target || !text) {
      setHelpOpen(true);
      return;
    }
    const rect = target.getBoundingClientRect();
    setHelpPopup({
      text,
      x: Math.min(rect.left + 12, window.innerWidth - 340),
      y: Math.min(rect.bottom + 6, window.innerHeight - 100)
    });
  }, [t]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("runbeat:inspector", { detail: uiPrefs.inspector }));
  }, [uiPrefs.inspector]);

  useEffect(() => {
    document.title = title;
  }, [title]);

  useEffect(() => {
    const enableHelpMode = () => {
      setHelpMode(true);
      setHelpPopup(undefined);
    };
    window.addEventListener("runbeat:help-mode", enableHelpMode);
    return () => window.removeEventListener("runbeat:help-mode", enableHelpMode);
  }, []);

  useEffect(() => {
    const suppressNativeContextMenu = (event: MouseEvent) => event.preventDefault();
    document.addEventListener("contextmenu", suppressNativeContextMenu, true);
    return () => document.removeEventListener("contextmenu", suppressNativeContextMenu, true);
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (helpMode) {
        event.preventDefault();
        event.stopPropagation();
        setHelpMode(false);
        showHelpForElement(event.target as Element);
        return;
      }
      if (!menuBarRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
        setOpenSubmenu(null);
      }
      if (helpPopup) setHelpPopup(undefined);
    };
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const editing = target.matches("input, textarea, select, [contenteditable='true']");
      const key = event.key.toLowerCase();
      if (event.key === "F1") {
        event.preventDefault();
        if (event.shiftKey) {
          setHelpMode(true);
          setHelpPopup(undefined);
        } else {
          showHelpForElement(document.activeElement);
        }
        return;
      }
      if (event.defaultPrevented) return;
      if (document.querySelector("[role='dialog']")) return;
      const menuShortcut = ({ f: "file", e: "edit", v: "view", p: "project", h: "help" } as const)[key as "f" | "e" | "v" | "p" | "h"];
      if (event.altKey && !event.ctrlKey && !event.metaKey && menuShortcut) {
        event.preventDefault();
        setOpenSubmenu(null);
        setOpenMenu(menuShortcut);
        window.requestAnimationFrame(() => {
          menuBarRef.current
            ?.querySelector<HTMLButtonElement>(`[data-menu="${menuShortcut}"] .classic-menu-popup button:not(:disabled)`)
            ?.focus();
        });
        return;
      }
      if (event.key === "F10") {
        event.preventDefault();
        menuBarRef.current?.querySelector<HTMLButtonElement>(".classic-menu-button")?.focus();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === "n") dispatchCommand("new-project");
      else if ((event.ctrlKey || event.metaKey) && key === "o") dispatchCommand("open-project");
      else if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === "s") dispatchCommand("save-project-as");
      else if ((event.ctrlKey || event.metaKey) && key === "s") dispatchCommand("save-project");
      else if ((event.ctrlKey || event.metaKey) && key === "e") dispatchCommand("export-audio");
      else if ((event.ctrlKey || event.metaKey) && key === "w") dispatchCommand("close-project");
      else if ((event.ctrlKey || event.metaKey) && key === "a" && !editing) dispatchCommand("select-all");
      else if (event.key === "Insert" && !editing) dispatchCommand("add-tracks");
      else if (event.key === "Delete" && !editing) dispatchCommand("delete-selected");
      else if (event.altKey && event.key === "ArrowUp" && !editing) dispatchCommand("move-up");
      else if (event.altKey && event.key === "ArrowDown" && !editing) dispatchCommand("move-down");
      else if (event.altKey && event.key === "Enter" && !editing) dispatchCommand("track-properties");
      else return;
      event.preventDefault();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleShortcut);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleShortcut);
    };
  }, [helpMode, helpPopup, showHelpForElement]);

  const closeMenu = () => {
    setOpenMenu(null);
    setOpenSubmenu(null);
    setMenuStatus("");
  };
  const runMenuItem = (item: MenuItem) => {
    if (item.disabled || item.separator || item.children?.length) return;
    closeMenu();
    if (item.command) dispatchCommand(item.command);
    item.action?.();
  };
  const focusFirstMenuItem = (name: MenuName) => {
    window.requestAnimationFrame(() => {
      menuBarRef.current
        ?.querySelector<HTMLButtonElement>(`[data-menu="${name}"] .classic-menu-popup button:not(:disabled)`)
        ?.focus();
    });
  };
  const openAndFocusMenu = (name: MenuName) => {
    setOpenSubmenu(null);
    setOpenMenu(name);
    focusFirstMenuItem(name);
  };
  const openAndFocusSubmenu = (id: string) => {
    setOpenSubmenu(id);
    window.requestAnimationFrame(() => {
      menuBarRef.current
        ?.querySelector<HTMLButtonElement>(`[data-submenu="${id}"] > button:not(:disabled)`)
        ?.focus();
    });
  };
  const switchMenu = (direction: -1 | 1) => {
    if (!openMenu) return;
    const index = MENU_ORDER.indexOf(openMenu);
    openAndFocusMenu(MENU_ORDER[(index + direction + MENU_ORDER.length) % MENU_ORDER.length]);
  };
  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const popup = target.closest<HTMLElement>(".classic-menu-popup");
    const submenu = target.closest<HTMLElement>(".classic-menu-submenu");
    if (event.key === "Escape") {
      event.preventDefault();
      if (submenu) {
        const id = submenu.dataset.submenu;
        setOpenSubmenu(null);
        window.requestAnimationFrame(() => {
          if (id) menuBarRef.current?.querySelector<HTMLButtonElement>(`[data-submenu-trigger="${id}"]`)?.focus();
        });
        return;
      }
      const menu = target.closest<HTMLElement>("[data-menu]")?.dataset.menu as MenuName | undefined;
      closeMenu();
      if (menu) menuBarRef.current?.querySelector<HTMLButtonElement>(`[data-menu="${menu}"] > .classic-menu-button`)?.focus();
      return;
    }
    if (!popup) {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        const menu = target.closest<HTMLElement>("[data-menu]")?.dataset.menu as MenuName | undefined;
        if (!menu) return;
        event.preventDefault();
        openAndFocusMenu(menu);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const current = target.closest<HTMLElement>("[data-menu]")?.dataset.menu as MenuName | undefined;
        if (!current) return;
        const index = MENU_ORDER.indexOf(current);
        const next = MENU_ORDER[(index + (event.key === "ArrowRight" ? 1 : -1) + MENU_ORDER.length) % MENU_ORDER.length];
        menuBarRef.current?.querySelector<HTMLButtonElement>(`[data-menu="${next}"] > .classic-menu-button`)?.focus();
      }
      return;
    }
    const items = Array.from(popup.children)
      .map((child) => child instanceof HTMLButtonElement
        ? child
        : child.matches(".classic-submenu-entry")
          ? child.querySelector<HTMLButtonElement>(":scope > button")
          : null)
      .filter((item): item is HTMLButtonElement => item != null && !item.disabled);
    const index = items.indexOf(target as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      items[(index + direction + items.length) % items.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (event.key === "ArrowRight" && target.dataset.submenuTrigger) {
      event.preventDefault();
      openAndFocusSubmenu(target.dataset.submenuTrigger);
    } else if (event.key === "ArrowLeft" && submenu) {
      event.preventDefault();
      const id = submenu.dataset.submenu;
      setOpenSubmenu(null);
      window.requestAnimationFrame(() => {
        if (id) menuBarRef.current?.querySelector<HTMLButtonElement>(`[data-submenu-trigger="${id}"]`)?.focus();
      });
    } else if (!submenu && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      event.preventDefault();
      switchMenu(event.key === "ArrowRight" ? 1 : -1);
    }
  };

  const accessLabel = (source: string, key: string, ellipsis = false): ReactNode => (
    <>{t(source)}(<u>{key}</u>){ellipsis ? "…" : ""}</>
  );

  const menus: Array<{ name: MenuName; label: ReactNode; items: MenuItem[] }> = [
    {
      name: "file",
      label: accessLabel("文件", "F"),
      items: [
        { label: accessLabel("新建项目", "N"), command: "new-project", shortcut: "Ctrl+N", description: t("创建一个新的未命名项目。") },
        { label: accessLabel("打开项目", "O", true), command: "open-project", shortcut: "Ctrl+O", description: t("打开保存在当前设备上的项目。") },
        { separator: true, label: "" },
        { label: accessLabel("保存项目", "S"), command: "save-project", shortcut: "Ctrl+S", disabled: !inStudio, description: t("保存当前项目。") },
        { label: accessLabel("项目另存为", "A", true), command: "save-project-as", shortcut: "Ctrl+Shift+S", disabled: !inStudio, description: t("用新名称保存项目副本。") },
        { separator: true, label: "" },
        { label: accessLabel("添加歌曲", "M", true), command: "add-tracks", shortcut: "Insert", disabled: !inStudio, description: t("向当前项目添加音频文件。") },
        { label: accessLabel("导入项目文件", "I", true), command: "import-project", disabled: !inStudio, description: t("从 .runbeat.json 文件导入项目。") },
        { label: accessLabel("备份项目文件", "B", true), command: "backup-project", disabled: !inStudio, description: t("下载当前项目的 JSON 备份。") },
        { separator: true, label: "" },
        { label: accessLabel("导出音频", "E", true), command: "export-audio", shortcut: "Ctrl+E", disabled: !inStudio, description: t("打开导出音频向导。") },
        { separator: true, label: "" },
        { label: accessLabel("关闭项目", "C"), command: "close-project", shortcut: "Ctrl+W", disabled: !inStudio, description: t("关闭当前项目并返回本地项目列表。") }
      ]
    },
    {
      name: "edit",
      label: accessLabel("编辑", "E"),
      items: [
        { label: accessLabel("全选歌曲", "A"), command: "select-all", shortcut: "Ctrl+A", disabled: !inStudio, description: t("选择列表中的全部歌曲。") },
        { separator: true, label: "" },
        { label: accessLabel("加入导出", "I"), command: "include-selected", shortcut: "Space", disabled: !inStudio, description: t("把所选歌曲加入导出。") },
        { label: accessLabel("排除导出", "X"), command: "exclude-selected", disabled: !inStudio, description: t("从导出中排除所选歌曲。") },
        { label: accessLabel("上移", "U"), command: "move-up", shortcut: "Alt+↑", disabled: !inStudio, description: t("在播放顺序中上移所选歌曲。") },
        { label: accessLabel("下移", "D"), command: "move-down", shortcut: "Alt+↓", disabled: !inStudio, description: t("在播放顺序中下移所选歌曲。") },
        { separator: true, label: "" },
        { label: accessLabel("删除", "L"), command: "delete-selected", shortcut: "Del", disabled: !inStudio, description: t("从项目中删除所选歌曲。") },
        { label: accessLabel("歌曲属性", "P"), command: "track-properties", shortcut: "Alt+Enter", disabled: !inStudio, description: t("显示焦点歌曲的检查器。") }
      ]
    },
    {
      name: "view",
      label: accessLabel("查看", "V"),
      items: [
        { label: accessLabel("工具栏", "T"), checked: uiPrefs.toolbar, action: () => setPreference("toolbar", !uiPrefs.toolbar), description: t("显示或隐藏工具栏。") },
        { label: accessLabel("状态栏", "S"), checked: uiPrefs.statusbar, action: () => setPreference("statusbar", !uiPrefs.statusbar), description: t("显示或隐藏状态栏。") },
        { label: accessLabel("歌曲检查器", "I"), checked: uiPrefs.inspector, disabled: !inStudio, action: () => setPreference("inspector", !uiPrefs.inspector), description: t("显示或隐藏歌曲检查器。") }
      ]
    },
    {
      name: "project",
      label: accessLabel("项目", "P"),
      items: [
        { label: accessLabel("项目属性", "P", true), command: "project-properties", disabled: !inStudio, description: t("设置项目名称、目标步频和全局节拍轨。") },
        { label: accessLabel("删除项目", "D", true), command: "delete-project", disabled: (!inStudio && !inProjects) || (inStudio && !hasSavedRecord), description: inProjects ? t("永久删除本地项目列表中所选的项目。") : t("永久删除当前项目并返回本地项目列表。") },
        { separator: true, label: "" },
        { label: accessLabel("按当前范围重新选择", "S"), command: "reset-selection", disabled: !inStudio, description: t("根据项目的变速范围重新设置默认导出歌曲。") },
        { label: accessLabel("重新分析所选歌曲", "A"), command: "reanalyze-selected", disabled: !inStudio, description: t("重新分析当前所选歌曲的 BPM 与拍点。") },
        { label: accessLabel("重新关联文件", "R", true), command: "relink-files", disabled: !inStudio, description: t("重新选择保存项目引用的原始音频文件。") }
      ]
    },
    {
      name: "help",
      label: accessLabel("帮助", "H"),
      items: [
        { label: accessLabel("帮助主题", "H"), shortcut: "F1", action: () => setHelpOpen(true), description: t("打开 RunBeat 帮助主题。") },
        { label: accessLabel("这是什么？", "W"), shortcut: "Shift+F1", action: () => setHelpMode(true), description: t("单击一个控件查看它的说明。") },
        { separator: true, label: "" },
        {
          id: "language",
          label: accessLabel("语言", "L"),
          description: t("选择界面语言。"),
          children: [
            { label: "中文", ariaLabel: "中文", checked: language === "zh-CN", radio: true, action: () => setLanguage("zh-CN"), description: t("将界面语言切换为中文。") },
            { label: "English", ariaLabel: "English", checked: language === "en", radio: true, action: () => setLanguage("en"), description: t("将界面语言切换为英文。") }
          ]
        },
        { separator: true, label: "" },
        { label: accessLabel("关于 RunBeat", "A", true), action: () => setAboutOpen(true), description: t("显示程序版本和许可证信息。") }
      ]
    }
  ];

  const toolbarButtons: Array<{ icon: ClassicIconName; command: AppCommand; label: string; disabled?: boolean }> = [
    { icon: "new", command: "new-project", label: t("新建项目") },
    { icon: "open", command: "open-project", label: t("打开项目") },
    { icon: "save", command: "save-project", label: t("保存项目"), disabled: !inStudio },
    { icon: "add", command: "add-tracks", label: t("添加歌曲"), disabled: !inStudio },
    { icon: "export", command: "export-audio", label: t("导出音频"), disabled: !inStudio }
  ];

  function renderMenuItems(items: MenuItem[], nested = false): ReactNode {
    return items.map((item, index) => {
      if (item.separator) {
        return <div key={`separator-${index}`} className="classic-menu-separator" role="separator" />;
      }

      if (item.children?.length) {
        const submenuId = item.id ?? `submenu-${index}`;
        const expanded = openSubmenu === submenuId;
        return <div
          key={submenuId}
          className="classic-submenu-entry"
          onMouseEnter={() => {
            setOpenSubmenu(submenuId);
            setMenuStatus(item.description ?? "");
          }}
        >
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={expanded}
            aria-controls={`classic-submenu-${submenuId}`}
            data-submenu-trigger={submenuId}
            disabled={item.disabled}
            onFocus={() => setMenuStatus(item.description ?? "")}
            onClick={() => openAndFocusSubmenu(submenuId)}
          >
            <span>{item.label}</span><span className="classic-submenu-arrow" aria-hidden="true" />
          </button>
          {expanded && <div
            id={`classic-submenu-${submenuId}`}
            className="classic-menu-popup classic-menu-submenu"
            role="menu"
            aria-label={submenuId}
            data-submenu={submenuId}
          >
            {renderMenuItems(item.children, true)}
          </div>}
        </div>;
      }

      return <button
        key={item.id ?? index}
        type="button"
        role={item.radio ? "menuitemradio" : item.checked == null ? "menuitem" : "menuitemcheckbox"}
        aria-label={item.ariaLabel}
        aria-checked={item.checked}
        data-checked={item.checked ? "true" : undefined}
        data-selection-role={item.radio ? "radio" : item.checked == null ? undefined : "checkbox"}
        disabled={item.disabled}
        onMouseEnter={() => {
          if (!nested) setOpenSubmenu(null);
          setMenuStatus(item.description ?? "");
        }}
        onFocus={() => {
          if (!nested) setOpenSubmenu(null);
          setMenuStatus(item.description ?? "");
        }}
        onClick={() => runMenuItem(item)}
      >
        <span>{item.label}</span>{item.shortcut && <kbd>{item.shortcut}</kbd>}
      </button>;
    });
  }

  return (
    <div className={`app-shell ${helpMode ? "context-help-mode" : ""}`}>
      <section className="application-frame window" aria-label={t("RunBeat 主窗口")}>
        <div className="title-bar application-title-bar">
          <div className="title-bar-text"><ClassicIcon name="app" size={16} />{title}</div>
        </div>

        <div className="classic-menu-bar" role="menubar" aria-label={t("应用程序菜单")} ref={menuBarRef} onKeyDown={handleMenuKeyDown}>
          {menus.map((menu) => (
            <div key={menu.name} className="classic-menu" data-menu={menu.name} onMouseEnter={() => {
              if (!openMenu) return;
              setOpenSubmenu(null);
              setOpenMenu(menu.name);
            }}>
              <button
                className={`classic-menu-button ${openMenu === menu.name ? "open" : ""}`}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={openMenu === menu.name}
                onClick={() => {
                  setOpenSubmenu(null);
                  setOpenMenu((current) => current === menu.name ? null : menu.name);
                }}
              >
                {menu.label}
              </button>
              {openMenu === menu.name && <div className="classic-menu-popup" role="menu" aria-label={menu.name}>
                {renderMenuItems(menu.items)}
              </div>}
            </div>
          ))}
        </div>

        {uiPrefs.toolbar && <div className="classic-toolbar" role="toolbar" aria-label={t("常用命令")}>
          {toolbarButtons.map((button, index) => <button
            key={button.command}
            type="button"
            className={`classic-toolbar-button ${index === 3 || index === 4 ? "toolbar-separated" : ""}`}
            title={button.label}
            aria-label={button.label}
            disabled={button.disabled}
            onMouseEnter={() => setMenuStatus(button.label)}
            onMouseLeave={() => setMenuStatus("")}
            onFocus={() => setMenuStatus(button.label)}
            onBlur={() => setMenuStatus("")}
            onClick={() => dispatchCommand(button.command)}
          ><ClassicIcon name={button.icon} /></button>)}
        </div>}

        <main className="application-content"><Outlet /></main>

        {uiPrefs.statusbar && <div className="status-bar application-status">
          <p className="status-bar-field">{primaryStatus}</p>
          <p className="status-bar-field">{inStudio
            ? t("{count} 首歌曲 · {spm} SPM", { count: project.tracks.length, spm: project.targetSpm })
            : t("本地项目")}</p>
          <p className="status-bar-field">{inStudio ? saveStatus : ""}</p>
        </div>}
      </section>

      {(helpOpen || location.pathname === "/guide") && <Suspense fallback={<LazyDialogFallback />}>
        <HelpTopicsDialog open onClose={() => {
          setHelpOpen(false);
          if (location.pathname === "/guide") navigate("/studio", { replace: true });
        }} />
      </Suspense>}
      {(aboutOpen || location.pathname === "/about") && <Suspense fallback={<LazyDialogFallback />}>
        <AboutDialog open onClose={() => {
          setAboutOpen(false);
          if (location.pathname === "/about") navigate("/studio", { replace: true });
        }} />
      </Suspense>}
      {helpPopup && <Suspense fallback={null}>
        <ContextHelpPopup {...helpPopup} onClose={() => setHelpPopup(undefined)} />
      </Suspense>}
    </div>
  );
}
