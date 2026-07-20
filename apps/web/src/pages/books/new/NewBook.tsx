import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Image as ImageIcon } from "lucide-react";
import { importEpubAsBook } from "@/features/dna/lib/importEpub";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UnsplashPicker } from "@/components/book/UnsplashPicker";
import { BriefIntakeSheet } from "@/components/book/BriefIntakeSheet";
import { WriteModeDialog, type WriteMode } from "@/components/book/WriteModeDialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { setPageTitle } from "@/utils/pageTitle";

interface BookDraft {
  name: string;
  subtitle: string;
  author: string;
  cover_url: string | null;
  show_text_on_cover: boolean;
  is_public: boolean;
  // Cover tone (used only when there is no uploaded cover image — fills the
  // preview with a flat colour the writer can pick from the swatch row).
  cover_tone: string | null;
}

const SWATCHES: { label: string; value: string }[] = [
  { label: "Paper", value: "#f6f3ec" },
  { label: "Ink", value: "#1f1d18" },
  { label: "Maroon", value: "#7a2d20" },
  { label: "Forest", value: "#3a4a3d" },
  { label: "Sand", value: "#d4a574" },
  { label: "Slate", value: "#3a4a5a" },
];

const NewBook = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [authorDefault, setAuthorDefault] = useState("");
  const [intakeBookId, setIntakeBookId] = useState<number | null>(null);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const epubInputRef = useRef<HTMLInputElement>(null);

  const [book, setBook] = useState<BookDraft>({
    name: "",
    subtitle: "",
    author: "",
    cover_url: null,
    show_text_on_cover: true,
    is_public: false,
    cover_tone: null,
  });

  useEffect(() => {
    setPageTitle("New Book");
    // Best-effort: prefill author with the signed-in user's display name.
    supabase.auth.getSession().then(({ data }) => {
      const meta = data.session?.user.user_metadata as Record<string, unknown> | undefined;
      const guess =
        (meta?.full_name as string | undefined) ||
        (meta?.name as string | undefined) ||
        data.session?.user.email?.split("@")[0] ||
        "";
      setAuthorDefault(guess);
      setBook((prev) => (prev.author ? prev : { ...prev, author: guess }));
    });
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!book.name.trim()) {
      toast({
        variant: "destructive",
        title: "Title is required",
        description: "Give your book a title before saving.",
      });
      return;
    }

    try {
      setSaving(true);
      const { data, error } = await supabase
        .from("books")
        .insert({
          name: book.name.trim(),
          subtitle: book.subtitle.trim() || null,
          author: (book.author || authorDefault).trim() || null,
          is_public: book.is_public,
          cover_url: book.cover_url,
          show_text_on_cover: book.show_text_on_cover,
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: "Book created",
        description: "Your first page is ready — happy writing.",
      });
      setIntakeBookId(data.id);
      setIntakeOpen(true);
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Error creating book",
        description:
          error instanceof Error ? error.message : "An unknown error occurred",
      });
    } finally {
      setSaving(false);
    }
  };

  // Draft onboarding: an existing manuscript (.epub) becomes a DNA-native book — prose imported
  // as locked scenes, plan rungs left for the Studio to infer/author.
  const handleEpubImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-picking the same file after a failure
    if (!file) return;
    try {
      setImporting(true);
      const result = await importEpubAsBook(file);
      toast({
        title: `Imported “${result.title}”`,
        description: `${result.chapters} chapters · ${result.scenes} scenes · ${result.words.toLocaleString()} words. Your prose is locked — the Studio builds around it.`,
      });
      navigate(`/books/${result.bookId}/dna`);
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Import failed",
        description: error instanceof Error ? error.message : "Could not read that epub.",
      });
    } finally {
      setImporting(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;

    const fileExt = file.name.split(".").pop();
    const fileName = `new_${Math.random().toString(36).slice(2)}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from("public_images")
      .upload(fileName, file);

    if (uploadError) {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: uploadError.message,
      });
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("public_images").getPublicUrl(fileName);

    setBook((prev) => ({ ...prev, cover_url: publicUrl, cover_tone: null }));
    setUploadOpen(false);
  };

  const handleUnsplashSelect = (url: string) => {
    setBook((prev) => ({ ...prev, cover_url: url, cover_tone: null }));
    setUploadOpen(false);
  };

  const previewTitle = book.name.trim() || "Untitled";
  const previewAuthor = (book.author || authorDefault).trim();

  // Intake finished or dismissed → present the fork: write manually or build with the Studio.
  const closeIntake = (open: boolean) => {
    setIntakeOpen(open);
    // Defer so the intake dialog finishes closing before the choice dialog opens — swapping two Radix
    // dialogs in the same tick can leave the body with pointer-events:none.
    if (!open) setTimeout(() => setChoiceOpen(true), 150);
  };

  const chooseMode = (mode: WriteMode) => {
    setChoiceOpen(false);
    if (!intakeBookId) return;
    // Studio mode lands on the full-screen Studio route; manual mode lands on the book page.
    navigate(`/books/${intakeBookId}${mode === "studio" ? "/dna/overview" : ""}`);
  };

  // Dismissing the choice (Esc / overlay) still lands the author on the book — as if they chose manual.
  const onChoiceOpenChange = (open: boolean) => {
    if (open) setChoiceOpen(true);
    else chooseMode("manual");
  };

  return (
    <div className="mx-auto max-w-[1080px] px-6 pb-24 pt-12 md:px-12">
      {/* Masthead */}
      <header className="mb-12">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="pv-serif text-[14px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground"
        >
          ← back to your books
        </button>
        <h1 className="pv-display mt-4 text-[44px] font-normal leading-[1.05] tracking-tight text-foreground md:text-[56px]">
          <em>Start</em> a new book.
        </h1>
        <p className="pv-serif mt-3 max-w-[560px] text-[18px] italic leading-snug text-[hsl(var(--pv-text-muted))] md:text-[19px]">
          Begin with the spine. You can fill in the chapters whenever the writing finds you.
        </p>
        <p className="pv-serif mt-2 text-[14px] italic text-[hsl(var(--pv-text-muted))]">
          Already have a draft?{" "}
          <button
            type="button"
            disabled={importing}
            onClick={() => epubInputRef.current?.click()}
            className="underline underline-offset-2 transition-colors hover:text-foreground disabled:opacity-60"
          >
            {importing ? "Importing your draft…" : "Import an .epub"}
          </button>
        </p>
        <input
          ref={epubInputRef}
          type="file"
          accept=".epub,application/epub+zip"
          className="hidden"
          onChange={handleEpubImport}
        />
      </header>

      <form
        onSubmit={handleSubmit}
        className="grid grid-cols-1 items-start gap-12 md:grid-cols-[360px_1fr] md:gap-16"
      >
        {/* Cover preview column */}
        <div>
          <div className="pv-eyebrow mb-2.5">Cover</div>
          <div
            className="aspect-[4/5] w-full rounded-md border border-border bg-[hsl(var(--pv-surface-2))] p-3.5"
          >
            <div
              className="relative h-full w-full overflow-hidden rounded-[3px] shadow-[0_12px_28px_rgba(0,0,0,0.10)]"
              style={
                book.cover_url
                  ? undefined
                  : book.cover_tone
                    ? { background: book.cover_tone }
                    : {
                        backgroundImage:
                          "repeating-linear-gradient(135deg, rgba(0,0,0,0.04) 0 14px, rgba(0,0,0,0.00) 14px 28px), linear-gradient(135deg, hsl(var(--pv-surface-2)), hsl(var(--pv-border-soft)))",
                      }
              }
            >
              {book.cover_url && (
                <img
                  src={book.cover_url}
                  alt="Cover preview"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              )}
              {/* Title overlay */}
              {book.show_text_on_cover && (
                <div
                  className="absolute inset-0 flex flex-col justify-end p-7"
                  style={{
                    background: book.cover_url
                      ? "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55))"
                      : "linear-gradient(180deg, rgba(0,0,0,0) 60%, rgba(0,0,0,0.25))",
                  }}
                >
                  <div className="pv-mono text-[11px] uppercase tracking-[0.18em] text-white/85">
                    a book on Pensive
                  </div>
                  <div className="pv-display mt-1.5 text-[36px] font-normal italic leading-none text-white">
                    {previewTitle}
                  </div>
                  {previewAuthor && (
                    <div className="pv-serif mt-1.5 text-[14px] text-white/85">
                      by {previewAuthor}
                    </div>
                  )}
                </div>
              )}

              {/* Upload trigger */}
              <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
                <DialogTrigger asChild>
                  <button
                    type="button"
                    className="pv-serif absolute bottom-3.5 right-3.5 inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-[13px] text-foreground"
                  >
                    <ImageIcon className="h-3.5 w-3.5" />
                    <span>Upload an image</span>
                  </button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Choose cover image</DialogTitle>
                  </DialogHeader>
                  <Tabs defaultValue="upload">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="upload">Upload</TabsTrigger>
                      <TabsTrigger value="unsplash">Unsplash</TabsTrigger>
                    </TabsList>
                    <TabsContent value="upload" className="space-y-4">
                      <Input
                        type="file"
                        accept="image/*"
                        onChange={handleFileUpload}
                      />
                    </TabsContent>
                    <TabsContent value="unsplash">
                      <UnsplashPicker onSelect={handleUnsplashSelect} />
                    </TabsContent>
                  </Tabs>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {/* Show-on-cover toggle */}
          <label className="mt-5 inline-flex cursor-pointer items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={book.show_text_on_cover}
              onClick={() =>
                setBook((prev) => ({ ...prev, show_text_on_cover: !prev.show_text_on_cover }))
              }
              className={`relative h-[22px] w-[38px] rounded-full transition-colors ${
                book.show_text_on_cover ? "bg-foreground" : "bg-border"
              }`}
            >
              <span
                className="absolute top-[2px] h-[18px] w-[18px] rounded-full bg-background transition-all"
                style={{
                  left: book.show_text_on_cover ? "calc(100% - 20px)" : "2px",
                }}
              />
            </button>
            <span className="pv-serif text-[14px] text-foreground">
              Show title and author on the cover
            </span>
          </label>

          {/* Tone swatches */}
          <div className="mt-7">
            <div className="pv-eyebrow mb-3">Or pick a tone</div>
            <div className="flex gap-2">
              {SWATCHES.map((s) => {
                const active = book.cover_tone === s.value;
                return (
                  <button
                    key={s.value}
                    type="button"
                    aria-label={`${s.label} cover`}
                    onClick={() =>
                      setBook((prev) => ({
                        ...prev,
                        cover_tone: s.value,
                        cover_url: null,
                      }))
                    }
                    className={`h-[26px] w-[26px] rounded-full border transition-transform ${
                      active
                        ? "scale-110 border-foreground"
                        : "border-black/15 hover:scale-105"
                    }`}
                    style={{ background: s.value }}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Form column */}
        <div>
          <Field label="Book title">
            <input
              type="text"
              value={book.name}
              onChange={(e) => setBook((p) => ({ ...p, name: e.target.value }))}
              placeholder="The title of your book"
              className="pv-display w-full bg-transparent text-[28px] font-normal italic tracking-tight text-foreground outline-none placeholder:text-[hsl(var(--pv-text-faint))] md:text-[36px]"
              style={{ letterSpacing: "-0.3px" }}
              autoFocus
            />
          </Field>

          <Field label="Subtitle">
            <input
              type="text"
              value={book.subtitle}
              onChange={(e) => setBook((p) => ({ ...p, subtitle: e.target.value }))}
              placeholder="A single line that opens the door…"
              className="pv-serif w-full bg-transparent text-[16px] italic text-foreground outline-none placeholder:text-[hsl(var(--pv-text-faint))]"
            />
          </Field>

          <Field label="Author">
            <input
              type="text"
              value={book.author}
              onChange={(e) => setBook((p) => ({ ...p, author: e.target.value }))}
              placeholder={authorDefault || "Your name"}
              className="pv-serif w-full bg-transparent text-[16px] text-foreground outline-none placeholder:text-[hsl(var(--pv-text-faint))]"
            />
          </Field>

          <div className="mb-9 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Visibility" tight>
              <div className="flex flex-1 items-center justify-between">
                <select
                  value={book.is_public ? "public" : "private"}
                  onChange={(e) =>
                    setBook((p) => ({ ...p, is_public: e.target.value === "public" }))
                  }
                  className="pv-serif w-full appearance-none bg-transparent text-[16px] text-foreground outline-none"
                >
                  <option value="private">Private · only you</option>
                  <option value="public">Public · in the Library</option>
                </select>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--pv-text-muted))]" />
              </div>
            </Field>
            <Field label="Category" tight>
              <div className="flex flex-1 items-center justify-between">
                <span className="pv-serif text-[16px] italic text-[hsl(var(--pv-text-faint))]">
                  Choose a category…
                </span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--pv-text-muted))]" />
              </div>
            </Field>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="pv-serif inline-flex h-11 items-center rounded-full border border-border bg-transparent px-5 text-[14px] italic text-[hsl(var(--pv-text-muted))] transition-colors hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="pv-serif inline-flex h-11 items-center rounded-full bg-foreground px-5 text-[14px] tracking-[0.01em] text-background transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save & start writing →"}
            </button>
          </div>

          <p className="pv-serif mt-7 border-t border-dashed border-border pt-5 text-[14px] italic leading-relaxed text-[hsl(var(--pv-text-muted))]">
            <em>tip</em> — you can change any of this later. The first page is created for you,
            so you can begin the moment you press save.
          </p>
        </div>
      </form>

      {intakeBookId && (
        <>
          <BriefIntakeSheet
            bookId={intakeBookId}
            open={intakeOpen}
            onOpenChange={closeIntake}
            onFinish={() => {
              /* choice modal is opened by closeIntake via onOpenChange */
            }}
          />
          <WriteModeDialog
            open={choiceOpen}
            onOpenChange={onChoiceOpenChange}
            onChoose={chooseMode}
          />
        </>
      )}
    </div>
  );
};

function Field({
  label,
  children,
  tight = false,
}: {
  label: string;
  children: React.ReactNode;
  tight?: boolean;
}) {
  return (
    <div className={tight ? "mb-0" : "mb-7"}>
      <div className="pv-eyebrow mb-2.5">{label}</div>
      <div
        className="flex items-center gap-3 rounded-[10px] border border-border bg-[hsl(var(--pv-surface-2))] px-4 transition-colors focus-within:border-[hsl(var(--pv-text-faint))]"
        style={{ minHeight: tight ? 48 : 56 }}
      >
        {children}
      </div>
    </div>
  );
}

export default NewBook;
