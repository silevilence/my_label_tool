import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLUGIN_ZH_CN as pluginText } from "../../i18n/plugin.zh-CN";
import { PRELABEL_ZH_CN as prelabelText } from "../../i18n/prelabel.zh-CN";
import type {
  PluginCapabilities,
  PluginExportFormatDescriptor,
  PluginPrelabelSourceDescriptor,
  PluginRegistryEntry,
} from "../../types/plugin";
import { ExportPanel } from "./ExportPanel";
import { PluginSettings } from "./PluginSettings";
import { PrelabelSettings } from "./PrelabelSettings";

const tauriMocks = vi.hoisted(() => ({
  authorizePlugin: vi.fn(),
  clearPluginFailures: vi.fn(),
  getOnnxRuntimeStatus: vi.fn(),
  getPluginRuntimeLogs: vi.fn(),
  getPluginRuntimeSettings: vi.fn(),
  installPlugin: vi.fn(),
  listPlugins: vi.fn(),
  selectPluginPackage: vi.fn(),
  setPluginEnabled: vi.fn(),
  setPluginSafeMode: vi.fn(),
  uninstallPlugin: vi.fn(),
}));
const promptsMocks = vi.hoisted(() => ({ confirmAction: vi.fn().mockResolvedValue(true) }));

vi.mock("../../lib/prompts", () => promptsMocks);
vi.mock("../../lib/tauri-api", () => tauriMocks);

const capabilities: PluginCapabilities = {
  annotationTypes: ["rect"],
  batch: false,
  progress: true,
  cancel: true,
  configMigration: false,
  exporter: { apiVersion: { min: 1 } },
  prelabel: { apiVersion: { min: 1 } },
};

function pluginEntry(
  id: string,
  name: string,
  extensionKind: PluginRegistryEntry["extensionKind"],
  state: PluginRegistryEntry["state"],
): PluginRegistryEntry {
  return {
    id,
    name,
    version: "1.0.0",
    extensionKind,
    entry: extensionKind === "label-preset" ? null : { command: "plugin.exe", args: [] },
    capabilities,
    grants: [],
    state,
    failureCount: state === "auto-disabled" ? 3 : 0,
    lastError: state === "auto-disabled" ? "连续失败" : null,
    configVersion: 1,
    timeoutMs: 30_000,
    installedAt: "2026-08-27T00:00:00Z",
    updatedAt: "2026-08-27T00:00:00Z",
  };
}

