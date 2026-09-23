import { useEffect, useRef, useState } from "react";
import { PRELABEL_ZH_CN as text } from "../i18n/prelabel.zh-CN";
import { PrelabelModelContextChangedError } from "../lib/prelabel-models";
import { OPERATION_ZH_CN as operationText } from "../i18n/operations.zh-CN";
import {
  tryBeginOperation,
  useOperations,
  type OperationHandle,
  type OperationView,
  type OperationResource,
} from "../store/useOperations";

interface MutationOptions {
  download?: boolean;
  formatError?: (reason: unknown) => string;
}

/** Actions receive the latest form and persistence callbacks, including on retry.
 * Capture only stable operation arguments (such as model IDs) in the action itself. */
export function usePrelabelLibraryMutation<T>(context: T) {
  const latest = useRef(context);
  latest.current = context;
  const mutationInFlight = useRef(false);
  const modelOperation = useRef<OperationHandle | null>(null);
  const [isLibraryBusy, setIsLibraryBusy] = useState(false);
  const [retry, setRetry] = useState<{
    failure: OperationView;
    action: () => Promise<void>;
  } | null>(null);
  // pushError may update a card in place by ID. Bind to the exact failure revision,
  // so a different message on the same card cannot revive an earlier action.
  const canRetry = useOperations(
    (state) => retry !== null && state.operations.includes(retry.failure),
  );
  const retryLibraryBlocked = useOperations((state) => !state.canStart("model-download"));
  const [busyResource, reportBusy] = useState<OperationResource | null>(null);
  const reportedResourceBusy = useOperations(
    (state) => busyResource !== null && !state.canStart(busyResource),
  );
  useEffect(() => {
    if (!reportedResourceBusy) reportBusy(null);
  }, [reportedResourceBusy]);

  function setError(message: string) {
    setRetry(null);
    const registry = useOperations.getState();
    if (message) registry.pushError(operationText.prelabelSettings, message);
    else
      registry.operations
        .filter((op) => op.label === operationText.prelabelSettings && op.status === "failed")
        .forEach((op) => registry.dismiss(op.id));
  }

  async function runLibraryMutation(
    action: (current: T) => Promise<void>,
    { download = false, formatError = text.settingsOperationFailed }: MutationOptions = {},
  ) {
    if (mutationInFlight.current) return;
    const operation = download
      ? tryBeginOperation({ label: operationText.model, resource: "model-download" })
      : null;
    if (download ? !operation : !useOperations.getState().canStart("model-download")) {
      reportBusy("model-download");
      return;
    }
    if (operation) modelOperation.current = operation;
    mutationInFlight.current = true;
    setIsLibraryBusy(true);
    try {
      await action(latest.current);
      if (!download) setError("");
    } catch (reason) {
      if (operation) operation.fail(reason);
      else {
        setError(formatError(reason));
        const failure = useOperations
          .getState()
          .operations.find(
            (op) => op.label === operationText.prelabelSettings && op.status === "failed",
          );
        if (failure && !(reason instanceof PrelabelModelContextChangedError))
          setRetry({ failure, action: () => runLibraryMutation(action, { formatError }) });
      }
    } finally {
      mutationInFlight.current = false;
      setIsLibraryBusy(false);
      operation?.complete();
    }
  }

  return {
    runLibraryMutation,
    reportBusy,
    busyNotice: reportedResourceBusy ? operationText.busy : "",
    retryLibraryAction:
      canRetry && retry
        ? async () => {
            const registry = useOperations.getState();
            if (registry.canStart("model-download") && registry.operations.includes(retry.failure))
              await retry.action();
          }
        : null,
    retryLibraryBlocked,
    isLibraryBusy,
    modelOperation,
    mutationInFlight,
    setError,
  };
}
