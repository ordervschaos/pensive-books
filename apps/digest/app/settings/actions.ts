"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyToken } from "@/lib/digest/readwise";

// Account-level settings, one row per user. RLS-enforcing client throughout: the service role belongs to the
// 6am pipeline, and nothing a browser can reach should be able to read another user's key.

export async function saveReadwise(form: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const enabled = form.get("readwise_enabled") === "on";
  // The field is write-only: it renders empty even when a token is stored, so "blank" means "leave it
  // alone", never "clear it". Clearing is the explicit Disconnect button.
  const pasted = String(form.get("readwise_token") ?? "").trim();

  const { data: existing } = await supabase
    .from("digest_user_settings")
    .select("readwise_token")
    .eq("user_id", user.id)
    .maybeSingle();
  const stored = (existing as { readwise_token: string | null } | null)?.readwise_token ?? null;

  if (enabled && !pasted && !stored) return back("Paste your Readwise access token before turning this on.");

  // Verify at PASTE time, in front of a human who can fix it. The alternative — storing whatever was typed
  // and finding out at 6am — turns a typo (or an expired plan) into a silently empty section days later.
  const payload: Record<string, unknown> = { user_id: user.id, readwise_enabled: enabled };
  if (pasted) {
    const check = await verifyToken(pasted);
    if (!check.ok) return back(check.error ?? "Readwise rejected that token.");
    payload.readwise_token = pasted;
    payload.readwise_verified_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from("digest_user_settings")
    .upsert(payload, { onConflict: "user_id" });
  if (error) return back(error.message);

  revalidatePath("/settings");
  redirect(`/settings?ok=${pasted ? "connected" : "saved"}`);
}

export async function disconnectReadwise() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  await supabase
    .from("digest_user_settings")
    .upsert(
      { user_id: user.id, readwise_enabled: false, readwise_token: null, readwise_verified_at: null },
      { onConflict: "user_id" },
    );

  revalidatePath("/settings");
  redirect("/settings?ok=disconnected");
}

// Server actions on a plain <form> have no return channel to the page, and a client component just to show
// one error string would be a worse trade. The URL carries it.
function back(message: string): never {
  redirect(`/settings?error=${encodeURIComponent(message)}`);
}
