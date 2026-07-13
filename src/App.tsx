import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Image as KonvaImage, Layer, Rect, Stage, Transformer } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Rect as KonvaRect } from "konva/lib/shapes/Rect";
import type { Transformer as KonvaTransformer } from "konva/lib/shapes/Transformer";
import { DEFAULT_LABELS } from "./lib/defaults/labels";
import {
  exportAnnotationsJson,
  imageFileSrc,
  type ImageFile,
  listImageFiles,
  selectExportJsonPath,
  selectImageFolder,
} from "./lib/tauri-api";
import { useAnnotationStore } from "./store/useAnnotationStore";
import type { AnnotationShape, LabelConfig } from "./types/annotation";
import "./App.css";

interface ImageLayout {
  width: number;
  height: number;
  x: number;
  y: number;
  scale: number;
}

interface DrawingRect {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

function App() {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const selectedRectRef = useRef<KonvaRect | null>(null);
  const transformerRef = useRef<KonvaTransformer | null>(null);
  const [folderPath, setFolderPath] = useState("");
  const [images, setImages] = useState<ImageFile[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);
  const [imageLoadError, setImageLoadError] = useState("");
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [drawingRect, setDrawingRect] = useState<DrawingRect | null>(null);
  const [error, setError] = useState("");

  const annotationsByImage = useAnnotationStore((state) => state.annotationsByImage);
  const selectedShapeId = useAnnotationStore((state) => state.selectedShapeId);
  const addAnnotation = useAnnotationStore((state) => state.addAnnotation);
  const updateAnnotation = useAnnotationStore((state) => state.updateAnnotation);
  const selectShape = useAnnotationStore((state) => state.selectShape);
  const annotations = annotationsByImage[selectedPath] ?? [];
  const selectedShape = annotations.find((annotation) => annotation.id === selectedShapeId) ?? null;

  const labelById = useMemo(() => new Map(DEFAULT_LABELS.map((label) => [label.id, label])), []);

  const selectedImage = useMemo(
    () => images.find((image) => image.path === selectedPath) ?? null,
    [images, selectedPath],
  );

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) {
      return;
    }

    const updateSize = () => {
      setCanvasSize({
        width: host.clientWidth,
        height: host.clientHeight,
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!selectedImage) {
      setLoadedImage(null);
      setImageLoadError("");
      return;
    }

    let cancelled = false;
    const image = new Image();
    setLoadedImage(null);
    setImageLoadError("");

    image.onload = () => {
      if (!cancelled) {
        setLoadedImage(image);
      }
    };
    image.onerror = () => {
      if (!cancelled) {
        setImageLoadError(`图片加载失败：${selectedImage.name}`);
      }
    };
    image.src = imageFileSrc(selectedImage.path);

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [selectedImage]);

  useEffect(() => {
    selectShape(null);
    setDrawingRect(null);
  }, [selectShape, selectedPath]);

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) {
      return;
    }

