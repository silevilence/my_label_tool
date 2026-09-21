import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectMediaList } from "./ProjectMediaList";
import { generateImageThumbnail } from "../../lib/tauri-api";
import { IMAGE_ROW_HEIGHT, VIDEO_HEADER_HEIGHT } from "./ProjectMediaList";
import type { ImageFile } from "../../lib/tauri-api";
import type { LoadedProjectVideo } from "../../lib/project-media";
import type { VideoProject } from "../../types/video";

vi.mock("../../lib/tauri-api", () => ({
  generateImageThumbnail: vi.fn(),
  imageFileSrc: (path: string) => `asset:${path}`,
}));

const generateThumbnail = vi.mocked(generateImageThumbnail);

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly observed: Element[] = [];
  disconnected = false;
  constructor(
    private readonly callback: (entries: Array<{ isIntersecting: boolean }>) => void,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(node: Element) {
    this.observed.push(node);
  }
  disconnect() {
    this.disconnected = true;
  }
  unobserve() {}
  trigger(isIntersecting: boolean) {
    this.callback([{ isIntersecting }]);
  }
}

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const images: ImageFile[] = Array.from({ length: 300 }, (_, index) => ({
  path: `C:/imgs/img-${String(index).padStart(4, "0")}.png`,
  name: `img-${String(index).padStart(4, "0")}.png`,
}));

function videoFixture(frameCount: number): LoadedProjectVideo {
  const frames = Array.from({ length: frameCount }, (_, index) => ({
    name: `frame-${String(index).padStart(4, "0")}.png`,
    frameIndex: index,
    timestampSeconds: index / 5,
  }));
  const scopedVideo: VideoProject = {
    schemaVersion: 1,
    sourcePath: "C:/videos/demo.mp4",
    frameInterval: 1,
    totalFrames: frameCount,
    width: 1280,
    height: 720,
    frames,
  };
  return {
    sourcePath: "C:/videos/demo.mp4",
    folderPath: "C:/project/frames",
    video: scopedVideo,
    images: frames.map((frame) => ({
      path: `C:/project/frames/${frame.name}`,
      name: frame.name,
    })),
    scopedVideo,
  };
}

let host: HTMLDivElement;
let root: Root;

function renderList(props: {
  images?: ImageFile[];
  videos?: LoadedProjectVideo[];
  selectedPath?: string;
}) {
  act(() =>
    root.render(
      <ProjectMediaList
        folderPath="C:/project"
        images={props.images ?? []}
        videos={props.videos ?? []}
        selectedPath={props.selectedPath ?? ""}
        onSelect={vi.fn()}
        onPrepare={vi.fn()}
        onImageMenu={vi.fn()}
      />,
    ),
  );
}

function scroller() {
  return host.querySelector<HTMLDivElement>(".overflow-auto")!;
}

