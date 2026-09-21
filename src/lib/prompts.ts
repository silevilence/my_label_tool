import { create } from "zustand";
import { PROMPTS_ZH_CN as text } from "../i18n/prompts.zh-CN";

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 破坏性操作：确认按钮使用危险配色（见「破坏性操作确认分级」任务）。 */
  danger?: boolean;
}

export interface PromptOptions {
  title: string;
  message?: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
}

export interface ConfirmRequest extends ConfirmOptions {
  resolve: (value: boolean) => void;
}
export interface PromptRequest extends PromptOptions {
  resolve: (value: string | null) => void;
}

interface PromptStore {
  confirmQueue: ConfirmRequest[];
  promptQueue: PromptRequest[];
  requestConfirm: (options: ConfirmOptions) => Promise<boolean>;
  requestPrompt: (options: PromptOptions) => Promise<string | null>;
  settleConfirm: (value: boolean) => void;
  settlePrompt: (value: string | null) => void;
}

// 同类请求 FIFO 排队，宿主每次只显示队首一个；Esc/取消解析为 false/null。
export const usePromptStore = create<PromptStore>((set) => ({
  confirmQueue: [],
  promptQueue: [],
  requestConfirm: (options) => {
    return new Promise<boolean>((resolve) => {
      set((state) => ({ confirmQueue: [...state.confirmQueue, { ...options, resolve }] }));
    });
  },
  requestPrompt: (options) => {
    return new Promise<string | null>((resolve) => {
      set((state) => ({ promptQueue: [...state.promptQueue, { ...options, resolve }] }));
    });
  },
  settleConfirm: (value) =>
    set((state) => {
      const [head, ...rest] = state.confirmQueue;
      head?.resolve(value);
      return { confirmQueue: rest };
    }),
  settlePrompt: (value) =>
    set((state) => {
      const [head, ...rest] = state.promptQueue;
      head?.resolve(value);
      return { promptQueue: rest };
    }),
}));

// 原生 window.confirm / Tauri confirm 的应用内替代；宿主挂载 PromptHost 后任意模块可用。
export function confirmAction(
  message: string,
  options: { danger?: boolean; confirmLabel?: string } = {},
): Promise<boolean> {
  return usePromptStore.getState().requestConfirm({
    title: text.confirmTitle,
    message,
    danger: options.danger,
    confirmLabel: options.confirmLabel,
  });
}

// 原生 window.prompt 的应用内替代；取消解析为 null，提交值已 trim。
export function promptText(title: string, initial = ""): Promise<string | null> {
  return usePromptStore.getState().requestPrompt({ title, initial });
}
