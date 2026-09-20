import { ImageListRow } from "./ImageListRow";
import { useAnnotationStore } from "../../store/useAnnotationStore";
import type { ImageFile } from "../../lib/tauri-api";
import type { LoadedProjectVideo } from "../../lib/project-media";
import type { AnnotationShape } from "../../types/annotation";
import { VIDEO_ZH_CN as text } from "../../i18n/video.zh-CN";

export function ProjectMediaList({
  images,
  videos,
  selectedPath,
  annotations,
  onSelect,
  onPrepare,
  onImageMenu,
  onVideoMenu,
}: {
  onVideoMenu?: (source: string, x: number, y: number) => void;
  images: ImageFile[];
  videos: LoadedProjectVideo[];
  selectedPath: string;
  annotations: Record<string, AnnotationShape[]>;
  onSelect: (path: string) => void;
  onPrepare: (source: string) => void;
  onImageMenu: (image: ImageFile, x: number, y: number) => void;
}) {
  const pushScope = useAnnotationStore((state) => state.pushScope);
  const framePaths = new Set(videos.flatMap((video) => video.images.map((image) => image.path)));
  return (
    <>
      {images
        .filter((image) => !framePaths.has(image.path))
        .map((image) => (
          <ImageListRow
            key={image.path}
            type="button"
            title={image.path}
            selected={image.path === selectedPath}
            className={`block w-full truncate rounded px-3 py-2 text-left text-sm ${image.path === selectedPath ? "bg-sky-500 text-white" : "text-slate-300 hover:bg-slate-800"}`}
            onClick={() => onSelect(image.path)}
            onContextMenu={(event) => {
              event.preventDefault();
              onImageMenu(image, event.clientX, event.clientY);
            }}
          >
            {image.name}
          </ImageListRow>
        ))}
      {videos.map((video) => {
        const active = video.images.some((image) => image.path === selectedPath);
        const done = video.images.filter(
          (image) => (annotations[image.path]?.length ?? 0) > 0,
        ).length;
        return (
          <div key={video.sourcePath} className="mb-1">
            <button
              type="button"
              title={video.sourcePath}
              onContextMenu={(event) => {
                event.preventDefault();
                onVideoMenu?.(video.sourcePath, event.clientX, event.clientY);
              }}
              aria-current={active ? "true" : undefined}
              className={`w-full rounded px-3 py-2 text-left text-sm ${active ? "bg-sky-500/15 text-sky-200 ring-1 ring-inset ring-sky-500/40" : "text-slate-300 hover:bg-slate-800"}`}
              onClick={() => {
                if (!video.images.length) {
                  onPrepare(video.sourcePath);
                  return;
                }
                pushScope({
                  kind: "video",
                  ids: video.images.map((image) => image.path),
                  label: video.sourcePath.split(/[\\/]/).pop() ?? video.sourcePath,
                });
              }}
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
                  <ImageListRow
                    key={frame.path}
                    type="button"
                    selected={frame.path === selectedPath}
                    className={`block w-full rounded px-2 py-1.5 text-left text-xs ${frame.path === selectedPath ? "bg-sky-500 text-white" : "text-slate-400 hover:bg-slate-800"}`}
                    onClick={() => onSelect(frame.path)}
                  >
                    {text.frameLabel(video.video!.frames[index].frameIndex + 1)}
                    <span className="float-right tabular-nums">
                      {text.time(video.video!.frames[index].timestampSeconds)}
                    </span>
                  </ImageListRow>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
