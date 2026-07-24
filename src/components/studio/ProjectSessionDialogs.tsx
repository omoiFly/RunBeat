import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ProjectV1 } from "../../domain/types";
import { useI18n } from "../../i18n";
import { deleteProject, listProjects } from "../../services/db";
import { ClassicIcon } from "../ClassicIcon";
import { ConfirmDialog } from "../ConfirmDialog";

export function ProjectNameDialog({ open, title, initialName, onSave, onCancel }: {
  open: boolean;
  title: string;
  initialName: string;
  onSave: (name: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const save = async () => {
    if (!name.trim()) {
      inputRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      await onSave(name.trim());
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !saving) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-input-shield" />
        <Dialog.Content
          className="save-project-dialog window"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            window.requestAnimationFrame(() => {
              inputRef.current?.focus();
              inputRef.current?.select();
            });
          }}
        >
          <div className="title-bar">
            <Dialog.Title className="title-bar-text">{title}</Dialog.Title>
            <div className="title-bar-controls"><Dialog.Close asChild><button className="close" type="button" aria-label={t("关闭")} disabled={saving} /></Dialog.Close></div>
          </div>
          <div className="save-project-body">
            <ClassicIcon name="save" size={32} />
            <div>
              <label htmlFor="save-project-name">{t("项目名称:")}</label>
              <input
                ref={inputRef}
                id="save-project-name"
                value={name}
                maxLength={80}
                spellCheck={false}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void save();
                }}
              />
            </div>
          </div>
          <div className="dialog-command-row">
            <button className="default" type="button" disabled={saving || !name.trim()} onClick={() => void save()}>{saving ? t("正在保存...") : t("保存")}</button>
            <button type="button" disabled={saving} onClick={onCancel}>{t("取消")}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function formatDate(timestamp: number, language: "zh-CN" | "en"): string {
  return new Date(timestamp).toLocaleString(language === "en" ? "en-US" : "zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function OpenProjectDialog({ open, currentProjectId, onOpen, onCancel }: {
  open: boolean;
  currentProjectId?: string;
  onOpen: (project: ProjectV1) => void;
  onCancel: () => void;
}) {
  const { language, t } = useI18n();
  const [projects, setProjects] = useState<ProjectV1[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [pendingDelete, setPendingDelete] = useState<ProjectV1>();
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    void listProjects()
      .then((items) => {
        setProjects(items);
        setSelectedId(items.find((item) => item.id !== currentProjectId)?.id ?? items[0]?.id);
      })
      .finally(() => setLoading(false));
  }, [currentProjectId, open]);

  const selected = projects.find((project) => project.id === selectedId);
  const canDeleteSelected = selected != null && selected.id !== currentProjectId;
  const removeSelected = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteProject(pendingDelete.id);
      const remaining = projects.filter((project) => project.id !== pendingDelete.id);
      setProjects(remaining);
      setSelectedId((current) => current === pendingDelete.id
        ? remaining.find((project) => project.id !== currentProjectId)?.id ?? remaining[0]?.id
        : current);
      setPendingDelete(undefined);
    } finally {
      setDeleting(false);
    }
  };

  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!projects.length) return;
    const index = Math.max(0, projects.findIndex((project) => project.id === selectedId));
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = event.key === "Home"
        ? 0
        : event.key === "End"
          ? projects.length - 1
          : Math.max(0, Math.min(projects.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
      setSelectedId(projects[next].id);
    } else if (event.key === "Enter" && selected) {
      onOpen(selected);
    } else if (event.key === "Delete" && canDeleteSelected) {
      event.preventDefault();
      setPendingDelete(selected);
    }
  };

  return (
    <>
      <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !pendingDelete) onCancel(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="modal-input-shield" />
          <Dialog.Content className="open-project-dialog window">
            <div className="title-bar">
              <Dialog.Title className="title-bar-text">{t("打开项目")}</Dialog.Title>
              <div className="title-bar-controls"><Dialog.Close asChild><button className="close" type="button" aria-label={t("关闭")} /></Dialog.Close></div>
            </div>
            <div className="open-project-body">
              <div className="open-project-location"><label>{t("查找范围:")}</label><div className="sunken-panel"><ClassicIcon name="folder" />{t("本地项目")}</div></div>
              <div className="open-project-list sunken-panel" tabIndex={0} role="listbox" aria-label={t("本地项目")} onKeyDown={handleListKeyDown}>
                <table>
                  <thead><tr><th>{t("名称")}</th><th>{t("歌曲")}</th><th>{t("目标步频")}</th><th>{t("修改日期")}</th></tr></thead>
                  <tbody>{projects.map((project) => <tr
                    key={project.id}
                    role="option"
                    aria-selected={selectedId === project.id}
                    className={selectedId === project.id ? "selected highlighted" : ""}
                    onClick={() => setSelectedId(project.id)}
                    onDoubleClick={() => onOpen(project)}
                  >
                    <td><ClassicIcon name="folder" />{project.name}</td>
                    <td>{project.tracks.length}</td>
                    <td>{project.targetSpm} SPM</td>
                    <td>{formatDate(project.updatedAt, language)}</td>
                  </tr>)}</tbody>
                </table>
                {!loading && !projects.length && <div className="classic-list-empty"><p>{t("没有已保存的项目。")}</p></div>}
                {loading && <div className="classic-list-empty"><p>{t("正在读取项目...")}</p></div>}
              </div>
            </div>
            <div className="dialog-command-row">
              <button
                type="button"
                disabled={!canDeleteSelected || deleting}
                title={selected?.id === currentProjectId ? t("当前打开的项目请使用“项目”菜单删除。") : undefined}
                onClick={() => canDeleteSelected && setPendingDelete(selected)}
              >{t("删除")}</button>
              <span className="dialog-command-spacer" />
              <button className="default" type="button" disabled={!selected || deleting} onClick={() => selected && onOpen(selected)}>{t("打开")}</button>
              <button type="button" disabled={deleting} onClick={onCancel}>{t("取消")}</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <ConfirmDialog
        open={pendingDelete != null}
        title={t("删除项目")}
        message={t("要永久删除“{name}”吗？此操作无法撤销。", { name: pendingDelete?.name ?? "" })}
        confirmLabel={t("删除(Y)")}
        onConfirm={() => void removeSelected()}
        onCancel={() => setPendingDelete(undefined)}
      />
    </>
  );
}
