import { tryBeginOperation, useOperations } from "../store/useOperations";
import { OPERATION_ZH_CN as operationText } from "../i18n/operations.zh-CN";
import { useRef, useState } from "react";
import { recycleImageFile, type ImageFile } from "../lib/tauri-api";
import { useAnnotationStore } from "../store/useAnnotationStore";
import { IMAGE_DELETION_ZH_CN as text } from "../i18n/image-deletion.zh-CN";

export interface ImageDeletionTarget {
  image: ImageFile;
  folderPath: string;
  readyAt: number;
}

export function useImageDeletion(options: {
  folderPath: string;
  busy: boolean;
  setError: (message: string) => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const targetRef = useRef<ImageDeletionTarget | null>(null);
  const inFlight = useRef(false);
  const [target, setTarget] = useState<ImageDeletionTarget | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState("");

  function request(path: string) {
    const current = latest.current;
    if (targetRef.current || inFlight.current) return;
    if (
      current.busy ||
      !useOperations.getState().canStart(["project-annotations", "export-dir", "video-frames"])
    ) {
      current.setError(text.busy);
      return;
    }
    const image = useAnnotationStore.getState().images.find((item) => item.path === path);
    if (!image) return;
    const next = { image, folderPath: current.folderPath, readyAt: Date.now() + 3000 };
    targetRef.current = next;
    setError("");
    setTarget(next);
  }

  function cancel() {
    if (inFlight.current) return;
    targetRef.current = null;
    setTarget(null);
  }

  async function confirm() {
    const pending = targetRef.current;
    if (!pending || inFlight.current || Date.now() < pending.readyAt) return;
    const current = latest.current;
    if (
      current.busy ||
      !useOperations.getState().canStart(["project-annotations", "export-dir", "video-frames"])
    ) {
      setError(text.busy);
      return;
    }
    if (
      current.folderPath !== pending.folderPath ||
      !useAnnotationStore.getState().images.includes(pending.image)
    ) {
      setError(text.stale);
      return;
    }
    const operation = tryBeginOperation({
      label: operationText.deleteImage,
      resource: ["project-annotations", "export-dir", "video-frames"],
    });
    if (!operation) {
      setError(operationText.busy);
      return;
    }
    inFlight.current = true;
    setIsDeleting(true);
    setError("");
    try {
      await recycleImageFile(pending.folderPath, pending.image.path);
      useAnnotationStore.getState().removeImage(pending.image.path);
      operation.complete();
      targetRef.current = null;
      setTarget(null);
    } catch (caught: unknown) {
      operation.fail(caught);
      setError(text.failure(caught instanceof Error ? caught.message : String(caught)));
    } finally {
      inFlight.current = false;
      setIsDeleting(false);
    }
  }

  return { target, isDeleting, error, request, cancel, confirm };
}
