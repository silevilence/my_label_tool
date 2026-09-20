import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useImageDeletion } from "../hooks/useImageDeletion";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { DEFAULT_SHORTCUTS } from "../lib/defaults/shortcuts";
import { useAnnotationStore } from "../store/useAnnotationStore";
import { DeleteImageDialog } from "./DeleteImageDialog";
import { IMAGE_DELETION_ZH_CN as text } from "../i18n/image-deletion.zh-CN";
import { recycleImageFile } from "../lib/tauri-api";

vi.mock("../lib/tauri-api", () => ({ recycleImageFile: vi.fn() }));
const initialImages = ["a", "b", "c"].map((name) => ({
  name: `${name}.png`,
  path: `C:/images/${name}.png`,
}));
const rect = { id: "rect", type: "rect" as const, labelId: "person", points: [1, 2, 3, 4] };
const shortcutAction = vi.fn();
let controls: ReturnType<typeof useImageDeletion>;

function Harness({
  selected = "b",
  busy = false,
  shortcut = "F8",
}: {
  selected?: string;
  busy?: boolean;
  shortcut?: string;
}) {
  const images = useAnnotationStore((state) => state.images);
  const selectedPath = useAnnotationStore((state) => state.selectedPath);
  useEffect(() => {
    useAnnotationStore.getState().setImages(initialImages);
    useAnnotationStore.getState().select(`C:/images/${selected}.png`);
  }, [selected]);
  const [error, setError] = useState("");
  const annotations = useAnnotationStore((state) => state.annotationsByImage);
  controls = useImageDeletion({
    folderPath: "C:/images",
    busy,
    setError,
  });
  useKeyboardShortcuts({
    labels: [],
    selectedPath,
    selectedShapeId: rect.id,
    shortcuts: { ...DEFAULT_SHORTCUTS, deleteImage: shortcut },
    deleteCurrentImage: () => controls.request(selectedPath),
    changeCurrentLabel: shortcutAction,
    deleteSelectedShape: shortcutAction,
    redo: shortcutAction,
    save: shortcutAction,
    selectAdjacentImage: shortcutAction,
    selectShapeType: shortcutAction,
    undoPolygonPoint: () => false,
    undo: shortcutAction,
    zoomFromKeyboard: shortcutAction,
    onShortcutConflict: shortcutAction,
  });
  return (
    <>
      <output data-selected>{selectedPath}</output>
      <output data-images>{images.map((image) => image.name).join(",")}</output>
      <output data-error>{error}</output>
      <input aria-label="input" />
      {controls.target && (
        <DeleteImageDialog
          target={controls.target}
          annotationCount={annotations[controls.target.image.path]?.length ?? 0}
          isDeleting={controls.isDeleting}
          error={controls.error}
          onCancel={controls.cancel}
          onConfirm={() => void controls.confirm()}
        />
      )}
    </>
  );
}

