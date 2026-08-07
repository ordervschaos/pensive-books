// StudioNewBookPage — /studio/new
// Fastest path into Studio: ask for a name, create an empty book (brief: {}), and land
// straight in the tree. No cover/subtitle/author — those stay on the full /books/new flow.
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { setPageTitle } from "@/utils/pageTitle";

export default function StudioNewBookPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => setPageTitle("New Book"), []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || saving) return;

    try {
      setSaving(true);
      const { data, error } = await supabase
        .from("books")
        .insert({ name: name.trim(), brief: {} })
        .select()
        .single();
      if (error) throw error;

      navigate(`/books/${data.id}/studio/tree/`);
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Error creating book",
        description: error instanceof Error ? error.message : "An unknown error occurred",
      });
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-[560px] flex-col justify-center px-6">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="pv-serif mb-6 self-start text-[14px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground"
      >
        ← back
      </button>
      <h1 className="pv-display text-[36px] font-normal italic leading-[1.05] tracking-tight text-foreground md:text-[44px]">
        Name your book.
      </h1>
      <p className="pv-serif mt-3 text-[16px] italic text-[hsl(var(--pv-text-muted))]">
        Everything else — brief, shape, prose — you build in the Studio.
      </p>

      <form onSubmit={handleSubmit} className="mt-9">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="The title of your book"
          autoFocus
          className="pv-display w-full border-b border-border bg-transparent pb-3 text-[26px] font-normal italic tracking-tight text-foreground outline-none placeholder:text-[hsl(var(--pv-text-faint))]"
        />

        <div className="mt-8 flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="pv-serif inline-flex h-11 items-center rounded-full border border-border bg-transparent px-5 text-[14px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="pv-serif inline-flex h-11 items-center rounded-full bg-foreground px-5 text-[14px] tracking-[0.01em] text-background transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {saving ? "Creating…" : "Create & open Studio →"}
          </button>
        </div>
      </form>
    </div>
  );
}