    transformer.nodes(selectedShape && selectedRectRef.current ? [selectedRectRef.current] : []);
    transformer.getLayer()?.batchDraw();
  }, [selectedShape]);

  const imageLayout = useMemo<ImageLayout | null>(() => {
    if (!loadedImage || canvasSize.width === 0 || canvasSize.height === 0) {
      return null;
    }

    const scale = Math.min(
      canvasSize.width / loadedImage.naturalWidth,
      canvasSize.height / loadedImage.naturalHeight,
    );
    const width = loadedImage.naturalWidth * scale;
    const height = loadedImage.naturalHeight * scale;

    return {
      width,
      height,
      scale,
      x: (canvasSize.width - width) / 2,
      y: (canvasSize.height - height) / 2,
    };
  }, [canvasSize, loadedImage]);

  async function openFolder() {
    setError("");

    try {
      const path = await selectImageFolder();
      if (!path) {
        return;
      }

      const nextImages = await listImageFiles(path);
      setFolderPath(path);
      setImages(nextImages);
      setSelectedPath(nextImages[0]?.path ?? "");
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    }
  }

  async function exportJson() {
    setError("");

    try {
      const outputPath = await selectExportJsonPath();
      if (!outputPath) {
        return;
      }

      await exportAnnotationsJson(outputPath, {
        labels: DEFAULT_LABELS,
        images: images.map((image) => ({
          ...image,
          annotations: annotationsByImage[image.path] ?? [],
        })),
      });
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    }
  }

  function handleStageMouseDown(event: KonvaEventObject<MouseEvent>) {
    if (!imageLayout || !loadedImage || !selectedPath) {
      return;
    }

    const isBackground =
      event.target === event.target.getStage() || event.target.name() === "image";
    if (!isBackground) {
      return;
    }

    const point = getImagePoint(event, imageLayout, loadedImage);
    if (!point) {
      selectShape(null);
      return;
    }

    selectShape(null);
    setDrawingRect({ startX: point.x, startY: point.y, currentX: point.x, currentY: point.y });
  }

  function handleStageMouseMove(event: KonvaEventObject<MouseEvent>) {
    if (!drawingRect || !imageLayout || !loadedImage) {
      return;
    }

    const point = getImagePoint(event, imageLayout, loadedImage);
    if (!point) {
      return;
    }

    setDrawingRect({ ...drawingRect, currentX: point.x, currentY: point.y });
  }

  function handleStageMouseUp() {
    if (!drawingRect || !selectedPath) {
      return;
    }

    const points = normalizeRectPoints(drawingRect);
    setDrawingRect(null);

    if (points[2] < 3 || points[3] < 3) {
      return;
    }

    addAnnotation(selectedPath, {
      id: newAnnotationId(),
      type: "rect",
      labelId: DEFAULT_LABELS[0].id,
      points,
      frameIndex: 0,
    });
  }

  function updateSelectedLabel(labelId: string) {
    if (selectedShape) {
      updateAnnotation(selectedPath, selectedShape.id, { labelId });
    }
  }

  function handleDragEnd(annotation: AnnotationShape, event: KonvaEventObject<DragEvent>) {
    if (!imageLayout || !loadedImage) {
      return;
    }

    const node = event.target;
    const [, , width, height] = annotation.points;
    const nextRect = clampRect(
      {
        x: (node.x() - imageLayout.x) / imageLayout.scale,
        y: (node.y() - imageLayout.y) / imageLayout.scale,
        width,
        height,
      },
      loadedImage,
    );

    updateAnnotation(selectedPath, annotation.id, {
      points: [nextRect.x, nextRect.y, nextRect.width, nextRect.height],
    });
  }

  function handleTransformEnd(annotation: AnnotationShape) {
    const node = selectedRectRef.current;
    if (!node || !imageLayout || !loadedImage) {
      return;
    }

    const nextRect = clampRect(
      {
        x: (node.x() - imageLayout.x) / imageLayout.scale,
        y: (node.y() - imageLayout.y) / imageLayout.scale,
        width: (node.width() * node.scaleX()) / imageLayout.scale,
        height: (node.height() * node.scaleY()) / imageLayout.scale,
      },
      loadedImage,
    );

    node.scaleX(1);
    node.scaleY(1);
    updateAnnotation(selectedPath, annotation.id, {
      points: [nextRect.x, nextRect.y, nextRect.width, nextRect.height],
    });
  }

  const draftRect =
    drawingRect && imageLayout ? toCanvasRect(normalizeRectPoints(drawingRect), imageLayout) : null;

  return (
    <main className="flex h-screen bg-slate-950 text-slate-100">
      <aside className="flex w-72 shrink-0 flex-col border-r border-slate-800 bg-slate-900">
        <div className="border-b border-slate-800 p-4">
          <h1 className="text-lg font-semibold">my_label_tool</h1>
          <button
            className="mt-4 w-full rounded bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400"
            type="button"
            onClick={openFolder}
          >
            打开图片文件夹
          </button>
          <button
            className="mt-2 w-full rounded bg-emerald-500 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700"
            type="button"
            disabled={images.length === 0}
            onClick={exportJson}
          >
            导出 JSON
          </button>
          {folderPath && (
            <p className="mt-3 truncate text-xs text-slate-400" title={folderPath}>
              {folderPath}
            </p>
          )}
          {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        </div>

        <section className="border-b border-slate-800 p-4">
          <h2 className="text-sm font-medium text-slate-200">标签</h2>
          <div className="mt-3 space-y-2">
            {DEFAULT_LABELS.map((label) => (
              <div className="flex items-center gap-2 text-sm text-slate-300" key={label.id}>
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: label.color }} />
                <span>{label.name}</span>
                <span className="text-xs text-slate-500">{label.shortcut}</span>
              </div>
            ))}
          </div>
          {selectedShape && (
            <label className="mt-4 block text-sm text-slate-300">
              选中矩形标签
              <select
                className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                value={selectedShape.labelId}
                onChange={(event) => updateSelectedLabel(event.target.value)}
              >
                {DEFAULT_LABELS.map((label) => (
                  <option key={label.id} value={label.id}>
                    {label.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>

        <div className="min-h-0 flex-1 overflow-auto p-2">
          {images.length === 0 ? (
            <p className="p-2 text-sm text-slate-400">
              {folderPath
                ? "没有找到可加载的 jpg/png/bmp 图片；空文件或损坏图片会被跳过。"
                : "请选择包含 jpg/png/bmp 的文件夹。"}
            </p>
          ) : (
            images.map((image) => (
              <button
                className={`block w-full truncate rounded px-3 py-2 text-left text-sm ${
                  image.path === selectedPath
                    ? "bg-sky-500 text-white"
                    : "text-slate-300 hover:bg-slate-800"
                }`}
                key={image.path}
                title={image.path}
                type="button"
                onClick={() => setSelectedPath(image.path)}
              >
                {image.name}
              </button>
            ))
          )}
        </div>
      </aside>

      <div ref={canvasHostRef} className="min-w-0 flex-1 bg-slate-950">
        {selectedImage && loadedImage && imageLayout ? (
          <Stage
            width={canvasSize.width}
            height={canvasSize.height}
            onMouseDown={handleStageMouseDown}
            onMouseMove={handleStageMouseMove}
            onMouseUp={handleStageMouseUp}
          >
            <Layer>
              <KonvaImage
                height={imageLayout.height}
                image={loadedImage}
                name="image"
                width={imageLayout.width}
                x={imageLayout.x}
                y={imageLayout.y}
              />
              {annotations.map((annotation) => (
                <AnnotationRect
                  annotation={annotation}
                  imageLayout={imageLayout}
                  isSelected={annotation.id === selectedShapeId}
                  key={annotation.id}
                  label={labelById.get(annotation.labelId) ?? DEFAULT_LABELS[0]}
                  rectRef={selectedRectRef}
                  onDragEnd={handleDragEnd}
                  onSelect={selectShape}
                  onTransformEnd={handleTransformEnd}
                />
              ))}
              {draftRect && (
                <Rect
                  {...draftRect}
                  dash={[6, 4]}
                  stroke={DEFAULT_LABELS[0].color}
                  strokeWidth={2}
                />
              )}
              <Transformer ref={transformerRef} rotateEnabled={false} />
            </Layer>
          </Stage>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            {selectedImage
              ? imageLoadError ||
                (loadedImage ? "画布区域尺寸异常，无法显示图片。" : "正在加载图片...")
              : "选择文件夹后，在这里预览图片。"}
          </div>
        )}
      </div>
    </main>
  );
}

interface AnnotationRectProps {
  annotation: AnnotationShape;
  imageLayout: ImageLayout;
  isSelected: boolean;
  label: LabelConfig;
  rectRef: MutableRefObject<KonvaRect | null>;
  onDragEnd: (annotation: AnnotationShape, event: KonvaEventObject<DragEvent>) => void;
  onSelect: (annotationId: string) => void;
  onTransformEnd: (annotation: AnnotationShape) => void;
}

function AnnotationRect({
  annotation,
  imageLayout,
  isSelected,
  label,
  rectRef,
  onDragEnd,
  onSelect,
  onTransformEnd,
}: AnnotationRectProps) {
  const rect = toCanvasRect(annotation.points, imageLayout);

  return (
    <Rect
      {...rect}
      ref={(node) => {
        if (isSelected) {
          rectRef.current = node;
        }
      }}
      draggable
      fill={`${label.color}22`}
      stroke={label.color}
      strokeWidth={isSelected ? 3 : 2}
      onClick={() => onSelect(annotation.id)}
      onDragEnd={(event) => onDragEnd(annotation, event)}
      onMouseDown={(event) => {
        event.cancelBubble = true;
        onSelect(annotation.id);
      }}
      onTransformEnd={() => onTransformEnd(annotation)}
    />
  );
}

function getImagePoint(
  event: KonvaEventObject<MouseEvent>,
  layout: ImageLayout,
  image: HTMLImageElement,
): { x: number; y: number } | null {
  const pointer = event.target.getStage()?.getPointerPosition();
  if (!pointer) {
    return null;
  }

  const x = (pointer.x - layout.x) / layout.scale;
  const y = (pointer.y - layout.y) / layout.scale;
  if (x < 0 || y < 0 || x > image.naturalWidth || y > image.naturalHeight) {
    return null;
  }

  return { x, y };
}

function normalizeRectPoints(rect: DrawingRect): number[] {
  const x = Math.min(rect.startX, rect.currentX);
  const y = Math.min(rect.startY, rect.currentY);
  return [x, y, Math.abs(rect.currentX - rect.startX), Math.abs(rect.currentY - rect.startY)];
}

function toCanvasRect(points: number[], layout: ImageLayout) {
  const [x, y, width, height] = points;
  return {
    x: layout.x + x * layout.scale,
    y: layout.y + y * layout.scale,
    width: width * layout.scale,
    height: height * layout.scale,
  };
}

function clampRect(
  rect: { x: number; y: number; width: number; height: number },
  image: HTMLImageElement,
) {
  const width = Math.max(1, Math.min(rect.width, image.naturalWidth));
  const height = Math.max(1, Math.min(rect.height, image.naturalHeight));
  return {
    x: Math.min(Math.max(0, rect.x), image.naturalWidth - width),
    y: Math.min(Math.max(0, rect.y), image.naturalHeight - height),
    width,
    height,
  };
}

function newAnnotationId(): string {
  return crypto.randomUUID();
}

export default App;
