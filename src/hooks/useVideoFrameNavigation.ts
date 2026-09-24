import type { VideoProject } from "../types/video";
import type { ImageFile } from "../lib/tauri-api";
import { frameNavigation, frameSummaries } from "../lib/video-frames";
import { useAnnotationStore } from "../store/useAnnotationStore";
import { useOperations } from "../store/useOperations";
export function useVideoFrameNavigation(
  video: VideoProject | null,
  images: ImageFile[],
  selectedPath: string,
) {
  const busy = useOperations((state) => !state.canEditAnnotations());
  const annotations = useAnnotationStore((state) => state.annotationsByImage);
  const frames = frameSummaries(video, annotations, images);
  const navigation = frameNavigation(frames, selectedPath, (path) => {
    if (!video || !useOperations.getState().canEditAnnotations()) return false;
    const store = useAnnotationStore.getState();
    store.pushScope({
      kind: "video",
      ids: frames.map((frame) => frame.path),
      label: video.sourcePath.split(/[\\/]/).pop() ?? video.sourcePath,
    });
    store.select(path);
  });
  return { ...navigation, frames, canStep: (delta: number) => !busy && navigation.canStep(delta) };
}
