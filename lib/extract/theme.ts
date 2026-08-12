import { descend, attribute, parseXml } from "@/lib/docx/xml";
import type { ThemeFonts } from "./types";

/**
 * `w:rFonts` often names a theme slot instead of a typeface — `w:asciiTheme`
 * of `minorHAnsi` means "whatever theme1.xml calls the minor latin font".
 * Resolving those needs the theme in hand before any style is read.
 */
export function extractTheme(themeXml: string | undefined): ThemeFonts {
  if (!themeXml) {
    return {};
  }

  const scheme = descend(
    parseXml(themeXml),
    "a:theme",
    "a:themeElements",
    "a:fontScheme",
  );

  return {
    major: latinTypeface(scheme, "a:majorFont"),
    minor: latinTypeface(scheme, "a:minorFont"),
  };
}

function latinTypeface(
  scheme: ReturnType<typeof descend>,
  slot: string,
): string | undefined {
  const typeface = attribute(descend(scheme, slot, "a:latin"), "typeface");
  // An empty typeface is Word's way of saying "inherit the system default".
  return typeface && typeface.trim() !== "" ? typeface : undefined;
}

const MAJOR_SLOTS: ReadonlySet<string> = new Set([
  "majorHAnsi",
  "majorAscii",
  "majorBidi",
  "majorEastAsia",
]);

const MINOR_SLOTS: ReadonlySet<string> = new Set([
  "minorHAnsi",
  "minorAscii",
  "minorBidi",
  "minorEastAsia",
]);

/** Turns a `w:asciiTheme` slot name into the typeface the theme assigns it. */
export function resolveThemeFont(
  theme: ThemeFonts,
  slot: string | undefined,
): string | undefined {
  if (!slot) {
    return undefined;
  }
  if (MAJOR_SLOTS.has(slot)) {
    return theme.major;
  }
  if (MINOR_SLOTS.has(slot)) {
    return theme.minor;
  }
  return undefined;
}
