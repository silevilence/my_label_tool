import { useRef, useState } from "react";
import type { AnnotationShape, LabelConfig } from "../../types/annotation";
import type { VideoProject } from "../../types/video";
import { exportAnnotationsJson, selectExportPath, type ImageFile } from "../../lib/tauri-api";
import { exportVideo } from "../../lib/exporters/video";
import { VIDEO_ZH_CN as text } from "../../i18n/video.zh-CN";

export function VideoExportButton({
  video,
  images,
  labels,
  annotations,
  disabled,
  onMessage,
}: {
  video: VideoProject;
  images: ImageFile[];
  labels: LabelConfig[];
  annotations: Record<string, AnnotationShape[]>;
  disabled: boolean;
  onMessage: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  async function save() {
    if (pending.current || disabled) return;
    pending.current = true;
    setSaving(true);
    try {
      const snapshot = exportVideo(video, images, labels, annotations);
      const path = await selectExportPath("annotations.video.json");
      if (!path) return;
      await exportAnnotationsJson(path, snapshot);
      onMessage(text.exported);
    } catch (error) {
      onMessage(String(error));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  return (
    <button
      disabled={disabled || saving}
      onClick={() => void save()}
      className="shrink-0 rounded bg-emerald-700 px-3 py-1 text-sm disabled:opacity-40"
    >
      {saving ? text.exporting : text.exportVideo}
    </button>
  );
}
