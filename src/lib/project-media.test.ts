import { expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020";
import mediaSchema from "../../docs/project-media.schema.json";
import videoSchema from "../../docs/video-annotation.schema.json";
import exporterSchema from "../../docs/plugin-exporter.schema.json";
import {
  mergeProjectImages,
  projectFrameIndices,
  projectVideos,
  videoForImage,
  withProjectMedia,
} from "./project-media";
import { matchImportedImages } from "./app-utils";
import { parseNativeJsonImport } from "./importers";
import { exportYolo } from "./exporters/yolo";
import { interpolateVideoTrack } from "./video-interpolation";
import type { ProjectVideo } from "../types/video";
import type { AnnotationShape, LabelConfig } from "../types/annotation";

export function fixtureVideo(id: string): ProjectVideo {
  return {
    sourcePath: `C:/project/${id}.mp4`,
    folderPath: `C:/project/${id}`,
    video: {
      schemaVersion: 1,
      sourcePath: `C:/project/${id}.mp4`,
      width: 64,
      height: 48,
      frameInterval: 3,
      totalFrames: 7,
      frames: [0, 3, 6].map((frameIndex, index) => ({
        name: `frame-00000${index}.png`,
        frameIndex,
        timestampSeconds: frameIndex / 10,
      })),
    },
  };
}
const labels: LabelConfig[] = [{ id: "car", name: "车", color: "#123456", shapeType: "rect" }];
const shape: AnnotationShape = {
  id: "target",
  labelId: "car",
  type: "rect",
  points: [1, 2, 3, 4],
  attributes: { videoTrackId: "same-track", videoKeyframe: true },
};

it("keeps duplicate frame names and track IDs isolated across mixed project assets", () => {
  const videos = projectVideos("C:/project", [fixtureVideo("one"), fixtureVideo("two")]);
  const photo = { path: "C:/project/photo.png", name: "photo.png" };
  const images = mergeProjectImages([photo], videos);
  expect(images).toHaveLength(7);
  expect(new Set(images.map((image) => image.name)).size).toBe(7);
  expect(projectFrameIndices(videos)[videos[1].images[2].path]).toBe(6);
  expect(videoForImage(videos, photo.path)).toBeUndefined();
  expect(videoForImage(videos, videos[1].images[0].path)?.sourcePath).toContain("two.mp4");
  const annotations = {
    [videos[0].images[0].path]: [shape],
    [videos[0].images[2].path]: [{ ...shape, points: [9, 2, 3, 4] }],
    [videos[1].images[0].path]: [shape],
  };
  const plan = interpolateVideoTrack(
    videos[0].scopedVideo!,
    videos[0].images,
    annotations,
    "same-track",
  );
  expect(plan.entries.map((entry) => entry.imagePath)).toEqual([videos[0].images[1].path]);
  const data = {
    labels,
    images: images.map((image) => ({
      ...image,
      width: 64,
      height: 48,
      annotations: annotations[image.path] ?? [],
    })),
  };
  const saved = withProjectMedia(data, videos);
  const validate = new Ajv2020({ strict: true })
    .addSchema(exporterSchema)
    .addSchema(videoSchema)
    .compile(mediaSchema);
  expect(
    "projectMedia" in saved && validate(saved.projectMedia),
    JSON.stringify(validate.errors),
  ).toBe(true);
  const restored = matchImportedImages(parseNativeJsonImport(JSON.stringify(saved)), images);
  expect(restored.missingCount).toBe(0);
  expect(restored.annotationsByImage[videos[1].images[0].path]).toEqual([
    { ...shape, frameIndex: 0 },
  ]);
  expect(new Set(exportYolo(data).map((file) => file.path)).size).toBe(8);
  expect(saved).toMatchObject({
    projectMedia: { schemaVersion: 1, videos: [{ frameFolder: "one" }, { frameFolder: "two" }] },
  });
});

it("retains legacy single-video directories and pending raw videos", () => {
  const legacy = fixtureVideo("one");
  const videos = projectVideos("C:/project/one", [
    legacy,
    { sourcePath: "C:/new.mp4", folderPath: null, video: null },
  ]);
  expect(videos[0].images[0].name).toBe("frame-000000.png");
  expect(videos[1].scopedVideo).toBeNull();
  expect(mergeProjectImages(videos[0].images, videos)).toHaveLength(3);
  expect(withProjectMedia({ labels, images: [] }, videos)).toMatchObject({
    projectMedia: { videos: [{ frameFolder: "." }, { frameFolder: null }] },
  });
  const data = { labels, images: [] };
  expect(withProjectMedia(data, [])).toBe(data);
});
