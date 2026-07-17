import { listImageFiles, selectImageFolder, type ImageFile } from "../lib/tauri-api";

export function useOpenFolder({
  maybeLoadProjectConfig,
  setError,
  setFolderPath,
  setImages,
  setSelectedPath,
}: {
  maybeLoadProjectConfig: (path: string, images: ImageFile[]) => Promise<void>;
  setError: (message: string) => void;
  setFolderPath: (path: string) => void;
  setImages: (images: ImageFile[]) => void;
  setSelectedPath: (path: string) => void;
}) {
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
      await maybeLoadProjectConfig(path, nextImages);
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    }
  }

  return openFolder;
}
