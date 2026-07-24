import { useI18n } from "../i18n";

export function LazyDialogFallback() {
  const { t } = useI18n();

  return (
    <>
      <div className="modal-input-shield" />
      <div className="lazy-dialog-loading message-box window" role="status" aria-live="polite">
        <div className="title-bar">
          <div className="title-bar-text">RunBeat</div>
        </div>
        <div className="lazy-dialog-loading-body">
          <span aria-hidden="true" />
          {t("正在加载 RunBeat…")}
        </div>
      </div>
    </>
  );
}
