"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PreviewFailure } from "@/app/api/preview/route";

/** Long enough that a burst of typing costs one container, not twenty. */
const DEBOUNCE_MS = 1200;

type PreviewState =
  | { readonly status: "compiling" }
  | { readonly status: "ready"; readonly url: string }
  | { readonly status: "rejected"; readonly log: string }
  | { readonly status: "unavailable"; readonly message: string };

type Sources = Readonly<Record<string, string>>;

interface PreviewPaneProps {
  readonly sources: Sources;
}

export function PreviewPane({ sources }: PreviewPaneProps) {
  const [state, setState] = useState<PreviewState>({ status: "compiling" });
  // What the visible preview was built from. Comparing it to the current
  // sources is what "stale" means, so it is derived rather than tracked
  // separately and kept in step by hand.
  const [renderedFrom, setRenderedFrom] = useState<Sources>();

  // The container keeps running whatever the browser does, so a second request
  // sent mid-compile buys nothing and costs a container. One runs at a time and
  // the newest sources win: `latest` is what the next lap will read.
  const latest = useRef(sources);
  const busy = useRef(false);
  const queued = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    if (busy.current) {
      queued.current = true;
      return;
    }

    busy.current = true;
    try {
      do {
        queued.current = false;
        const snapshot = latest.current;

        setState({ status: "compiling" });
        const next = await requestPreview(snapshot);

        if (!alive.current) {
          revoke(next);
          return;
        }
        setState(next);
        setRenderedFrom(snapshot);
      } while (queued.current);
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    latest.current = sources;

    const timer = setTimeout(run, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [sources, run]);

  // Releasing the previous object URL belongs here rather than in the setter:
  // a state updater must stay pure, and this fires on both replacement and
  // unmount, which are the two moments a URL stops being displayed.
  useEffect(() => () => revoke(state), [state]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
          Compiled preview
        </h3>
        <Status state={state} stale={renderedFrom !== sources} />
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <Body state={state} />
      </div>
    </section>
  );
}

function Status({
  state,
  stale,
}: {
  readonly state: PreviewState;
  readonly stale: boolean;
}) {
  if (state.status === "compiling") {
    return (
      <span role="status" className="text-sm text-zinc-500 dark:text-zinc-400">
        Running pdfLaTeX&hellip;
      </span>
    );
  }
  if (stale) {
    return (
      <span className="text-sm text-amber-700 dark:text-amber-300">
        Edited &mdash; recompiling shortly
      </span>
    );
  }
  return (
    <span className="text-sm text-zinc-500 dark:text-zinc-400">
      Matches the sources above
    </span>
  );
}

function Body({ state }: { readonly state: PreviewState }) {
  if (state.status === "ready") {
    return (
      <object
        data={state.url}
        type="application/pdf"
        title="Compiled PDF"
        className="h-[36rem] w-full bg-zinc-100 dark:bg-zinc-900"
      >
        <p className="p-4 text-sm text-zinc-600 dark:text-zinc-400">
          This browser will not display the PDF inline.{" "}
          <a
            href={state.url}
            className="text-violet-700 underline dark:text-violet-300"
          >
            Open it in a new tab
          </a>
          .
        </p>
      </object>
    );
  }

  if (state.status === "rejected") {
    return (
      <div>
        <p className="border-b border-zinc-200 px-4 py-3 text-sm text-red-700 dark:border-zinc-800 dark:text-red-300">
          pdfLaTeX rejected the document. The log says:
        </p>
        <pre className="max-h-80 overflow-auto bg-zinc-50 p-4 font-mono text-xs leading-relaxed text-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-200">
          {tail(state.log)}
        </pre>
      </div>
    );
  }

  if (state.status === "unavailable") {
    return (
      <p className="px-4 py-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
        {state.message}
      </p>
    );
  }

  return (
    <div className="h-[36rem] animate-pulse bg-zinc-100 dark:bg-zinc-900" />
  );
}

async function requestPreview(sources: Sources): Promise<PreviewState> {
  let response: Response;
  try {
    response = await fetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources }),
    });
  } catch {
    return {
      status: "unavailable",
      message: "Could not reach the compiler. Is the dev server running?",
    };
  }

  if (response.ok) {
    return { status: "ready", url: URL.createObjectURL(await response.blob()) };
  }

  const failure: PreviewFailure = await response.json();
  if (failure.reason === "rejected") {
    return { status: "rejected", log: failure.log };
  }
  return { status: "unavailable", message: failure.error };
}

function revoke(state: PreviewState): void {
  if (state.status === "ready") {
    URL.revokeObjectURL(state.url);
  }
}

/** The interesting part of a TeX log is always at the end. */
function tail(log: string): string {
  const lines = log.split("\n");
  return lines.length > 60 ? lines.slice(-60).join("\n") : log;
}
