import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, Loader2, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type ModelTier = "opus" | "sonnet" | "deepseek" | "qwen" | "qwen-plus" | "kimi" | "glm" | "minimax" | "gpt" | "hermes";

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
    value: "deepseek",
    label: "DeepSeek",
    description: "Lowest cost. Uses DeepSeek's API (requires DEEPSEEK_API_KEY secret). Quality varies by task.",
    badge: "Budget",
    badgeVariant: "outline",
  },
];

const ADMIN_SETTINGS = "admin_settings";

// Per-role tier overrides (§4c): prose / structure (outlines, beats, structural JSON) / the agent reasoning
// loop can each run on a different tier. Empty = "same as the base tier". The keys match _shared/model-config
// ROLE_TIER_KEYS, whose resolveRoleModels falls back to the base tier for any unset/blank role.
const ROLE_KEYS = { prose: "ai_model_tier_prose", structure: "ai_model_tier_structure", agent: "ai_model_tier_agent" } as const;
type RoleKey = keyof typeof ROLE_KEYS;
type RoleTiers = Record<RoleKey, ModelTier | "">;
const EMPTY_ROLES: RoleTiers = { prose: "", structure: "", agent: "" };
const ROLE_HINT: Record<RoleKey, string> = {
  prose: "Scene prose — where a prose-specialist (e.g. GPT-5.5, Hermes) pays off.",
  structure: "Outlines, beats, and structural JSON — favor a JSON-reliable model.",
  agent: "The Studio agent's reasoning + tool loop.",
};

export default function AdminSettings() {
  const [tier, setTier] = useState<ModelTier>("opus");
  const [saved, setSaved] = useState<ModelTier>("opus");
  const [roles, setRoles] = useState<RoleTiers>(EMPTY_ROLES);
  const [savedRoles, setSavedRoles] = useState<RoleTiers>(EMPTY_ROLES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    (supabase as any)
      .from(ADMIN_SETTINGS)
      .select("key, value")
      .in("key", ["ai_model_tier", ...Object.values(ROLE_KEYS)])
      .then(({ data, error }: { data: { key: string; value: string }[] | null; error: unknown }) => {
        if (!error && data) {
          const map = new Map(data.map((r) => [r.key, r.value]));
          const t = (map.get("ai_model_tier") as ModelTier) ?? "opus";
          setTier(t); setSaved(t);
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
  const dirty = tier !== saved || rolesDirty;

  async function save() {
    setSaving(true);
    const now = new Date().toISOString();
    const rows = [
      { key: "ai_model_tier", value: tier, updated_at: now },
      ...(Object.keys(ROLE_KEYS) as RoleKey[]).map((role) => ({ key: ROLE_KEYS[role], value: roles[role], updated_at: now })),
    ];
    const { error } = await (supabase as any).from(ADMIN_SETTINGS).upsert(rows, { onConflict: "key" });
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      setSaved(tier); setSavedRoles(roles);
      toast({ title: "Saved", description: `AI model tier set to ${tier}.` });
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
          <CardTitle className="text-base">AI Model Tier</CardTitle>
          <CardDescription>
            Controls which model is used for all AI generation calls (prose, outlines, evaluation, voice).
            Summaries and thread scans always use the cheap fast model regardless of this setting.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup value={tier} onValueChange={(v) => setTier(v as ModelTier)} className="space-y-3">
            {TIERS.map((t) => (
              <div
                key={t.value}
                className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors ${
                  tier === t.value ? "border-foreground bg-muted/40" : "border-border hover:border-foreground/40"
                }`}
                onClick={() => setTier(t.value)}
              >
                <RadioGroupItem value={t.value} id={t.value} className="mt-0.5" />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={t.value} className="font-medium cursor-pointer">{t.label}</Label>
                    <Badge variant={t.badgeVariant} className="text-xs">{t.badge}</Badge>
                    {saved === t.value && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <CheckCircle2 className="h-3 w-3" /> active
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{t.description}</p>
                </div>
              </div>
            ))}
          </RadioGroup>

          <div className="space-y-3 border-t pt-4">
            <div>
              <p className="text-sm font-medium">Per-role model (advanced)</p>
              <p className="text-xs text-muted-foreground">
                Run prose, structure, and the agent loop on different tiers — the best prose model and the best
                structural-JSON model differ (e.g. Hermes writes great prose but is unreliable for JSON).
                "Same as base" uses the tier selected above.
              </p>
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
                  <option value="">Same as base ({tier})</option>
                  {TIERS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
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
