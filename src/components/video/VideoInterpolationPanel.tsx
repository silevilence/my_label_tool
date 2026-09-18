import { useState } from "react";
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

export function VideoInterpolationPanel({
  video,
  images,
  selectedPath,
  selectedShape,
  disabled,
  onSelect,
  onError,
}: {
  video: VideoProject;
  images: ImageFile[];
  selectedPath: string;
  selectedShape: AnnotationShape | null;
  disabled: boolean;
  onSelect: (path: string) => void;
  onError: (message: string) => void;
}) {
  const annotations = useAnnotationStore((state) => state.annotationsByImage);
  const [choice, setChoice] = useState("");
  const [preview, setPreview] = useState<{
    plan: VideoInterpolationPlan;
    source: typeof annotations;
  } | null>(null);
  const tracks = [
    ...new Set(
      images.flatMap((image) => (annotations[image.path] ?? []).map(videoTrackId)).filter(Boolean),
    ),
  ];
  const selectedTrack =
    choice === "new" ? "" : tracks.includes(choice) ? choice : videoTrackId(selectedShape);
  function mark() {
    if (!selectedShape || disabled) return;
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
    try {
      setPreview({
        plan: interpolateVideoTrack(video, images, annotations, selectedTrack),
        source: annotations,
      });
    } catch (error) {
      setPreview(null);
      onError(String(error));
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
        <ul className="mt-2 max-h-24 overflow-auto text-xs text-slate-300">
          {preview.plan.entries.map((entry) => (
            <li key={entry.imagePath}>
              <button disabled={disabled} onClick={() => onSelect(entry.imagePath)}>
                {text.viewFrame(entry.frameIndex + 1)}
              </button>
              {": "}
              {entry.generated.points.map((point) => point.toFixed(2)).join(", ")}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
