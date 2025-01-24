import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpen, Users, Rocket, Code, PenTool } from "lucide-react";

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <div className="space-y-4">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Pensive – Write, Publish, and Share Your Books with Ease</h1>
            <p className="text-xl text-muted-foreground">
              Publish your own books on the web—free, open, and simple.
            </p>
            <p className="text-lg text-muted-foreground">
              Writing online is easy, but publishing a whole book shouldn't be hard either. Pensive makes it effortless to create, organize, and publish books in a beautiful, readable format—whether for yourself, your audience, or the world.
            </p>
          </div>

          <div className="flex justify-center gap-4">
            <Button size="lg" onClick={() => navigate("/auth")}>
              Get Started
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate("/library")}>
              Browse Library
            </Button>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 text-left">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PenTool className="h-5 w-5" />
                  Write with Ease
                </CardTitle>
              </CardHeader>
              <CardContent>
                📖 Write, edit, and structure your book with ease.
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5" />
                  Beautiful Format
                </CardTitle>
              </CardHeader>
              <CardContent>
                🎨 Customize covers, layouts, and content seamlessly.
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Collaboration
                </CardTitle>
              </CardHeader>
              <CardContent>
                👥 Collaborate with co-authors or invite readers.
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Rocket className="h-5 w-5" />
                  Instant Publishing
                </CardTitle>
              </CardHeader>
              <CardContent>
                🚀 Publish instantly—no publisher, no gatekeepers, just your words.
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Code className="h-5 w-5" />
                  Open Source
                </CardTitle>
              </CardHeader>
              <CardContent>
                🌍 Host it yourself or use our open-source platform.
              </CardContent>
            </Card>
          </div>

          <div className="mt-16 space-y-8">
            <h2 className="text-3xl font-bold">How Pensive Works</h2>
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

          <div className="mt-16 space-y-8">
            <h2 className="text-3xl font-bold">What Can You Publish on Pensive?</h2>
            <p className="text-lg text-muted-foreground">
              If you've written it, it's ready for Pensive. No middlemen, no approval process—just publish.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 text-left">
              <Card>
                <CardHeader>
                  <CardTitle>Fiction & Nonfiction</CardTitle>
                  <CardDescription>
                    📚 Novels, memoirs, essays, poetry, and more.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Instruction Manuals</CardTitle>
                  <CardDescription>
                    📖 Document your software, hardware, or workflows.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Graphic Novels</CardTitle>
                  <CardDescription>
                    🖼️ Use images to tell compelling stories.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Short Stories</CardTitle>
                  <CardDescription>
                    📝 Group your writings into a complete book.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Technical Docs</CardTitle>
                  <CardDescription>
                    👩‍💻 Keep internal or public knowledge easily accessible.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Personal Projects</CardTitle>
                  <CardDescription>
                    🏡 Gather stories, photos, and memories in one place.
                  </CardDescription>
                </CardHeader>
              </Card>
            </div>
          </div>

          <div className="mt-16 space-y-8">
            <h2 className="text-3xl font-bold">Open-Source & Self-Hostable</h2>
            <p className="text-lg text-muted-foreground">
              Unlike closed platforms, Pensive is open-source, meaning you can host your own version, customize it, and retain full control over your books. Or, use our hosted service for a hassle-free experience.
            </p>
            <div className="mt-8">
              <p className="text-xl font-semibold">
                ✍️ Your words, your platform, your way. Start writing today with Pensive.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}