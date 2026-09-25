import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Annotation, Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { LUA_LANGUAGE } from "../../lib/lua-language";
import { autocompletion, closeCompletion, completionKeymap } from "@codemirror/autocomplete";
import { tags } from "@lezer/highlight";
import { luaCompletions } from "../../lib/lua-completion";
import { SCRIPT_ZH_CN as text } from "../../i18n/script.zh-CN";

export interface LuaEditorHandle {
  closeCompletion: () => boolean;
}
export function closeFocusedLuaCompletion() {
  const focused = document.activeElement;
  const view = focused instanceof HTMLElement ? EditorView.findFromDOM(focused) : null;
  return view ? closeCompletion(view) : false;
}
const externalChange = Annotation.define<boolean>();

export const LuaEditor = forwardRef<
  LuaEditorHandle,
  {
    value: string;
    onChange: (source: string) => void;
    readOnly?: boolean;
    disabled?: boolean;
    dark?: boolean;
  }
>(function LuaEditor({ value, onChange, readOnly = false, disabled = false, dark = true }, ref) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView>();
  const config = useRef(new Compartment());
  const latest = useRef(onChange);
  latest.current = onChange;
  useImperativeHandle(
    ref,
    () => ({ closeCompletion: () => (editor.current ? closeCompletion(editor.current) : false) }),
    [],
  );
  useEffect(() => {
    const view = new EditorView({
      parent: container.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          LUA_LANGUAGE,
          EditorState.phrases.of(text.editorPhrases),
          autocompletion({ override: [luaCompletions], defaultKeymap: false }),
          keymap.of([...completionKeymap, ...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": text.editor,
            role: "textbox",
            "aria-multiline": "true",
          }),
          config.current.of([]),
          EditorView.updateListener.of((update) => {
            if (
              update.docChanged &&
              !update.transactions.some((transaction) => transaction.annotation(externalChange))
            )
              latest.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    editor.current = view;
    return () => {
      view.destroy();
      editor.current = undefined;
    };
    // External changes are synchronized below without recreating the undo history.
  }, []);
  useEffect(() => {
    const view = editor.current;
    if (view && value.replace(/\r\n?/g, "\n") !== view.state.doc.toString()) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        annotations: [externalChange.of(true), Transaction.addToHistory.of(false)],
      });
    }
  }, [value]);
  useEffect(() => {
    editor.current?.dispatch({
      effects: config.current.reconfigure([
        EditorState.readOnly.of(readOnly || disabled),
        EditorView.editable.of(!readOnly && !disabled),
        EditorView.contentAttributes.of({
          "aria-readonly": String(readOnly || disabled),
          "aria-disabled": String(disabled),
          tabindex: "0",
        }),
        EditorView.theme(
          {
            "&": {
              backgroundColor: dark ? "#020617" : "#fff",
              color: dark ? "#e2e8f0" : "#0f172a",
            },
            ".cm-scroller": { fontFamily: "monospace", overflow: "auto", maxHeight: "24rem" },
            ".cm-content": { minHeight: "16rem" },
            ".cm-gutters": {
              backgroundColor: dark ? "#0f172a" : "#f1f5f9",
              color: dark ? "#94a3b8" : "#475569",
            },
            ".cm-cursor": { borderLeftColor: dark ? "#fff" : "#000" },
          },
          { dark },
        ),
        syntaxHighlighting(
          HighlightStyle.define([
            { tag: tags.keyword, color: dark ? "#c4b5fd" : "#6d28d9" },
            { tag: tags.string, color: dark ? "#86efac" : "#166534" },
            { tag: tags.comment, color: dark ? "#94a3b8" : "#475569", fontStyle: "italic" },
            { tag: tags.number, color: dark ? "#fdba74" : "#9a3412" },
            { tag: tags.standard(tags.name), color: dark ? "#7dd3fc" : "#0369a1" },
          ]),
        ),
      ]),
    });
  }, [readOnly, disabled, dark]);
  return (
    <div ref={container} className="overflow-hidden rounded border border-slate-600 text-sm" />
  );
});
