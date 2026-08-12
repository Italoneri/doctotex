"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArchiveReport } from "@/components/ArchiveReport";
import { Dropzone } from "@/components/Dropzone";
import type { ConvertFailure, ConvertSuccess } from "@/app/api/convert/route";
import { describeRejection, rejectUpload } from "@/lib/docx/upload";

type UploadState =
  | { readonly status: "idle" }
  | { readonly status: "reading"; readonly filename: string }
  | { readonly status: "read"; readonly result: ConvertSuccess }
  | { readonly status: "failed"; readonly message: string };

export default function Home() {
  const [state, setState] = useState<UploadState>({ status: "idle" });
  const inFlight = useRef<AbortController>(null);

  // A new drop supersedes the previous request, and unmounting must not leave
  // a fetch running against a dead component.
  useEffect(() => () => inFlight.current?.abort(), []);

  const handleFile = useCallback(async (file: File) => {
    const rejection = rejectUpload(file);
    if (rejection) {
      setState({ status: "failed", message: describeRejection(rejection) });
      return;
    }

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setState({ status: "reading", filename: file.name });

    const body = new FormData();
    body.append("file", file);

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
      setState({ status: "read", result: payload });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setState({
        status: "failed",
        message: "Could not reach the converter. Is the dev server running?",
      });
    }
  }, []);

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-6 py-16 dark:bg-zinc-950 sm:py-24">
      <main className="w-full max-w-2xl space-y-10">
        <header className="space-y-3 text-center">
          <span className="inline-block rounded-full bg-violet-100 px-3 py-1 text-xs font-medium tracking-wide text-violet-800 uppercase dark:bg-violet-500/15 dark:text-violet-200">
            Phase 0
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
          <ArchiveReport result={state.result} onReset={reset} />
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
