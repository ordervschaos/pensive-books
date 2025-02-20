import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Code, Book, Users, Rocket, Download, Server } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export default function Landing() {
  const navigate = useNavigate();

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        navigate('/my-books', { replace: true });
      }
    };
    checkAuth();
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background">
      <main className="container mx-auto px-6 py-16 space-y-24">
        {/* Hero Section */}
        <div className="text-center space-y-8 max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
          >
            <h1 className="text-6xl md:text-7xl font-serif font-bold text-primary mb-4">
              Pensive
            </h1>
            <p className="text-2xl md:text-3xl text-primary/90">
              Write, Publish, and Share Your Books with Ease
            </p>
          </motion.div>
          <p className="text-lg text-muted-foreground">
            Publish your own books on the web—free, open, and simple.
          </p>

          <img
            src="/homepage_images/book_page.png"
            alt="Book page"
            className="w-full rounded-lg border border-border"
          />

          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Writing online is easy, but publishing a whole book shouldn't be hard either. 
            Pensive makes it effortless to create, organize, and publish books in a beautiful, 
            readable format.
          </p>

          <div className="flex flex-wrap gap-4 justify-center">
            <Button 
              size="lg" 
              onClick={() => navigate("/auth")}
              className="text-lg px-8 py-6"
            >
              Start Writing
            </Button>
            <Button 
              size="lg" 
              variant="outline" 
              onClick={() => navigate("/library")}
              className="text-lg px-8 py-6"
            >
              Browse Library
            </Button>
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            { icon: Book, title: "Write & Edit", desc: "Write, edit, and structure your book with ease" },
            { icon: Code, title: "Customize", desc: "Customize covers, layouts, and content seamlessly" },
            { icon: Users, title: "Collaborate", desc: "Collaborate with co-authors or invite readers" },
            { icon: Rocket, title: "Publish", desc: "Publish instantly—no publisher, no gatekeepers" },
            { icon: Server, title: "Self-host or use our service", desc: "Host it yourself or use our hosted service" },
            { icon: Download, title: "Download & Read offline", desc: "Download books in EPUB format" }
          ].map((feature, index) => (
            <Card key={index} className="p-6 space-y-3">
              <feature.icon className="h-6 w-6 text-primary" />
              <h3 className="font-medium text-lg">{feature.title}</h3>
              <p className="text-sm text-muted-foreground">{feature.desc}</p>
            </Card>
          ))}
        </div>

        {/* How it Works Section */}
        <section className="space-y-12">
          <h2 className="text-4xl font-serif font-bold text-primary text-center">
            How it Works
          </h2>

          <div className="grid gap-12 md:grid-cols-2">
            {[
              {
                title: "1. Start your book",
                desc: "Create a new book and customize its details.",
                img: "/homepage_images/new_book.png"
              },
              {
                title: "2. Write and Edit",
                desc: "Use our powerful editor to write your content.",
                img: "/homepage_images/editor_ui.png"
              },
              {
                title: "3. Organize Your Book",
                desc: "Structure your book with chapters and pages.",
                img: "/homepage_images/book_page.png"
              },
              {
                title: "4. Collaborate and Share",
                desc: "Invite co-authors or share with readers.",
                img: "/homepage_images/invite_as_many_people_as_you_want.png"
              }
            ].map((step, index) => (
              <div key={index} className="space-y-4">
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
        </section>

        {/* Manual Link Section */}
        <div className="text-center border rounded-lg p-12 space-y-6">
          <h3 className="text-3xl font-medium text-primary">Want to learn more?</h3>
          <a 
            href="https://www.pensive.me/book/658-the-pensive-manual"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-3 text-xl font-medium text-primary hover:text-primary/90"
          >
            <span>📖</span>
            <span>Read the Complete Pensive Manual</span>
            <span>→</span>
          </a>
        </div>

        {/* What You Can Publish Section */}
        <section className="space-y-12">
          <div className="text-center">
            <h2 className="text-4xl font-serif font-bold text-primary mb-4">
              What Can You Publish on Pensive?
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              If you've written it, it's ready for Pensive. No middlemen, no approval process—just publish.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                icon: "📚",
                title: "Fiction & Nonfiction",
                desc: "Novels, memoirs, essays, poetry, and more."
              },
              {
                icon: "📖",
                title: "Instruction Manuals",
                desc: "Document your software, hardware, or workflows."
              },
              {
                icon: "🖼️",
                title: "Graphic Novels & Picture Books",
                desc: "Use images to tell compelling stories."
              }
            ].map((item, index) => (
              <Card key={index} className="p-6 space-y-3">
                <span className="text-3xl">{item.icon}</span>
                <h3 className="text-lg font-medium">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.desc}</p>
              </Card>
            ))}
          </div>
        </section>

        {/* Open Source Section */}
        <section className="text-center border rounded-lg p-12 space-y-8">
          <h2 className="text-4xl font-serif font-bold text-primary">
            Open-Source & Self-Hostable
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Unlike closed platforms, Pensive is open-source, meaning you can host your own version, 
            customize it, and retain full control over your books. Or, use our hosted service for 
            a hassle-free experience.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Button 
              size="lg" 
              onClick={() => navigate("/auth")}
              className="text-lg px-8 py-6"
            >
              Start Writing
            </Button>
            <Button 
              size="lg" 
              variant="outline" 
              onClick={() => window.open("https://github.com/ordervschaos/pensive-books", "_blank")}
              className="text-lg px-8 py-6"
            >
              View on GitHub
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}