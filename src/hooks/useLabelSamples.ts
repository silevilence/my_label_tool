import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LabelConfig } from "../types/annotation";
import type { LabelSample, LabelSampleCandidate } from "../types/label-sample";
import {
  finishLabelSamples,
  listLabelSamples,
  openLabelSampleDirectory,
  prepareLabelSamples,
  previewLabelSample,
  selectLabelSample,
  createLabelSampleCrop,
  discardLabelSampleCrop,
  previewProjectLabelSample,
} from "../lib/tauri-api";
import { sampleFileStem, sampleNameError } from "../lib/label-samples";
import { LABEL_SAMPLE_ZH_CN as text } from "../i18n/label-sample.zh-CN";

type Draft = { path: string; preview: string } | null;
export type LabelSamples = ReturnType<typeof useLabelSamples>;

export function useLabelSamples(folder: string, savedLabels: LabelConfig[], templateId: string) {
  const [entries, setEntries] = useState<LabelSample[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const lock = useRef(false);
  const ownedCrops = useRef(new Map<string, string>());
  const report = useCallback(
    (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
    [],
  );
  const reset = useCallback(() => {
    generation.current++;
    setDrafts({});
    setError("");
    setLoading(false);
    for (const path of ownedCrops.current.values()) void discardLabelSampleCrop(path).catch(report);
    ownedCrops.current.clear();
  }, [report]);
  useLayoutEffect(() => {
    reset();
    setEntries([]);
  }, [folder, savedLabels, templateId, reset]);
  useEffect(() => {
    const owned = ownedCrops.current;
    return () => {
      generation.current++;
      for (const path of owned.values()) void discardLabelSampleCrop(path).catch(() => {});
      owned.clear();
    };
  }, []);

  function releaseOwned(id: string) {
    const path = ownedCrops.current.get(id);
    if (path) {
      ownedCrops.current.delete(id);
      void discardLabelSampleCrop(path).catch(report);
    }
  }

  const previewCandidate = useCallback(
    (candidate: LabelSampleCandidate) =>
      previewProjectLabelSample(folder, candidate.imagePath, candidate.bounds),
    [folder],
  );

  async function chooseCrop(id: string, candidate: LabelSampleCandidate): Promise<boolean> {
    if (!folder || lock.current) return false;
    const current = generation.current;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const crop = await createLabelSampleCrop(folder, candidate.imagePath, candidate.bounds);
      if (generation.current !== current) {
        await discardLabelSampleCrop(crop.path);
        return false;
      }
      releaseOwned(id);
      ownedCrops.current.set(id, crop.path);
      setDrafts((items) => ({ ...items, [id]: crop }));
      return true;
    } catch (err) {
      if (generation.current === current) report(err);
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const refresh = useCallback(async () => {
    if (!folder) return;
    const current = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const result = await listLabelSamples(folder);
      if (generation.current === current) setEntries(result);
    } catch (err) {
      if (generation.current === current) {
        setEntries([]);
        report(err);
      }
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, [folder, report]);

  async function choose(id: string): Promise<boolean> {
    if (!folder || lock.current) return false;
    const current = generation.current;
    lock.current = true;
    setBusy(true);
    try {
      const path = await selectLabelSample();
      if (!path) return false;
      const preview = await previewLabelSample(path);
      if (generation.current === current) {
        releaseOwned(id);
        setDrafts((items) => ({ ...items, [id]: { path, preview } }));
        setError("");
        return true;
      }
    } catch (err) {
      if (generation.current === current) report(err);
    } finally {
      lock.current = false;
      setBusy(false);
    }
    return false;
  }

  function preview(label: LabelConfig) {
    if (label.id in drafts) return drafts[label.id]?.preview;
    const name = savedLabels.find((item) => item.id === label.id)?.name ?? label.name;
    return entries.find((item) => item.name === sampleFileStem(name).toLowerCase())?.preview;
  }

  async function save(labels: LabelConfig[], persist: () => Promise<void>): Promise<boolean> {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    let token: number | undefined;
    try {
      if (folder) {
        const invalid = sampleNameError(labels);
        if (invalid) throw new Error(invalid);
        token = await prepareLabelSamples(
          folder,
          labels.map((label) => ({
            name: label.name,
            originalName: savedLabels.find((item) => item.id === label.id)?.name,
            sourcePath: drafts[label.id]?.path,
            clear: drafts[label.id] === null,
          })),
        );
      }
      await persist();
      if (token !== undefined) await finishLabelSamples(token, true);
      for (const id of ownedCrops.current.keys()) releaseOwned(id);
      setDrafts({});
      return true;
    } catch (err) {
      if (token !== undefined) {
        try {
          await finishLabelSamples(token, false);
        } catch (rollback) {
          report(text.rollbackFailed(err, rollback));
          return false;
        }
      }
      report(err);
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return {
    enabled: !!folder,
    dirty: Object.keys(drafts).length > 0,
    entries,
    error,
    loading,
    busy,
    revision: savedLabels,
    reset,
    refresh,
    choose,
    chooseCrop,
    previewCandidate,
    preview,
    save,
    clear: (id: string) => {
      if (!lock.current) {
        releaseOwned(id);
        setDrafts((items) => ({ ...items, [id]: null }));
      }
    },
    openDirectory: async () => {
      try {
        await openLabelSampleDirectory(folder);
      } catch (err) {
        report(err);
      }
    },
  };
}
