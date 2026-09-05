import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createProject } from "../domain/types";
import { useI18n } from "../i18n";
import { beatSampleReference, cleanUnusedLibraryBeats, deleteLibraryBeat, downloadLibraryBeat, uploadLibraryBeat, type BeatLibraryItem } from "../services/beatLibrary";
import { loadCustomBeatSample } from "../services/customBeat";
import { BEAT_PREVIEW_SECONDS, playBeatPreview, stopPreview } from "../services/preview";
import { useBeatLibrary } from "../services/useBeatLibrary";
import { ConfirmDialog } from "./ConfirmDialog";
import { RenameBeatDialog } from "./RenameBeatDialog";

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function BeatLibraryDialog({ onClose }: { onClose: () => void }) {
  const { t, translateMessage } = useI18n();
  const { items, loading, error: loadError, refresh } = useBeatLibrary();
  const [selection, setSelection] = useState<string>();
  const [search, setSearch] = useState("");
  const [working, setWorking] = useState(false);
  const [playingId, setPlayingId] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [confirmation, setConfirmation] = useState<{ ids: string[]; clean: boolean }>();
  const [renaming, setRenaming] = useState<BeatLibraryItem>();
  const input = useRef<HTMLInputElement>(null);
  const previewRequest = useRef(0);
  const previewTimer = useRef<number | undefined>(undefined);
  const visible = items.filter((item) => [item.name, item.fileName].some((name) => name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())));
  const selected = visible.find((item) => item.resourceId === selection) ?? visible[0];
  const unused = items.filter((item) => !item.projectNames.length && !item.activeInWorkspace);
  const selectedUsed = selected && (selected.projectNames.length > 0 || selected.activeInWorkspace);

  useEffect(() => () => {
    previewRequest.current += 1;
    window.clearTimeout(previewTimer.current);
    stopPreview();
  }, []);

  const stop = () => {
    previewRequest.current += 1;
    window.clearTimeout(previewTimer.current);
    stopPreview();
    setPlayingId(undefined);
  };

  const preview = async (item: BeatLibraryItem) => {
    const wasPlaying = playingId === item.resourceId;
    stop();
    if (wasPlaying) return;
    const request = previewRequest.current;
    setPlayingId(item.resourceId);
    setError(undefined);
    try {
      const sample = await loadCustomBeatSample(item.resourceId);
      if (request !== previewRequest.current) return;
      if (!sample) throw new Error("鼓点已被删除，请重新选择。");
      const project = createProject();
      project.beatTrack = { ...project.beatTrack, sound: "custom", customSample: beatSampleReference(item) };
      await playBeatPreview(project, sample);
      if (request === previewRequest.current) previewTimer.current = window.setTimeout(() => setPlayingId(undefined), BEAT_PREVIEW_SECONDS * 1000);
    } catch (reason) {
      if (request !== previewRequest.current) return;
      setPlayingId(undefined);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const run = async (action: () => Promise<void>) => {
    setWorking(true);
    setError(undefined);
    setMessage(undefined);
    stop();
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setWorking(false); refresh(); }
  };

  const download = async () => {
    if (!selected) return;
    const { blob, fileName } = await downloadLibraryBeat(selected.resourceId);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const startRename = (item: BeatLibraryItem) => { stop(); setRenaming(item); };

  const handleListKey = (event: KeyboardEvent<HTMLTableElement>) => {
    if (working || !selected) return;
    const index = visible.indexOf(selected);
    if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1 : Math.max(0, Math.min(visible.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
      setSelection(visible[next].resourceId);
      document.getElementById(`library-beat-${visible[next].resourceId}`)?.focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      void preview(selected);
    } else if (event.key === "F2") {
      event.preventDefault();
      startRename(selected);
    } else if (event.key === "Delete" && !selectedUsed) {
      event.preventDefault();
      setConfirmation({ ids: [selected.resourceId], clean: false });
    }
  };

  return <Dialog.Root open onOpenChange={(open) => { if (!open && !working) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="modal-input-shield" />
      <Dialog.Content className="property-dialog beat-library-dialog window" onEscapeKeyDown={(event) => { if (working) event.preventDefault(); }}>
        <div className="title-bar">
          <Dialog.Title className="title-bar-text">{t("鼓点库")}</Dialog.Title>
          <div className="title-bar-controls"><Dialog.Close asChild><button type="button" className="close" aria-label={t("关闭")} disabled={working} /></Dialog.Close></div>
        </div>
        <div className="beat-library-body">
          <Dialog.Description>{t("鼓点保存在当前浏览器，可供所有本地项目使用。支持不超过 3 秒、10 MB 的单次鼓点音频。")}</Dialog.Description>
          <div className="beat-library-toolbar">
            <button type="button" disabled={working} onClick={() => input.current?.click()}>{t("上传...")}</button>
            <button type="button" disabled={working || !selected} onClick={() => { if (selected) void preview(selected); }}>{playingId === selected?.resourceId && playingId ? t("停止") : t("试听")}</button>
            <button type="button" disabled={working || !selected} onClick={() => void run(download)}>{t("下载")}</button>
            <button type="button" disabled={working || !selected} title="F2" onClick={() => { if (selected) startRename(selected); }}>{t("重命名...")}</button>
            <button type="button" disabled={working || !selected || Boolean(selectedUsed)} onClick={() => { if (selected) setConfirmation({ ids: [selected.resourceId], clean: false }); }}>{t("删除")}</button>
            <button type="button" disabled={working || !unused.length} onClick={() => setConfirmation({ ids: unused.map((item) => item.resourceId), clean: true })}>{t("清理未使用...")}</button>
            <input ref={input} hidden type="file" multiple accept="audio/*,.wav,.mp3,.flac,.m4a,.aac,.ogg" aria-label={t("上传鼓点")} onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.currentTarget.value = "";
              if (!files.length) return;
              void run(async () => {
                const failures: string[] = [];
                for (const file of files) {
                  try { const reference = await uploadLibraryBeat(file); setSelection(reference.resourceId); }
                  catch (reason) { failures.push(`${file.name}: ${translateMessage(reason instanceof Error ? reason.message : String(reason))}`); }
                }
                if (failures.length) setError(failures.join("\n"));
                else setMessage(t("已加入鼓点库；相同文件会自动复用。"));
              });
            }} />
          </div>
          <div className="beat-library-search"><label htmlFor="beat-library-search">{t("查找鼓点:")}</label><input id="beat-library-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
          <div className="beat-library-list sunken-panel">
            <table role="grid" aria-label={t("鼓点列表")} onKeyDown={handleListKey}>
              <thead><tr><th>{t("名称")}</th><th>{t("时长")}</th><th>{t("占用空间")}</th><th>{t("使用情况")}</th></tr></thead>
              <tbody>{visible.map((item) => <tr key={item.resourceId} id={`library-beat-${item.resourceId}`} tabIndex={selected?.resourceId === item.resourceId ? 0 : -1} aria-selected={selected?.resourceId === item.resourceId} onClick={() => setSelection(item.resourceId)} onDoubleClick={() => { if (!working) void preview(item); }}>
                <td title={item.name}>{item.name}</td><td>{item.durationSeconds.toFixed(2)} s</td><td>{formatBytes(item.storageBytes)}</td>
                <td>{item.projectNames.length ? t("{count} 个项目", { count: item.projectNames.length }) : item.activeInWorkspace ? t("编辑中") : t("未使用")}</td>
              </tr>)}</tbody>
            </table>
            {!visible.length && <p className="beat-library-empty">{loading ? t("正在加载...") : items.length ? t("没有匹配的鼓点。") : t("鼓点库为空，点击“上传”添加第一个鼓点。")}</p>}
          </div>
          <div className="beat-library-details">
            {selected && <span>{t("原文件：{name}", { name: selected.fileName })}</span>}
            <span>{selected?.projectNames.length ? t("用于项目：{names}", { names: selected.projectNames.join("、") }) : selected?.activeInWorkspace ? t("当前编辑或撤销记录仍在使用这个鼓点。") : t("未使用的鼓点可删除，也可保留供以后使用。")}</span>
            {selected && !selected.originalAvailable && <span>{t("此旧鼓点没有保留原文件，下载时会导出为 WAV。")}</span>}
          </div>
          {(error || loadError) && <p role="alert" className="beat-library-error">{translateMessage(error ?? loadError)}</p>}
          {message && <p role="status">{message}</p>}
        </div>
        <div className="dialog-command-row beat-library-footer"><span role="status">{working ? t("正在处理...") : t("{count} 个鼓点，共 {size}", { count: items.length, size: formatBytes(items.reduce((sum, item) => sum + item.storageBytes, 0)) })}</span><button type="button" onClick={onClose} disabled={working}>{t("关闭")}</button></div>
        {confirmation && <ConfirmDialog open title={confirmation.clean ? t("清理未使用鼓点") : t("删除鼓点")} message={confirmation.clean
          ? t("要删除这 {count} 个未使用鼓点吗？包括尚未用于项目的新上传鼓点。正在使用的资源会保留。", { count: confirmation.ids.length })
          : t("要从鼓点库中永久删除“{name}”吗？", { name: selected?.name ?? "" })} confirmLabel={t("删除")} onCancel={() => setConfirmation(undefined)} onConfirm={() => {
            const pending = confirmation;
            setConfirmation(undefined);
            void run(async () => {
              if (pending.clean) {
                const result = await cleanUnusedLibraryBeats(pending.ids);
                setMessage(t("已清理 {deleted} 个鼓点，保留 {skipped} 个使用中的鼓点。", result));
              } else await deleteLibraryBeat(pending.ids[0]);
            });
          }} />}
        {renaming && <RenameBeatDialog resourceId={renaming.resourceId} name={renaming.name} fileName={renaming.fileName} onClose={() => setRenaming(undefined)} onRenamed={(name) => {
          setSelection(renaming.resourceId);
          setSearch("");
          setRenaming(undefined);
          setMessage(t("已重命名为“{name}”。", { name }));
          refresh();
        }} />}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
