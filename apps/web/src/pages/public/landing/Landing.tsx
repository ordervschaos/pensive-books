import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Book,
  BookOpen,
  Check,
  Code,
  Download,
  Globe,
  Rocket,
  Server,
  Sparkles,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface PublicBook {
  id: number;
  name: string;
  author: string | null;
  subtitle: string | null;
  cover_url: string | null;
  show_text_on_cover: boolean;
}

const sectionReveal = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.2 },
  transition: { duration: 0.5 },
};

const platformNotes = [
  {
    icon: Rocket,
    title: "Instant publishing",
    desc: "Make a book public the moment it is ready. No storefront queue, no approval loop.",
  },
  {
    icon: Users,
    title: "Invite collaborators",
    desc: "Write solo or bring in co-authors and readers without losing the shape of the book.",
  },
  {
    icon: Download,
    title: "Readable offline",
    desc: "Export EPUB files so people can keep reading away from the browser.",
  },
];

const featureHighlights = [
  {
    icon: Book,
    title: "Write in a book-first workflow",
    desc: "Draft chapters and pages in a structure that already feels like a finished publication instead of a pile of disconnected documents.",
    className: "sm:col-span-2",
  },
  {
    icon: Code,
    title: "Customize the presentation",
    desc: "Adjust covers, layouts, and the final reading experience without fighting a rigid template.",
  },
  {
    icon: Users,
    title: "Collaborate without chaos",
    desc: "Share the work with co-authors, reviewers, or early readers while keeping the book organized.",
  },
  {
    icon: Rocket,
    title: "Publish when you decide",
    desc: "Turn a draft into a public book with a switch instead of a complicated release process.",
  },
  {
    icon: Server,
    title: "Hosted or self-hosted",
    desc: "Use the managed service if you want speed, or run your own instance if control matters more.",
  },
  {
    icon: Download,
    title: "Keep portable copies",
    desc: "Let readers download EPUB versions so the book is useful online and offline.",
  },
];

const workflowSteps = [
  {
    number: "01",
    title: "Start your book",
    desc: "Create a book, set the metadata, and give it a strong starting structure.",
    img: "/homepage_images/new_book.png",
  },
  {
    number: "02",
    title: "Write and revise",
    desc: "Work in the editor with room for long-form drafts, rewrites, and cleanup.",
    img: "/homepage_images/editor_ui.png",
  },
  {
    number: "03",
    title: "Organize the reading flow",
    desc: "Arrange chapters and pages so the book reads cleanly from beginning to end.",
    img: "/homepage_images/book_page.png",
  },
  {
    number: "04",
    title: "Share and collaborate",
    desc: "Invite the people you need, then publish publicly when the manuscript is ready.",
    img: "/homepage_images/invite_as_many_people_as_you_want.png",
  },
];

const publishOptions = [
  {
    icon: BookOpen,
    title: "Fiction and nonfiction",
    desc: "Novels, memoirs, essays, poetry, research notes, and other long-form writing.",
  },
  {
    icon: Code,
    title: "Manuals and documentation",
    desc: "Software guides, internal playbooks, hardware docs, and process-heavy reference books.",
  },
  {
    icon: Sparkles,
    title: "Image-led books",
    desc: "Graphic novels, picture books, illustrated essays, and visual storytelling projects.",
  },
];

