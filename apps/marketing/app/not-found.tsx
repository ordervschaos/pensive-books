import Link from "next/link";

export default function NotFound() {
  return (
    <main className="container mx-auto max-w-3xl px-4 py-16">
      <div className="rounded-2xl border bg-card p-10 text-center shadow-sm">
        <h1 className="text-3xl font-semibold text-foreground">Not found</h1>
        <p className="mt-3 text-muted-foreground">
          The page you requested does not exist or is no longer public.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
          <Link
            href="/library"
            className="inline-flex items-center justify-center rounded-md border border-input px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Browse library
          </Link>
        </div>
      </div>
    </main>
  );
}
