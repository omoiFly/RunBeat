import { ClassicMessageBox } from "./ClassicMessageBox";
import { useI18n } from "../i18n";

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "是(Y)",
  onConfirm,
  onCancel
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <ClassicMessageBox
      open={open}
      title={title}
      message={message}
      icon="warning"
      cancelValue="cancel"
      buttons={[
        { value: "confirm", label: t(confirmLabel), accessKey: "y" },
        { value: "cancel", label: t("取消"), accessKey: "c", default: true }
      ]}
      onSelect={(value) => value === "confirm" ? onConfirm() : onCancel()}
    />
  );
}
