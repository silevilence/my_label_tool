import { useEffect, useMemo, useRef, useState } from "react";
import { Image as KonvaImage, Layer, Stage } from "react-konva";
import { imageFileSrc, type ImageFile, listImageFiles, selectImageFolder } from "./lib/tauri-api";
import "./App.css";

function App() {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const [folderPath, setFolderPath] = useState("");
  const [images, setImages] = useState<ImageFile[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [error, setError] = useState("");

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
      return;
    }

    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) {
        setLoadedImage(image);
      }
    };
    image.src = imageFileSrc(selectedImage.path);

    return () => {
      cancelled = true;
    };
  }, [selectedImage]);

  const imageLayout = useMemo(() => {
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
          {folderPath && (
            <p className="mt-3 truncate text-xs text-slate-400" title={folderPath}>
              {folderPath}
            </p>
          )}
          {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-2">
          {images.length === 0 ? (
            <p className="p-2 text-sm text-slate-400">请选择包含 jpg/png/bmp 的文件夹。</p>
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
          <Stage width={canvasSize.width} height={canvasSize.height}>
            <Layer>
              <KonvaImage image={loadedImage} {...imageLayout} />
            </Layer>
          </Stage>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            {selectedImage ? "正在加载图片..." : "选择文件夹后，在这里预览图片。"}
          </div>
        )}
      </div>
    </main>
  );
}

export default App;
