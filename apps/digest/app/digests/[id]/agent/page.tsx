import { createClient } from "@/lib/supabase/server";
import type { Turn } from "@/lib/digest/llm";
import { toExchanges } from "@/lib/digest/agent/transcript";
import { AgentRail } from "./AgentRail";

export const dynamic = "force-dynamic";

// The agent tab. Loads the most recent conversation for this digest and hands it to the rail.
//
// `digest_agent_chats.messages` stores the MODEL's view — user turns, assistant turns with their tool
// calls, tool results. The displayed view is derived from it here rather than stored alongside, because two
// stored representations of one conversation is exactly the kind of mirror that drifts, and this direction
// is the one that works: the model's transcript contains everything the display needs, not the reverse.
export default async function AgentPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const digestId = Number(params.id);

  const { data } = await supabase
    .from("digest_agent_chats")
    .select("id, messages")
    .eq("digest_id", digestId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const chat = data as { id: number; messages: Turn[] } | null;

  return (
    <AgentRail
      digestId={digestId}
      initialChatId={chat?.id ?? null}
      initialExchanges={toExchanges(chat?.messages ?? [])}
    />
  );
}
