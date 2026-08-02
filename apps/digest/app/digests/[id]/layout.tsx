import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Tabs } from "@/components/Tabs";
import { RunNowButton } from "./RunNowButton";

export const dynamic = "force-dynamic";

// Everything a digest's tabs share — title, run controls, breadcrumb trail — lives here so switching tabs
// doesn't re-render (or re-fetch) the chrome. Each tab underneath is just its own body.
export default async function DigestLayout({
  params,
  children,
}: {
  params: { id: string };
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const { data } = await supabase
    .from("digests")
    .select("id, name")
    .eq("id", Number(params.id))
    .maybeSingle();
  if (!data) notFound();

  const base = `/digests/${data.id}`;

  return (
    <main className="space-y-6">
      <Breadcrumbs items={[{ label: "Digests", href: "/" }, { label: data.name as string }]} />

      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl">{data.name as string}</h1>
        <RunNowButton digestId={data.id as number} />
      </div>

      <Tabs
        tabs={[
          { label: "Sections", href: base },
          { label: "Issues", href: `${base}/issues` },
          { label: "Inbox", href: `${base}/inbox` },
          { label: "Posts", href: `${base}/posts` },
          { label: "Settings", href: `${base}/settings` },
        ]}
      />

      <div className="pt-2">{children}</div>
    </main>
  );
}
