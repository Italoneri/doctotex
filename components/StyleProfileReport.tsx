import type {
  EffectiveStyle,
  HeadingStyle,
  LineSpacing,
  StyleProfile,
} from "@/lib/extract/types";
import { PageDiagram } from "./PageDiagram";

interface StyleProfileReportProps {
  readonly profile: StyleProfile;
  /** Paragraph count per style id, to tell declared apart from applied. */
  readonly styleUsage: Readonly<Record<string, number>>;
}

export function StyleProfileReport({
  profile,
  styleUsage,
}: StyleProfileReportProps) {
  const appliedHeadings = profile.headings.filter(
    (heading) => (styleUsage[heading.styleId] ?? 0) > 0,
  );
  return (
    <div className="space-y-8">
      <Section title="Page">
        <div className="flex flex-wrap items-start gap-6">
          <PageDiagram page={profile.page} />
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
            <Field label="Size">
              {mm(profile.page.widthMm)} &times; {mm(profile.page.heightMm)}
            </Field>
            <Field label="Orientation">{profile.page.orientation}</Field>
            <Field label="Margins">
              {mm(profile.page.margins.topMm)} top,{" "}
              {mm(profile.page.margins.bottomMm)} bottom,{" "}
              {mm(profile.page.margins.leftMm)} left,{" "}
              {mm(profile.page.margins.rightMm)} right
            </Field>
            <Field label="Header">{mm(profile.page.margins.headerMm)}</Field>
            <Field label="Footer">{mm(profile.page.margins.footerMm)}</Field>
          </dl>
        </div>
      </Section>

      <Section title="Body text">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <Field label="Font">
            {profile.defaults.text.fontFamily ?? <Undeclared />}
          </Field>
          <Field label="Size">
            {profile.defaults.text.fontSizePt !== undefined ? (
              pt(profile.defaults.text.fontSizePt)
            ) : (
              <Undeclared />
            )}
          </Field>
          <Field label="Line spacing">
            {describeSpacing(profile.defaults.paragraph.lineSpacing)}
          </Field>
          <Field label="Theme fonts">
            {[profile.theme.major, profile.theme.minor]
              .filter(Boolean)
              .join(" / ") || <Undeclared />}
          </Field>
        </dl>
      </Section>

      <Section title={headingsTitle(profile, appliedHeadings.length)}>
        {profile.headings.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            This document defines no heading styles.
          </p>
        ) : (
          <>
            {appliedHeadings.length === 0 && <UnusedHeadingsNotice />}
            <ul className="space-y-2">
              {profile.headings.map((heading) => (
                <HeadingRow
                  key={heading.styleId}
                  heading={heading}
                  uses={styleUsage[heading.styleId] ?? 0}
                />
              ))}
            </ul>
          </>
        )}
        {profile.title && (
          <TitleRow
            title={profile.title}
            uses={styleUsage[profile.title.styleId] ?? 0}
          />
        )}
      </Section>

      <Section title="Contains">
        <ul className="flex flex-wrap gap-2">
          {featureLabels(profile).map((label) => (
            <li
              key={label}
              className="rounded-full bg-violet-100 px-3 py-1 text-xs font-medium text-violet-800 dark:bg-violet-500/15 dark:text-violet-200"
            >
              {label}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function headingsTitle(profile: StyleProfile, applied: number): string {
  if (profile.headings.length === 0) {
    return "Headings";
  }
  return `Headings — ${profile.headings.length} declared, ${applied} in use`;
}

/**
 * The distinction matters more than it looks: a document can carry Word's whole
 * heading hierarchy and still have every visible heading typed as a bolded
 * normal paragraph, in which case the template genuinely has no sections.
 */
function UnusedHeadingsNotice() {
  return (
    <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-100">
      None of these styles is applied to any paragraph. Every heading in this
      document was formatted by hand, so the generated template has no sections
      — the class still defines them, ready to be applied.
    </p>
  );
}

function HeadingRow({
  heading,
  uses,
}: {
  readonly heading: HeadingStyle;
  readonly uses: number;
}) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <span className="rounded bg-zinc-900 px-2 py-0.5 font-mono text-xs text-white dark:bg-zinc-100 dark:text-zinc-900">
        H{heading.level}
      </span>
      <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
        {heading.styleId}
      </span>
      <span className="text-sm text-zinc-800 dark:text-zinc-200">
        {describeStyle(heading)}
      </span>
      <UsageBadge uses={uses} />
    </li>
  );
}

function TitleRow({
  title,
  uses,
}: {
  readonly title: EffectiveStyle;
  readonly uses: number;
}) {
  return (
    <p className="mt-2 flex flex-wrap items-baseline gap-x-3 rounded-lg border border-dashed border-zinc-200 px-3 py-2 text-sm text-zinc-800 dark:border-zinc-800 dark:text-zinc-200">
      <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
        Title
      </span>
      {describeStyle(title)}
      <UsageBadge uses={uses} />
    </p>
  );
}

function UsageBadge({ uses }: { readonly uses: number }) {
  if (uses === 0) {
    return (
      <span className="ml-auto rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
        unused
      </span>
    );
  }
  return (
    <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">
      {uses}&times;
    </span>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-zinc-900 dark:text-zinc-100">{children}</dd>
    </>
  );
}

/** Distinguishes "the document says nothing" from a value of zero or none. */
function Undeclared() {
  return (
    <span className="text-zinc-400 italic dark:text-zinc-500">
      not declared
    </span>
  );
}

function mm(value: number): string {
  return `${value} mm`;
}

function pt(value: number): string {
  return `${value} pt`;
}

function describeSpacing(spacing: LineSpacing | undefined): React.ReactNode {
  if (!spacing) {
    return <Undeclared />;
  }
  switch (spacing.kind) {
    case "multiple":
      return `${spacing.value}x`;
    case "exact":
      return `exactly ${pt(spacing.pt)}`;
    case "atLeast":
      return `at least ${pt(spacing.pt)}`;
  }
}

function describeStyle({ text, paragraph }: EffectiveStyle): string {
  const parts = [
    text.fontFamily,
    text.fontSizePt !== undefined ? pt(text.fontSizePt) : undefined,
    text.bold ? "bold" : undefined,
    text.italic ? "italic" : undefined,
    text.allCaps ? "caps" : undefined,
    paragraph.alignment && paragraph.alignment !== "left"
      ? paragraph.alignment
      : undefined,
    text.colorHex,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : "inherits everything";
}

function featureLabels(profile: StyleProfile): readonly string[] {
  const { features } = profile;
  return [
    features.tables && "tables",
    features.images && "images",
    features.ommlEquations && "equations (OMML)",
    features.oleObjects && "equations (legacy OLE)",
    features.headers && "header",
    features.footers && "footer",
    features.numbering && "lists",
  ].filter((label): label is string => typeof label === "string");
}