export default function Landing() {
  const navigate = useNavigate();
  const [publicBooks, setPublicBooks] = useState<PublicBook[]>([]);

  useEffect(() => {
    const fetchPublicBooks = async () => {
      const { data, error } = await supabase
        .from("books")
        .select("id, name, author, subtitle, cover_url, show_text_on_cover")
        .eq("is_public", true)
        .eq("is_archived", false)
        .order("created_at", { ascending: false })
        .limit(10);

      if (!error && data) {
        setPublicBooks(data);
      }
    };

    fetchPublicBooks();
  }, []);

  const openPublicBook = (bookId: number) => {
    navigate(`/library/books/${bookId}`);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none absolute left-[-10rem] top-[-8rem] h-[24rem] w-[24rem] rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute right-[-8rem] top-[18rem] h-[22rem] w-[22rem] rounded-full bg-muted blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-10rem] left-1/3 h-[24rem] w-[24rem] rounded-full bg-primary/5 blur-3xl" />

      <main className="container relative mx-auto space-y-24 px-6 py-10 md:space-y-28 md:py-14">
        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
          className="relative overflow-hidden rounded-[2rem] border border-border/70 bg-gradient-to-br from-background via-background to-muted/40 p-8 shadow-[0_30px_100px_-60px_rgba(0,0,0,0.65)] md:p-10 lg:p-14"
        >
          <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/3 bg-gradient-to-l from-primary/5 to-transparent lg:block" />

          <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <div className="space-y-8">
              <Badge
                variant="outline"
                className="w-fit rounded-full border-primary/20 bg-primary/5 px-4 py-1 text-[11px] uppercase tracking-[0.22em] text-primary"
              >
                Open-source publishing platform
              </Badge>

              <div className="space-y-5">
                <h1 className="max-w-4xl font-serif text-5xl leading-none tracking-tight text-primary md:text-6xl lg:text-7xl">
                  Write books for the web. Publish them on your terms.
                </h1>
                <p className="max-w-2xl text-lg leading-8 text-muted-foreground md:text-xl">
                  Pensive gives writers a direct path from draft to public book:
                  clean structure, readable pages, simple collaboration, and no
                  platform gatekeeping.
                </p>
              </div>

              <div className="flex flex-wrap gap-4">
                <Button
                  size="lg"
                  onClick={() => navigate("/auth")}
                  className="group h-12 rounded-full px-6 text-base"
                >
                  Start writing
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => navigate("/library")}
                  className="h-12 rounded-full px-6 text-base"
                >
                  Browse library
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  "Book-shaped writing workflow",
                  "EPUB export for offline reading",
                  "Hosted service or self-hosted install",
                ].map((item) => (
                  <div
                    key={item}
                    className="flex items-center gap-3 rounded-2xl border border-border/70 bg-background/70 px-4 py-3 backdrop-blur"
                  >
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Check className="h-4 w-4" />
                    </span>
                    <span className="text-sm font-medium text-foreground">
                      {item}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative">
              <div className="pointer-events-none absolute -right-8 top-10 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />

              <div className="grid gap-4">
                <Card className="overflow-hidden rounded-[1.75rem] border-primary/10 bg-card/95 shadow-2xl shadow-primary/10">
                  <div className="flex flex-col gap-3 border-b border-border/60 bg-background/80 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                        Live editor
                      </p>
                      <h2 className="mt-1 font-serif text-xl text-primary">
                        Built for long-form drafts
                      </h2>
                    </div>
                    <div className="inline-flex w-fit items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                      <Sparkles className="h-3.5 w-3.5" />
                      Clean and readable
                    </div>
                  </div>
                  <img
                    src="/homepage_images/editor_ui.png"
                    alt="Pensive editor interface"
                    className="w-full object-cover"
                  />
                </Card>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Card className="overflow-hidden rounded-[1.5rem] border-border/70 bg-background/85">
                    <div className="space-y-1 px-4 py-4">
                      <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                        Structure
                      </p>
                      <h3 className="font-serif text-xl text-primary">
                        Organize pages and chapters
                      </h3>
                    </div>
                    <img
                      src="/homepage_images/new_book.png"
                      alt="Create a new book in Pensive"
                      className="h-44 w-full object-cover object-top"
                    />
                  </Card>

                  <Card className="overflow-hidden rounded-[1.5rem] border-border/70 bg-background/85">
                    <div className="space-y-1 px-4 py-4">
                      <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                        Library
                      </p>
                      <h3 className="font-serif text-xl text-primary">
                        Share a public catalog
                      </h3>
                    </div>
                    <img
                      src="/homepage_images/public_library.png"
                      alt="Public library view"
                      className="h-44 w-full object-cover object-top"
                    />
                  </Card>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-10 grid gap-4 border-t border-border/70 pt-8 md:grid-cols-3">
            {platformNotes.map((note) => (
              <div
                key={note.title}
                className="rounded-[1.5rem] border border-border/70 bg-background/65 p-5 backdrop-blur"
              >
                <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <note.icon className="h-5 w-5" />
                </div>
                <h3 className="font-serif text-2xl text-primary">{note.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {note.desc}
                </p>
              </div>
            ))}
          </div>
        </motion.section>

        <motion.section {...sectionReveal} className="space-y-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-3">
              <Badge
                variant="outline"
                className="w-fit rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.22em]"
              >
                Public library
              </Badge>
              <div className="space-y-2">
                <h2 className="font-serif text-4xl tracking-tight text-primary md:text-5xl">
                  Recent books published with Pensive
                </h2>
                <p className="max-w-2xl text-lg text-muted-foreground">
                  Browse what writers are already sharing on the web, then open
                  a book and see how the reading experience feels in practice.
                </p>
              </div>
            </div>

            <Button
              variant="ghost"
              onClick={() => navigate("/library")}
              className="group h-11 w-fit rounded-full px-0 text-sm font-medium text-primary hover:bg-transparent hover:text-primary/80"
            >
              Browse all books
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Button>
          </div>

          {publicBooks.length > 0 ? (
            <div className="relative rounded-[1.75rem] border border-border/70 bg-card/60 p-4 shadow-[0_24px_70px_-60px_rgba(0,0,0,0.7)] md:p-6">
              <Carousel className="w-full">
                <CarouselContent className="-ml-4">
                  {publicBooks.map((book) => (
                    <CarouselItem
                      key={book.id}
                      className="basis-[85%] pl-4 sm:basis-1/2 lg:basis-1/3 xl:basis-1/4"
                    >
                      <Card
                        className="group h-full cursor-pointer overflow-hidden rounded-[1.5rem] border border-border/60 bg-background/90 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
                        onClick={() => openPublicBook(book.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openPublicBook(book.id);
                          }
                        }}
                        role="link"
                        tabIndex={0}
                      >
                        {book.cover_url ? (
                          <div className="relative aspect-[3/4] overflow-hidden bg-muted">
                            <img
                              src={book.cover_url}
                              alt={book.name}
                              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                            />
                            {book.show_text_on_cover && (
                              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4">
                                <h3 className="line-clamp-2 font-serif text-lg text-white">
                                  {book.name}
                                </h3>
                                {book.author && (
                                  <p className="mt-1 text-xs uppercase tracking-[0.18em] text-white/75">
                                    By {book.author}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex aspect-[3/4] items-center justify-center bg-muted p-6">
                            <h3 className="line-clamp-4 text-center font-serif text-2xl text-muted-foreground">
                              {book.name}
                            </h3>
                          </div>
                        )}

                        <div className="space-y-1 p-4">
                          <h3 className="line-clamp-2 font-serif text-xl text-primary">
                            {book.name}
                          </h3>
                          {book.subtitle && (
                            <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">
                              {book.subtitle}
                            </p>
                          )}
                          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                            {book.author ? `By ${book.author}` : "Published on Pensive"}
                          </p>
                        </div>
                      </Card>
                    </CarouselItem>
                  ))}
                </CarouselContent>
                <CarouselPrevious className="-left-3 hidden h-12 w-12 border-border/70 bg-background/90 shadow-md sm:inline-flex" />
                <CarouselNext className="-right-3 hidden h-12 w-12 border-border/70 bg-background/90 shadow-md sm:inline-flex" />
              </Carousel>
            </div>
          ) : (
            <Card className="overflow-hidden rounded-[1.75rem] border-border/70 bg-card/60">
              <div className="grid gap-6 p-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-center md:p-8">
                <div className="space-y-4">
                  <h3 className="font-serif text-3xl text-primary">
                    Explore the public library
                  </h3>
                  <p className="text-lg leading-8 text-muted-foreground">
                    The carousel will populate as soon as public books are
                    available. You can still open the library and browse the
                    latest published work there.
                  </p>
                  <Button
                    size="lg"
                    onClick={() => navigate("/library")}
                    className="group h-12 rounded-full px-6 text-base"
                  >
                    Open library
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </Button>
                </div>

                <img
                  src="/homepage_images/public_library.png"
                  alt="Pensive public library"
                  className="w-full rounded-[1.5rem] border border-border/70"
                />
              </div>
            </Card>
          )}
        </motion.section>

        <motion.section
          {...sectionReveal}
          className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-12"
        >
          <div className="space-y-6 lg:sticky lg:top-20 lg:self-start">
            <Badge
              variant="outline"
              className="w-fit rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.22em]"
            >
              Why Pensive
            </Badge>

            <div className="space-y-4">
              <h2 className="font-serif text-4xl tracking-tight text-primary md:text-5xl">
                A publishing workflow that still feels like writing.
              </h2>
              <p className="max-w-xl text-lg leading-8 text-muted-foreground">
                The goal is not to turn authors into CMS operators. Pensive adds
                enough structure to ship a real book, while keeping the work
                centered on pages, chapters, and reading flow.
              </p>
            </div>

            <a
              href="https://www.pensive.me/book/658-the-pensive-manual"
              target="_blank"
              rel="noopener noreferrer"
              className="group block rounded-[1.5rem] border border-border/70 bg-gradient-to-br from-background to-muted/40 p-6 transition-colors hover:border-primary/20"
            >
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                <BookOpen className="h-5 w-5" />
              </div>
              <h3 className="mt-5 font-serif text-2xl text-primary">
                Read the complete Pensive manual
              </h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                See the product in detail, from writing workflow to publishing
                and distribution.
              </p>
              <div className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-primary">
                Open manual
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </div>
            </a>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {featureHighlights.map((feature) => (
              <Card
                key={feature.title}
                className={cn(
                  "rounded-[1.5rem] border-border/70 bg-gradient-to-br from-background to-muted/40 p-6 shadow-sm",
                  feature.className
                )}
              >
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <feature.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-5 font-serif text-2xl text-primary">
                  {feature.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {feature.desc}
                </p>
              </Card>
            ))}
          </div>
        </motion.section>

        <motion.section
          {...sectionReveal}
          className="rounded-[2rem] border border-border/70 bg-gradient-to-br from-muted/40 via-background to-background p-6 md:p-10"
        >
          <div className="max-w-3xl space-y-4">
            <Badge
              variant="outline"
              className="w-fit rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.22em]"
            >
              From draft to publication
            </Badge>
            <h2 className="font-serif text-4xl tracking-tight text-primary md:text-5xl">
              How it works
            </h2>
            <p className="text-lg leading-8 text-muted-foreground">
              Pensive keeps the path straightforward: start the book, write it,
              shape the structure, then publish it when you are ready to share.
            </p>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {workflowSteps.map((step) => (
              <Card
                key={step.number}
                className="overflow-hidden rounded-[1.5rem] border-border/70 bg-background/85"
              >
                <div className="space-y-4 p-6">
                  <div className="flex items-start gap-4">
                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                      {step.number}
                    </span>
                    <div>
                      <h3 className="font-serif text-2xl text-primary">
                        {step.title}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {step.desc}
                      </p>
                    </div>
                  </div>
                </div>
                <img
                  src={step.img}
                  alt={step.title}
                  className="h-64 w-full object-cover object-top"
                />
              </Card>
            ))}
          </div>

          <div className="mt-6 overflow-hidden rounded-[1.75rem] bg-primary text-primary-foreground">
            <div className="grid gap-8 p-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-center md:p-10">
              <div className="space-y-5">
                <Badge
                  variant="outline"
                  className="w-fit rounded-full border-white/20 bg-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-white"
                >
                  Final step
                </Badge>
                <h3 className="font-serif text-4xl tracking-tight">
                  Ready to share? Just hit publish.
                </h3>
                <p className="max-w-xl text-lg leading-8 text-primary-foreground/75">
                  No complex release checklist, no gatekeepers, no marketplace
                  ceremony. When the book is ready, make it public and send
                  readers straight to it.
                </p>
                <Button
                  size="lg"
                  onClick={() => navigate("/auth")}
                  className="h-12 rounded-full bg-background px-6 text-base text-foreground hover:bg-background/90"
                >
                  Start your first book
                </Button>
              </div>

              <div className="rounded-[1.5rem] bg-white/10 p-4 backdrop-blur">
                <img
                  src="/homepage_images/publish.gif"
                  alt="Publishing a book in Pensive"
                  className="w-full rounded-[1.25rem]"
                />
              </div>
            </div>
          </div>
        </motion.section>

        <motion.section
          {...sectionReveal}
          className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]"
        >
          <Card className="rounded-[1.75rem] border-border/70 bg-card/60 p-6 md:p-8">
            <Badge
              variant="outline"
              className="w-fit rounded-full px-3 py-1 text-[11px] uppercase tracking-[0.22em]"
            >
              Made for books of all kinds
            </Badge>
            <h2 className="mt-4 font-serif text-4xl tracking-tight text-primary">
              What can you publish on Pensive?
            </h2>
            <p className="mt-3 max-w-2xl text-lg leading-8 text-muted-foreground">
              If it works as a book, it belongs here. Pensive is flexible enough
              for narrative writing, reference material, and image-led formats.
            </p>

            <div className="mt-8 grid gap-4">
              {publishOptions.map((option) => (
                <div
                  key={option.title}
                  className="rounded-[1.5rem] border border-border/70 bg-background/80 p-5"
                >
                  <div className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <option.icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 font-serif text-2xl text-primary">
                    {option.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {option.desc}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          <section className="relative overflow-hidden rounded-[1.75rem] bg-primary p-8 text-primary-foreground md:p-10">
            <div className="pointer-events-none absolute right-0 top-0 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
            <div className="pointer-events-none absolute bottom-0 left-0 h-36 w-36 rounded-full bg-white/10 blur-3xl" />

            <div className="relative space-y-6">
              <Badge
                variant="outline"
                className="w-fit rounded-full border-white/20 bg-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-white"
              >
                Own your publishing stack
              </Badge>
              <div className="space-y-4">
                <h2 className="font-serif text-4xl tracking-tight">
                  Open-source and self-hostable
                </h2>
                <p className="text-lg leading-8 text-primary-foreground/75">
                  Use the hosted service if you want the simplest path. If you
                  need more control, run your own version, customize it, and
                  keep the full publishing workflow in your hands.
                </p>
              </div>

              <div className="space-y-3">
                {[
                  {
                    icon: Globe,
                    label: "Publish to the web with a clean public reading experience.",
                  },
                  {
                    icon: Server,
                    label: "Self-host when ownership and customization matter.",
                  },
                  {
                    icon: Download,
                    label: "Keep books portable with EPUB export built into the workflow.",
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                  >
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white">
                      <item.icon className="h-5 w-5" />
                    </span>
                    <p className="text-sm leading-6 text-primary-foreground/80">
                      {item.label}
                    </p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-3 pt-2">
                <Button
                  size="lg"
                  onClick={() => navigate("/auth")}
                  className="h-12 rounded-full bg-background px-6 text-base text-foreground hover:bg-background/90"
                >
                  Start writing
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() =>
                    window.open(
                      "https://github.com/ordervschaos/pensive-books-v2",
                      "_blank"
                    )
                  }
                  className="h-12 rounded-full border-white/20 bg-transparent px-6 text-base text-white hover:bg-white/10 hover:text-white"
                >
                  View on GitHub
                </Button>
              </div>
            </div>
          </section>
        </motion.section>
      </main>
    </div>
  );
}
