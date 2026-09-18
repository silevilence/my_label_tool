import { useRef, type MutableRefObject } from "react";
import type { ImageFile } from "../../lib/tauri-api";
import type { LoadedProjectVideo } from "../../lib/project-media";
import type { AnnotationShape } from "../../types/annotation";
import { VIDEO_ZH_CN as text } from "../../i18n/video.zh-CN";

export function ProjectMediaList({
  images,
  videos,
  selectedPath,
  annotations,
  selectedRef,
  onSelect,
  onPrepare,
  onImageMenu,
}: {
  images: ImageFile[];
  videos: LoadedProjectVideo[];
  selectedPath: string;
  annotations: Record<string, AnnotationShape[]>;
  selectedRef: MutableRefObject<HTMLButtonElement | null>;
  onSelect: (path: string) => void;
  onPrepare: (source: string) => void;
  onImageMenu: (image: ImageFile, x: number, y: number) => void;
}) {
  const remembered = useRef(new Map<string, string>());
  const framePaths = new Set(videos.flatMap((video) => video.images.map((image) => image.path)));
  return (
    <>
      {images
        .filter((image) => !framePaths.has(image.path))
        .map((image) => (
          <button
            key={image.path}
            type="button"
            title={image.path}
            ref={(node) => {
              if (image.path === selectedPath) selectedRef.current = node;
            }}
            className={`block w-full truncate rounded px-3 py-2 text-left text-sm ${image.path === selectedPath ? "bg-sky-500 text-white" : "text-slate-300 hover:bg-slate-800"}`}
            onClick={() => onSelect(image.path)}
            onContextMenu={(event) => {
              event.preventDefault();
              onImageMenu(image, event.clientX, event.clientY);
            }}
          >
            {image.name}
          </button>
        ))}
      {videos.map((video) => {
        const active = video.images.some((image) => image.path === selectedPath);
        if (active) remembered.current.set(video.sourcePath, selectedPath);
        const done = video.images.filter(
          (image) => (annotations[image.path]?.length ?? 0) > 0,
        ).length;
        return (
          <div key={video.sourcePath} className="mb-1">
            <button
              type="button"
              title={video.sourcePath}
              aria-current={active ? "true" : undefined}
              className={`w-full rounded px-3 py-2 text-left text-sm ${active ? "bg-sky-500/15 text-sky-200 ring-1 ring-inset ring-sky-500/40" : "text-slate-300 hover:bg-slate-800"}`}
              onClick={() =>
                video.images.length
                  ? onSelect(remembered.current.get(video.sourcePath) ?? video.images[0].path)
                  : onPrepare(video.sourcePath)
              }
            >
              <span className="flex items-center gap-2">
                <span className="rounded border border-slate-600 px-1 text-[10px]">
                  {text.video}
                </span>
                <span className="truncate">{video.sourcePath.split(/[\\/]/).pop()}</span>
              </span>
              <span className="mt-1 block text-xs text-slate-400">
                {video.video ? text.annotatedFrames(done, video.images.length) : text.notPrepared}
              </span>
            </button>
            {active && (
              <div className="scrollbar-dark ml-4 mt-1 max-h-48 overflow-auto border-l border-slate-700 pl-2">
                {video.images.map((frame, index) => (
                  <button
                    key={frame.path}
                    type="button"
                    ref={(node) => {
                      if (frame.path === selectedPath) selectedRef.current = node;
                    }}
                    className={`block w-full rounded px-2 py-1.5 text-left text-xs ${frame.path === selectedPath ? "bg-sky-500 text-white" : "text-slate-400 hover:bg-slate-800"}`}
                    onClick={() => onSelect(frame.path)}
                  >
                    {text.frameLabel(video.video!.frames[index].frameIndex + 1)}
                    <span className="float-right tabular-nums">
                      {text.time(video.video!.frames[index].timestampSeconds)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
