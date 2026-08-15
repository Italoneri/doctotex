"use client";

import { useCallback, useMemo, useState } from "react";
import type { ConvertSuccess } from "@/app/api/convert/route";
import { formatBytes } from "@/lib/docx/upload";
import { PreviewPane } from "./PreviewPane";
import { SourcesPanel } from "./SourcesPanel";
import { StyleProfileReport } from "./StyleProfileReport";

interface ArchiveReportProps {
  readonly result: ConvertSuccess;
  readonly onReset: () => void;
}

type Sources = Readonly<Record<string, string>>;

export function ArchiveReport({ result, onReset }: ArchiveReportProps) {
  // Lifted out of the panel because the preview compiles what the reader is
  // looking at, not what the converter first produced.
  const [sources, setSources] = useState<Sources>(result.sources);

  const edit = useCallback((path: string, content: string) => {
    setSources((current) =>
      current[path] === content ? current : { ...current, [path]: content },
    );
  }, []);

  const revert = useCallback(
    () => setSources(result.sources),
    [result.sources],
  );

  const edited = useMemo(
    () => Object.keys(sources).some((k) => sources[k] !== result.sources[k]),
    [sources, result.sources],
  );

  return (
    <section className="space-y-8">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-medium text-zinc-900 dark:text-zinc-100">
            {result.filename}
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {formatBytes(result.sizeBytes)} &middot; {result.entries.length}{" "}
            parts in the package
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors duration-200 hover:border-zinc-400 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
        >
          Choose another
        </button>
      </header>

      <StyleProfileReport
        profile={result.profile}
        styleUsage={result.styleUsage}
      />

      <div className="grid gap-8 xl:grid-cols-2">
        <SourcesPanel
          filename={result.filename}
          sources={sources}
          onEdit={edit}
          onRevert={revert}
          edited={edited}
        />
        {/* The options the sources were generated with, not the ones the panel
            currently shows: the preview compiles what is on screen. */}
        <PreviewPane sources={sources} options={result.options} />
      </div>

      <details className="group rounded-xl border border-zinc-200 dark:border-zinc-800">
        <summary className="cursor-pointer px-4 py-3 text-xs font-medium tracking-wide text-zinc-500 uppercase transition-colors duration-200 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
          Package parts
        </summary>
        <ul className="max-h-72 overflow-y-auto border-t border-zinc-200 dark:border-zinc-800">
          {result.entries.map((entry) => (
            <li
              key={entry}
              className="px-4 py-1.5 font-mono text-xs text-zinc-700 dark:text-zinc-300"
            >
              {entry}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
