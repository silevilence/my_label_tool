import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { AnnotationShape, LabelConfig } from "../../types/annotation";
import {
  getSearchCompletions,
  getSearchHighlights,
  searchImages,
  type CompletionSuggestion,
  type HighlightToken,
} from "../../lib/image-search";
import { imageFileSrc, type ImageFile } from "../../lib/tauri-api";

interface ImageSearchDialogProps {
  annotationsByImage: Record<string, AnnotationShape[]>;
  images: ImageFile[];
  labels: LabelConfig[];
  selectedPath: string;
  onClose: () => void;
  onSelectImage: (path: string) => void;
}

export function ImageSearchDialog({
  annotationsByImage,
  images,
  labels,
  selectedPath,
  onClose,
  onSelectImage,
}: ImageSearchDialogProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isRegexSearch, setIsRegexSearch] = useState(false);
  const [searchText, setSearchText] = useState("");
  const deferredSearchText = useDeferredValue(searchText);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [searchResults, setSearchResults] = useState(images);
  const [searchError, setSearchError] = useState("");
  const [candidatePath, setCandidatePath] = useState("");
  const [isPreviewError, setIsPreviewError] = useState(false);
  const labelById = useMemo(() => new Map(labels.map((label) => [label.id, label])), [labels]);
  const classIndexByLabelId = useMemo(
    () => new Map(labels.map((label, index) => [label.id, index])),
    [labels],
  );
  const searchIndex = useMemo(
    () => ({ annotationsByImage, classIndexByLabelId, labelById }),
    [annotationsByImage, classIndexByLabelId, labelById],
  );
  const suggestions = useMemo(
    () => (isRegexSearch ? [] : getSearchCompletions(searchText, cursorIndex, labels)),
    [cursorIndex, isRegexSearch, labels, searchText],
  );
  const highlights = useMemo(
    () => (isRegexSearch ? [] : getSearchHighlights(searchText)),
    [isRegexSearch, searchText],
  );
  const candidate =
    searchResults.find((image) => image.path === candidatePath) ??
    searchResults.find((image) => image.path === selectedPath) ??
    searchResults[0] ??
    null;
  const searchPlaceholder = isRegexSearch
    ? "按文件名正则搜索，例如：WIN_.*Pro\\.jpg"
    : "搜索图片：@tag(person) -bad @size(>1MB)";

  useEffect(() => {
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    setIsPreviewError(false);
  }, [candidate?.path]);

  useEffect(() => {
    setActiveSuggestionIndex(0);
  }, [suggestions]);

  useEffect(() => {
    if (!deferredSearchText.trim()) {
      setSearchResults(images);
      setSearchError("");
      return;
    }

    try {
      if (isRegexSearch) {
        const pattern = new RegExp(deferredSearchText, "i");
        setSearchResults(images.filter((image) => pattern.test(image.name)));
      } else {
        setSearchResults(searchImages(images, deferredSearchText, searchIndex));
      }
      setSearchError("");
    } catch (caughtError: unknown) {
      const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
      setSearchError(`${isRegexSearch ? "正则表达式" : "搜索表达式"}无效：${message}`);
    }
  }, [deferredSearchText, images, isRegexSearch, searchIndex]);

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

  function updateCursor(input: HTMLInputElement) {
    setCursorIndex(input.selectionStart ?? input.value.length);
  }

  function applySuggestion(suggestion: CompletionSuggestion) {
    const nextSearchText =
      searchText.slice(0, suggestion.replacementStart) +
      suggestion.value +
      searchText.slice(suggestion.replacementEnd);
    const nextCursorIndex = suggestion.replacementStart + suggestion.value.length;
    setSearchText(nextSearchText);
    setCursorIndex(nextCursorIndex);
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursorIndex, nextCursorIndex);
    }, 0);
  }

  function moveCandidate(delta: 1 | -1) {
    if (searchResults.length === 0) {
      return;
    }
    const currentIndex = Math.max(
      0,
      searchResults.findIndex((image) => image.path === candidate?.path),
    );
    const nextIndex = (currentIndex + delta + searchResults.length) % searchResults.length;
    setCandidatePath(searchResults[nextIndex].path);
  }

  return (
    <div className="fixed inset-0 z-[65] flex items-start justify-center bg-slate-950/60 px-4 pt-20">
      <section className="grid w-full max-w-3xl grid-cols-[1fr_220px] gap-4 rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              {!isRegexSearch && searchText && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre rounded border border-transparent px-3 py-2 font-mono text-sm"
                >
                  {highlights.map((token, index) => (
                    <span className={highlightClassName(token)} key={`${token.text}-${index}`}>
                      {token.text}
                    </span>
                  ))}
                </div>
              )}
              <input
                ref={inputRef}
                className={`w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm placeholder:text-slate-500 ${
                  !isRegexSearch && searchText
                    ? "caret-slate-100 text-transparent"
                    : "text-slate-100"
                }`}
                placeholder={searchPlaceholder}
                value={searchText}
                onChange={(event) => {
                  setSearchText(event.target.value);
                  updateCursor(event.currentTarget);
                }}
                onClick={(event) => updateCursor(event.currentTarget)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    onClose();
                    return;
                  }
                  if (suggestions.length > 0 && event.key === "ArrowDown") {
                    event.preventDefault();
                    setActiveSuggestionIndex((index) => (index + 1) % suggestions.length);
                    return;
                  }
                  if (suggestions.length > 0 && event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveSuggestionIndex(
                      (index) => (index - 1 + suggestions.length) % suggestions.length,
                    );
                    return;
                  }
                  if (suggestions.length > 0 && (event.key === "Tab" || event.key === "Enter")) {
                    event.preventDefault();
                    applySuggestion(suggestions[activeSuggestionIndex] ?? suggestions[0]);
                    return;
                  }
                  if (suggestions.length === 0 && event.key === "ArrowDown") {
                    event.preventDefault();
                    moveCandidate(1);
                    return;
                  }
                  if (suggestions.length === 0 && event.key === "ArrowUp") {
                    event.preventDefault();
                    moveCandidate(-1);
                    return;
                  }
                  if (event.key === "Enter") {
                    confirmCandidate();
                  }
                }}
                onKeyUp={(event) => updateCursor(event.currentTarget)}
                onSelect={(event) => updateCursor(event.currentTarget)}
              />
              {suggestions.length > 0 && (
                <div className="absolute left-0 top-11 z-10 w-full overflow-hidden rounded border border-slate-700 bg-slate-950 shadow-xl">
                  {suggestions.map((suggestion, index) => (
                    <button
                      className={`block w-full px-3 py-2 text-left text-sm ${
                        index === activeSuggestionIndex
                          ? "bg-sky-500/20 text-white"
                          : "text-slate-200 hover:bg-slate-800"
                      }`}
                      key={`${suggestion.value}-${suggestion.label}`}
                      type="button"
                      onMouseEnter={() => setActiveSuggestionIndex(index)}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        applySuggestion(suggestion);
                      }}
                    >
                      <span className="font-mono text-sky-200">{suggestion.value}</span>
                      <span className="ml-2 text-slate-400">{suggestion.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              className={`rounded border px-3 py-2 text-sm ${
                isRegexSearch
                  ? "border-sky-400 bg-sky-500 text-white"
                  : "border-slate-700 text-slate-300 hover:bg-slate-800"
              }`}
              type="button"
              onClick={() => {
                setIsRegexSearch(!isRegexSearch);
                setSearchError("");
              }}
            >
              正则
            </button>
            <button
              className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
              type="button"
              onClick={() => {
                setSearchText("");
                setCursorIndex(0);
              }}
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
          {searchError && <p className="mt-2 text-sm text-red-300">{searchError}</p>}
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

function highlightClassName(token: HighlightToken): string {
  if (token.kind === "operator") {
    return "text-amber-300";
  }
  if (token.kind === "qualifier") {
    return "text-sky-300";
  }
  if (token.kind === "value") {
    return "text-emerald-200";
  }
  if (token.kind === "paren") {
    return "text-fuchsia-300";
  }
  return "text-slate-100";
}
