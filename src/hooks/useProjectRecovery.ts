import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAnnotationStore } from "../store/useAnnotationStore";
import { useOperations } from "../store/useOperations";
import { useRecoveryStore } from "../store/useRecoveryStore";
import {
  RecoveryWriter,
  relativeImagePath,
  validateRecovery,
  type RecoveryContext,
} from "../lib/recovery";
import {
  lastRecoveryProject,
  loadRecovery,
  saveRecovery,
  forkRecovery,
  openRecoveryDirectory,
  type ImageFile,
} from "../lib/tauri-api";
import { usePromptStore } from "../lib/prompts";
import { RECOVERY_TEXT as text } from "../i18n/recovery.zh-CN";
import { isReloadShortcut } from "../lib/reload-shortcuts";
import type { RecoveryMetadata, RecoverySnapshot } from "../types/recovery";

interface Params {
  folder: string;
  metadata: Omit<RecoveryMetadata, "savedAt" | "selectedPath">;
  apply: (metadata: RecoveryMetadata) => void;
  report: (message: string) => void;
  notify: (message: string) => void;
}
interface Session {
  folder: string;
  writer: RecoveryWriter;
  metadata: Params["metadata"];
  ready: boolean;
}

export function useProjectRecovery(params: Params) {
  const current = useRef(params);
  current.current = params;
  const [, renderSession] = useState(0);
  const session = useRef<Session | null>(null);
  const loading = useRef(false);
  const closing = useRef(false);
  const reopenChecked = useRef(false);
  const reopenAccepted = useRef("");
  const wake = useRef<ReturnType<typeof setTimeout>>();
  const pendingPaths = useRef(new Set<string>());
  const pendingAll = useRef(false);
  const prepared = useRef<{
    folder: string;
    snapshot: RecoverySnapshot | null;
    restore: boolean;
    fork: boolean;
  }>();
  const manualPending = useRef(new Map<string, Promise<boolean>>());
  const manualBusy = useRecoveryStore((state) => state.manualPending > 0);
  const settings = useRecoveryStore((state) => state.settings);
  function failed(error: unknown) {
    current.current.report(`${text.saveFailed}\n${String(error)}`);
  }
  function save(paths?: readonly string[]) {
    const active = session.current;
    if (!active || !active.ready || loading.current || useOperations.getState().mcpControlled)
      return Promise.resolve();
    return active.writer.save(paths);
  }
  function schedule(paths?: readonly string[]) {
    // Render label/config changes before taking a consistent snapshot; coalesce bulk operations.
    if (paths) paths.forEach((path) => pendingPaths.current.add(path));
    else pendingAll.current = true;
    if (wake.current !== undefined) return;
    wake.current = setTimeout(() => {
      wake.current = undefined;
      const selected = pendingAll.current ? undefined : [...pendingPaths.current];
      pendingAll.current = false;
      pendingPaths.current.clear();
      if (useRecoveryStore.getState().settings.mode !== "off") void save(selected).catch(failed);
    }, 0);
  }
  useLayoutEffect(() => {
    const active = session.current;
    if (!active || loading.current || active.folder !== params.folder) return;
    if (!active.ready) {
      active.metadata = params.metadata;
      active.ready = true;
      if (settings.mode !== "off") schedule();
      return;
    }
    if (JSON.stringify(active.metadata) !== JSON.stringify(params.metadata)) {
      active.metadata = params.metadata;
      active.writer.markMetadata();
      if (settings.mode === "switch") schedule();
    }
  });
  useEffect(
    () =>
      useAnnotationStore.subscribe((next, previous) => {
        const active = session.current;
        if (!active || loading.current) return;
        if (next.annotationRevision !== previous.annotationRevision) {
          active.writer.mark(next.changedImagePaths);
          if (
            useRecoveryStore.getState().settings.mode === "switch" &&
            (next.changedImagePaths.length > 1 ||
              next.changedImagePaths.some((path) => path !== next.selectedPath))
          )
            schedule();
        }
        if (
          next.selectedPath !== previous.selectedPath &&
          previous.selectedPath &&
          useRecoveryStore.getState().settings.mode === "switch"
        )
          schedule([previous.selectedPath]);
      }),
    [],
  );
  useEffect(
    () =>
      useOperations.subscribe((next, previous) => {
        if (previous.mcpControlled && !next.mcpControlled && session.current?.writer.hasChanges)
          schedule();
      }),
    [],
  );
  useEffect(() => {
    if (settings.mode !== "off") void save().catch(failed);
    if (settings.mode !== "interval") return;
    const timer = setInterval(() => {
      void save().catch(failed);
    }, settings.intervalSeconds * 1000);
    return () => clearInterval(timer);
  }, [settings]);

  async function beforeLeave(after?: () => Promise<void>) {
    const active = session.current;
    if (
      loading.current ||
      manualPending.current.size ||
      !useOperations.getState().canStart(["project-annotations", "export-dir", "video-frames"])
    ) {
      current.current.report(text.busy);
      return false;
    }
    if (!active) {
      if (current.current.folder && useAnnotationStore.getState().images.length) {
        current.current.report(text.loadFailed);
        return false;
      }
      await after?.();
      return true;
    }
    const operation = useOperations
      .getState()
      .begin({ label: text.title, resource: "project-annotations" });
    try {
      await active.writer.settle();
      let allowed = true;
      if (useRecoveryStore.getState().settings.mode !== "off") {
        try {
          await save();
          allowed = !active.writer.hasChanges;
        } catch (error) {
          failed(error);
          return false;
        }
      } else if (active.writer.hasChanges) {
        allowed = await usePromptStore.getState().requestConfirm({
          title: text.discard,
          message: text.discardMessage,
          confirmLabel: text.discardConfirm,
          danger: true,
        });
      }
      // Keep the edit gate until the native window has actually gone away.
      if (allowed) await after?.();
      return allowed;
    } finally {
      operation.complete();
    }
  }
  useEffect(() => {
    function preventReload(event: KeyboardEvent) {
      if (isReloadShortcut(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) current.current.notify(text.refreshBlocked);
      }
    }
    function beforeUnload(event: BeforeUnloadEvent) {
      if (session.current?.writer.hasChanges || session.current?.writer.isSaving) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    window.addEventListener("keydown", preventReload, true);
    window.addEventListener("beforeunload", beforeUnload);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (isTauri())
      void getCurrentWindow()
        .onCloseRequested((event) => {
          event.preventDefault();
          if (closing.current) return;
          closing.current = true;
          void beforeLeave(() => getCurrentWindow().destroy())
            .catch(failed)
            .finally(() => {
              closing.current = false;
            });
        })
        .then((stop) => {
          if (disposed) stop();
          else unlisten = stop;
        })
        .catch(failed);
    return () => {
      disposed = true;
      unlisten?.();
      if (wake.current !== undefined) clearTimeout(wake.current);
      window.removeEventListener("keydown", preventReload, true);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);

  async function load(folder: string, images: ImageFile[], fallback: () => Promise<void>) {
    const previous = session.current;
    const previousMetadata = previous?.metadata ?? current.current.metadata;
    loading.current = true;
    if (wake.current !== undefined) clearTimeout(wake.current);
    try {
      const preparation = prepared.current?.folder === folder ? prepared.current : undefined;
      const recovered = preparation?.snapshot ?? null;
      const accept = preparation?.restore ?? false;
      let fork = preparation?.fork ?? false;
      prepared.current = undefined;
      reopenAccepted.current = "";
      if (accept && recovered) {
        const byRelative = new Map(
          images.map((image) => [relativeImagePath(folder, image.path).toLowerCase(), image.path]),
        );
        const annotations: RecoveryContext["annotations"] = {};
        let missing = 0;
        for (const [path, shapes] of Object.entries(recovered.annotations)) {
          const absolute = byRelative.get(path.toLowerCase());
          if (absolute) annotations[absolute] = shapes;
          else missing++;
        }
        useAnnotationStore.getState().replaceAnnotations(annotations, recovered.metadata.labels);
        current.current.apply(recovered.metadata);
        useAnnotationStore.getState().select(recovered.metadata.selectedPath);
        current.current.notify(missing ? text.missingImages(missing) : text.recovered);
      } else await fallback();
      const writer = new RecoveryWriter(
        () => ({
          folder,
          metadata: {
            ...active.metadata,
            selectedPath: useAnnotationStore.getState().selectedPath,
          },
          annotations: useAnnotationStore.getState().annotationsByImage,
        }),
        async (project, update) => {
          const operation = useOperations
            .getState()
            .begin({ label: text.operation, resource: "recovery-copy", quiet: true });
          try {
            const revision = await (fork
              ? forkRecovery(project, update)
              : saveRecovery(project, update));
            fork = false;
            operation.complete(text.saved);
            return revision;
          } catch (error) {
            operation.fail(error);
            throw error;
          }
        },
        (status) => {
          if (session.current === active) useRecoveryStore.setState({ status });
        },
      );
      const active: Session = {
        folder,
        metadata: accept && recovered ? recovered.metadata : current.current.metadata,
        writer,
        ready: false,
      };
      session.current = active;
      active.writer.initialize(
        recovered?.revision ?? 0,
        !!accept,
        accept ? recovered!.metadata.savedAt : "",
      );
      useRecoveryStore.setState({
        retry: () => {
          void save().catch(failed);
        },
        openArchives: () => {
          void openRecoveryDirectory(folder).catch(failed);
        },
        resolveConflict: () => {
          void (async () => {
            if (session.current !== active || loading.current || closing.current) return;
            if (
              !(await usePromptStore.getState().requestConfirm({
                title: text.keepBoth,
                message: text.keepBothMessage,
                confirmLabel: text.keepBoth,
              }))
            )
              return;
            if (
              session.current !== active ||
              loading.current ||
              closing.current ||
              !useOperations.getState().canStart("project-annotations")
            )
              return;
            const operation = useOperations
              .getState()
              .begin({ label: text.keepBoth, resource: "project-annotations" });
            try {
              await active.writer.branch(forkRecovery);
              operation.complete();
            } catch (error) {
              operation.fail(error);
              throw error;
            }
          })().catch(failed);
        },
      });
      renderSession((value) => value + 1);
    } catch (error) {
      session.current = previous;
      current.current.apply({ ...previousMetadata, selectedPath: "", savedAt: "" });
      throw error;
    }
  }
  async function manual(action: () => Promise<boolean>, key = "save") {
    const duplicate = manualPending.current.get(key);
    if (duplicate) return duplicate;
    if (loading.current || closing.current) {
      current.current.report(text.busy);
      return false;
    }
    const active = session.current;
    if (!active) return action();
    const pending = active.writer
      .manual(action, (result) => result)
      .catch((error: unknown) => {
        failed(error);
        return false;
      });
    manualPending.current.set(key, pending);
    useRecoveryStore.setState({ manualPending: manualPending.current.size });
    try {
      return await pending;
    } finally {
      manualPending.current.delete(key);
      useRecoveryStore.setState({ manualPending: manualPending.current.size });
    }
  }
  async function offerLast(open: (path: string) => Promise<boolean>) {
    if (reopenChecked.current || session.current) return;
    reopenChecked.current = true;
    try {
      const folder = await lastRecoveryProject();
      if (!folder || session.current || current.current.folder) return;
      if (
        await usePromptStore.getState().requestConfirm({
          title: text.reopen,
          message: text.reopenMessage(folder),
          confirmLabel: text.restore,
        })
      ) {
        if (session.current || current.current.folder) return;
        reopenAccepted.current = folder;
        await open(folder);
      }
    } catch (error) {
      current.current.report(String(error));
    }
  }
  async function beforeOpen(folder: string) {
    if (loading.current || closing.current || !(await beforeLeave())) return false;
    if (!useOperations.getState().canStart("project-annotations")) return false;
    const operation = useOperations
      .getState()
      .begin({ label: text.restore, resource: "project-annotations" });
    loading.current = true;
    let proceed = false;
    try {
      let snapshot: RecoverySnapshot | null = null;
      let fork = false;
      let restore = false;
      try {
        const raw = await loadRecovery(folder);
        snapshot = raw ? validateRecovery(raw) : null;
      } catch (error) {
        const choice = await usePromptStore.getState().requestChoice({
          title: text.unreadable,
          message: text.unreadableMessage(error),
          choices: [{ id: "original", label: text.skip }],
        });
        if (choice !== "original") return false;
        fork = true;
      }
      if (snapshot) {
        const choice =
          reopenAccepted.current === folder
            ? "restore"
            : await usePromptStore.getState().requestChoice({
                title: text.restore,
                message: `${text.restoreMessage(new Date(snapshot.metadata.savedAt).toLocaleString())}\n${text.originalHint}`,
                choices: [
                  { id: "original", label: text.skip },
                  { id: "restore", label: text.restore },
                ],
              });
        if (!choice) return false;
        restore = choice === "restore";
      }
      prepared.current = { folder, snapshot, restore, fork };
      if (wake.current !== undefined) clearTimeout(wake.current);
      wake.current = undefined;
      pendingAll.current = false;
      pendingPaths.current.clear();
      proceed = true;
      return true;
    } finally {
      loading.current = proceed;
      reopenAccepted.current = "";
      operation.complete();
    }
  }
  return {
    manualBusy,
    beforeOpen,
    load,
    manual,
    offerLast,
    openFinished: () => {
      loading.current = false;
    },
  };
}
