import type { MutableRefObject, ReactNode } from "react";
import { Label as KonvaLabel, Rect, Tag, Text } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Rect as KonvaRect } from "konva/lib/shapes/Rect";
import type { AnnotationShape, LabelConfig } from "../../types/annotation";
import { toCanvasRect } from "./geometry";
import { INTERACTION_MODE_HELP, type ImageLayout, type InteractionMode } from "./types";

interface DeleteAnnotationDialogProps {
  labelName: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ModeHelpOverlay({ mode }: { mode: InteractionMode }) {
  const help = INTERACTION_MODE_HELP[mode];

  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-xs rounded-lg border border-slate-700/70 bg-slate-950/75 px-3 py-2 text-xs leading-5 text-slate-200 shadow-lg">
      <div className="font-medium text-sky-200">{help.title}</div>
      {help.tips.map((tip) => (
        <div key={tip}>{tip}</div>
      ))}
    </div>
  );
}

export function DeleteAnnotationDialog({
  labelName,
  onCancel,
  onConfirm,
}: DeleteAnnotationDialogProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 px-4">
      <section className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <h2 className="text-base font-semibold text-slate-100">确认删除标注？</h2>
        <p className="mt-2 text-sm text-slate-400">将删除「{labelName}」标注，可用 Ctrl+Z 撤销。</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
            type="button"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            className="rounded bg-red-500 px-3 py-2 text-sm font-medium text-white hover:bg-red-400"
            type="button"
            onClick={onConfirm}
          >
            删除
          </button>
        </div>
      </section>
    </div>
  );
}

