import { DeleteImageDialog } from "../DeleteImageDialog";
import type { VideoReextractTarget } from "../../hooks/useProjectVideoActions";
import { useAnnotationStore } from "../../store/useAnnotationStore";
import { VIDEO_ZH_CN as text } from "../../i18n/video.zh-CN";

export function VideoReextractDialog({
  target,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  target: VideoReextractTarget;
  busy: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const annotations = useAnnotationStore((state) => state.annotationsByImage);
  return (
    <DeleteImageDialog
      target={{
        image: {
          path: target.asset.sourcePath,
          name: target.asset.sourcePath.split(/[\\/]/).pop() ?? "",
        },
        folderPath: target.folderPath,
        readyAt: target.readyAt,
      }}
      annotationCount={target.asset.images.reduce(
        (sum, image) => sum + (annotations[image.path]?.length ?? 0),
        0,
      )}
      isDeleting={busy}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
      allowCancelWhileBusy
      messages={{
        title: text.reextract,
        consequence: text.reextractConsequence(target.asset.images.length, target.interval),
        confirm: text.reextractConfirm,
        deleting: text.importing,
      }}
    />
  );
}
