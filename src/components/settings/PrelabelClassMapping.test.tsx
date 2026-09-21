import { PRELABEL_ZH_CN as text } from "../../i18n/prelabel.zh-CN";
import { projectConfigTemplate, type ProjectConfig } from "../../lib/importers";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ClassMappingPanel, ClassMappingRow } from "./PrelabelClassMapping";
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

it("clears the pending flag when the parent supplies a saved binding", async () => {
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

it("persists binding through the panel and clears pending when reselecting the saved label", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const persist = vi.fn();
  function Harness() {
    const [config, setConfig] = useState<ProjectConfig>({
      schemaVersion: 1,
      format: "json",
      annotationPath: "a.json",
      imageFolder: "p",
      exportedAt: "",
      labels,
      template: projectConfigTemplate(),
      exportOptions: { format: "json" },
    });
    return (
      <ClassMappingPanel
        activeProjectConfig={config}
        labels={labels}
        classNames={["person"]}
        sourceId="model"
        disabled={false}
        isLabelDirty={false}
        onSave={async (mappings) => {
          persist(mappings);
          setConfig({ ...config, prelabelMappings: { model: mappings } });
        }}
      />
    );
  }
  act(() => root.render(<Harness />));
  const select = host.querySelector("select")!;
  const choose = (value: string) =>
    act(() => {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  choose("l2");
  expect(host.textContent).toContain(text.pendingSelection);
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === text.excludeClass)!
      .click(),
  );
  expect(persist).toHaveBeenLastCalledWith([
    { classIndex: 0, className: "person", action: "exclude" },
  ]);
  expect(host.textContent).not.toContain(text.pendingSelection);
  expect(host.textContent).toContain(text.mappingExcluded);
  expect(select.value).toBe("l1");
  persist.mockClear();
  choose("l2");
  expect(host.textContent).toContain(text.pendingSelection);
  await act(async () =>
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === text.bindExisting)!
      .click(),
  );
  expect(persist).toHaveBeenCalledWith([
    { classIndex: 0, className: "person", action: "bind", labelId: "l2" },
  ]);
  expect(host.textContent).not.toContain(text.pendingSelection);
  expect(host.textContent).toContain(text.mappingExplicit);
  choose("l1");
  expect(host.textContent).toContain(text.pendingSelection);
  choose("l2");
  expect(host.textContent).not.toContain(text.pendingSelection);
  expect(persist).toHaveBeenCalledOnce();
  act(() => root.unmount());
  host.remove();
});
