import { useEffect, useState } from "react";
import type { AnnotationShape } from "../../types/annotation";
import type { VideoProject } from "../../types/video";
import type { ImageFile } from "../../lib/tauri-api";
import { useAnnotationStore } from "../../store/useAnnotationStore";
import {
  interpolateVideoTrack,
  markVideoKeyframe,
  videoTrackId,
  type VideoInterpolationPlan,
} from "../../lib/video-interpolation";
import { VIDEO_ZH_CN as text } from "../../i18n/video.zh-CN";

export interface InterpolationPreview {
  plan: VideoInterpolationPlan;
  source: Record<string, AnnotationShape[]>;
  video: VideoProject;
}

export function VideoInterpolationPanel({
  video,
  images,
  selectedPath,
  selectedShape,
  disabled,
  onSelect,
  onError,
  onPreviewChange,
}: {
  video: VideoProject;
  images: ImageFile[];
  selectedPath: string;
  selectedShape: AnnotationShape | null;
  disabled: boolean;
  onSelect: (path: string) => void;
  onError: (message: string) => void;
  onPreviewChange?: (preview: InterpolationPreview | null) => void;
}) {
  const annotations = useAnnotationStore((state) => state.annotationsByImage);
  const [choice, setChoice] = useState("");
  const [preview, setPreview] = useState<InterpolationPreview | null>(null);
  const tracks = [
    ...new Set(
      images.flatMap((image) => (annotations[image.path] ?? []).map(videoTrackId)).filter(Boolean),
    ),
  ];
  const selectedTrack =
    choice === "new" ? "" : tracks.includes(choice) ? choice : videoTrackId(selectedShape);
  useEffect(() => {
    onPreviewChange?.(
      preview?.source === annotations &&
        preview.video === video &&
        preview.plan.trackId === selectedTrack
        ? preview
        : null,
    );
    return () => onPreviewChange?.(null);
  }, [preview, annotations, video, selectedTrack, onPreviewChange]);

  function mark() {
    if (!selectedShape || disabled) return;
    onError("");
    const track = selectedTrack || crypto.randomUUID();
    if (
      (annotations[selectedPath] ?? []).some(
        (shape) => shape.id !== selectedShape.id && videoTrackId(shape) === track,
      )
    ) {
      onError(text.duplicateTrack);
      return;
    }
    useAnnotationStore
      .getState()
      .updateAnnotation(selectedPath, selectedShape.id, markVideoKeyframe(selectedShape, track));
    setChoice(track);
    setPreview(null);
  }
  function prepare() {
    if (disabled) return;
    onError("");
    try {
      const plan = interpolateVideoTrack(video, images, annotations, selectedTrack);
      setChoice(plan.trackId);
      setPreview({
        plan,
        source: annotations,
        video,
      });
      const target =
        plan.entries.find((entry) => entry.imagePath === selectedPath) ?? plan.entries[0];
      if (target && target.imagePath !== selectedPath) onSelect(target.imagePath);
    } catch (error) {
      setPreview(null);
      onError(error instanceof Error ? error.message : String(error));
    }
  }
  function apply() {
    if (!preview || disabled) return;
    if (
      preview.source !== useAnnotationStore.getState().annotationsByImage ||
      preview.plan.trackId !== selectedTrack
    ) {
      onError(text.stalePreview);
      return;
    }
    useAnnotationStore.getState().insertAnnotationsBatch(preview.plan.entries, "replace");
    onError("");
    setPreview(null);
  }
  return (
    <details className="border-t border-slate-800 bg-slate-900 px-4 py-2 text-xs">
      <summary className="cursor-pointer text-sky-300">{text.interpolation}</summary>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label>
          {text.track}{" "}
          <select
            aria-label={text.track}
            value={selectedTrack || "new"}
            disabled={disabled}
            onChange={(event) => {
              setChoice(event.target.value);
              setPreview(null);
              onError("");
            }}
            className="max-w-48 rounded bg-slate-800 p-1"
          >
            <option value="new">{text.newTrack}</option>
            {tracks.map((track) => (
              <option key={track} value={track}>
                {track}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={disabled || !selectedShape}
          onClick={mark}
          className="rounded bg-sky-700 px-2 py-1 disabled:opacity-40"
        >
          {text.markKeyframe}
        </button>
        <button
          disabled={disabled || !selectedTrack}
          onClick={prepare}
          className="rounded bg-slate-700 px-2 py-1 disabled:opacity-40"
        >
          {text.preview}
        </button>
        {selectedShape?.attributes?.videoKeyframe === true && <span>{text.keyframe}</span>}
        {selectedShape?.attributes?.videoInterpolated === true && <span>{text.interpolated}</span>}
        {preview && (
          <>
            <span role="status">{text.previewCount(preview.plan.entries.length)}</span>
            <button
              disabled={disabled}
              onClick={() => {
                setPreview(null);
                onError("");
              }}
              className="rounded border border-slate-600 px-2 py-1 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
            >
              {text.cancelPreview}
            </button>
            <button
              disabled={
                disabled || preview.source !== annotations || preview.plan.entries.length === 0
              }
              onClick={apply}
              className="rounded bg-emerald-700 px-2 py-1 disabled:opacity-40"
            >
              {text.apply}
            </button>
          </>
        )}
      </div>
      {preview && (
        <div className="mt-2 space-y-2">
          <p className="text-amber-200">
            {preview.source !== annotations
              ? text.stalePreview
              : preview.plan.entries.length
                ? text.previewHint
                : text.emptyPreview}
          </p>
          <ul className="flex max-h-20 flex-wrap gap-2 overflow-auto text-xs text-slate-300">
            {preview.plan.entries.map((entry) => (
              <li key={entry.imagePath}>
                <button
                  disabled={disabled || preview.source !== annotations}
                  onClick={() => onSelect(entry.imagePath)}
                  aria-current={entry.imagePath === selectedPath ? "true" : undefined}
                  className={`rounded border px-2 py-1 ${entry.imagePath === selectedPath ? "border-amber-400 text-amber-200" : "border-slate-700 hover:bg-slate-800"}`}
                >
                  {text.viewFrame(entry.frameIndex + 1)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}
