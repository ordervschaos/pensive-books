import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, Loader2, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";

type ModelTier = "opus" | "sonnet" | "deepseek" | "qwen";

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
    value: "qwen",
    label: "Qwen 3",
    description: "Alibaba's Qwen 3 Max via MuleRouter. Competitive quality at low cost. Requires MULE_ROUTER_API_KEY secret.",
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

export default function AdminSettings() {
  const [tier, setTier] = useState<ModelTier>("opus");
  const [saved, setSaved] = useState<ModelTier>("opus");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    (supabase as any)
      .from(ADMIN_SETTINGS)
      .select("value")
      .eq("key", "ai_model_tier")
      .single()
      .then(({ data, error }: { data: { value: string } | null; error: unknown }) => {
        if (!error && data?.value) {
          const t = data.value as ModelTier;
          setTier(t);
          setSaved(t);
        }
        setLoading(false);
      });
  }, []);

  async function save() {
    setSaving(true);
    const { error } = await (supabase as any)
      .from(ADMIN_SETTINGS)
      .update({ value: tier, updated_at: new Date().toISOString() })
      .eq("key", "ai_model_tier");
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      setSaved(tier);
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
        <h1 className="text-xl font-semibold">Admin Settings</h1>
        <Link to="/admin" className="ml-auto text-sm text-muted-foreground hover:text-foreground">
          ← Dashboard
        </Link>
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

          <Button onClick={save} disabled={saving || tier === saved} className="w-full sm:w-auto">
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {tier === saved ? "Saved" : "Save Changes"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
