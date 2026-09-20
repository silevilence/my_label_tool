import { useOperations } from "../store/useOperations";
import { OPERATION_ZH_CN as text } from "../i18n/operations.zh-CN";

export function useSaveFeedback(saveProjectExport: () => Promise<boolean>) {
  const isSaving = useOperations((state) =>
    state.operations.some((op) => op.label === text.save && op.status === "running"),
  );
  return { isSaving, saveWithFeedback: saveProjectExport, showSaveSuccess: false };
}
