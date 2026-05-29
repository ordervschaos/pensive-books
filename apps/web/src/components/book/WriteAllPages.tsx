import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { buildDoc } from "@/lib/inlineMarkdown";

const BRIDGE = import.meta.env.VITE_EVAL_BRIDGE_URL as string | undefined;

// Per-page generation is flaky in the ways network + LLM calls always are (Anthropic
// 429/529/5xx, a dropped connection, an edge-function timeout, the bridge's `claude
// exited N`). Retry each page a couple of times with exponential backoff before giving
// up, so one transient blip mid-cascade doesn't strand a page.
const MAX_ATTEMPTS = 3; // 1 try + 2 retries
const RETRY_BASE_MS = 1000; // backoff ≈ 1s, then 2s (+ jitter)
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

interface WriteAllPagesProps {
  bookId: number;
}

interface PageRow {
  id: number;
  title: string | null;
  content: unknown;
  metadata: { objective?: string } | null;
}

// Body text excluding the leading title heading — used to decide if a page is "empty".
function bodyText(content: unknown): string {
  if (!content || typeof content !== "object") return typeof content === "string" ? content : "";
  const doc = content as { content?: Array<Record<string, unknown>> };
  if (!Array.isArray(doc.content)) return "";
  const nodes = doc.content[0]?.type === "heading" ? doc.content.slice(1) : doc.content;
  const walk = (n: Record<string, unknown>): string =>
    n.type === "text"
      ? String(n.text ?? "")
      : ((n.content as Array<Record<string, unknown>>) ?? []).map(walk).join("");
  return nodes.map(walk).join("").trim();
}

/**
 * Book-level generation (cascade): fill every empty, objective-bearing text page by
 * rendering prose from its objective. Clobber-safe — pages that already have prose are
 * skipped. Runs client-side (one generate-unit call per page) so it shows progress and
 * never hits an edge-function timeout.
 */
export function WriteAllPages({ bookId }: WriteAllPagesProps) {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; retrying?: number } | null>(null);

  const run = async () => {
    try {
      setRunning(true);
      setProgress(null);

      const { data: pages, error } = await supabase
        .from("pages")
        .select("id, title, content, metadata")
        .eq("book_id", bookId)
        .eq("page_type", "text")
        .eq("archived", false)
        .order("page_index", { ascending: true });
      if (error) throw error;

      const targets = (pages as PageRow[] | null ?? []).filter(
        (p) => p.metadata?.objective && !bodyText(p.content)
      );
      if (targets.length === 0) {
        toast({ title: "Nothing to write", description: "No empty pages with an objective were found." });
        return;
      }
      if (!window.confirm(`Generate prose for ${targets.length} empty page(s) from their objectives?`)) {
        return;
      }

      // Generate + persist one page's prose. Throws on any failure so the retry
      // loop below can catch it.
      const writePage = async (page: PageRow) => {
        let text: string;
        if (BRIDGE) {
          const r = await fetch(`${BRIDGE}/unit`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ bookId, pageId: page.id, level: "page", objective: page.metadata!.objective }),
          });
          const d = await r.json();
          if (d.error) throw new Error(d.error);
          text = String(d.text ?? "").trim();
        } else {
          const { data, error: genErr } = await supabase.functions.invoke("generate-unit", {
            body: { bookId, pageId: page.id, level: "page", objective: page.metadata!.objective },
          });
          if (genErr) throw genErr;
          text = String(data?.text ?? "").trim();
        }
        if (text) {
          const { error: upErr } = await supabase
            .from("pages")
            .update({ content: buildDoc(page.title, text) })
            .eq("id", page.id);
          if (upErr) throw upErr;
        }
      };

      setProgress({ done: 0, total: targets.length });
      let failures = 0;
      for (let i = 0; i < targets.length; i++) {
        const page = targets[i];
        let written = false;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS && !written; attempt++) {
          try {
            await writePage(page);
            written = true;
          } catch (e) {
            console.error(`write-all: page ${page.id} attempt ${attempt}/${MAX_ATTEMPTS} failed`, e);
            if (attempt < MAX_ATTEMPTS) {
              setProgress({ done: i, total: targets.length, retrying: attempt });
              await sleep(RETRY_BASE_MS * 2 ** (attempt - 1) + Math.random() * 250);
            }
          }
        }
        if (!written) failures++;
        setProgress({ done: i + 1, total: targets.length });
      }

      toast({
        title: "Book draft written",
        description: `${targets.length - failures} of ${targets.length} pages filled${failures ? ` (${failures} failed)` : ""}.`,
        variant: failures ? "destructive" : undefined,
      });
    } catch (e) {
      toast({ title: "Couldn't write pages", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-base font-medium">Write all pages from objectives</h3>
          <p className="text-sm text-muted-foreground">
            Render prose for every empty page that has an objective. Pages you've already written are
            left untouched.
          </p>
        </div>
        <Button onClick={run} disabled={running} variant="outline" className="flex-none">
          {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
          {progress
            ? progress.retrying
              ? `Retrying ${progress.done + 1}/${progress.total}…`
              : `Writing ${progress.done}/${progress.total}…`
            : running ? "Working…" : "Write all pages"}
        </Button>
      </div>
    </Card>
  );
}
