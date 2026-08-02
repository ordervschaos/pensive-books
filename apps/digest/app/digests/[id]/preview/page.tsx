import { Suspense } from "react";
import { notFound } from "next/navigation";
import { previewStream, previewClosersAndIntro, type PreviewStream } from "@/lib/digest/build";
import { markdownToHtml, issueStyles, isVerbatimSection } from "@/lib/digest/render";
import type { RenderedSection } from "@/lib/digest/types";

export const dynamic = "force-dynamic";

// The live, streamed twin of `previewIssue`/`/api/digests/[id]/preview` (still there, for curl and
// `?ignoreSeen=1` reload-in-the-URL-bar dev workflows — this page doesn't replace it). Every source
// section's build is kicked off up front by `previewStream` and each gets its own <Suspense> boundary, so a
// fast section renders the moment it's ready instead of the whole page blocking on the slowest one. Content
// renders through the SAME `markdownToHtml` + `issueStyles` the mailed HTML uses (scoped under
// `.issue-render` here instead of a standalone document) — this is what the reader's Kindle gets, not a
// separate preview design.
type ClosersAndIntro = { intro: string; closed: RenderedSection[] };

async function SectionBlock({ promise }: { promise: Promise<RenderedSection | null> }) {
  const rendered = await promise;
  if (!rendered) return null; // dropped — NOTHING_TODAY, a write failure, or filtered to empty
  return (
    <>
      <h2>{rendered.title}</h2>
      <div dangerouslySetInnerHTML={{ __html: markdownToHtml(rendered.markdown, { items: rendered.items }) }} />
      <hr />
    </>
  );
}

function SectionFallback({ title }: { title: string }) {
  return (
    <div className="animate-pulse">
      <h2>{title}</h2>
      <p className="text-sm text-muted">Gathering…</p>
      <hr />
    </div>
  );
}

// Intro and closers share ONE `previewClosersAndIntro` call (kicked off once in the page below, passed to
// both) — they depend on the same "every source section settled" work, and awaiting the same promise twice
// costs nothing extra, while calling the function twice would run the writer and any closer twice over.
async function IntroBlock({ promise }: { promise: Promise<ClosersAndIntro> }) {
  const { intro } = await promise;
  if (!intro) return null;
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: markdownToHtml(intro) }} />
      <hr />
    </>
  );
}

async function ClosersBlock({ promise }: { promise: Promise<ClosersAndIntro> }) {
  const { closed } = await promise;
  return (
    <>
      {closed.map((s) => (
        <div key={s.id}>
          <h2>{s.title}</h2>
          <div dangerouslySetInnerHTML={{ __html: markdownToHtml(s.markdown, { items: s.items, citations: !isVerbatimSection(s.markdown), trustImageUrls: isVerbatimSection(s.markdown) }) }} />
          <hr />
        </div>
      ))}
    </>
  );
}

export default async function PreviewPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { ignoreSeen?: string };
}) {
  const stream = await previewStream(Number(params.id), { ignoreSeen: searchParams.ignoreSeen === "1" });
  if ("error" in stream) notFound();
  const s: PreviewStream = stream;

  // Kicked off once, up front — shared by IntroBlock and ClosersBlock below.
  const closersAndIntro = previewClosersAndIntro(s);

  return (
    <div className="issue-render">
      <style dangerouslySetInnerHTML={{ __html: issueStyles(".issue-render") }} />
      <h1>
        {s.digest.name} — {s.issueDate} (preview)
      </h1>

      {s.sourceSections.length === 0 && <p className="text-sm text-muted">No sections due today.</p>}

      <Suspense fallback={null}>
        <IntroBlock promise={closersAndIntro} />
      </Suspense>

      {s.sourceSections.map(({ section, promise }) => (
        <Suspense key={section.id} fallback={<SectionFallback title={section.title} />}>
          <SectionBlock promise={promise} />
        </Suspense>
      ))}

      <Suspense fallback={null}>
        <ClosersBlock promise={closersAndIntro} />
      </Suspense>
    </div>
  );
}
