import type { AnnotationShape } from "../types/annotation";
import type { ImageFile } from "./tauri-api";
import type { PrelabelImageInference } from "../types/prelabel";
import { PRELABEL_ZH_CN as text } from "../i18n/prelabel.zh-CN";

interface ExecutePrelabelBatchOptions {
  images: ImageFile[];
  chunkSize: number;
  infer: (imagePaths: string[]) => Promise<PrelabelImageInference[]>;
  toAnnotations: (result: PrelabelImageInference) => AnnotationShape[];
  commit: (entries: Array<{ imagePath: string; annotations: AnnotationShape[] }>) => void;
  shouldCommit?: (entry: { imagePath: string; annotations: AnnotationShape[] }) => boolean;
  isContextCurrent?: () => boolean;
  isCancelled: () => boolean;
  onProgress: (processed: number) => void;
}

export function selectPrelabelBatchImages(
  images: ImageFile[],
  annotationsByImage: Record<string, AnnotationShape[]>,
  forceOverwrite: boolean,
): ImageFile[] {
  return forceOverwrite
    ? images
    : images.filter((image) => (annotationsByImage[image.path] ?? []).length === 0);
}

export function chunkPrelabelImages(images: ImageFile[], chunkSize: number): ImageFile[][] {
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("批量大小必须为正整数");
  }
  const chunks: ImageFile[][] = [];
  for (let index = 0; index < images.length; index += chunkSize) {
    chunks.push(images.slice(index, index + chunkSize));
  }
  return chunks;
}

export async function executePrelabelBatch({
  images,
  chunkSize,
  infer,
  toAnnotations,
  commit,
  shouldCommit = () => true,
  isContextCurrent = () => true,
  isCancelled,
  onProgress,
}: ExecutePrelabelBatchOptions): Promise<{
  processed: number;
  annotationCount: number;
  cancelled: boolean;
  skippedConflictCount: number;
}> {
  let processed = 0;
  let annotationCount = 0;
  let skippedConflictCount = 0;
  for (const chunk of chunkPrelabelImages(images, chunkSize)) {
    const results = await infer(chunk.map((image) => image.path));
    if (!isContextCurrent()) {
      throw new Error(text.executionContextChanged);
    }
    const entries = results.map((result) => {
      const annotations = toAnnotations(result);
      return { imagePath: result.imagePath, annotations };
    });
    const committableEntries = entries.filter(shouldCommit);
    skippedConflictCount += entries.length - committableEntries.length;
    annotationCount += committableEntries.reduce(
      (total, entry) => total + entry.annotations.length,
      0,
    );
    commit(committableEntries);
    processed += chunk.length;
    onProgress(processed);
    if (isCancelled()) {
      return { processed, annotationCount, cancelled: true, skippedConflictCount };
    }
  }
  return { processed, annotationCount, cancelled: false, skippedConflictCount };
}
