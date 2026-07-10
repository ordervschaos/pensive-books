import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type ModelTier = "opus" | "sonnet" | "deepseek" | "deepseek-v4" | "qwen" | "qwen-plus" | "kimi" | "glm" | "minimax" | "gpt" | "hermes" | "claude-local";

const TIERS: { value: ModelTier; label: string; description: string; badge: string; badgeVariant: "default" | "secondary" | "outline" }[] = [
  {
    value: "opus",
    label: "Claude Opus",
    description: "Highest quality. Best for final drafts, nuanced evaluation, and complex restructuring. Most expensive.",
    badge: "Expensive",
    badgeVariant: "default",
  },
  {
    value: "sonnet",
    label: "Claude Sonnet",
    description: "Strong quality at ~5× lower cost. Good for most generation tasks. Recommended during development.",
    badge: "Recommended",
    badgeVariant: "secondary",
  },
  {
    value: "gpt",
    label: "GPT-5.5",
    description: "OpenAI GPT-5.5 via OpenRouter. Standout in prose tests — richest, warmest, wittiest drafts (best at the romcom register the brief asks for), though it runs long. Requires OPENROUTER_API_KEY secret.",
    badge: "Strong",
    badgeVariant: "secondary",
  },
  {
    value: "hermes",
    label: "Hermes 3 (405B)",
    description: "Nous Hermes 3 405B via OpenRouter. Non-reasoning, fast (~37s/scene). The one model that delivered EXPLICIT heat that lands while honoring the beat + voice (scene-22 prose test). Best for explicit-mandate books; watch structural-JSON passes. Requires OPENROUTER_API_KEY secret.",
    badge: "Mature",
    badgeVariant: "secondary",
  },
  {
    value: "qwen",
    label: "Qwen 3 Max",
    description: "Alibaba's large Qwen model via OpenRouter. Competitive quality at low cost. Requires OPENROUTER_API_KEY secret.",
    badge: "Budget",
    badgeVariant: "outline",
  },
  {
    value: "qwen-plus",
    label: "Qwen 3.7 Plus",
    description: "Cheaper Qwen tier via OpenRouter. Good first budget candidate for outline and planning experiments.",
    badge: "Budget",
    badgeVariant: "outline",
  },
  {
    value: "kimi",
    label: "Kimi K2.7 Code",
    description: "Moonshot's Kimi model via OpenRouter. Coding-focused, but worth testing for structured revisions and long-context planning.",
    badge: "Budget",
    badgeVariant: "outline",
  },
  {
    value: "glm",
    label: "GLM 5.2",
    description: "Z.ai GLM via OpenRouter. Long-context reasoning model; useful for outline and agent-style experiments.",
    badge: "Budget",
    badgeVariant: "outline",
  },
  {
    value: "minimax",
    label: "MiniMax M3",
    description: "MiniMax model via OpenRouter. Very low-cost option to test against Qwen for planning and drafting.",
    badge: "Budget",
    badgeVariant: "outline",
  },
  {
    value: "deepseek-v4",
    label: "DeepSeek V4",
    description: "Latest DeepSeek (v4-pro / v4-flash) via OpenRouter. 1M-token context, tool-use capable, and very cheap (~$0.44/$0.87 per M for pro, ~$0.14/$0.28 for flash). Requires OPENROUTER_API_KEY secret.",
    badge: "Budget",
    badgeVariant: "outline",
  },
  {
    value: "deepseek",
    label: "DeepSeek (legacy)",
    description: "Original DeepSeek via its own API (deepseek-chat, requires DEEPSEEK_API_KEY secret). Superseded by DeepSeek V4 — kept for comparison. Quality varies by task.",
    badge: "Budget",
    badgeVariant: "outline",
  },
  {
    value: "claude-local",
    label: "Claude (local)",
    description: "Routes to a claude -p shim on your laptop (scripts/claude-local-shim.mjs) instead of any API host — billed against your Claude Code subscription, not per-token. Dev-only: needs CLAUDE_LOCAL_URL set in supabase/functions/.env and the shim running (pnpm dev:claude-local-shim). Each call takes minutes; unusable in production (a deployed function can't reach your laptop, and fails loudly if selected there).",
    badge: "Dev only",
    badgeVariant: "outline",
  },
];

