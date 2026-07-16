import { useEffect, useMemo, useRef, useState } from "react";
import { imageFileSrc, type ImageFile } from "../../lib/tauri-api";

interface ImageSearchDialogProps {
  images: ImageFile[];
  selectedPath: string;
  onClose: () => void;
  onSelectImage: (path: string) => void;
}

export function ImageSearchDialog({
  images,
  selectedPath,
  onClose,
  onSelectImage,
}: ImageSearchDialogProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isRegexSearch, setIsRegexSearch] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [candidatePath, setCandidatePath] = useState("");
  const [isPreviewError, setIsPreviewError] = useState(false);
  const searchPattern = useMemo(() => {
    if (!isRegexSearch || !searchText) {
      return null;
    }
    try {
      return new RegExp(searchText, "i");
    } catch (caughtError: unknown) {
      return caughtError instanceof Error ? caughtError.message : String(caughtError);
    }
  }, [isRegexSearch, searchText]);
  const searchResults = useMemo(() => {
    if (typeof searchPattern === "string") {
      return [];
    }
    const query = searchText.trim().toLowerCase();
    return images.filter((image) =>
      searchPattern ? searchPattern.test(image.name) : image.name.toLowerCase().includes(query),
    );
  }, [images, searchPattern, searchText]);
  const candidate =
    searchResults.find((image) => image.path === candidatePath) ??
    searchResults.find((image) => image.path === selectedPath) ??
    searchResults[0] ??
    null;

  useEffect(() => {
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    setIsPreviewError(false);
  }, [candidate?.path]);

  useEffect(() => {
    if (candidate) {
      setCandidatePath(candidate.path);
    }
  }, [candidate]);

  function confirmCandidate() {
    if (!candidate) {
      return;
    }
    onSelectImage(candidate.path);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[65] flex items-start justify-center bg-slate-950/60 px-4 pt-20">
      <section className="grid w-full max-w-3xl grid-cols-[1fr_220px] gap-4 rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              placeholder="按文件名搜索图片"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  onClose();
                }
                if (event.key === "Enter") {
                  confirmCandidate();
                }
              }}
            />
            <button
              className={`rounded border px-3 py-2 text-sm ${
                isRegexSearch
                  ? "border-sky-400 bg-sky-500 text-white"
                  : "border-slate-700 text-slate-300 hover:bg-slate-800"
              }`}
              type="button"
              onClick={() => setIsRegexSearch(!isRegexSearch)}
            >
              正则
            </button>
            <button
              className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
              type="button"
              onClick={() => setSearchText("")}
            >
              清空
            </button>
            <button
              aria-label="关闭搜索"
              className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
              type="button"
              onClick={onClose}
            >
              ×
            </button>
          </div>
          {typeof searchPattern === "string" && (
            <p className="mt-2 text-sm text-red-300">正则表达式无效：{searchPattern}</p>
          )}
          <div className="scrollbar-dark mt-3 max-h-96 overflow-y-auto rounded border border-slate-800">
            {searchResults.length === 0 ? (
              <p className="p-3 text-sm text-slate-400">没有匹配的图片。</p>
            ) : (
              searchResults.map((image) => (
                <button
                  className={`block w-full truncate px-3 py-2 text-left text-sm ${
                    image.path === candidate?.path
                      ? "bg-slate-700 text-white"
                      : image.path === selectedPath
                        ? "bg-sky-500/30 text-sky-100"
                        : "text-slate-300 hover:bg-slate-800"
                  }`}
                  key={image.path}
                  title={image.path}
                  type="button"
                  onClick={() => {
                    if (image.path === candidate?.path) {
                      onSelectImage(image.path);
                      onClose();
                      return;
                    }
                    setCandidatePath(image.path);
                  }}
                >
                  {image.name}
                </button>
              ))
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            单击结果预览，再次点击或按 Enter 跳转；Esc 关闭。
          </p>
        </div>

        <aside className="min-w-0 rounded border border-slate-800 bg-slate-950 p-3">
          <div className="mb-2 truncate text-sm font-medium text-slate-200">
            {candidate?.name ?? "无预览"}
          </div>
          {candidate && !isPreviewError ? (
            <img
              alt={candidate.name}
              className="max-h-52 w-full rounded object-contain"
              src={imageFileSrc(candidate.path)}
              onError={() => setIsPreviewError(true)}
            />
          ) : (
            <div className="flex h-52 items-center justify-center rounded bg-slate-900 text-sm text-slate-500">
              {candidate ? "预览加载失败" : "请选择图片"}
            </div>
          )}
          {candidate && (
            <button
              className="mt-3 w-full rounded bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400"
              type="button"
              onClick={confirmCandidate}
            >
              跳转到此图片
            </button>
          )}
        </aside>
      </section>
    </div>
  );
}
