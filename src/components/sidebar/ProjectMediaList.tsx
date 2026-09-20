import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ImageListRow, ScopeBar } from "./ImageListRow";
import { ListThumbnail } from "./ListThumbnail";
import { useVideoFrameNavigation } from "../../hooks/useVideoFrameNavigation";
import { frameSummaries } from "../../lib/video-frames";
import { rowOffsets, scrollTopForIndex, visibleRows } from "../../lib/virtual-list";
import { useAnnotationStore } from "../../store/useAnnotationStore";
import type { ImageFile } from "../../lib/tauri-api";
import type { LoadedProjectVideo } from "../../lib/project-media";
import { VIDEO_ZH_CN as text } from "../../i18n/video.zh-CN";

// 窗口化渲染的固定行高方案：图片行 / 视频分组头 / 帧子列表行高度异构，
// 全部纳入同一前缀和换算，选中定位才能按索引精确计算 scrollTop。
export const IMAGE_ROW_HEIGHT = 48;
export const VIDEO_HEADER_HEIGHT = 64;
export const FRAME_ROW_HEIGHT = 32;
export const FRAME_LIST_MAX_HEIGHT = 192;
const FRAME_LIST_GAP = 4;
const OVERSCAN_ROWS = 4;

/** 帧子列表实际占位高度：短列表收缩，长列表封顶在 max-h-48。 */
function frameListHeight(frameCount: number): number {
  return Math.min(FRAME_LIST_MAX_HEIGHT, frameCount * FRAME_ROW_HEIGHT);
}

interface MediaProps {
  folderPath: string;
  onVideoMenu?: (source: string, x: number, y: number) => void;
  images: ImageFile[];
  videos: LoadedProjectVideo[];
  selectedPath: string;
  onSelect: (path: string) => void;
  onPrepare: (source: string) => void;
  onImageMenu: (image: ImageFile, x: number, y: number) => void;
}

type MediaRow =
  | { kind: "image"; image: ImageFile }
  | {
      kind: "video";
      video: LoadedProjectVideo;
      /** 当前选中帧属于该视频；同时决定分组头高亮与帧子列表展开。 */
      active: boolean;
      frameCount: number;
    };

