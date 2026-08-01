import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { markdownToHtml } from "@/lib/digest/render";
import { stripReaderPreamble } from "@/lib/digest/entities";

export const dynamic = "force-dynamic";

// Read a pulled post without leaving the app.
//
// We already paid to extract this text — linking out to the original and making the reader fetch it again
// was throwing that away. It also makes the corpus inspectable: when a section produces something odd, this
// is where you check whether the writer was handed bad material or simply wrote it badly.
export default async function PostPage({ params }: { params: { id: string; postId: string } }) {
  const supabase = createClient();

  const { data } = await supabase
    .from("digest_posts")
    .select("id, url, title, source, section_id, body, image_url, published_at, fetched_at, used_at, used_in_issue_id")
    .eq("id", Number(params.postId))
    .eq("digest_id", Number(params.id))
    .maybeSingle();
  if (!data) notFound();

  // Bodies stored before the extractor learned to strip r.jina.ai's metadata block still carry it, so clean
  // on read as well as on write. Cheap, and it means old rows display correctly without a backfill.
  const { text } = stripReaderPreamble((data.body as string) ?? "");

  const meta = [
    data.source as string | null,
    data.section_id as string | null,
    data.published_at ? `published ${new Date(data.published_at as string).toLocaleDateString()}` : null,
    `pulled ${new Date(data.fetched_at as string).toLocaleDateString()}`,
  ].filter(Boolean);

  return (
    <article className="space-y-6">
      <header className="space-y-2 border-b border-rule pb-4">
        <h1 className="text-2xl">{(data.title as string) ?? "(untitled)"}</h1>
        <p className="font-mono text-xs text-muted">{meta.join(" · ")}</p>
        <p className="flex gap-4 font-mono text-xs">
          <a href={`/digests/${params.id}/posts`} className="underline">
            ← all posts
          </a>
          {data.url && (
            <a href={data.url as string} target="_blank" rel="noreferrer" className="underline">
              original ↗
            </a>
          )}
          {data.used_at ? (
            <a href={`/issues/${data.used_in_issue_id}`} className="underline">
              used in an issue →
            </a>
          ) : (
            <span className="text-muted">not used in an issue</span>
          )}
        </p>
      </header>

      {data.image_url && (
        // eslint-disable-next-line @next/next/no-img-element -- remote publisher images, no loader configured
        <img src={data.image_url as string} alt="" className="max-h-96 w-auto" />
      )}

      {text ? (
        // Same renderer the digest itself uses, so what you read here matches what the writer was handed.
        <div
          className="prose-digest space-y-3 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: markdownToHtml(text) }}
        />
      ) : (
        <p className="text-sm text-muted">
          No body was stored for this post — extraction failed, or it was pulled before bodies were kept.
        </p>
      )}
    </article>
  );
}