function content() {
  return scroller().querySelector<HTMLDivElement>("div.relative")!;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  FakeIntersectionObserver.instances = [];
  generateThumbnail.mockResolvedValue("C:/cache/thumbnails/cached.png");
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("renders a window of rows and reserves the full virtual height", () => {
  renderList({ images });
  const rows = host.querySelectorAll("button");
  expect(rows.length).toBeLessThan(20);
  expect(content().style.height).toBe(`${images.length * IMAGE_ROW_HEIGHT}px`);
  // 视口外不请求缩略图
  expect(generateThumbnail).not.toHaveBeenCalled();
});

it("keeps rendered rows bounded when a project grows to ten thousand images", () => {
  renderList({ images });
  const smallCount = host.querySelectorAll("button[title]").length;
  const largeImages = Array.from({ length: 10_000 }, (_, index) => ({
    path: `C:/large/image-${index}.png`,
    name: `image-${index}.png`,
  }));
  renderList({ images: largeImages });
  expect(host.querySelectorAll("button[title]").length).toBe(smallCount);
  Object.defineProperty(scroller(), "clientHeight", { value: 480, configurable: true });
  act(() => {
    scroller().scrollTop = 5_000 * IMAGE_ROW_HEIGHT;
    scroller().dispatchEvent(new Event("scroll"));
  });
  expect(host.querySelector('button[title="C:/large/image-5000.png"]')).not.toBeNull();
  expect(host.querySelectorAll("button[title]").length).toBeLessThan(25);
});

it("follows scrolling to render the target window", () => {
  renderList({ images });
  const target = images[200];
  act(() => {
    scroller().scrollTop = 200 * IMAGE_ROW_HEIGHT;
    scroller().dispatchEvent(new Event("scroll"));
  });
  expect(host.querySelector(`button[title="${target.path}"]`)).not.toBeNull();
  expect(host.querySelector(`button[title="${images[0].path}"]`)).toBeNull();
});

it("keeps video headers and frame sublists in the same height scheme", () => {
  const video = videoFixture(4);
  renderList({ images: images.slice(0, 1), videos: [video] });
  expect(content().style.height).toBe(`${IMAGE_ROW_HEIGHT + VIDEO_HEADER_HEIGHT}px`);
  // 选中该视频的帧：分组头保持 64，帧子列表展开占 4px 间距 + 收缩后的列表高度
  const frame = video.images[3];
  act(() =>
    root.render(
      <ProjectMediaList
        folderPath="C:/project"
        images={images.slice(0, 1)}
        videos={[video]}
        selectedPath={frame.path}
        onSelect={vi.fn()}
        onPrepare={vi.fn()}
        onImageMenu={vi.fn()}
      />,
    ),
  );
  const activeExtra = 4 + 4 * 32; // 短列表收缩，4 行全部可见
  expect(content().style.height).toBe(`${IMAGE_ROW_HEIGHT + VIDEO_HEADER_HEIGHT + activeExtra}px`);
  const nested = scroller().querySelector<HTMLDivElement>(".overflow-auto")!;
  expect(nested.querySelectorAll("[data-frame-path]").length).toBe(4);
});

it("aligns the selected row by computing scrollTop from its index", () => {
  renderList({ images, selectedPath: images[150].path });
  // 对齐一次真实视口，再改选更深的行，验证按索引换算滚动
  Object.defineProperty(scroller(), "clientHeight", { value: 480, configurable: true });
  act(() => {
    scroller().dispatchEvent(new Event("scroll"));
  });
  act(() =>
    root.render(
      <ProjectMediaList
        folderPath="C:/project"
        images={images}
        videos={[]}
        selectedPath={images[240].path}
        onSelect={vi.fn()}
        onPrepare={vi.fn()}
        onImageMenu={vi.fn()}
      />,
    ),
  );
  expect(scroller().scrollTop).toBe(240 * IMAGE_ROW_HEIGHT - 480 + IMAGE_ROW_HEIGHT);
});

it("loads thumbnails lazily on intersection and falls back to the file name on failure", async () => {
  const failing = { path: "C:/imgs/broken.png", name: "broken.png" };
  generateThumbnail.mockImplementation((path: string) =>
    path === failing.path ? Promise.reject(new Error("boom")) : Promise.resolve("C:/cache/t.png"),
  );
  renderList({ images: [images[0], failing, images[2]] });
  const row = host.querySelector<HTMLButtonElement>(`button[title="${failing.path}"]`)!;
  const okRow = host.querySelector<HTMLButtonElement>(`button[title="${images[0].path}"]`)!;
  expect(generateThumbnail).not.toHaveBeenCalled();
  act(() => {
    FakeIntersectionObserver.instances.forEach((observer) => observer.trigger(true));
  });
  await act(async () => {});
  // 成功：显示缓存缩略图（asset 协议），失败：无图标占位，仅显示文件名
  expect(generateThumbnail).toHaveBeenCalledTimes(3);
  expect(okRow.querySelector("img")?.getAttribute("src")).toBe("asset:C:/cache/t.png");
  expect(row.querySelector("img")).toBeNull();
  expect(row.textContent).toBe(failing.name);
});

it("scrolls the nested frame list by frame index when selection enters a video", () => {
  const video = videoFixture(12);
  const render = (selected: string) =>
    act(() =>
      root.render(
        <ProjectMediaList
          folderPath="C:/project"
          images={[]}
          videos={[video]}
          selectedPath={selected}
          onSelect={vi.fn()}
          onPrepare={vi.fn()}
          onImageMenu={vi.fn()}
        />,
      ),
    );
  render("");
  expect(scroller().querySelector(".overflow-auto")).toBeNull();
  render(video.images[10].path);
  const nested = scroller().querySelector<HTMLDivElement>(".overflow-auto")!;
  // 进入视频时按帧索引对齐（jsdom 视口为 0，行贴顶对齐）
  expect(nested.scrollTop).toBe(10 * 32);
  render(video.images[1].path);
  expect(nested.scrollTop).toBe(1 * 32);
  expect(
    nested.querySelector('[data-frame-path="C:/project/frames/frame-0001.png"]'),
  ).not.toBeNull();
});

it("subscribes to scrolling each time a previously collapsed video is expanded", () => {
  const video = videoFixture(1000);
  renderList({ videos: [video] });
  for (let cycle = 0; cycle < 2; cycle += 1) {
    renderList({ videos: [video], selectedPath: video.images[0].path });
    const nested = scroller().querySelector<HTMLDivElement>(".overflow-auto")!;
    Object.defineProperty(nested, "clientHeight", { value: 192, configurable: true });
    act(() => {
      nested.scrollTop = 500 * 32;
      nested.dispatchEvent(new Event("scroll"));
    });
    expect(nested.querySelector(`[data-frame-path="${video.images[500].path}"]`)).not.toBeNull();
    expect(nested.querySelector(`[data-frame-path="${video.images[0].path}"]`)).toBeNull();
    expect(nested.querySelectorAll("[data-frame-path]").length).toBeLessThan(20);
    renderList({ videos: [video] });
    expect(scroller().querySelector(".overflow-auto")).toBeNull();
  }
});

it("revalidates a thumbnail after its row leaves and reenters the virtual window", async () => {
  renderList({ images });
  act(() => FakeIntersectionObserver.instances.forEach((observer) => observer.trigger(true)));
  await act(async () => {});
  expect(generateThumbnail.mock.calls.filter(([path]) => path === images[0].path)).toHaveLength(1);
  act(() => {
    scroller().scrollTop = 200 * IMAGE_ROW_HEIGHT;
    scroller().dispatchEvent(new Event("scroll"));
  });
  FakeIntersectionObserver.instances = [];
  act(() => {
    scroller().scrollTop = 0;
    scroller().dispatchEvent(new Event("scroll"));
  });
  act(() => FakeIntersectionObserver.instances.forEach((observer) => observer.trigger(true)));
  await act(async () => {});
  expect(generateThumbnail.mock.calls.filter(([path]) => path === images[0].path)).toHaveLength(2);
});