describe("image deletion confirmation and state", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(recycleImageFile).mockResolvedValue(undefined);
    useAnnotationStore.getState().replaceAnnotations({});
    useAnnotationStore.getState().addAnnotation(initialImages[1].path, rect);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });
  async function render(props: Parameters<typeof Harness>[0] = {}) {
    await act(async () => root.render(<Harness {...props} />));
  }
  async function key(key: string, extra: KeyboardEventInit = {}, target: EventTarget = window) {
    await act(async () => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }),
      );
    });
  }
  function confirmButton() {
    return document.body.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')[1];
  }
  async function clickConfirm(detail = 1) {
    await act(async () => {
      confirmButton().dispatchEvent(new MouseEvent("click", { bubbles: true, detail }));
    });
  }
  async function ready() {
    await act(async () => vi.advanceTimersByTime(3000));
  }

  it("shows filename, annotation count and consequences; enforces 3 full seconds", async () => {
    await render();
    await key("F8");
    expect(document.body.textContent).toContain(text.annotationCount(1));
    expect(document.body.textContent).toContain(text.consequence);
    expect(document.body.querySelector('[role="alertdialog"]')?.textContent).toContain("b.png");
    expect(confirmButton().disabled).toBe(true);
    await clickConfirm();
    await act(async () => controls.confirm());
    await act(async () => vi.advanceTimersByTime(2999));
    expect(recycleImageFile).not.toHaveBeenCalled();
    expect(confirmButton().disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(1));
    expect(confirmButton().disabled).toBe(false);
    await clickConfirm();
    expect(recycleImageFile).toHaveBeenCalledExactlyOnceWith("C:/images", initialImages[1].path);
  });

  it("blocks all keyboard confirmation and canvas shortcuts, repeats and programmatic clicks", async () => {
    await render();
    await key("F8", { repeat: true });
    expect(controls.target).toBeNull();
    await key("F8");
    const pending = controls.target;
    await ready();
    confirmButton().focus();
    for (const value of ["Enter", " ", "Delete", "ArrowRight", "=", "r", "F8"]) await key(value);
    await key("z", { ctrlKey: true });
    await key("s", { ctrlKey: true });
    await clickConfirm(0);
    expect(controls.target).toBe(pending);
    expect(shortcutAction).not.toHaveBeenCalled();
    expect(recycleImageFile).not.toHaveBeenCalled();
    await key("Tab");
    expect(document.activeElement).toBe(document.body.querySelector('[role="alertdialog"] button'));
    await key("Escape");
    expect(controls.target).toBeNull();
    expect(useAnnotationStore.getState().annotationsByImage[initialImages[1].path]).toEqual([rect]);
    await key("ArrowRight");
    expect(shortcutAction).toHaveBeenCalledWith(1);
  });

  it("cancels by mouse without state changes and starts a fresh countdown", async () => {
    await render();
    await key("F8");
    await ready();
    const before = useAnnotationStore.getState();
    await act(async () =>
      document.body.querySelector<HTMLButtonElement>('[role="alertdialog"] button')?.click(),
    );
    expect(useAnnotationStore.getState()).toBe(before);
    expect(document.body.querySelector("[data-images]")?.textContent).toBe("a.png,b.png,c.png");
    await key("F8");
    expect(confirmButton().disabled).toBe(true);
    expect(recycleImageFile).not.toHaveBeenCalled();
  });

  it.each([
    ["b", "c"],
    ["c", "b"],
    ["a", "b"],
  ])("deleting current %s selects %s", async (selected, next) => {
    await render({ selected });
    await key("F8");
    await ready();
    await clickConfirm();
    expect(document.body.querySelector("[data-selected]")?.textContent).toBe(
      `C:/images/${next}.png`,
    );
    expect(document.body.querySelector("[data-images]")?.textContent).not.toContain(
      `${selected}.png`,
    );
  });

  it("preserves current image and its selection when deleting another, then handles empty list", async () => {
    await render();
    useAnnotationStore.getState().selectShape(rect.id);
    await act(async () => controls.request(initialImages[0].path));
    await ready();
    await clickConfirm();
    expect(document.body.querySelector("[data-selected]")?.textContent).toBe(initialImages[1].path);
    expect(useAnnotationStore.getState().selectedShapeId).toBe(rect.id);
    for (let i = 0; i < 2; i++) {
      await key("F8");
      await ready();
      await clickConfirm();
    }
    expect(document.body.querySelector("[data-images]")?.textContent).toBe("");
    expect(document.body.querySelector("[data-selected]")?.textContent).toBe("");
    await key("F8");
    expect(controls.target).toBeNull();
  });

  it("keeps list, annotations, selection and history unchanged on backend failure and allows retry", async () => {
    vi.mocked(recycleImageFile).mockRejectedValueOnce(new Error("access denied"));
    await render();
    const before = useAnnotationStore.getState();
    await key("F8");
    await ready();
    await clickConfirm();
    expect(document.body.textContent).toContain("access denied");
    expect(useAnnotationStore.getState()).toBe(before);
    expect(document.body.querySelector("[data-images]")?.textContent).toBe("a.png,b.png,c.png");
    expect(document.body.querySelector("[data-selected]")?.textContent).toBe(initialImages[1].path);
    await clickConfirm();
    expect(controls.target).toBeNull();
  });

  it("serializes repeated confirmations and does not cancel an already running operation", async () => {
    let resolve!: () => void;
    vi.mocked(recycleImageFile).mockReturnValue(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    await render();
    await key("F8");
    await ready();
    await clickConfirm();
    await clickConfirm();
    await key("Escape");
    await act(async () => {
      void controls.confirm();
      controls.cancel();
    });
    expect(recycleImageFile).toHaveBeenCalledTimes(1);
    expect(controls.target).not.toBeNull();
    expect(document.body.querySelector("[data-images]")?.textContent).toContain("b.png");
    await act(async () => resolve());
    expect(controls.target).toBeNull();
    expect(useAnnotationStore.getState().annotationsByImage).not.toHaveProperty(
      initialImages[1].path,
    );
    await act(async () => {
      useAnnotationStore.getState().undo();
      useAnnotationStore.getState().redo();
    });
    expect(useAnnotationStore.getState().annotationsByImage).not.toHaveProperty(
      initialImages[1].path,
    );
  });

  it("honors rebinding, ignores editable fields, keeps Delete for shapes", async () => {
    await render({ shortcut: "F9" });
    await key("F8");
    await key("F9", {}, document.body.querySelector("input")!);
    expect(controls.target).toBeNull();
    await key("Delete");
    expect(shortcutAction).toHaveBeenCalledOnce();
    await key("F9");
    expect(controls.target?.image.path).toBe(initialImages[1].path);
  });

  it("refuses deletion during background writes", async () => {
    await render({ busy: true });
    await key("F8");
    expect(controls.target).toBeNull();
    expect(document.body.textContent).toContain(text.busy);
    expect(recycleImageFile).not.toHaveBeenCalled();
  });
});
