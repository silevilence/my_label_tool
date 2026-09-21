import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { PromptHost } from "./PromptHost";
import { confirmAction, promptText, usePromptStore } from "../../lib/prompts";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function renderHost() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<PromptHost />));
}

function button(label: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!found) throw new Error(`button not found: ${label}`);
  return found;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  usePromptStore.setState({ confirmQueue: [], promptQueue: [] });
  renderHost();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  usePromptStore.setState({ confirmQueue: [], promptQueue: [] });
});

it("resolves confirm true on confirm, false on cancel and queues concurrent requests", async () => {
  let first!: Promise<boolean>;
  let second!: Promise<boolean>;
  act(() => {
    first = confirmAction("第一条？");
    second = confirmAction("第二条？");
  });
  expect(document.body.textContent).toContain("第一条？");
  expect(document.body.textContent).not.toContain("第二条？");
  act(() => button("取消").click());
  await expect(first).resolves.toBe(false);
  expect(document.body.textContent).toContain("第二条？");
  act(() => button("确定").click());
  await expect(second).resolves.toBe(true);
});

it("marks danger confirms and resolves escape-style close as false", async () => {
  let pending!: Promise<boolean>;
  act(() => {
    pending = confirmAction("删除模板？", { danger: true, confirmLabel: "删除" });
  });
  const confirmButton = button("删除");
  expect(confirmButton.className).toContain("bg-red-600");
  expect(document.activeElement).toBe(confirmButton);
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  await expect(pending).resolves.toBe(false);
});

it("submits trimmed prompt text via Enter and returns null on cancel click", async () => {
  let pending!: Promise<string | null>;
  act(() => {
    pending = promptText("新模板名称", "  草稿  ");
  });
  const input = document.body.querySelector<HTMLInputElement>('input[aria-label="新模板名称"]')!;
  expect(input.value).toBe("  草稿  ");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "  我的模板  ",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  await expect(pending).resolves.toBe("我的模板");
  let second!: Promise<string | null>;
  act(() => {
    second = promptText("另存为模板名称");
  });
  act(() => button("取消").click());
  await expect(second).resolves.toBeNull();
});

it("rejects empty prompt submissions until text is entered", async () => {
  let pending!: Promise<string | null>;
  act(() => {
    pending = promptText("新模板名称");
  });
  expect(button("确定").disabled).toBe(true);
  act(() => button("确定").click());
  const input = document.body.querySelector<HTMLInputElement>('input[aria-label="新模板名称"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "名称");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(button("确定").disabled).toBe(false);
  await act(async () => button("确定").click());
  await expect(pending).resolves.toBe("名称");
});

it("resets the input for queued naming requests with the same title", async () => {
  let first!: Promise<string | null>;
  let second!: Promise<string | null>;
  act(() => {
    first = promptText("新模板名称", "第一个");
    second = promptText("新模板名称", "第二个");
  });
  act(() => button("确定").click());
  await expect(first).resolves.toBe("第一个");
  expect(document.body.querySelector<HTMLInputElement>("input")!.value).toBe("第二个");
  act(() => button("确定").click());
  await expect(second).resolves.toBe("第二个");
});

it("ignores IME Enter and settles a naming prompt with Escape", async () => {
  let pending!: Promise<string | null>;
  act(() => {
    pending = promptText("名称", "拼音");
  });
  const input = document.body.querySelector("input")!;
  act(() =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        isComposing: true,
      }),
    ),
  );
  expect(usePromptStore.getState().promptQueue).toHaveLength(1);
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  await expect(pending).resolves.toBeNull();
});
it("settles prompts even when Promise.withResolvers is absent", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(Promise, "withResolvers");
  Object.defineProperty(Promise, "withResolvers", { configurable: true, value: undefined });
  try {
    let confirm!: Promise<boolean>;
    act(() => {
      confirm = confirmAction("兼容性确认");
    });
    act(() => button("确定").click());
    await expect(confirm).resolves.toBe(true);
    let prompt!: Promise<string | null>;
    act(() => {
      prompt = promptText("兼容性输入", "test");
    });
    act(() => button("确定").click());
    await expect(prompt).resolves.toBe("test");
  } finally {
    if (descriptor) Object.defineProperty(Promise, "withResolvers", descriptor);
    else Reflect.deleteProperty(Promise, "withResolvers");
  }
});
