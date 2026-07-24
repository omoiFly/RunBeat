import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { AppCommand } from "../components/AppLayout";
import { ClassicIcon } from "../components/ClassicIcon";
import { ConfirmDialog } from "../components/ConfirmDialog";
import type { ProjectV1 } from "../domain/types";
import { useI18n } from "../i18n";
import { deleteProject, listProjects } from "../services/db";

function formatDate(timestamp: number, language: "zh-CN" | "en"): string {
  return new Date(timestamp).toLocaleString(language === "en" ? "en-US" : "zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function ProjectsPage() {
  const { language, t } = useI18n();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectV1[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [pendingDelete, setPendingDelete] = useState<ProjectV1>();

  useEffect(() => {
    void listProjects().then((items) => {
      setProjects(items);
      setSelectedId(items[0]?.id);
    });
  }, []);

  const selected = projects.find((project) => project.id === selectedId);
  const openSelected = useCallback(() => {
    if (selected) navigate(`/studio?project=${encodeURIComponent(selected.id)}`);
  }, [navigate, selected]);
  const remove = async () => {
    if (!pendingDelete) return;
    await deleteProject(pendingDelete.id);
    const remaining = projects.filter((item) => item.id !== pendingDelete.id);
    setProjects(remaining);
    setSelectedId((current) => current === pendingDelete.id ? remaining[0]?.id : current);
    setPendingDelete(undefined);
  };

  useEffect(() => {
    const onCommand = (event: Event) => {
      const command = (event as CustomEvent<AppCommand>).detail;
      if (command === "new-project") navigate(`/studio?new=${Date.now()}`);
      else if (command === "open-project") openSelected();
      else if (command === "close-project") navigate("/studio");
      else if (command === "delete-project" && selected) setPendingDelete(selected);
    };
    window.addEventListener("runbeat:command", onCommand);
    return () => window.removeEventListener("runbeat:command", onCommand);
  }, [navigate, openSelected, selected]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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
    } else if (event.key === "Enter") {
      openSelected();
    } else if (event.key === "Delete" && selected) {
      setPendingDelete(selected);
    }
  };

  return (
    <div className="projects-page-classic">
      <div className="projects-location-row">
        <label>{t("查找范围:")}</label>
        <div className="sunken-panel"><ClassicIcon name="folder" />{t("本地项目")}</div>
      </div>
      <div className="projects-detail-list sunken-panel" tabIndex={0} role="listbox" aria-label={t("本地项目")} onKeyDown={handleKeyDown}>
        <table>
          <thead><tr><th>{t("名称")}</th><th>{t("歌曲")}</th><th>{t("目标步频")}</th><th>{t("修改日期")}</th></tr></thead>
          <tbody>{projects.map((project) => <tr
            key={project.id}
            role="option"
            aria-selected={selectedId === project.id}
            className={selectedId === project.id ? "selected highlighted" : ""}
            onClick={() => setSelectedId(project.id)}
            onDoubleClick={() => navigate(`/studio?project=${encodeURIComponent(project.id)}`)}
          >
            <td><ClassicIcon name="folder" />{project.name}</td>
            <td>{project.tracks.length}</td>
            <td>{project.targetSpm} SPM</td>
            <td>{formatDate(project.updatedAt, language)}</td>
          </tr>)}</tbody>
        </table>
        {!projects.length && <div className="classic-list-empty"><ClassicIcon name="folder" size={32} /><p>{t("没有已保存的项目。")}</p></div>}
      </div>
      <div className="projects-command-row">
        <button type="button" onClick={() => navigate(`/studio?new=${Date.now()}`)}><ClassicIcon name="new" />{t("新建...")}</button>
        <span />
        <button className="default" type="button" disabled={!selected} onClick={openSelected}>{t("打开")}</button>
        <button type="button" disabled={!selected} onClick={() => selected && setPendingDelete(selected)}>{t("删除")}</button>
      </div>
      <ConfirmDialog
        open={pendingDelete != null}
        title={t("删除项目")}
        message={t("要永久删除“{name}”吗？", { name: pendingDelete?.name ?? "" })}
        confirmLabel={t("删除(Y)")}
        onConfirm={() => void remove()}
        onCancel={() => setPendingDelete(undefined)}
      />
    </div>
  );
}
