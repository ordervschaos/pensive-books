// DocsPage — the /docs documentation store. Two routes share this one component:
//   /docs         → the index (landing + doc cards)
//   /docs/:slug   → a rendered document, with a persistent sidebar
// Stakeholder-facing and public (no auth) so a link can be shared. Content lives in ./registry.
import { Link, useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";
import { DOCS, docsByCategory, getDoc } from "./registry";

function Sidebar({ activeSlug }: { activeSlug?: string }) {
  const groups = docsByCategory();
  return (
    <nav className="space-y-6 text-sm">
      <Link to="/docs" className="block font-semibold tracking-tight text-foreground hover:opacity-80">
        📚 Docs
      </Link>
      {groups.map((g) => (
        <div key={g.category} className="space-y-1.5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.category}</div>
          <ul className="space-y-1">
            {g.docs.map((d) => (
              <li key={d.slug}>
                <Link
                  to={`/docs/${d.slug}`}
                  className={cn(
                    "block rounded-md px-2 py-1 transition-colors hover:bg-muted",
                    d.slug === activeSlug ? "bg-muted font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {d.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function DocsIndex() {
  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight">Pensive Documentation</h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          How the product works — the bet, the method, and the AI collaborator behind it.
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        {DOCS.map((d) => (
          <Link
            key={d.slug}
            to={`/docs/${d.slug}`}
            className="group rounded-lg border border-border bg-card p-5 transition-colors hover:border-foreground/30 hover:bg-muted/40"
          >
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{d.category}</div>
            <h2 className="mt-1 text-lg font-semibold group-hover:underline">{d.title}</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">{d.summary}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

function DocNotFound({ slug }: { slug: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Doc not found</h1>
      <p className="text-muted-foreground">
        No document at <code className="rounded bg-muted px-1.5 py-0.5">/docs/{slug}</code>.
      </p>
      <Link to="/docs" className="text-sm font-medium underline">
        ← Back to all docs
      </Link>
    </div>
  );
}

export default function DocsPage() {
  const { slug } = useParams();
  const doc = slug ? getDoc(slug) : undefined;

  return (
    <div className="container max-w-6xl py-8">
      <div className="gap-10 lg:grid lg:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="mb-8 lg:mb-0">
          <div className="lg:sticky lg:top-8">
            <Sidebar activeSlug={slug} />
          </div>
        </aside>
        <main className="min-w-0">
          {!slug ? <DocsIndex /> : doc ? <Markdown content={doc.content} /> : <DocNotFound slug={slug} />}
        </main>
      </div>
    </div>
  );
}