interface CanvasContextMenuProps {
  annotation: AnnotationShape | null;
  canNextImage: boolean;
  canNextUnannotatedImage: boolean;
  canPreviousImage: boolean;
  canPreviousUnannotatedImage: boolean;
  labels: LabelConfig[];
  x: number;
  y: number;
  onChangeLabel: (annotationId: string, labelId: string) => void;
  onDeleteAnnotation: (annotation: AnnotationShape) => void;
  onFitHeight: () => void;
  onFitWidth: () => void;
  onNextImage: () => void;
  onNextUnannotatedImage: () => void;
  onOriginalSize: () => void;
  onPreviousImage: () => void;
  onPreviousUnannotatedImage: () => void;
  onResetZoom: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export function CanvasContextMenu({
  annotation,
  canNextImage,
  canNextUnannotatedImage,
  canPreviousImage,
  canPreviousUnannotatedImage,
  labels,
  x,
  y,
  onChangeLabel,
  onDeleteAnnotation,
  onFitHeight,
  onFitWidth,
  onNextImage,
  onNextUnannotatedImage,
  onOriginalSize,
  onPreviousImage,
  onPreviousUnannotatedImage,
  onResetZoom,
  onZoomIn,
  onZoomOut,
}: CanvasContextMenuProps) {
  const openSubmenusUp = y > window.innerHeight / 2;

  return (
    <div
      className="fixed z-50 max-h-[calc(100vh-1rem)] w-44 overflow-visible rounded-lg border border-slate-700 bg-slate-900 py-1 text-sm text-slate-100 shadow-2xl"
      data-context-menu="true"
      style={{ left: x, top: y }}
    >
      <ContextMenuGroup title="缩放操作">
        <ContextMenuButton onClick={onZoomIn}>放大</ContextMenuButton>
        <ContextMenuButton onClick={onZoomOut}>缩小</ContextMenuButton>
        <ContextSubMenu label="更多缩放" openUp={openSubmenusUp}>
          <ContextMenuButton onClick={onFitWidth}>适应宽度</ContextMenuButton>
          <ContextMenuButton onClick={onFitHeight}>适应高度</ContextMenuButton>
          <ContextMenuButton onClick={onOriginalSize}>原图大小</ContextMenuButton>
          <ContextMenuButton onClick={onResetZoom}>重置缩放</ContextMenuButton>
        </ContextSubMenu>
      </ContextMenuGroup>

      <ContextMenuGroup title="图片操作">
        <ContextSubMenu label="跳转" openUp={openSubmenusUp}>
          <ContextMenuButton disabled={!canPreviousImage} onClick={onPreviousImage}>
            上一张
          </ContextMenuButton>
          <ContextMenuButton disabled={!canNextImage} onClick={onNextImage}>
            下一张
          </ContextMenuButton>
          <ContextMenuButton
            disabled={!canPreviousUnannotatedImage}
            onClick={onPreviousUnannotatedImage}
          >
            上个未标注
          </ContextMenuButton>
          <ContextMenuButton disabled={!canNextUnannotatedImage} onClick={onNextUnannotatedImage}>
            下个未标注
          </ContextMenuButton>
        </ContextSubMenu>
      </ContextMenuGroup>

      {annotation && (
        <ContextMenuGroup title="标签操作">
          <ContextSubMenu label="修改" openUp={openSubmenusUp}>
            <div className="max-h-72 overflow-y-auto py-1">
              {labels.map((label) => (
                <button
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-800 ${
                    label.id === annotation.labelId ? "text-sky-300" : ""
                  }`}
                  key={label.id}
                  type="button"
                  onClick={() => onChangeLabel(annotation.id, label.id)}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: label.color }}
                  />
                  <span className="truncate">{label.name}</span>
                </button>
              ))}
            </div>
          </ContextSubMenu>
          <ContextMenuButton danger onClick={() => onDeleteAnnotation(annotation)}>
            删除
          </ContextMenuButton>
        </ContextMenuGroup>
      )}
    </div>
  );
}

interface ContextMenuGroupProps {
  children: ReactNode;
  title: string;
}

interface ContextSubMenuProps {
  children: ReactNode;
  label: string;
  openUp: boolean;
}

function ContextSubMenu({ children, label, openUp }: ContextSubMenuProps) {
  return (
    <div className="group relative">
      <button
        className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-slate-800"
        type="button"
      >
        <span>{label}</span>
        <span className="text-slate-500">›</span>
      </button>
      <div
        className={`invisible absolute left-full w-40 rounded-lg border border-slate-700 bg-slate-900 py-1 opacity-0 shadow-2xl group-hover:visible group-hover:opacity-100 ${
          openUp ? "bottom-0" : "top-0"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function ContextMenuGroup({ children, title }: ContextMenuGroupProps) {
  return (
    <div className="border-b border-slate-800 py-1 last:border-b-0">
      <div className="px-3 py-1 text-xs text-slate-500">{title}</div>
      {children}
    </div>
  );
}

interface ContextMenuButtonProps {
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function ContextMenuButton({
  children,
  danger = false,
  disabled = false,
  onClick,
}: ContextMenuButtonProps) {
  return (
    <button
      className={`block w-full px-3 py-1.5 text-left hover:bg-slate-800 disabled:cursor-not-allowed disabled:text-slate-600 ${
        danger ? "text-red-300 hover:bg-red-500 hover:text-white" : ""
      }`}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

interface AnnotationRectProps {
  annotation: AnnotationShape;
  imageLayout: ImageLayout;
  interactionMode: InteractionMode;
  isHighlighted: boolean;
  isPanning: boolean;
  isSelected: boolean;
  label: LabelConfig;
  rectRef: MutableRefObject<KonvaRect | null>;
  showLabel: boolean;
  onContextMenu: (event: KonvaEventObject<MouseEvent>, annotationId: string) => void;
  onDragEnd: (annotation: AnnotationShape, event: KonvaEventObject<DragEvent>) => void;
  onPanStart: (event: KonvaEventObject<MouseEvent>) => void;
  onSelect: (annotationId: string) => void;
  onTransformEnd: (annotation: AnnotationShape) => void;
}

export function AnnotationRect({
  annotation,
  imageLayout,
  interactionMode,
  isHighlighted,
  isPanning,
  isSelected,
  label,
  rectRef,
  showLabel,
  onContextMenu,
  onDragEnd,
  onPanStart,
  onSelect,
  onTransformEnd,
}: AnnotationRectProps) {
  const rect = toCanvasRect(annotation.points, imageLayout);

  return (
    <>
      <Rect
        {...rect}
        ref={(node) => {
          if (isSelected) {
            rectRef.current = node;
          }
        }}
        fill={`${label.color}22`}
        shadowBlur={isHighlighted ? 10 : 0}
        shadowColor="#facc15"
        perfectDrawEnabled={false}
        shadowForStrokeEnabled={false}
        stroke={isHighlighted ? "#facc15" : label.color}
        strokeWidth={isHighlighted || isSelected ? 3 : 2}
        draggable={!isPanning && interactionMode === "default"}
        onClick={(event) => {
          if (interactionMode !== "default" || event.evt.ctrlKey || event.evt.shiftKey) {
            return;
          }
          onSelect(annotation.id);
        }}
        onContextMenu={(event) => {
          event.cancelBubble = true;
          onContextMenu(event, annotation.id);
        }}
        onDragEnd={(event) => onDragEnd(annotation, event)}
        onMouseDown={(event) => {
          if (event.evt.button === 1) {
            event.evt.preventDefault();
            event.cancelBubble = true;
            return;
          }
          if (event.evt.button === 2 && event.evt.ctrlKey) {
            event.cancelBubble = true;
            onPanStart(event);
            return;
          }
          if (event.evt.button !== 0) {
            return;
          }
          if (event.evt.ctrlKey || event.evt.shiftKey) {
            return;
          }
          event.cancelBubble = true;
          onSelect(annotation.id);
        }}
        onTransformEnd={() => onTransformEnd(annotation)}
      />
      {showLabel && (
        <KonvaLabel
          listening={false}
          x={rect.x}
          y={Math.max(imageLayout.y, rect.y - 22)}
        >
          <Tag fill={`${label.color}dd`} cornerRadius={4} />
          <Text fill="#ffffff" fontSize={12} padding={4} text={label.name} />
        </KonvaLabel>
      )}
    </>
  );
}
