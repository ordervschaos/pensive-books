import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Code, Book, Users, Rocket, Globe, Server } from "lucide-react";

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-6 py-16 space-y-24">
        {/* Hero Section */}
        <div className="text-center space-y-6 max-w-3xl mx-auto">
          <div className="space-y-4">
            <h1 className="text-4xl md:text-6xl font-serif font-bold tracking-tight">
              Pensive Books – Write, Publish, and Share Your Books with Ease
            </h1>
            <p className="text-xl text-muted-foreground">
              Publish your own books on the web—free, open, and simple.
            </p>
          </div>
          <p className="text-lg text-muted-foreground leading-relaxed">
            Writing online is easy, but publishing a whole book shouldn't be hard either. 
            Pensive Books makes it effortless to create, organize, and publish books in a beautiful, 
            readable format—whether for yourself, your audience, or the world.
          </p>
          <div className="flex gap-4 justify-center">
            <Button size="lg" onClick={() => navigate("/auth")}>
              Start Writing
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate("/library")}>
              Browse Library
            </Button>
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="p-6 space-y-2 bg-card/50">
            <Book className="h-6 w-6 mb-2" />
            <h3 className="font-medium">Write & Edit</h3>
            <p className="text-sm text-muted-foreground">
              Write, edit, and structure your book with ease
            </p>
          </Card>
          <Card className="p-6 space-y-2 bg-card/50">
            <Code className="h-6 w-6 mb-2" />
            <h3 className="font-medium">Customize</h3>
            <p className="text-sm text-muted-foreground">
              Customize covers, layouts, and content seamlessly
            </p>
          </Card>
          <Card className="p-6 space-y-2 bg-card/50">
            <Users className="h-6 w-6 mb-2" />
            <h3 className="font-medium">Collaborate</h3>
            <p className="text-sm text-muted-foreground">
              Collaborate with co-authors or invite readers
            </p>
          </Card>
          <Card className="p-6 space-y-2 bg-card/50">
            <Rocket className="h-6 w-6 mb-2" />
            <h3 className="font-medium">Publish</h3>
            <p className="text-sm text-muted-foreground">
              Publish instantly—no publisher, no gatekeepers, just your words
            </p>
          </Card>
          <Card className="p-6 space-y-2 bg-card/50">
            <Globe className="h-6 w-6 mb-2" />
            <h3 className="font-medium">Share</h3>
            <p className="text-sm text-muted-foreground">
              Share with the world or keep it private
            </p>
          </Card>
          <Card className="p-6 space-y-2 bg-card/50">
            <Server className="h-6 w-6 mb-2" />
            <h3 className="font-medium">Self-host</h3>
            <p className="text-sm text-muted-foreground">
              Host it yourself or use our open-source platform
            </p>
          </Card>
        </div>

        {/* How it Works */}
        <section className="space-y-12">
          <div className="text-center">
            <h2 className="text-3xl font-serif font-bold">How it Works</h2>
          </div>
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-4">
              <h3 className="text-xl font-medium">Start your book</h3>
              <p className="text-muted-foreground">Give it a title and upload a cover.</p>
            </div>
            <div className="space-y-4">
              <h3 className="text-xl font-medium">Add content</h3>
              <p className="text-muted-foreground">Write chapters, insert images, and structure your ideas.</p>
            </div>
            <div className="space-y-4">
              <h3 className="text-xl font-medium">Organize effortlessly</h3>
              <p className="text-muted-foreground">Drag and rearrange pages as your story unfolds.</p>
            </div>
            <div className="space-y-4">
              <h3 className="text-xl font-medium">Collaborate</h3>
              <p className="text-muted-foreground">Invite co-authors to contribute or readers to review.</p>
            </div>
            <div className="space-y-4">
              <h3 className="text-xl font-medium">Publish with one click</h3>
              <p className="text-muted-foreground">Make it private, share with select people, or go fully public.</p>
            </div>
          </div>
        </section>

        {/* What You Can Publish */}
        <section className="space-y-12">
          <div className="text-center">
            <h2 className="text-3xl font-serif font-bold">What Can You Publish on Pensive Books?</h2>
            <p className="mt-4 text-lg text-muted-foreground">
              If you've written it, it's ready for Pensive Books. No middlemen, no approval process—just publish.
            </p>
          </div>
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-4">
              <h3 className="text-xl font-medium">📚 Fiction & Nonfiction</h3>
              <p className="text-muted-foreground">Novels, memoirs, essays, poetry, and more.</p>
            </div>
            <div className="space-y-4">
              <h3 className="text-xl font-medium">📖 Instruction Manuals</h3>
              <p className="text-muted-foreground">Document your software, hardware, or workflows.</p>
            </div>
            <div className="space-y-4">
              <h3 className="text-xl font-medium">🖼️ Graphic Novels & Picture Books</h3>
              <p className="text-muted-foreground">Use images to tell compelling stories.</p>
            </div>
          </div>
        </section>

        {/* Open Source Section */}
        <section className="text-center space-y-6">
          <h2 className="text-3xl font-serif font-bold">Open-Source & Self-Hostable</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Unlike closed platforms, Pensive Books is open-source, meaning you can host your own version, 
            customize it, and retain full control over your books. Or, use our hosted service for 
            a hassle-free experience.
          </p>
          <div className="flex justify-center gap-4">
            <Button size="lg" onClick={() => navigate("/auth")}>
              Start Writing
            </Button>
            <Button size="lg" variant="outline" onClick={() => window.open("https://github.com/ordervschaos/pensive-books", "_blank")}>
              View on GitHub
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}