describe("plugin UI acceptance", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows lifecycle states and applies safe mode immediately", async () => {
    const entries = [
      pluginEntry("dev.test.exporter", "导出插件", "exporter", "enabled"),
      pluginEntry("dev.test.labels", "标签插件", "label-preset", "enabled"),
      pluginEntry("dev.test.failed", "故障插件", "prelabel", "auto-disabled"),
    ];
    tauriMocks.listPlugins.mockResolvedValue({ plugins: entries, warning: null });
    tauriMocks.getPluginRuntimeSettings.mockResolvedValue({ safeMode: false });
    tauriMocks.setPluginSafeMode.mockResolvedValue({ safeMode: true });
    const onPluginsChanged = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <PluginSettings
          projectDir="C:\\project"
          onClose={vi.fn()}
          onPluginsChanged={onPluginsChanged}
          onRetryConfigMigration={vi.fn().mockResolvedValue(undefined)}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain(pluginText.stateEnabled);
    expect(document.body.textContent).toContain(pluginText.stateAutoDisabled);
    expect(document.body.textContent).toContain(pluginText.clearFailures);
    const safeMode = Array.from(document.body.querySelectorAll("input")).find((input) =>
      input.parentElement?.textContent?.includes(pluginText.safeMode),
    );
    expect(safeMode).toBeDefined();

    await act(async () => {
      safeMode?.click();
      await Promise.resolve();
    });

    expect(tauriMocks.setPluginSafeMode).toHaveBeenCalledWith(true);
    expect(onPluginsChanged).toHaveBeenCalledOnce();
    expect(promptsMocks.confirmAction).toHaveBeenCalled();
    expect(document.body.textContent).toContain(pluginText.safeModeRuntimeBlocked);
    const exporterCard = Array.from(document.body.querySelectorAll("article")).find((card) =>
      card.textContent?.includes("导出插件"),
    );
    const labelCard = Array.from(document.body.querySelectorAll("article")).find((card) =>
      card.textContent?.includes("标签插件"),
    );
    expect(exporterCard?.querySelector("button")?.disabled).toBe(true);
    expect(labelCard?.querySelector("button")?.disabled).toBe(false);
  });

  it("shows disabled exporter reason, progress, and cancellation control", async () => {
    const format: PluginExportFormatDescriptor = {
      selectionId: "plugin:dev.test.exporter:labelme",
      pluginId: "dev.test.exporter",
      pluginName: "LabelMe 插件",
      format: {
        id: "labelme",
        displayName: "LabelMe JSON",
        extensions: ["json"],
        multiFile: true,
      },
      enabled: false,
      disabledReason: "安全模式已阻止",
      supportsProgress: true,
      supportsCancel: true,
    };
    const onCancel = vi.fn();
    await act(async () => {
      root.render(
        <ExportPanel
          canSaveProject
          customMappingText=""
          disabled={false}
          isSaving={false}
          exportError={null}
          pluginExportProgress={{
            percent: 47,
            message: "正在生成",
            canCancel: true,
            cancelling: false,
          }}
          pluginFormats={[format]}
          selectedFormatId={format.selectionId}
          onCancelPluginExport={onCancel}
          onChangeCustomMappingText={vi.fn()}
          onChangeFormat={vi.fn()}
          onExport={vi.fn()}
          onSaveProject={vi.fn()}
        />,
      );
    });

    expect(document.body.textContent).toContain("安全模式已阻止");
    expect(document.body.textContent).toContain("47%");
    const selectedOption = document.body.querySelector(`option[value="${format.selectionId}"]`);
    expect((selectedOption as HTMLOptionElement).disabled).toBe(true);
    const cancel = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent === pluginText.exportCancel,
    );
    await act(async () => cancel?.click());
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows enabled and disabled prelabel sources with their live reasons", async () => {
    tauriMocks.getOnnxRuntimeStatus.mockResolvedValue({
      state: "missing",
      version: "",
      dllPath: "",
      runtimeDirectory: "",
      downloadAvailable: false,
      message: "运行时未安装",
    });
    const sources: PluginPrelabelSourceDescriptor[] = [
      {
        selectionId: "plugin:dev.test.ready",
        pluginId: "dev.test.ready",
        pluginName: "可用预打标",
        classNames: ["person"],
        annotationTypes: ["rect"],
        enabled: true,
        disabledReason: null,
        supportsBatch: true,
        supportsProgress: true,
        supportsCancel: true,
      },
      {
        selectionId: "plugin:dev.test.blocked",
        pluginId: "dev.test.blocked",
        pluginName: "已禁用预打标",
        classNames: [],
        annotationTypes: ["rect"],
        enabled: false,
        disabledReason: "等待配置迁移",
        supportsBatch: false,
        supportsProgress: false,
        supportsCancel: false,
      },
    ];

    await act(async () => {
      root.render(
        <PrelabelSettings
          activeProjectConfig={null}
          isLabelDirty={false}
          isLoaded
          labels={[]}
          library={{ schemaVersion: 1, currentModelId: null, models: [] }}
          pluginSources={sources}
          onAddModel={vi.fn()}
          onClose={vi.fn()}
          onDeleteModel={vi.fn()}
          onSaveMappings={vi.fn()}
          onSelectModel={vi.fn()}
          onUpdateModel={vi.fn()}
        />,
      );
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain(prelabelText.pluginSourcesTitle);
    expect(document.body.textContent).toContain(prelabelText.pluginSourceReady);
    expect(document.body.textContent).toContain("等待配置迁移");
    const ready = Array.from(document.body.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("可用预打标"),
    );
    await act(async () => ready?.click());
    expect(document.body.textContent).toContain("可用预打标");
    expect(document.body.textContent).toContain("person");
  });
});
