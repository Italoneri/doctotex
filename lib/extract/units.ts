/**
 * OOXML measures the same document in four different units. Everything below
 * converts into mm or pt at the boundary so no raw twip ever reaches the LaTeX
 * generator.
 */

const TWIPS_PER_INCH = 1440;
const TWIPS_PER_POINT = 20;
const MM_PER_INCH = 25.4;

/** `w:line` at `w:lineRule="auto"`: 240 twips is single spacing. */
const TWIPS_PER_SINGLE_LINE = 240;

/** Two decimals is finer than any printer resolves, and kills float noise. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function twipsToMm(twips: number): number {
  return round((twips / TWIPS_PER_INCH) * MM_PER_INCH);
}

export function twipsToPt(twips: number): number {
  return round(twips / TWIPS_PER_POINT);
}

/** `w:sz` and `w:szCs` are in half-points: `<w:sz w:val="24"/>` is 12pt. */
export function halfPointsToPt(halfPoints: number): number {
  return round(halfPoints / 2);
}

/** Turns `w:line` into the multiplier LaTeX's `setspace` wants. */
export function lineToMultiplier(line: number): number {
  return round(line / TWIPS_PER_SINGLE_LINE);
}

/**
 * OOXML attribute values are strings, and absent is meaningfully different from
 * zero — an omitted `w:spacing` inherits, a `w:spacing` of 0 overrides to none.
 */
export function toInteger(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * `w:val` on a toggle property (`w:b`, `w:i`) may be absent, which means on.
 * Word writes `0`, `false` or `off` to turn one back off in a derived style.
 */
export function toToggle(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  const text = String(value).toLowerCase();
  return text !== "0" && text !== "false" && text !== "off";
}

const HEX_COLOR = /^[0-9a-f]{6}$/i;

/**
 * `w:val="auto"` means "pick a readable colour against the background", which
 * is an instruction rather than a value — it must inherit, not become black.
 */
export function toColorHex(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.trim().replace(/^#/, "");
  return HEX_COLOR.test(text) ? `#${text.toUpperCase()}` : undefined;
}
