"use client";

import Editor, {
  loader,
  type Monaco,
  type OnMount,
} from "@monaco-editor/react";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { editor } from "monaco-editor";
import {
  LATEX_LANGUAGE_ID,
  latexConfiguration,
  latexTokens,
} from "@/lib/editor/latex-language";

/**
 * Serve the editor from this origin instead of the default CDN, so an offline
 * machine still gets one and no third party sits in the path of the session.
 * `scripts/vendor-monaco.mjs` puts the files there on install.
 */
loader.config({ paths: { vs: "/monaco/vs" } });

const DARK = "(prefers-color-scheme: dark)";

interface LatexEditorProps {
  readonly path: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}

export function LatexEditor({ path, value, onChange }: LatexEditorProps) {
  const dark = usePrefersDark();
  const editorRef = useRef<editor.IStandaloneCodeEditor>(null);

  // Monaco reaches its model asynchronously, so the first alignment happens
  // when it arrives rather than when this component first renders.
  const mount = useCallback<OnMount>(
    (instance) => {
      editorRef.current = instance;
      align(instance, value);
    },
    [value],
  );

  useEffect(() => {
    const instance = editorRef.current;
    if (instance) {
      align(instance, value);
    }
  }, [value, path]);

  const register = useCallback((monaco: Monaco) => {
    const known = monaco.languages
      .getLanguages()
      .some((language: { id: string }) => language.id === LATEX_LANGUAGE_ID);
    if (known) {
      return;
    }
    monaco.languages.register({ id: LATEX_LANGUAGE_ID });
    monaco.languages.setMonarchTokensProvider(LATEX_LANGUAGE_ID, latexTokens);
    monaco.languages.setLanguageConfiguration(
      LATEX_LANGUAGE_ID,
      latexConfiguration,
    );
  }, []);

  const handleChange = useCallback(
    (next: string | undefined) => onChange(next ?? ""),
    [onChange],
  );

  return (
    <Editor
      // Keyed by path so each file keeps its own undo history and cursor.
      path={path}
      value={value}
      language={LATEX_LANGUAGE_ID}
      theme={dark ? "vs-dark" : "vs"}
      beforeMount={register}
      onMount={mount}
      onChange={handleChange}
      height="26rem"
      loading={
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          Loading editor&hellip;
        </span>
      }
      options={{
        fontSize: 13,
        fontFamily: "var(--font-mono), monospace",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: "on",
        renderLineHighlight: "none",
        automaticLayout: true,
        padding: { top: 12, bottom: 12 },
      }}
    />
  );
}

/**
 * Monaco owns a model per path and treats that model, not the prop, as the
 * text. Keeping the prop out of it is what stops a keystroke being echoed back
 * over the cursor — and it is also why a model that outlives the component it
 * was created for reappears carrying the previous file. Reverting an edit and
 * regenerating from new settings both replace the text from outside the editor,
 * so both have to be said out loud.
 */
function align(instance: editor.IStandaloneCodeEditor, value: string): void {
  const model = instance.getModel();
  if (model && model.getValue() !== value) {
    model.setValue(value);
  }
}

/**
 * The colour scheme lives outside React, so it is subscribed to rather than
 * mirrored into state. The server has no media query to read and reports light;
 * the first client render corrects it.
 */
function usePrefersDark(): boolean {
  return useSyncExternalStore(subscribeToScheme, readScheme, () => false);
}

function subscribeToScheme(onChange: () => void): () => void {
  const query = window.matchMedia(DARK);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function readScheme(): boolean {
  return window.matchMedia(DARK).matches;
}