// WHICH HOST runs a call, chosen independently of WHICH MODEL runs it. Mirrors _shared/llm.ts's resolveRoute:
// a preference applies only where that provider can actually serve the selected model — otherwise the call
// falls back to the model's native host. So this switch never strands a model; it just moves the spend.
type ProviderPref = "auto" | "anthropic" | "openrouter" | "deepseek" | "mulerouter";
const PROVIDERS: { value: ProviderPref; label: string; description: string }[] = [
  {
    value: "auto",
    label: "Automatic (by model)",
    description: "Infer the host from the model id: Claude → Anthropic, deepseek-* → DeepSeek, everything else → MuleRouter when its key is set, else OpenRouter. The historical behaviour.",
  },
  {
    value: "deepseek",
    label: "DeepSeek",
    description: "DeepSeek's own API. Serves the DeepSeek V4 tier only (v4-pro / v4-flash) — other tiers fall back to their native host. The one cheap host that honours a reasoning bound, so agent-loop latency is controllable. Requires DEEPSEEK_API_KEY.",
  },
  {
    value: "openrouter",
    label: "OpenRouter",
    description: "Serves every `vendor/model` tier (Qwen, GPT, Kimi, GLM, MiniMax, Hermes, DeepSeek V4). Claude tiers still go to Anthropic. Requires OPENROUTER_API_KEY.",
  },
  {
    value: "mulerouter",
    label: "MuleRouter",
    description: "Cheaper mirror of a subset of the OpenRouter catalogue. Tiers it doesn't carry (Qwen 3 Max, Qwen 3 8B, Kimi, GLM, MiniMax) fall back to OpenRouter. Requires MULE_ROUTER_API_KEY.",
  },
  {
    value: "anthropic",
    label: "Anthropic",
    description: "Only serves the Claude tiers (Opus, Sonnet) — every other tier falls back to its native host, since our non-Claude ids have no Anthropic form. Requires ANTHROPIC_API_KEY.",
  },
];

const ADMIN_SETTINGS = "admin_settings";
const PROVIDER_KEY = "ai_provider";

// Capability matrix (mirrors _shared/model-config TOOL_INCAPABLE_MODELS). The agent role drives a native
// tool-use loop, so a tier with no tool-use endpoint (hermes on OpenRouter) is INVALID for it and is
// omitted from the agent dropdown — you can't pick what can't work. Prose/structure have no hard gate
// (any model emits JSON; reliability is soft advice), so they list every tier.
const TOOL_INCAPABLE_TIERS: ModelTier[] = ["hermes"];
// Where the agent falls back when the BASE tier itself can't do tools — kept in sync with model-config's
// AGENT_FALLBACK_MODEL (qwen). Shown in the "Same as base" label so the resolution is visible, not silent.
const AGENT_FALLBACK_TIER: ModelTier = "qwen";
const isToolCapableTier = (t: ModelTier) => !TOOL_INCAPABLE_TIERS.includes(t);
// A role can use a tier iff the role has no hard gate, or the tier clears the gate. Only the agent gates.
const roleAllowsTier = (role: RoleKey, tier: ModelTier) => (role === "agent" ? isToolCapableTier(tier) : true);

// Per-role tier overrides (§4c): prose / structure (outlines, beats, structural JSON) / the agent reasoning
// loop can each run on a different tier. Empty = "same as the base tier". The keys match _shared/model-config
// ROLE_TIER_KEYS, whose resolveRoleModels falls back to the base tier for any unset/blank role.
const ROLE_KEYS = { prose: "ai_model_tier_prose", structure: "ai_model_tier_structure", agent: "ai_model_tier_agent" } as const;
type RoleKey = keyof typeof ROLE_KEYS;
type RoleTiers = Record<RoleKey, ModelTier | "">;
const EMPTY_ROLES: RoleTiers = { prose: "", structure: "", agent: "" };
const GENERAL_HINT = "Outlines, revisions, evaluation, reads — everything except the three below.";
const ROLE_HINT: Record<RoleKey, string> = {
  prose: "Scene prose — where a prose-specialist (e.g. GPT-5.5, Hermes) pays off.",
  structure: "Outlines, beats, and structural JSON — favor a JSON-reliable model.",
  agent: "The Studio agent's reasoning + tool loop — tool-use only, so non-tool tiers (Hermes) aren't listed here.",
};

