import type { ConvertSuccess } from "@/app/api/convert/route";
import { formatBytes } from "@/lib/docx/upload";

/**
 * Parts the extraction pipeline will read in later phases. Surfacing which of
 * them a document actually carries turns the phase-0 echo into a useful signal
 * about what that document will exercise.
 */
const TRACKED_PARTS: ReadonlyArray<{ label: string; test: RegExp }> = [
  { label: "document", test: /^word\/document\.xml$/ },
  { label: "styles", test: /^word\/styles\.xml$/ },
  { label: "theme", test: /^word\/theme\/theme\d*\.xml$/ },
  { label: "settings", test: /^word\/settings\.xml$/ },
  { label: "numbering", test: /^word\/numbering\.xml$/ },
  { label: "headers", test: /^word\/header\d*\.xml$/ },
  { label: "footers", test: /^word\/footer\d*\.xml$/ },
  { label: "media", test: /^word\/media\// },
];

interface ArchiveReportProps {
  readonly result: ConvertSuccess;
  readonly onReset: () => void;
}

export function ArchiveReport({ result, onReset }: ArchiveReportProps) {
  const found = TRACKED_PARTS.filter(({ test }) =>
    result.entries.some((entry) => test.test(entry)),
  );

  return (
    <section className="space-y-6">
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

      <ul className="flex flex-wrap gap-2">
        {found.map(({ label }) => (
          <li
            key={label}
            className="rounded-full bg-violet-100 px-3 py-1 text-xs font-medium text-violet-800 dark:bg-violet-500/15 dark:text-violet-200"
          >
            {label}
          </li>
        ))}
      </ul>

      <div className="max-h-80 overflow-y-auto rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {result.entries.map((entry) => (
            <li
              key={entry}
              className="px-4 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300"
            >
              {entry}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
