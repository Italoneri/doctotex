"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PreviewFailure } from "@/app/api/preview/route";
import { ENGINE_LABELS, type GenerationOptions } from "@/lib/latex/options";

/** Long enough that a burst of typing costs one container, not twenty. */
const DEBOUNCE_MS = 1200;

type PreviewOutcome =
  | { readonly status: "compiling" }
  | { readonly status: "ready"; readonly url: string }
  | { readonly status: "rejected"; readonly log: string }
  | { readonly status: "unavailable"; readonly message: string };

/**
 * An outcome and the engine that produced it, never the engine currently
 * selected.
 *
 * A settings change leaves the previous report on screen while the new one is
 * generated, so those two are different for as long as that takes. Reading the
 * label off the selection made a XeLaTeX failure carry pdfLaTeX's name — which
 * sends the reader to the wrong preamble, and is the sort of wrong that costs
 * an afternoon.
 */
type PreviewState = PreviewOutcome & { readonly engine: string };

type Sources = Readonly<Record<string, string>>;

interface PreviewPaneProps {
  readonly sources: Sources;
  /** Sent with every compile: the engine resolves \includegraphics against them. */
  readonly assets: Sources;
  readonly options: GenerationOptions;
  /** Set while a settings change is being converted, so this pane is behind. */
  readonly regenerating?: boolean;
}

export function PreviewPane({
  sources,
  assets,
  options,
  regenerating = false,
}: PreviewPaneProps) {
  const [state, setState] = useState<PreviewState>({
    status: "compiling",
    engine: ENGINE_LABELS[options.engine],
  });
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

        setState({
          status: "compiling",
          engine: ENGINE_LABELS[options.engine],
        });
        const next = await requestPreview(snapshot, assets, options);

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
  }, [assets, options]);

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
        <Status
          state={state}
          stale={renderedFrom !== sources}
          regenerating={regenerating}
        />
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
  regenerating,
}: {
  readonly state: PreviewState;
  readonly stale: boolean;
  readonly regenerating: boolean;
}) {
  if (state.status === "compiling") {
    return (
      <span role="status" className="text-sm text-zinc-500 dark:text-zinc-400">
        Running {state.engine}&hellip;
      </span>
    );
  }
  // Said before staleness, because it is the stronger claim: the settings the
  // panel now shows are not the settings this preview was built with, and
  // saying only "matches the sources above" would invite reading it as current.
  if (regenerating) {
    return (
      <span className="text-sm text-amber-700 dark:text-amber-300">
        Built with the previous settings &mdash; regenerating
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
    const log = tail(state.log).trim();
    return (
      <div>
        <p className="border-b border-zinc-200 px-4 py-3 text-sm text-red-700 dark:border-zinc-800 dark:text-red-300">
          {state.engine} rejected the document.{log ? " The log says:" : ""}
        </p>
        {log ? (
          <pre className="max-h-80 overflow-auto bg-zinc-50 p-4 font-mono text-xs leading-relaxed text-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-200">
            {log}
          </pre>
        ) : (
          // An empty log is not an empty error. The engine ended without
          // writing one, so say that rather than showing a blank box the
          // reader would read as a rendering fault.
          <p className="px-4 py-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
            It produced no PDF and wrote no log, so there is nothing to quote.
          </p>
        )}
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

async function requestPreview(
  sources: Sources,
  assets: Sources,
  options: GenerationOptions,
): Promise<PreviewState> {
  // Read here rather than at the call site: the engine that ran is a property
  // of the request, and taking it from anywhere else is what let the two drift.
  const engine = ENGINE_LABELS[options.engine];

  let response: Response;
  try {
    response = await fetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources, assets, options }),
    });
  } catch {
    return {
      status: "unavailable",
      message: "Could not reach the compiler. Is the dev server running?",
      engine,
    };
  }

  if (response.ok) {
    return {
      status: "ready",
      url: URL.createObjectURL(await response.blob()),
      engine,
    };
  }

  const failure: PreviewFailure = await response.json();
  if (failure.reason === "rejected") {
    return { status: "rejected", log: failure.log, engine };
  }
  return { status: "unavailable", message: failure.error, engine };
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
