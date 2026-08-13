"use client";

import Editor, { loader, type Monaco } from "@monaco-editor/react";
import { useCallback, useSyncExternalStore } from "react";
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