export default function AdminSettings() {
  const [tier, setTier] = useState<ModelTier>("opus");
  const [saved, setSaved] = useState<ModelTier>("opus");
  const [roles, setRoles] = useState<RoleTiers>(EMPTY_ROLES);
  const [savedRoles, setSavedRoles] = useState<RoleTiers>(EMPTY_ROLES);
  const [provider, setProvider] = useState<ProviderPref>("auto");
  const [savedProvider, setSavedProvider] = useState<ProviderPref>("auto");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    (supabase as any)
      .from(ADMIN_SETTINGS)
      .select("key, value")
      .in("key", ["ai_model_tier", PROVIDER_KEY, ...Object.values(ROLE_KEYS)])
      .then(({ data, error }: { data: { key: string; value: string }[] | null; error: unknown }) => {
        if (!error && data) {
          const map = new Map(data.map((r) => [r.key, r.value]));
          const t = (map.get("ai_model_tier") as ModelTier) ?? "opus";
          setTier(t); setSaved(t);
          const p = (map.get(PROVIDER_KEY) as ProviderPref) ?? "auto";
          setProvider(p); setSavedProvider(p);
          const r: RoleTiers = {
            prose: (map.get(ROLE_KEYS.prose) as ModelTier | "") ?? "",
            structure: (map.get(ROLE_KEYS.structure) as ModelTier | "") ?? "",
            agent: (map.get(ROLE_KEYS.agent) as ModelTier | "") ?? "",
          };
          setRoles(r); setSavedRoles(r);
        }
        setLoading(false);
      });
  }, []);

  const rolesDirty = (Object.keys(ROLE_KEYS) as RoleKey[]).some((k) => roles[k] !== savedRoles[k]);
  const dirty = tier !== saved || provider !== savedProvider || rolesDirty;

  async function save() {
    setSaving(true);
    const now = new Date().toISOString();
    const rows = [
      { key: "ai_model_tier", value: tier, updated_at: now },
      { key: PROVIDER_KEY, value: provider, updated_at: now },
      ...(Object.keys(ROLE_KEYS) as RoleKey[]).map((role) => ({ key: ROLE_KEYS[role], value: roles[role], updated_at: now })),
    ];
    const { error } = await (supabase as any).from(ADMIN_SETTINGS).upsert(rows, { onConflict: "key" });
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      setSaved(tier); setSavedRoles(roles); setSavedProvider(provider);
      toast({ title: "Saved", description: `Model tier ${tier}, provider ${provider}.` });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-amber-600" />
        <h1 className="text-xl font-semibold">Settings</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provider</CardTitle>
          <CardDescription>
            Which host runs the calls. Independent of the model choice below — several models are served by more
            than one provider, so this is a spend/latency switch. A provider that can’t serve the selected model
            falls back to that model’s native host, so switching never breaks generation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <Label className="text-sm">Route calls through</Label>
            <select
              className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-sm"
              value={provider}
              onChange={(e) => setProvider(e.target.value as ProviderPref)}
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
          <p className="text-sm text-muted-foreground border-t pt-4">
            {PROVIDERS.find((p) => p.value === provider)?.description}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI models by use case</CardTitle>
          <CardDescription>
            Pick the model for each use case. Prose / Structure / Agent default to “Same as General” and only
            differ when you set them. Summaries and thread scans always use the cheap fast model regardless.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Use-case pickers: General is the root ("everything else"); the three specialised roles inherit it. */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Label className="text-sm">General</Label>
                <p className="text-xs text-muted-foreground truncate">{GENERAL_HINT}</p>
              </div>
              <select
                className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-sm"
                value={tier}
                onChange={(e) => setTier(e.target.value as ModelTier)}
              >
                {TIERS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            {(Object.keys(ROLE_KEYS) as RoleKey[]).map((role) => (
              <div key={role} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Label className="text-sm capitalize">{role}</Label>
                  <p className="text-xs text-muted-foreground truncate">{ROLE_HINT[role]}</p>
                </div>
                <select
                  className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-sm"
                  value={roles[role]}
                  onChange={(e) => setRoles({ ...roles, [role]: e.target.value as ModelTier | "" })}
                >
                  <option value="">
                    {role === "agent" && !isToolCapableTier(tier)
                      ? `Same as General (${tier} → ${AGENT_FALLBACK_TIER})`
                      : `Same as General (${tier})`}
                  </option>
                  {TIERS.filter((t) => roleAllowsTier(role, t.value)).map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {/* Model reference — descriptions live once here rather than repeated under every use case. */}
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-medium">Model reference</p>
            {TIERS.map((t) => (
              <div key={t.value} className="flex items-start gap-3 rounded-lg border border-border p-3">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{t.label}</span>
                    <Badge variant={t.badgeVariant} className="text-xs">{t.badge}</Badge>
                    {!isToolCapableTier(t.value) && (
                      <Badge variant="outline" className="text-xs">no tool use — prose/structure only</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{t.description}</p>
                </div>
              </div>
            ))}
          </div>

          <Button onClick={save} disabled={saving || !dirty} className="w-full sm:w-auto">
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {dirty ? "Save Changes" : "Saved"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
