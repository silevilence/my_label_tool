import { ImageListRow } from "./ImageListRow";
import { useVideoFrameNavigation } from "../../hooks/useVideoFrameNavigation";
import type { ImageFile } from "../../lib/tauri-api";
import type { LoadedProjectVideo } from "../../lib/project-media";
import { VIDEO_ZH_CN as text } from "../../i18n/video.zh-CN";
interface MediaProps {
  onVideoMenu?: (source: string, x: number, y: number) => void;
  images: ImageFile[];
  videos: LoadedProjectVideo[];
  selectedPath: string;
  onSelect: (path: string) => void;
  onPrepare: (source: string) => void;
  onImageMenu: (image: ImageFile, x: number, y: number) => void;
}
export function ProjectMediaList({
  images,
  videos,
  selectedPath,
  onSelect,
  onPrepare,
  onImageMenu,
  onVideoMenu,
}: MediaProps) {
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
      {videos.map((video) => (
        <VideoRows
          key={video.sourcePath}
          video={video}
          selectedPath={selectedPath}
          onPrepare={onPrepare}
          onVideoMenu={onVideoMenu}
        />
      ))}
    </>
  );
}
function VideoRows({
  video,
  selectedPath,
  onPrepare,
  onVideoMenu,
}: {
  video: LoadedProjectVideo;
  selectedPath: string;
  onPrepare: MediaProps["onPrepare"];
  onVideoMenu: MediaProps["onVideoMenu"];
}) {
  const navigation = useVideoFrameNavigation(video.scopedVideo, video.images, selectedPath);
  const active = navigation.currentIndex >= 0;
  const done = navigation.frames.filter((frame) => frame.annotated).length;
  return (
    <div className="mb-1">
      <button
        type="button"
        title={video.sourcePath}
        onContextMenu={(event) => {
          event.preventDefault();
          onVideoMenu?.(video.sourcePath, event.clientX, event.clientY);
        }}
        aria-current={active ? "true" : undefined}
        className={`w-full rounded px-3 py-2 text-left text-sm ${active ? "bg-sky-500/15 text-sky-200 ring-1 ring-inset ring-sky-500/40" : "text-slate-300 hover:bg-slate-800"}`}
        onClick={() =>
          navigation.frames.length
            ? navigation.select(active ? navigation.currentIndex : 0)
            : onPrepare(video.sourcePath)
        }
      >
        <span className="flex items-center gap-2">
          <span className="rounded border border-slate-600 px-1 text-[10px]">{text.video}</span>
          <span className="truncate">{video.sourcePath.split(/[\\/]/).pop()}</span>
        </span>
        <span className="mt-1 block text-xs text-slate-400">
          {video.video ? text.annotatedFrames(done, navigation.frames.length) : text.notPrepared}
        </span>
      </button>
      {active && (
        <div className="scrollbar-dark ml-4 mt-1 max-h-48 overflow-auto border-l border-slate-700 pl-2">
          {navigation.frames.map((frame) => (
            <ImageListRow
              key={frame.path}
              type="button"
              selected={frame.path === selectedPath}
              title={text.frameStatus(frame.frameIndex + 1, frame.annotated, frame.keyframe)}
              data-frame-path={frame.path}
              data-annotated={frame.annotated}
              data-keyframe={frame.keyframe}
              className={`block w-full rounded px-2 py-1.5 text-left text-xs ${frame.path === selectedPath ? "bg-sky-500 text-white" : "text-slate-400 hover:bg-slate-800"}`}
              onClick={() => navigation.select(frame.index)}
            >
              <span
                aria-hidden="true"
                className={
                  frame.keyframe
                    ? "text-amber-300"
                    : frame.annotated
                      ? "text-sky-300"
                      : "text-slate-600"
                }
              >
                {frame.keyframe ? "◆" : "●"}
              </span>{" "}
              {text.frameLabel(frame.frameIndex + 1)}
              <span className="float-right tabular-nums">{text.time(frame.timestampSeconds)}</span>
            </ImageListRow>
          ))}
        </div>
      )}
    </div>
  );
}
