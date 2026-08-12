import type { PageGeometry } from "@/lib/extract/types";

/** Longest side of the drawing, in px; the short side follows the real ratio. */
const LONG_EDGE = 150;

interface PageDiagramProps {
  readonly page: PageGeometry;
}

/**
 * Draws the page and its text block to scale. Four margin numbers in a table
 * are hard to picture; the same numbers as a shape are read at a glance, and a
 * margin the extractor got wrong is obvious immediately.
 */
export function PageDiagram({ page }: PageDiagramProps) {
  const { widthMm, heightMm, margins } = page;
  const scale = LONG_EDGE / Math.max(widthMm, heightMm);
  const width = widthMm * scale;
  const height = heightMm * scale;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={`Page ${widthMm} by ${heightMm} millimetres with ${margins.topMm} millimetre top margin`}
      className="shrink-0 rounded-sm shadow-sm"
    >
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        className="fill-white stroke-zinc-300 dark:fill-zinc-200 dark:stroke-zinc-600"
        strokeWidth={1}
      />
      <rect
        x={margins.leftMm * scale}
        y={margins.topMm * scale}
        width={Math.max(0, widthMm - margins.leftMm - margins.rightMm) * scale}
        height={
          Math.max(0, heightMm - margins.topMm - margins.bottomMm) * scale
        }
        className="fill-violet-500/15 stroke-violet-500"
        strokeWidth={1}
        strokeDasharray="3 2"
      />
    </svg>
  );
}
