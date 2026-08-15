"use client";

import type { ReactNode } from "react";
import {
  CITATION_LABELS,
  CITATION_STYLES,
  ENGINE_LABELS,
  ENGINES,
  type Bibliography,
  type CitationStyle,
  type GenerationOptions,
  type Layout,
} from "@/lib/latex/options";

interface ConfigPanelProps {
  readonly options: GenerationOptions;
  readonly onChange: (options: GenerationOptions) => void;
  readonly disabled: boolean;
}

const LAYOUTS: ReadonlyArray<readonly [Layout, string]> = [
  ["multi", "Class + main.tex"],
  ["single", "One main.tex"],
];

const BACKENDS: ReadonlyArray<readonly [Bibliography["backend"], string]> = [
  ["none", "None"],
  ["biblatex", "biblatex"],
  ["natbib", "natbib"],
];

export function ConfigPanel({ options, onChange, disabled }: ConfigPanelProps) {
  const { bibliography } = options;

  // A backend needs a style, so switching away from "none" has to carry one.
  // The first is as good a starting point as any; what matters is that the two
  // never travel apart.
  const chooseBackend = (backend: Bibliography["backend"]) => {
    if (backend === "none") {
      onChange({ ...options, bibliography: { backend } });
      return;
    }
    const style =
      bibliography.backend === "none" ? CITATION_STYLES[0] : bibliography.style;
    onChange({ ...options, bibliography: { backend, style } });
  };

  const chooseStyle = (style: CitationStyle) => {
    if (bibliography.backend === "none") {
      return;
    }
    onChange({
      ...options,
      bibliography: { backend: bibliography.backend, style },
    });
  };

  return (
    <section className="space-y-4 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
          Output settings
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Changing one regenerates the LaTeX, replacing any edits below.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Engine">
          <Choices
            values={ENGINES}
            selected={options.engine}
            label={(engine) => ENGINE_LABELS[engine]}
            onSelect={(engine) => onChange({ ...options, engine })}
            disabled={disabled}
          />
        </Field>

        <Field label="Bibliography">
          <Choices
            values={BACKENDS.map(([value]) => value)}
            selected={bibliography.backend}
            label={(backend) =>
              BACKENDS.find(([value]) => value === backend)?.[1] ?? backend
            }
            onSelect={chooseBackend}
            disabled={disabled}
          />
        </Field>

        <Field label="Citation style">
          <Choices
            values={CITATION_STYLES}
            selected={
              bibliography.backend === "none" ? undefined : bibliography.style
            }
            label={(style) => CITATION_LABELS[style]}
            onSelect={chooseStyle}
            disabled={disabled || bibliography.backend === "none"}
          />
        </Field>

        <Field label="Files">
          <Choices
            values={LAYOUTS.map(([value]) => value)}
            selected={options.layout}
            label={(layout) =>
              LAYOUTS.find(([value]) => value === layout)?.[1] ?? layout
            }
            onSelect={(layout) => onChange({ ...options, layout })}
            disabled={disabled}
          />
        </Field>
      </div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      {children}
    </div>
  );
}

function Choices<T extends string>({
  values,
  selected,
  label,
  onSelect,
  disabled,
}: {
  readonly values: readonly T[];
  readonly selected: T | undefined;
  readonly label: (value: T) => string;
  readonly onSelect: (value: T) => void;
  readonly disabled: boolean;
}) {
  return (
    <div
      role="radiogroup"
      className="flex flex-wrap gap-1.5 data-disabled:opacity-40"
      data-disabled={disabled || undefined}
    >
      {values.map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={value === selected}
          disabled={disabled}
          onClick={() => onSelect(value)}
          className={[
            "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-200",
            value === selected
              ? "border-violet-600 bg-violet-600 text-white"
              : "border-zinc-300 text-zinc-700 hover:border-zinc-400 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800",
            disabled ? "cursor-not-allowed" : "",
          ].join(" ")}
        >
          {label(value)}
        </button>
      ))}
    </div>
  );
}
