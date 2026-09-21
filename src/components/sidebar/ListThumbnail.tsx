import { useEffect, useRef, useState, type RefObject } from "react";
import { generateImageThumbnail, imageFileSrc } from "../../lib/tauri-api";

// Dedupes only in-flight requests. Completed entries live in the Rust disk cache;
// keeping every visited path here would grow memory and bypass mtime validation.
const requests = new Map<string, Promise<string | null>>();

function requestThumbnail(path: string): Promise<string | null> {
  const pending = requests.get(path);
  if (pending) return pending;
  const request = generateImageThumbnail(path)
    .catch(() => null)
    .finally(() => {
      requests.delete(path);
    });
  requests.set(path, request);
  return request;
}

/**
 * Lazy thumbnail for media list rows: requests generation only while the row is
 * inside the scroll viewport (plus a small prefetch margin), and renders nothing
 * once generation failed so the row falls back to the bare file name.
 */
export function ListThumbnail({
  path,
  root,
}: {
  path: string;
  root: RefObject<HTMLElement | null>;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // 无 IntersectionObserver 的环境（如 jsdom）直接跳过请求，行保持文件名回退展示
    if (typeof IntersectionObserver === "undefined") return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        requestThumbnail(path).then((thumbnail) => {
          if (cancelled) return;
          if (thumbnail) setSrc(imageFileSrc(thumbnail));
          else setFailed(true);
        });
      },
      { root: root.current, rootMargin: "128px 0px" },
    );
    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [path, root]);
  if (failed) return null;
  return (
    <span
      ref={ref}
      className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-slate-800"
    >
      {src && <img src={src} alt="" className="h-full w-full object-cover" />}
    </span>
  );
}
