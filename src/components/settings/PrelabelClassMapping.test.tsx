import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ClassMappingRow } from "./PrelabelClassMapping";
import type { LabelConfig } from "../../types/annotation";
import type { ResolvedPrelabelClassMapping } from "../../types/prelabel";

const labels: LabelConfig[] = [
  { id: "l1", name: "行人", color: "#111111", shapeType: "any" },
  { id: "l2", name: "车辆", color: "#222222", shapeType: "any" },
];

const mapping: ResolvedPrelabelClassMapping = {
  classIndex: 0,
  className: "person",
  excluded: false,
  source: "unmatched",
};

function renderRow(overrides: Partial<Parameters<typeof ClassMappingRow>[0]> = {}) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const props: Parameters<typeof ClassMappingRow>[0] = {
    disabled: false,
    labels,
    mapping,
    onBind: vi.fn(async () => {}),
    onCreate: vi.fn(async () => {}),
    onExclude: vi.fn(async () => {}),
    ...overrides,
  };
  act(() => root.render(<ClassMappingRow {...props} />));
  return { root, host, props };
}

it("flags an unbound selection instead of silently resetting it", () => {
  const { root, host } = renderRow();
  expect(document.body.textContent).not.toContain("未绑定");
  const select = document.body.querySelector<HTMLSelectElement>('select[aria-label="选择标签"]')!;
  act(() => {
    select.value = "l2";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(document.body.textContent).toContain("未绑定，点击绑定生效");
  act(() => root.unmount());
  host.remove();
});

it("clears the pending flag after binding commits the selection", async () => {
  const { root, host, props } = renderRow();
  const select = document.body.querySelector<HTMLSelectElement>('select[aria-label="选择标签"]')!;
  act(() => {
    select.value = "l2";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const bindButton = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === "绑定已有标签",
  )!;
  await act(async () => bindButton.click());
  expect(props.onBind).toHaveBeenCalledWith("l2");
  act(() => {
    props.mapping = { ...mapping, labelId: "l2", source: "explicit" };
    root.render(
      <ClassMappingRow
        disabled={false}
        labels={labels}
        mapping={props.mapping}
        onBind={props.onBind}
        onCreate={props.onCreate}
        onExclude={props.onExclude}
      />,
    );
  });
  expect(document.body.textContent).not.toContain("未绑定，点击绑定生效");
  act(() => root.unmount());
  host.remove();
});
