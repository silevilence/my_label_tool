import { useEffect, useState } from "react";
import {
  checkAppUpdate,
  installAppUpdate,
  type AppUpdateProgress,
  type AppUpdateStatus,
} from "../lib/updater";
import type { Update } from "@tauri-apps/plugin-updater";

export function useAppUpdate(setError: (message: string) => void) {
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus>("idle");
  const [updateMessage, setUpdateMessage] = useState("");
  const [updateProgress, setUpdateProgress] = useState<AppUpdateProgress | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void checkForUpdates(true);
    }, 1500);

    return () => window.clearTimeout(timer);
  }, []);

  async function checkForUpdates(silent = false) {
    if (updateStatus === "checking" || updateStatus === "downloading") {
      return;
    }

    setUpdateStatus("checking");
    setUpdateProgress(null);
    if (!silent) {
      setUpdateMessage("正在检查更新...");
    }

    try {
      const update = await checkAppUpdate();
      setPendingUpdate(update);

      if (!update) {
        setUpdateStatus(silent ? "idle" : "not-available");
        setUpdateMessage(silent ? "" : "已是最新版本。");
        return;
      }

      setUpdateStatus("available");
      setUpdateMessage(
        `发现新版本 ${update.version}，当前版本 ${update.currentVersion}。${summarizeUpdateBody(
          update.body,
        )}`,
      );
    } catch (caughtError: unknown) {
      setPendingUpdate(null);
      setUpdateStatus(silent ? "idle" : "error");
      setUpdateMessage(
        silent
          ? ""
          : `检查更新失败：${
              caughtError instanceof Error ? caughtError.message : String(caughtError)
            }`,
      );
    }
  }

  async function installUpdate() {
    if (!pendingUpdate || updateStatus === "downloading") {
      return;
    }

    setUpdateStatus("downloading");
    setUpdateMessage(`正在下载并安装 ${pendingUpdate.version}...`);

    try {
      await installAppUpdate(pendingUpdate, setUpdateProgress);
      setUpdateStatus("installed");
      setUpdateMessage("更新已安装，正在重启...");
    } catch (caughtError: unknown) {
      const message = `安装更新失败：${
        caughtError instanceof Error ? caughtError.message : String(caughtError)
      }`;
      setUpdateStatus("error");
      setUpdateMessage(message);
      setError(message);
    }
  }

  return {
    checkForUpdates,
    installUpdate,
    setUpdateMessage,
    updateMessage,
    updateProgress,
    updateStatus,
  };
}

function summarizeUpdateBody(body?: string) {
  const summary = body?.replace(/\s+/g, " ").trim();
  if (!summary) {
    return "";
  }

  return ` 发布说明：${summary.length > 160 ? `${summary.slice(0, 160)}...` : summary}`;
}
