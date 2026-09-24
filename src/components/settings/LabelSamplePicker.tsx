import { useEffect, useMemo, useState } from "react";
import type { LabelConfig } from "../../types/annotation";
import type { LabelSamples } from "../../hooks/useLabelSamples";
import { useAnnotationStore } from "../../store/useAnnotationStore";
import { labelSampleCandidates, SAMPLE_CANDIDATES_PER_PAGE } from "../../lib/label-sample-crops";
import { LABEL_SAMPLE_ZH_CN as text } from "../../i18n/label-sample.zh-CN";
import { Overlay } from "../overlay/Overlay";

export function LabelSamplePicker({
  label,
  samples,
  onClose,
}: {
  label: LabelConfig;
  samples: LabelSamples;
  onClose: () => void;
}) {
  const images = useAnnotationStore((state) => state.images);
  const annotations = useAnnotationStore((state) => state.annotationsByImage);
  const selectedPath = useAnnotationStore((state) => state.selectedPath);
  const candidates = useMemo(
    () => labelSampleCandidates(images, annotations, label.id, selectedPath),
    [images, annotations, label.id, selectedPath],
  );
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(candidates.length / SAMPLE_CANDIDATES_PER_PAGE));
  const currentPage = Math.min(page, pages - 1);
  const visible = useMemo(
    () =>
      candidates.slice(
        currentPage * SAMPLE_CANDIDATES_PER_PAGE,
        (currentPage + 1) * SAMPLE_CANDIDATES_PER_PAGE,
      ),
    [candidates, currentPage],
  );
  const [previews, setPreviews] = useState<Record<string, { src?: string; error?: string }>>({});
  const previewCandidate = samples.previewCandidate;
  useEffect(() => {
    let cancelled = false;
    setPreviews({});
    void (async () => {
      // Decode one image at a time; large projects must not decode the entire
      // gallery (or an entire page) concurrently.
      for (const candidate of visible) {
        if (cancelled) break;
        try {
          const src = await previewCandidate(candidate);
          if (!cancelled)
            setPreviews((items) => ({ ...items, [JSON.stringify(candidate)]: { src } }));
        } catch (error) {
          if (!cancelled)
            setPreviews((items) => ({
              ...items,
              [JSON.stringify(candidate)]: { error: String(error) },
            }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, previewCandidate]);

  return (
    <Overlay
      label={text.projectTitle(label.name)}
      onClose={onClose}
      canDismiss={!samples.busy}
      size="xl"
    >
      <section className="scrollbar-dark max-h-[85vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-slate-100">
            {text.projectTitle(label.name)}
          </h2>
          <button
            type="button"
            aria-label={text.closePicker}
            disabled={samples.busy}
            onClick={onClose}
            className="rounded border border-slate-600 px-2 py-1 text-slate-300 hover:bg-slate-800"
          >
            ×
          </button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-400">{text.projectHint}</p>
        <button
          type="button"
          disabled={samples.busy}
          onClick={async () => {
            if (await samples.choose(label.id)) onClose();
          }}
          className="mt-3 rounded border border-slate-600 px-3 py-2 text-sm text-sky-300 hover:bg-slate-800 disabled:opacity-40"
        >
          {text.fromFile}
        </button>
        {samples.error && (
          <p role="alert" className="mt-3 text-xs text-red-300">
            {samples.error}
          </p>
        )}
        {samples.busy && (
          <p role="status" className="mt-3 text-xs text-sky-300">
            {text.preparing}
          </p>
        )}
        {candidates.length === 0 ? (
          <p className="my-8 text-center text-sm text-slate-400">{text.noCandidates}</p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {visible.map((candidate, index) => {
                const entry = previews[JSON.stringify(candidate)];
                const name = text.candidate(
                  candidate.imageName,
                  currentPage * SAMPLE_CANDIDATES_PER_PAGE + index + 1,
                );
                return (
                  <button
                    key={`${candidate.imagePath}:${candidate.annotationId}`}
                    type="button"
                    aria-label={name}
                    title={candidate.imagePath}
                    disabled={samples.busy || !entry?.src}
                    onClick={async () => {
                      if (await samples.chooseCrop(label.id, candidate)) onClose();
                    }}
                    className="overflow-hidden rounded-lg border border-slate-700 bg-slate-950 text-left enabled:hover:border-sky-400 enabled:focus-visible:outline-sky-400 disabled:opacity-50"
                  >
                    <div className="flex h-32 items-center justify-center p-2">
                      {entry?.src ? (
                        <img src={entry.src} alt={name} className="h-full w-full object-contain" />
                      ) : (
                        <span className="px-2 text-xs text-slate-400">
                          {entry?.error ?? text.loading}
                        </span>
                      )}
                    </div>
                    <p className="truncate border-t border-slate-800 px-3 py-2 text-xs text-slate-300">
                      {name}
                    </p>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-slate-300">
              <button
                type="button"
                disabled={currentPage === 0 || samples.busy}
                onClick={() => setPage(currentPage - 1)}
                className="rounded border border-slate-700 px-3 py-2 disabled:opacity-30"
              >
                {text.previous}
              </button>
              <span>{text.page(currentPage + 1, pages, candidates.length)}</span>
              <button
                type="button"
                disabled={currentPage + 1 === pages || samples.busy}
                onClick={() => setPage(currentPage + 1)}
                className="rounded border border-slate-700 px-3 py-2 disabled:opacity-30"
              >
                {text.next}
              </button>
            </div>
          </>
        )}
      </section>
    </Overlay>
  );
}
