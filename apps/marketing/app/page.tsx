import type { Metadata } from "next";
import { getFeaturedBooks } from "@/lib/public-books";
import {
  getConfiguredAppOrigin,
} from "@/lib/pensive";
import { FeaturedBooksCarousel } from "@/components/FeaturedBooksCarousel";
import { Code, Book, Users, Rocket, Download, Server } from "lucide-react";

export const metadata: Metadata = {
  title: "Pensive",
  description: "Write, publish, and share your books with ease.",
  openGraph: {
    title: "Pensive",
    description: "Write, publish, and share your books with ease.",
    images: ["/og-image.png"],
  },
};

const primaryButtonClass =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary px-8 py-6 text-lg font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const outlineButtonClass =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-input bg-background px-8 py-6 text-lg font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const cardClass = "rounded-lg border bg-card text-card-foreground shadow-sm";

export default async function HomePage() {
  const appOrigin = getConfiguredAppOrigin();
  const featuredBooks = await getFeaturedBooks();

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto space-y-24 px-6 py-16">
        <div className="mx-auto max-w-3xl space-y-8 text-center">
          <div>
            <h1 className="mb-4 font-serif text-6xl font-bold text-primary md:text-7xl">
              Pensive
            </h1>
            <p className="text-2xl text-primary/90 md:text-3xl">
              Write, publish, and share your books with ease
            </p>
          </div>

          <p className="text-lg text-muted-foreground">
            Publish your own books on the web - free, open, and simple.
          </p>

          <img
            src="/homepage_images/book_page.png"
            alt="Book page"
            className="w-full rounded-lg border border-border"
          />

          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            Writing online is easy, but publishing a whole book shouldn&apos;t be hard either.
            Pensive makes it effortless to create, organize, and publish books in a beautiful,
            readable format.
          </p>

          <div className="flex flex-wrap justify-center gap-4">
            <a href={`${appOrigin}/auth`} className={primaryButtonClass}>
              Start writing
            </a>
            <a href="/library" className={outlineButtonClass}>
              Browse library
            </a>
          </div>
        </div>

        {featuredBooks.length > 0 && (
          <section className="space-y-8">
            <h2 className="text-center font-serif text-4xl font-bold text-primary">
              Featured Books
            </h2>
            <FeaturedBooksCarousel books={featuredBooks} />
          </section>
        )}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[
            {
              icon: Book,
              title: "Write and edit",
              desc: "Write, edit, and structure your book with ease",
            },
            {
              icon: Code,
              title: "Customize",
              desc: "Customize covers, layouts, and content seamlessly",
            },
            {
              icon: Users,
              title: "Collaborate",
              desc: "Collaborate with co-authors or invite readers",
            },
            {
              icon: Rocket,
              title: "Publish",
              desc: "Publish instantly—no publisher, no gatekeepers",
            },
            {
              icon: Server,
              title: "Self-host or use our service",
              desc: "Host it yourself or use our hosted service",
            },
            {
              icon: Download,
              title: "Download and read offline",
              desc: "Download books in EPUB format",
            },
          ].map((feature) => (
            <div key={feature.title} className={`${cardClass} space-y-3 p-6`}>
              <feature.icon className="h-6 w-6 text-primary" />
              <h3 className="text-lg font-medium">{feature.title}</h3>
              <p className="text-sm text-muted-foreground">{feature.desc}</p>
            </div>
          ))}
        </div>

        <section className="space-y-12">
          <h2 className="text-center font-serif text-4xl font-bold text-primary">
            How it works
          </h2>

          <div className="space-y-16">
            <div className="grid gap-12 md:grid-cols-2">
              {[
                {
                  title: "1. Start your book",
                  desc: "Create a new book and customize its details.",
                  img: "/homepage_images/new_book.png",
                },
                {
                  title: "2. Write and edit",
                  desc: "Use our powerful editor to write your content.",
                  img: "/homepage_images/editor_ui.png",
                },
                {
                  title: "3. Organize your book",
                  desc: "Structure your book with chapters and pages.",
                  img: "/homepage_images/book_page.png",
                },
                {
                  title: "4. Collaborate and share",
                  desc: "Invite co-authors or share with readers.",
                  img: "/homepage_images/invite_as_many_people_as_you_want.png",
                },
              ].map((step) => (
                <div key={step.title} className="space-y-4">
                  <h3 className="text-2xl font-medium text-primary">{step.title}</h3>
                  <p className="text-muted-foreground">{step.desc}</p>
                  <img
                    src={step.img}
                    alt={step.title}
                    className="w-full rounded-lg border border-border"
                  />
                </div>
              ))}
            </div>

            <div className="mx-auto max-w-3xl space-y-6 border-t pt-12 text-center">
              <h3 className="px-4 text-3xl font-medium text-primary">
                5. Ready to share? Just hit publish
              </h3>
              <p className="px-4 text-lg text-muted-foreground">
                No complex process, no gatekeepers. Just flip a switch to make your book public.
                It&apos;s that simple.
              </p>
              <div className="mx-4 rounded-xl border bg-card p-4 md:p-8">
                <img
                  src="/homepage_images/publish.gif"
                  alt="Publishing is as simple as flipping a switch"
                  className="mx-auto w-full max-w-lg rounded-lg"
                />
              </div>
            </div>
          </div>
        </section>

        <div className="space-y-6 rounded-lg border p-12 text-center">
          <h3 className="text-3xl font-medium text-primary">Want to learn more?</h3>
          <a
            href="/library/books/658-the-pensive-manual"
            className="inline-flex items-center gap-3 text-xl font-medium text-primary hover:text-primary/90"
          >
            <span>📖</span>
            <span>Read the complete Pensive manual</span>
            <span>→</span>
          </a>
        </div>

        <section className="space-y-12">
          <div className="text-center">
            <h2 className="mb-4 font-serif text-4xl font-bold text-primary">
              What can you publish on Pensive?
            </h2>
            <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
              If you&apos;ve written it, it&apos;s ready for Pensive. No middlemen, no approval
              process—just publish.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                icon: "📚",
                title: "Fiction and nonfiction",
                desc: "Novels, memoirs, essays, poetry, and more.",
              },
              {
                icon: "📖",
                title: "Instruction manuals",
                desc: "Document your software, hardware, or workflows.",
              },
              {
                icon: "🖼️",
                title: "Graphic novels and picture books",
                desc: "Use images to tell compelling stories.",
              },
            ].map((item) => (
              <div key={item.title} className={`${cardClass} space-y-3 p-6`}>
                <span className="text-3xl">{item.icon}</span>
                <h3 className="text-lg font-medium">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-8 rounded-lg border p-12 text-center">
          <h2 className="font-serif text-4xl font-bold text-primary">
            Open-source and self-hostable
          </h2>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            Unlike closed platforms, Pensive is open-source, meaning you can host your own version,
            customize it, and retain full control over your books. Or, use our hosted service for
            a hassle-free experience.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <a href={`${appOrigin}/auth`} className={primaryButtonClass}>
              Start writing
            </a>
            <a
              href="https://github.com/ordervschaos/pensive-books-v2"
              target="_blank"
              rel="noreferrer"
              className={outlineButtonClass}
            >
              View on GitHub
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
