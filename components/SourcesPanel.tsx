"use client";

import { useCallback, useState } from "react";
import { LatexEditor } from "./LatexEditor";

interface SourcesPanelProps {
  readonly filename: string;
  readonly sources: Readonly<Record<string, string>>;
  readonly onEdit: (path: string, content: string) => void;
  readonly onRevert: () => void;
  readonly edited: boolean;
}

type DownloadState = "idle" | "packaging" | "failed";

export function SourcesPanel({
  filename,
  sources,
  onEdit,
  onRevert,
  edited,
}: SourcesPanelProps) {
  const names = Object.keys(sources);
  const [active, setActive] = useState(names[0] ?? "");
  const [state, setState] = useState<DownloadState>("idle");

  const download = useCallback(async () => {
    setState("packaging");
    try {
      const response = await fetch("/api/bundle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, sources }),
      });
      if (!response.ok) {
        setState("failed");
        return;
      }
      saveBlob(await response.blob(), zipName(filename));
      setState("idle");
    } catch {
      setState("failed");
    }
  }, [filename, sources]);

  const edit = useCallback(
    (content: string) => onEdit(active, content),
    [onEdit, active],
  );

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
          Generated LaTeX
        </h3>
        <div className="flex items-center gap-3">
          {edited && (
            <button
              type="button"
              onClick={onRevert}
              className="text-sm text-zinc-600 underline underline-offset-4 transition-colors duration-200 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Revert edits
            </button>
          )}
          <button
            type="button"
            onClick={download}
            disabled={state === "packaging"}
            className="rounded-full bg-violet-600 px-5 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-violet-500 disabled:opacity-60"
          >
            {state === "packaging" ? "Packaging…" : "Download .zip"}
          </button>
        </div>
      </div>

      {state === "failed" && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          Packaging failed. The sources below are still what would be sent.
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
        <div className="flex border-b border-zinc-200 dark:border-zinc-800">
          {names.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setActive(name)}
              className={[
                "px-4 py-2 font-mono text-xs transition-colors duration-200",
                name === active
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
              ].join(" ")}
            >
              {name}
            </button>
          ))}
        </div>
        <LatexEditor
          path={active}
          value={sources[active] ?? ""}
          onChange={edit}
        />
      </div>
    </section>
  );
}

function zipName(filename: string): string {
  return `${filename.replace(/\.docx$/i, "") || "doctotex"}.zip`;
}

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // Revoking immediately can cancel the download in some browsers; one frame
  // is enough for the click to have been taken.
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}
