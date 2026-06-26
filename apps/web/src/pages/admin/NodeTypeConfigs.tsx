import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shield, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";

interface SlotConfig {
  voice: boolean;
  entities: boolean;
  threads: boolean;
  tentpoles: boolean;
  worldRules: boolean;
  games: boolean;
  preconditions: boolean;
  arc: boolean;
}

interface NodeTypeConfig {
  id: number;
  target: string;
  child_kind: string;
  child_level: number;
  parent_kind: string;
  role: string;
  count: string;
  schema_json: string;
  slots: SlotConfig;
}

const SLOT_LABELS: Record<keyof SlotConfig, string> = {
  voice: "Voice profile",
  entities: "Cast & world",
  threads: "Threads",
  tentpoles: "Tentpoles",
  worldRules: "World rules",
  games: "Games",
  preconditions: "State preconditions",
  arc: "Arc (movements)",
};

function SlotToggle({
  slotKey,
  value,
  onChange,
}: {
  slotKey: keyof SlotConfig;
  value: boolean;
  onChange: (key: keyof SlotConfig, val: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(slotKey, !value)}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
        value
          ? "bg-foreground text-background border-foreground"
          : "bg-background text-muted-foreground border-border hover:border-foreground/40"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${value ? "bg-background" : "bg-muted-foreground"}`} />
      {SLOT_LABELS[slotKey]}
    </button>
  );
}

function ConfigRow({ config, onSaved }: { config: NodeTypeConfig; onSaved: (updated: NodeTypeConfig) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<NodeTypeConfig>(config);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const dirty =
    draft.role !== config.role ||
    draft.count !== config.count ||
    draft.schema_json !== config.schema_json ||
    JSON.stringify(draft.slots) !== JSON.stringify(config.slots);

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("node_type_configs" as any)
      .update({
        role: draft.role,
        count: draft.count,
        schema_json: draft.schema_json,
        slots: draft.slots,
        updated_at: new Date().toISOString(),
      })
      .eq("id", config.id);
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Saved", description: `${config.target} config updated.` });
      onSaved(draft);
    }
  }

  function setSlot(key: keyof SlotConfig, val: boolean) {
    setDraft((d) => ({ ...d, slots: { ...d.slots, [key]: val } }));
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
        <span className="font-mono text-sm font-medium w-32">{config.target}</span>
        <span className="text-xs text-muted-foreground">
          {config.parent_kind} → <span className="text-foreground">{config.child_kind}</span> (level {config.child_level})
        </span>
        <div className="ml-auto flex gap-1 flex-wrap">
          {(Object.keys(SLOT_LABELS) as (keyof SlotConfig)[]).filter((k) => config.slots[k]).map((k) => (
            <Badge key={k} variant="secondary" className="text-xs px-1.5 py-0">{SLOT_LABELS[k]}</Badge>
          ))}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-4 border-t bg-muted/10">
          <div className="space-y-1.5">
            <Label className="text-xs">Role <span className="text-muted-foreground">(injected into system prompt)</span></Label>
            <Textarea
              value={draft.role}
              onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value }))}
              className="text-sm font-mono min-h-[80px] resize-y"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Count</Label>
            <Input
              value={draft.count}
              onChange={(e) => setDraft((d) => ({ ...d, count: e.target.value }))}
              className="text-sm font-mono w-48"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Schema JSON <span className="text-muted-foreground">(output template shown to Claude)</span></Label>
            <Textarea
              value={draft.schema_json}
              onChange={(e) => setDraft((d) => ({ ...d, schema_json: e.target.value }))}
              className="text-sm font-mono min-h-[120px] resize-y"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Context slots <span className="text-muted-foreground">(which blocks are injected into the prompt)</span></Label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(SLOT_LABELS) as (keyof SlotConfig)[]).map((k) => (
                <SlotToggle key={k} slotKey={k} value={draft.slots[k]} onChange={setSlot} />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button onClick={save} disabled={saving || !dirty} size="sm">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              {dirty ? "Save changes" : "Saved"}
            </Button>
            {dirty && (
              <button
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setDraft(config)}
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function NodeTypeConfigs() {
  const [configs, setConfigs] = useState<NodeTypeConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("node_type_configs" as any)
      .select("*")
      .order("child_level", { ascending: true })
      .order("target", { ascending: true })
      .then(({ data }) => {
        setConfigs((data as NodeTypeConfig[]) ?? []);
        setLoading(false);
      });
  }, []);

  function handleSaved(updated: NodeTypeConfig) {
    setConfigs((cs) => cs.map((c) => (c.id === updated.id ? updated : c)));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-amber-600" />
        <h1 className="text-xl font-semibold">Node Type Configs</h1>
        <Link to="/admin/settings" className="ml-auto text-sm text-muted-foreground hover:text-foreground">
          ← Settings
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">DNA expand targets</CardTitle>
          <CardDescription>
            Each row controls how one expand target generates content — the role injected into the system prompt,
            the count constraint, the output schema, and which context slots (cast, threads, etc.) are loaded.
            Structure columns (child_kind, level) are read-only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {configs.map((c) => (
            <ConfigRow key={c.id} config={c} onSaved={handleSaved} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
