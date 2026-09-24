import { useOperations, type OperationHandle } from "../../store/useOperations";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { ProjectMediaList } from "../sidebar/ProjectMediaList";
import { VideoTimeline } from "./VideoTimeline";
import { useVideoFrameNavigation } from "../../hooks/useVideoFrameNavigation";
import { projectVideos } from "../../lib/project-media";
import { useAnnotationStore } from "../../store/useAnnotationStore";
const videos = projectVideos("p", [
  {
    sourcePath: "p/v.mp4",
    folderPath: "p/frames",
    video: {
      schemaVersion: 1,
      sourcePath: "p/v.mp4",
      width: 100,
      height: 100,
      totalFrames: 11,
      frameInterval: 5,
      frames: [0, 5, 10].map((frameIndex) => ({
        name: `${frameIndex}.png`,
        frameIndex,
        timestampSeconds: frameIndex / 30,
      })),
    },
  },
]);
it("shares sidebar/timeline distribution and navigation through the selection store", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const store = useAnnotationStore.getState();
  store.setImages(videos[0].images);
  store.select(videos[0].images[0].path);
  store.replaceAnnotations({}, []);
  let navigation!: ReturnType<typeof useVideoFrameNavigation>;
  function Harness() {
    const selectedPath = useAnnotationStore((state) => state.selectedPath);
    navigation = useVideoFrameNavigation(videos[0].scopedVideo, videos[0].images, selectedPath);
    return (
      <>
        <ProjectMediaList
          folderPath="p"
          videos={videos}
          images={videos[0].images}
          selectedPath={selectedPath}
          onSelect={store.select}
          onPrepare={() => {}}
          onImageMenu={() => {}}
        />
        <VideoTimeline
          frames={navigation.frames}
          currentIndex={navigation.currentIndex}
          totalFrames={11}
          onSelectFrame={navigation.select}
        />
      </>
    );
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(<Harness />));
  act(() =>
    store.addAnnotation(videos[0].images[1].path, {
      id: "key",
      type: "point",
      labelId: "l",
      points: [1, 2],
      attributes: { videoTrackId: "t", videoKeyframe: true },
    }),
  );
  expect(container.querySelectorAll('[data-keyframe="true"]')).toHaveLength(2);
  expect(container.querySelectorAll('[data-annotated="true"]')).toHaveLength(2);
  act(() => {
    navigation.step(1);
  });
  expect(navigation.currentIndex).toBe(1);
  expect(useAnnotationStore.getState().scopeStack[1].kind).toBe("video");
  expect(container.querySelector("input")?.getAttribute("aria-valuetext")).toBe("源帧 6 / 11");
  act(() => {
    navigation.select("missing");
  });
  expect(navigation.currentIndex).toBe(1);
  act(() => {
    navigation.select(2);
    navigation.step(1);
  });
  expect(navigation.canStep(1)).toBe(false);
  let operation!: OperationHandle;
  act(() => {
    operation = useOperations.getState().begin({ label: "save", resource: "project-annotations" });
  });
  act(() => {
    expect(navigation.select(0)).toBe(false);
  });
  expect(navigation.currentIndex).toBe(2);
  expect(navigation.canStep(-1)).toBe(false);
  act(() => operation.complete());
  act(() => root.unmount());
  container.remove();
});
