import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Tabs } from "@/components/Tabs";
import { toExchanges } from "@/lib/digest/agent/transcript";
import type { Turn } from "@/lib/digest/llm";
import { RunNowButton } from "./RunNowButton";
import { AgentRail } from "./AgentRail";

export const dynamic = "force-dynamic";

// Everything a digest's tabs share — title, run controls, breadcrumb trail, and the agent — lives here so
// switching tabs doesn't re-render (or re-fetch) the chrome. Each tab underneath is just its own body.
//
// THE RAIL IS MOUNTED HERE, not on a tab of its own, and that placement is the feature. The agent edits the
// same configuration the tabs display, so the useful thing is watching the sections list change as it works
// — which requires both being on screen at once. It also means the conversation survives tab navigation:
// App Router swaps `children` without remounting the layout, so the client component keeps its state, and
// `router.refresh()` after a write re-renders the server components around it without discarding it.
export default async function DigestLayout({
  params,
  children,
}: {
  params: { id: string };
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const digestId = Number(params.id);

  const [{ data }, { data: chatRow }] = await Promise.all([
    supabase.from("digests").select("id, name").eq("id", digestId).maybeSingle(),
    // The most recent conversation for this digest. `messages` is the MODEL's transcript; the displayed
    // view is derived from it (see agent/transcript.ts) rather than stored a second time.
    supabase
      .from("digest_agent_chats")
      .select("id, messages")
      .eq("digest_id", digestId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!data) notFound();

  const base = `/digests/${data.id}`;
  const chat = chatRow as { id: number; messages: Turn[] } | null;

  return (
    // Two columns from `lg` up; below it the rail stacks under the page, where a narrow screen can still
    // reach it without a drawer to build and maintain.
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
      <main className="min-w-0 space-y-6">
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
            { label: "Preview", href: `${base}/preview` },
            { label: "Settings", href: `${base}/settings` },
          ]}
        />

        <div className="pt-2">{children}</div>
      </main>

      <AgentRail
        digestId={digestId}
        initialChatId={chat?.id ?? null}
        initialExchanges={toExchanges(chat?.messages ?? [])}
      />
    </div>
  );
}
