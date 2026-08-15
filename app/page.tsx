"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArchiveReport } from "@/components/ArchiveReport";
import { ConfigPanel } from "@/components/ConfigPanel";
import { Dropzone } from "@/components/Dropzone";
import type { ConvertFailure, ConvertSuccess } from "@/app/api/convert/route";
import { describeRejection, rejectUpload } from "@/lib/docx/upload";
import { DEFAULT_OPTIONS, type GenerationOptions } from "@/lib/latex/options";

type UploadState =
  | { readonly status: "idle" }
  | { readonly status: "reading"; readonly filename: string }
  | {
      readonly status: "read";
      readonly result: ConvertSuccess;
      /**
       * Bumped once per conversion. The report owns the reader's edits, and a
       * fresh set of sources has to arrive as a fresh report rather than as new
       * props over state that was seeded from the old ones.
       */
      readonly revision: number;
      /** A regeneration is in flight; what is on screen is the previous one. */
      readonly pending: boolean;
    }
  | { readonly status: "failed"; readonly message: string };

export default function Home() {
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const [options, setOptions] = useState<GenerationOptions>(DEFAULT_OPTIONS);
  // Kept so a settings change can be answered without asking for the file
  // again; the browser already has the bytes.
  const [file, setFile] = useState<File>();
  const inFlight = useRef<AbortController>(null);
  const revision = useRef(0);

  // A new drop supersedes the previous request, and unmounting must not leave
  // a fetch running against a dead component.
  useEffect(() => () => inFlight.current?.abort(), []);

  const convert = useCallback(
    async (source: File, selection: GenerationOptions) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      // A settings change leaves the previous report up. Blanking the screen
      // for a regeneration would make a small change look like a reload.
      setState((current) =>
        current.status === "read"
          ? { ...current, pending: true }
          : { status: "reading", filename: source.name },
      );

      const body = new FormData();
      body.append("file", source);
      body.append("options", JSON.stringify(selection));

      try {
        const response = await fetch("/api/convert", {
          method: "POST",
          body,
          signal: controller.signal,
        });
        const payload: ConvertSuccess | ConvertFailure = await response.json();

        if (!payload.ok) {
          setState({ status: "failed", message: payload.error });
          return;
        }
        revision.current += 1;
        setState({
          status: "read",
          result: payload,
          revision: revision.current,
          pending: false,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setState({
          status: "failed",
          message: "Could not reach the converter. Is the dev server running?",
        });
      }
    },
    [],
  );

  const handleFile = useCallback(
    async (dropped: File) => {
      const rejection = rejectUpload(dropped);
      if (rejection) {
        setState({ status: "failed", message: describeRejection(rejection) });
        return;
      }
      setFile(dropped);
      await convert(dropped, options);
    },
    [convert, options],
  );

  const changeOptions = useCallback(
    (next: GenerationOptions) => {
      setOptions(next);
      if (file) {
        void convert(file, next);
      }
    },
    [convert, file],
  );

  const reset = useCallback(() => {
    setFile(undefined);
    setState({ status: "idle" });
  }, []);

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-6 py-16 dark:bg-zinc-950 sm:py-24">
      <main
        className={[
          "w-full space-y-10 transition-[max-width] duration-300",
          // The editor and its preview sit side by side, which needs the room.
          state.status === "read" ? "max-w-7xl" : "max-w-3xl",
        ].join(" ")}
      >
        <header className="space-y-3 text-center">
          <span className="inline-block rounded-full bg-violet-100 px-3 py-1 text-xs font-medium tracking-wide text-violet-800 uppercase dark:bg-violet-500/15 dark:text-violet-200">
            Phase 4
          </span>
          <h1 className="font-serif text-5xl tracking-tight text-zinc-900 dark:text-zinc-50">
            DocToTex
          </h1>
          <p className="mx-auto max-w-md text-zinc-600 dark:text-zinc-400">
            Turn a Word document into a LaTeX template that keeps its margins,
            typography and heading hierarchy.
          </p>
        </header>

        {state.status === "read" ? (
          <>
            <ConfigPanel
              options={options}
              onChange={changeOptions}
              disabled={state.pending}
            />
            {/* The report is seeded from the sources it is given, so a new set
                arrives as a new report rather than as props it would ignore. */}
            <ArchiveReport
              key={state.revision}
              result={state.result}
              onReset={reset}
            />
          </>
        ) : (
          <Dropzone onFile={handleFile} disabled={state.status === "reading"} />
        )}

        {state.status === "reading" && (
          <p
            role="status"
            className="text-center text-sm text-zinc-500 dark:text-zinc-400"
          >
            Reading {state.filename}&hellip;
          </p>
        )}

        {state.status === "failed" && (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
          >
            {state.message}
          </p>
        )}
      </main>
    </div>
  );
}
