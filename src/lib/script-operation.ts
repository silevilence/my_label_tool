import { useOperations } from "../store/useOperations";
import { SCRIPT_ZH_CN as text } from "../i18n/script.zh-CN";

export function beginScriptOperation(cancel: (id: string) => Promise<void>) {
  const operation = useOperations.getState().begin({ label: text.title, resource: "project-annotations" });
  operation.setCancel(() => cancel(operation.id));
  return operation;
}
