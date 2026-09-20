import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ModelImportForm } from "./PrelabelModelForm";
import { createPrelabelModelConfig } from "../../lib/prelabel-models";
import { PRELABEL_ZH_CN as text } from "../../i18n/prelabel.zh-CN";
import type { PrelabelModelConfig } from "../../types/prelabel";

const model: PrelabelModelConfig = {
  ...createPrelabelModelConfig("C:/app/models/a.onnx", {
    format: "yolo11",
    classCount: 1,
    inputWidth: 640,
    inputHeight: 640,
    classNames: ["person"],
  }, "a"),
  name: "YOLO11",
};

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function renderForm(modelOverrides: Partial<PrelabelModelConfig> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const props = {
    mode: "edit" as const,
    disabled: false,
    model: { ...model, ...modelOverrides },
    submitLabel: text.saveModel,
    gpuAvailable: null,
    onCancel: vi.fn(),
    onChange: vi.fn(),
    onDelete: vi.fn(),
    onSubmit: vi.fn(),
    onValidate: vi.fn(),
  };
  act(() => root.render(<ModelImportForm {...props} />));
  return { props };
}

function inputByLabel(label: string): HTMLInputElement {
  const found = [...document.body.querySelectorAll("label")]
    .find((node) => node.textContent?.startsWith(label))
    ?.querySelector("input");
  if (!found) throw new Error(`input not found: ${label}`);
  return found;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("shows per-field reasons with aria wiring and a perceivable disabled-submit reason", () => {
  const { props } = renderForm({ name: "", classNames: ["person", ""], confidenceThreshold: 3 });
  const nameInput = inputByLabel(text.modelName);
  expect(nameInput.getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById("model-name-error")?.textContent).toContain(text.fieldNameRequired);
  expect(document.getElementById("model-classnames-error")?.textContent).toContain(
    text.fieldClassNamesBlank,
  );
  expect(inputByLabel(text.confidenceThreshold).getAttribute("aria-invalid")).toBe("true");
  expect(document.getElementById("model-confidence-error")?.textContent).toContain(
    text.fieldThresholdRange,
  );
  const reason = document.getElementById("model-submit-reason");
  expect(reason?.textContent).toContain(text.fieldNameRequired);
  const submit = [...document.body.querySelectorAll("button")].find(
    (button) => button.getAttribute("aria-describedby") === "model-submit-reason",
  )!;
  expect(submit.disabled).toBe(true);
  act(() => submit.click());
  expect(props.onSubmit).not.toHaveBeenCalled();
});

it("submits through the form on Enter once every field is valid", () => {
  const { props } = renderForm({ confidenceThreshold: 0.5 });
  const nameInput = inputByLabel(text.modelName);
  expect(nameInput.getAttribute("aria-invalid")).toBeNull();
  expect(document.body.textContent).not.toContain(text.fieldNameRequired);
  act(() => {
    nameInput.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    nameInput.form!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  expect(props.onSubmit).toHaveBeenCalledTimes(1);
});
