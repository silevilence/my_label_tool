import type { useProjectVideoActions } from "../../hooks/useProjectVideoActions";
import type { useProjectSettings } from "../../hooks/useProjectSettings";
import { VideoReextractDialog } from "./VideoReextractDialog";
import { VideoBatchDialog } from "./VideoBatchDialog";
import { VideoImportDialog } from "./VideoImportDialog";

export function ProjectVideoDialogs({
  actions,
  settings,
  folder,
}: {
  actions: ReturnType<typeof useProjectVideoActions>;
  settings: ReturnType<typeof useProjectSettings>;
  folder: string;
}) {
  return (
    <>
      {actions.replacement && (
        <VideoReextractDialog
          target={actions.replacement}
          busy={actions.replacing}
          error={actions.replacementError}
          onConfirm={() => void actions.confirmReextract()}
          onCancel={actions.cancelReextract}
        />
      )}
      {actions.batch && (
        <VideoBatchDialog
          progress={actions.batch}
          onCancel={() => void actions.cancel()}
          onClose={actions.closeBatch}
        />
      )}
      {actions.source !== null && !settings.loading && (
        <VideoImportDialog
          defaultSettings={settings.settings.videoExtraction}
          sourcePath={actions.source}
          busy={actions.busy}
          onClose={() => actions.setSource(null)}
          onCancel={() => void actions.cancel()}
          onImport={(sampling) => void actions.start(sampling, folder, actions.source!)}
        />
      )}
    </>
  );
}
