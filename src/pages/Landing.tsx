import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpen, Users, Rocket, Code, PenTool } from "lucide-react";

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto space-y-24">
          {/* Hero Section */}
          <div className="space-y-6 text-center">
            <h1 className="text-5xl font-serif tracking-tight sm:text-6xl">
              Pensive
              <span className="text-sm align-super ml-1 text-muted-foreground">1.0</span>
            </h1>
            <p className="text-3xl font-serif text-muted-foreground">
              Instantly publish your own books on the web for free, no publisher required.
            </p>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Writing online is easy, but publishing a whole book shouldn't be hard either. Pensive makes it effortless to create, organize, and publish books in a beautiful, readable format—whether for yourself, your audience, or the world.
            </p>
            <div className="flex justify-center gap-4 pt-4">
              <Button size="lg" onClick={() => navigate("/auth")}>
                Start Writing
              </Button>
              <Button size="lg" variant="outline" onClick={() => navigate("/library")}>
                Browse Library
              </Button>
            </div>
          </div>

          {/* Features Section */}
          <div className="space-y-12">
            <h2 className="text-3xl font-serif text-center">Make a book, give it a title, upload a cover.</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <Card className="bg-card/50">
                <CardHeader>
                  <PenTool className="h-6 w-6 mb-2" />
                  <CardTitle>Write with Ease</CardTitle>
                  <CardDescription>
                    📖 Write, edit, and structure your book with ease.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className="bg-card/50">
                <CardHeader>
                  <BookOpen className="h-6 w-6 mb-2" />
                  <CardTitle>Beautiful Format</CardTitle>
                  <CardDescription>
                    🎨 Customize covers, layouts, and content seamlessly.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className="bg-card/50">
                <CardHeader>
                  <Users className="h-6 w-6 mb-2" />
                  <CardTitle>Collaboration</CardTitle>
                  <CardDescription>
                    👥 Collaborate with co-authors or invite readers.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className="bg-card/50">
                <CardHeader>
                  <Rocket className="h-6 w-6 mb-2" />
                  <CardTitle>Instant Publishing</CardTitle>
                  <CardDescription>
                    🚀 Publish instantly—no publisher, no gatekeepers, just your words.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className="bg-card/50">
                <CardHeader>
                  <Code className="h-6 w-6 mb-2" />
                  <CardTitle>Open Source</CardTitle>
                  <CardDescription>
                    🌍 Host it yourself or use our open-source platform.
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          </div>

          {/* How it Works Section */}
          <div className="space-y-8">
            <h2 className="text-3xl font-serif text-center">How Pensive Works</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <div className="space-y-2">
                <h3 className="text-xl font-semibold">Start your book</h3>
                <p className="text-muted-foreground">Give it a title and upload a cover.</p>
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-semibold">Add content</h3>
                <p className="text-muted-foreground">Write chapters, insert images, and structure your ideas.</p>
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-semibold">Organize effortlessly</h3>
                <p className="text-muted-foreground">Drag and rearrange pages as your story unfolds.</p>
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-semibold">Collaborate</h3>
                <p className="text-muted-foreground">Invite co-authors to contribute or readers to review.</p>
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-semibold">Publish with one click</h3>
                <p className="text-muted-foreground">Make it private, share with select people, or go fully public.</p>
              </div>
            </div>
          </div>

          {/* Publishing Options Section */}
          <div className="space-y-8">
            <h2 className="text-3xl font-serif text-center">What Can You Publish on Pensive?</h2>
            <p className="text-center text-lg text-muted-foreground">
              If you've written it, it's ready for Pensive. No middlemen, no approval process—just publish.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <Card className="bg-card/50">
                <CardHeader>
                  <CardTitle>Fiction & Nonfiction</CardTitle>
                  <CardDescription>
                    📚 Novels, memoirs, essays, poetry, and more.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className="bg-card/50">
                <CardHeader>
                  <CardTitle>Instruction Manuals</CardTitle>
                  <CardDescription>
                    📖 Document your software, hardware, or workflows.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className="bg-card/50">
                <CardHeader>
                  <CardTitle>Graphic Novels</CardTitle>
                  <CardDescription>
                    🖼️ Use images to tell compelling stories.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className="bg-card/50">
                <CardHeader>
                  <CardTitle>Short Stories</CardTitle>
                  <CardDescription>
                    📝 Group your writings into a complete book.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className="bg-card/50">
                <CardHeader>
                  <CardTitle>Technical Docs</CardTitle>
                  <CardDescription>
                    👩‍💻 Keep internal or public knowledge easily accessible.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className="bg-card/50">
                <CardHeader>
                  <CardTitle>Personal Projects</CardTitle>
                  <CardDescription>
                    🏡 Gather stories, photos, and memories in one place.
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          </div>

          {/* Open Source Section */}
          <div className="space-y-8 text-center">
            <h2 className="text-3xl font-serif">Open-Source & Self-Hostable</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Unlike closed platforms, Pensive is open-source, meaning you can host your own version, customize it, and retain full control over your books. Or, use our hosted service for a hassle-free experience.
            </p>
            <div className="mt-8">
              <p className="text-xl font-semibold">
                ✍️ Your words, your platform, your way. Start writing today with Pensive.
              </p>
              <Button size="lg" className="mt-4" onClick={() => navigate("/auth")}>
                Get Started
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}