export function ProjectMediaList({
  folderPath,
  images,
  videos,
  selectedPath,
  onSelect,
  onPrepare,
  onImageMenu,
  onVideoMenu,
}: MediaProps) {
  const annotationsByImage = useAnnotationStore((state) => state.annotationsByImage);
  const framePaths = useMemo(
    () => new Set(videos.flatMap((video) => video.images.map((image) => image.path))),
    [videos],
  );
  const rows = useMemo<MediaRow[]>(() => {
    const imageRows = images
      .filter((image) => !framePaths.has(image.path))
      .map((image) => ({ kind: "image" as const, image }));
    const videoRows = videos.map((video) => {
      const frames = frameSummaries(video.scopedVideo, annotationsByImage, video.images);
      return {
        kind: "video" as const,
        video,
        active: frames.some((frame) => frame.path === selectedPath),
        frameCount: frames.length,
      };
    });
    return [...imageRows, ...videoRows];
  }, [images, videos, framePaths, annotationsByImage, selectedPath]);
  const heights = useMemo(
    () =>
      rows.map((row) =>
        row.kind === "image"
          ? IMAGE_ROW_HEIGHT
          : VIDEO_HEADER_HEIGHT +
            (row.active ? FRAME_LIST_GAP + frameListHeight(row.frameCount) : 0),
      ),
    [rows],
  );
  const offsets = useMemo(() => rowOffsets(heights), [heights]);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const { scrollTop, viewportHeight } = useScroller(scrollerRef);
  const range = visibleRows(offsets, scrollTop, viewportHeight, OVERSCAN_ROWS);

  // 选中定位：按索引计算 scrollTop（替代原行内 scrollIntoView）；
  // 只在选中路径变化时对齐，标注编辑不回拉滚动位置。键盘导航与右键菜单行为不变。
  useEffect(() => {
    if (!selectedPath) return;
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const index = rows.findIndex((row) =>
      row.kind === "image" ? row.image.path === selectedPath : row.active,
    );
    if (index < 0) return;
    // 内容区在滚动容器内的偏移（ScopeBar 之后）；容器带 relative 使 offsetTop 恰为该偏移
    const contentTop = content.offsetTop;
    scroller.scrollTop = scrollTopForIndex(
      offsets,
      index,
      scroller.scrollTop,
      scroller.clientHeight,
      contentTop,
    );
    // 仅随选中变化对齐：rows/offsets 取当次渲染值，故意不进依赖数组。
  }, [selectedPath]);

  return (
    <div ref={scrollerRef} className="scrollbar-dark relative min-h-0 flex-1 overflow-auto p-2">
      <ScopeBar />
      {rows.length === 0 ? (
        <p className="p-2 text-sm text-slate-400">
          {folderPath
            ? "没有找到可加载的 jpg/png/bmp 图片；空文件或损坏图片会被跳过。"
            : "请选择包含 jpg/png/bmp 的文件夹。"}
        </p>
      ) : (
        <div ref={contentRef} className="relative" style={{ height: offsets[offsets.length - 1] }}>
          {rows.slice(range.start, range.end + 1).map((row, position) => {
            const index = range.start + position;
            return (
              <div
                key={row.kind === "image" ? row.image.path : row.video.sourcePath}
                className="absolute left-0 w-full"
                style={{ top: offsets[index], height: heights[index] }}
              >
                {row.kind === "image" ? (
                  <ImageListRow
                    type="button"
                    title={row.image.path}
                    selected={row.image.path === selectedPath}
                    className={`flex h-full w-full items-center gap-2 truncate rounded px-3 text-left text-sm ${
                      row.image.path === selectedPath
                        ? "bg-sky-500 text-white"
                        : "text-slate-300 hover:bg-slate-800"
                    }`}
                    leading={<ListThumbnail path={row.image.path} root={scrollerRef} />}
                    onClick={() => onSelect(row.image.path)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      onImageMenu(row.image, event.clientX, event.clientY);
                    }}
                  >
                    <span className="min-w-0 truncate">{row.image.name}</span>
                  </ImageListRow>
                ) : (
                  <VideoItem
                    video={row.video}
                    selectedPath={selectedPath}
                    onPrepare={onPrepare}
                    onVideoMenu={onVideoMenu}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 测量滚动容器的视口与滚动位置，驱动窗口化渲染。 */
function useScroller(ref: RefObject<HTMLElement | null>) {
  const [state, setState] = useState({ scrollTop: 0, viewportHeight: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () =>
      setState({ scrollTop: element.scrollTop, viewportHeight: element.clientHeight });
    measure();
    element.addEventListener("scroll", measure, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      element.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [ref]);
  return state;
}

function VideoItem({
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
  const done = useMemo(
    () => navigation.frames.filter((frame) => frame.annotated).length,
    [navigation.frames],
  );
  const frameOffsets = useMemo(
    () => rowOffsets(navigation.frames.map(() => FRAME_ROW_HEIGHT)),
    [navigation.frames],
  );
  const frameScrollerRef = useRef<HTMLDivElement>(null);
  const { scrollTop, viewportHeight } = useScroller(frameScrollerRef);
  const range = visibleRows(frameOffsets, scrollTop, viewportHeight, OVERSCAN_ROWS);

  // 帧子列表是独立嵌套滚动容器，同样窗口化；选中帧按索引对齐到嵌套视口。
  useEffect(() => {
    if (navigation.currentIndex < 0) return;
    const scroller = frameScrollerRef.current;
    if (!scroller) return;
    scroller.scrollTop = scrollTopForIndex(
      frameOffsets,
      navigation.currentIndex,
      scroller.scrollTop,
      scroller.clientHeight,
    );
    // 仅随选中帧变化对齐：frames/offsets 取当次渲染值，故意不进依赖数组。
  }, [navigation.currentIndex]);

  return (
    <div className="flex h-full flex-col">
      <button
        type="button"
        title={video.sourcePath}
        onContextMenu={(event) => {
          event.preventDefault();
          onVideoMenu?.(video.sourcePath, event.clientX, event.clientY);
        }}
        aria-current={active ? "true" : undefined}
        className={`shrink-0 rounded px-3 py-2 text-left text-sm ${
          active
            ? "bg-sky-500/15 text-sky-200 ring-1 ring-inset ring-sky-500/40"
            : "text-slate-300 hover:bg-slate-800"
        }`}
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
        <div
          ref={frameScrollerRef}
          className="scrollbar-dark ml-4 mt-1 shrink-0 overflow-auto border-l border-slate-700 pl-2"
          style={{ height: frameListHeight(navigation.frames.length) }}
        >
          <div
            className="relative"
            style={{ height: frameOffsets[frameOffsets.length - 1] ?? 0 }}
          >
            {navigation.frames.slice(range.start, range.end + 1).map((frame, position) => {
              const index = range.start + position;
              return (
                <div
                  key={frame.path}
                  className="absolute left-0 w-full"
                  style={{ top: frameOffsets[index], height: FRAME_ROW_HEIGHT }}
                >
                  <ImageListRow
                    type="button"
                    selected={frame.path === selectedPath}
                    title={text.frameStatus(frame.frameIndex + 1, frame.annotated, frame.keyframe)}
                    data-frame-path={frame.path}
                    data-annotated={frame.annotated}
                    data-keyframe={frame.keyframe}
                    className={`flex h-full w-full items-center rounded px-2 text-left text-xs ${
                      frame.path === selectedPath
                        ? "bg-sky-500 text-white"
                        : "text-slate-400 hover:bg-slate-800"
                    }`}
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
                    <span className="min-w-0 truncate">{text.frameLabel(frame.frameIndex + 1)}</span>
                    <span className="ml-auto pl-2 tabular-nums">
                      {text.time(frame.timestampSeconds)}
                    </span>
                  </ImageListRow>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
