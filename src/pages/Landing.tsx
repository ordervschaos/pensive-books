import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Code, Book, Users, Rocket, Download, Server } from "lucide-react";
import { motion, useScroll, useTransform } from "framer-motion";
import { useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export default function Landing() {
  const navigate = useNavigate();
  const targetRef = useRef(null);
  const { scrollYProgress } = useScroll({
    target: targetRef,
    offset: ["start start", "end start"]
  });
  
  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.5], [1, 0.8]);
  const y = useTransform(scrollYProgress, [0, 0.5], [0, -100]);

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
    <div className="min-h-screen bg-gradient-to-b from-background via-background/95 to-background relative overflow-hidden" ref={targetRef}>
      {/* Enhanced pattern overlay with multiple layers */}
      <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))] opacity-50" />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/5 to-background pointer-events-none" />
      
      <main className="container mx-auto px-6 py-16 space-y-40 relative">
        {/* Enhanced Hero Section */}
        <motion.div 
          style={{ opacity, scale, y }}
          className="text-center space-y-12 max-w-5xl mx-auto relative"
        >
          {/* Decorative elements */}
          <div className="absolute -top-24 -left-24 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />
          <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-primary/10 rounded-full blur-3xl" />
          
          <div className="space-y-8 relative">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
            >
              <h1 className="text-6xl md:text-8xl font-serif font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-primary via-primary/90 to-primary/80 leading-tight">
                Pensive
              </h1>
              <p className="text-3xl md:text-4xl mt-4 bg-clip-text text-transparent bg-gradient-to-r from-primary/90 to-primary/70">
                Write, Publish, and Share Your Books with Ease
              </p>
            </motion.div>
            <motion.p 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="text-xl text-muted-foreground/90 font-light max-w-2xl mx-auto"
            >
              Publish your own books on the web—free, open, and simple.
            </motion.p>
          </div>

          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.6 }}
            className="relative group"
          >
            <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 via-primary/30 to-primary/20 rounded-2xl blur-xl group-hover:blur-2xl transition-all duration-500" />
            <div className="relative rounded-xl overflow-hidden shadow-2xl">
              <img
                src="/homepage_images/book_page.png"
                alt="Book page"
                className="w-full transition-transform duration-700 group-hover:scale-[1.02]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background/20 to-transparent" />
            </div>
          </motion.div>

          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.8 }}
            className="text-lg md:text-xl text-muted-foreground/90 leading-relaxed max-w-3xl mx-auto"
          >
            Writing online is easy, but publishing a whole book shouldn't be hard either. 
            Pensive makes it effortless to create, organize, and publish books in a beautiful, 
            readable format—whether for yourself, your audience, or the world.
          </motion.p>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 1 }}
            className="flex flex-wrap gap-6 justify-center"
          >
            <Button 
              size="lg" 
              onClick={() => navigate("/auth")}
              className="text-lg px-12 py-6 shadow-lg hover:shadow-xl transition-all duration-500 hover:-translate-y-1 bg-primary/90 hover:bg-primary rounded-xl"
            >
              Start Writing
            </Button>
            <Button 
              size="lg" 
              variant="outline" 
              onClick={() => navigate("/library")}
              className="text-lg px-12 py-6 shadow hover:shadow-md transition-all duration-500 hover:-translate-y-1 rounded-xl border-primary/20 hover:border-primary/40 backdrop-blur-sm"
            >
              Browse Library
            </Button>
          </motion.div>
        </motion.div>

        {/* Enhanced Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {[
            { icon: Book, title: "Write & Edit", desc: "Write, edit, and structure your book with ease", gradient: "from-blue-500/20 to-blue-600/20" },
            { icon: Code, title: "Customize", desc: "Customize covers, layouts, and content seamlessly", gradient: "from-purple-500/20 to-purple-600/20" },
            { icon: Users, title: "Collaborate", desc: "Collaborate with co-authors or invite readers", gradient: "from-green-500/20 to-green-600/20" },
            { icon: Rocket, title: "Publish", desc: "Publish instantly—no publisher, no gatekeepers, just your words", gradient: "from-orange-500/20 to-orange-600/20" },
            { icon: Server, title: "Self-host or use our service", desc: "Host it yourself or use our hosted service", gradient: "from-pink-500/20 to-pink-600/20" },
            { icon: Download, title: "Download & Read offline", desc: "Download books in EPUB format to read on any device", gradient: "from-cyan-500/20 to-cyan-600/20" }
          ].map((feature, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              viewport={{ once: true }}
              className="group"
            >
              <Card className="p-8 space-y-4 h-full bg-card/50 backdrop-blur-sm border border-primary/10 hover:border-primary/20 transition-all duration-500 hover:shadow-lg hover:-translate-y-1 rounded-xl overflow-hidden relative">
                <div className={`absolute inset-0 bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
                <div className="relative z-10">
                  <feature.icon className="h-8 w-8 mb-4 text-primary" />
                  <h3 className="font-medium text-xl">{feature.title}</h3>
                  <p className="text-base text-muted-foreground/90">{feature.desc}</p>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Enhanced How it Works Section */}
        <section className="space-y-20">
          <motion.div 
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-center relative"
          >
            <div className="absolute -top-12 -left-12 w-48 h-48 bg-primary/5 rounded-full blur-2xl" />
            <div className="absolute -bottom-12 -right-12 w-48 h-48 bg-primary/10 rounded-full blur-2xl" />
            <h2 className="text-5xl font-serif font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary via-primary/90 to-primary/80 relative">
              How it Works
            </h2>
          </motion.div>

          <div className="flex flex-col gap-20">
            <div className="grid gap-16 md:grid-cols-2">
              {[
                {
                  title: "1. Start your book",
                  desc: "Create a new book and customize its details.",
                  img: "/homepage_images/new_book.png",
                  gradient: "from-blue-500/20 to-purple-500/20"
                },
                {
                  title: "2. Write and Edit",
                  desc: "Use our powerful editor to write your content.",
                  img: "/homepage_images/editor_ui.png",
                  gradient: "from-purple-500/20 to-pink-500/20"
                }
              ].map((step, index) => (
                <motion.div 
                  key={index}
                  initial={{ opacity: 0, x: index % 2 === 0 ? -20 : 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  className="space-y-6 group relative"
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${step.gradient} rounded-2xl blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-700`} />
                  <div className="relative">
                    <h3 className="text-3xl font-medium text-primary mb-3">{step.title}</h3>
                    <p className="text-xl text-muted-foreground/90">{step.desc}</p>
                    <div className="mt-6 relative">
                      <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 via-primary/30 to-primary/20 rounded-2xl blur opacity-0 group-hover:opacity-100 transition-all duration-700" />
                      <img
                        src={step.img}
                        alt={step.title}
                        className="rounded-xl shadow-2xl w-full relative transition-transform duration-700 group-hover:scale-[1.02]"
                      />
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            <div className="grid gap-16 md:grid-cols-2">
              {[
                {
                  title: "3. Organize Your Book",
                  desc: "Structure your book with chapters and pages.",
                  img: "/homepage_images/book_page.png",
                  gradient: "from-orange-500/20 to-red-500/20"
                },
                {
                  title: "4. Collaborate and Share",
                  desc: "Invite co-authors or share with readers.",
                  img: "/homepage_images/invite_as_many_people_as_you_want.png",
                  gradient: "from-green-500/20 to-emerald-500/20"
                }
              ].map((step, index) => (
                <motion.div 
                  key={index}
                  initial={{ opacity: 0, x: index % 2 === 0 ? -20 : 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  className="space-y-6 group relative"
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${step.gradient} rounded-2xl blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-700`} />
                  <div className="relative">
                    <h3 className="text-3xl font-medium text-primary mb-3">{step.title}</h3>
                    <p className="text-xl text-muted-foreground/90">{step.desc}</p>
                    <div className="mt-6 relative">
                      <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 via-primary/30 to-primary/20 rounded-2xl blur opacity-0 group-hover:opacity-100 transition-all duration-700" />
                      <img
                        src={step.img}
                        alt={step.title}
                        className="rounded-xl shadow-2xl w-full relative transition-transform duration-700 group-hover:scale-[1.02]"
                      />
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Enhanced Manual Link */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center relative group"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 rounded-3xl blur-2xl transition-all duration-500 group-hover:blur-3xl" />
          <div className="relative bg-gradient-to-r from-background/80 to-background/90 rounded-2xl py-16 px-8 border border-primary/20 backdrop-blur-sm">
            <h3 className="text-4xl font-medium mb-8 bg-clip-text text-transparent bg-gradient-to-r from-primary to-primary/80">Want to learn more?</h3>
            <a 
              href="https://www.pensive.me/book/658-the-pensive-manual"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-3 text-2xl font-medium text-primary hover:text-primary/90 bg-background/80 px-10 py-5 rounded-xl shadow-lg hover:shadow-xl transition-all duration-500 hover:-translate-y-1 backdrop-blur-sm group"
            >
              <span className="text-3xl">📖</span>
              <span>Read the Complete Pensive Manual</span>
              <motion.span 
                className="inline-block"
                initial={{ x: 0 }}
                whileHover={{ x: 5 }}
                transition={{ duration: 0.3 }}
              >
                →
              </motion.span>
            </a>
          </div>
        </motion.div>

        {/* Enhanced What You Can Publish Section */}
        <section className="space-y-16">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center relative"
          >
            <div className="absolute -top-12 left-1/4 w-48 h-48 bg-primary/5 rounded-full blur-2xl" />
            <h2 className="text-5xl font-serif font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary via-primary/90 to-primary/80">
              What Can You Publish on Pensive?
            </h2>
            <p className="mt-6 text-xl text-muted-foreground/90 max-w-3xl mx-auto">
              If you've written it, it's ready for Pensive. No middlemen, no approval process—just publish.
            </p>
          </motion.div>

          <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: "📚",
                title: "Fiction & Nonfiction",
                desc: "Novels, memoirs, essays, poetry, and more.",
                gradient: "from-blue-500/20 to-purple-500/20"
              },
              {
                icon: "📖",
                title: "Instruction Manuals",
                desc: "Document your software, hardware, or workflows.",
                gradient: "from-purple-500/20 to-pink-500/20"
              },
              {
                icon: "🖼️",
                title: "Graphic Novels & Picture Books",
                desc: "Use images to tell compelling stories.",
                gradient: "from-pink-500/20 to-orange-500/20"
              }
            ].map((item, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                viewport={{ once: true }}
                className="group relative"
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${item.gradient} rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
                <Card className="p-8 space-y-4 bg-card/50 backdrop-blur-sm border border-primary/10 hover:border-primary/20 transition-all duration-500 hover:shadow-lg hover:-translate-y-1 rounded-xl relative">
                  <span className="text-4xl">{item.icon}</span>
                  <h3 className="text-2xl font-medium">{item.title}</h3>
                  <p className="text-lg text-muted-foreground/90">{item.desc}</p>
                </Card>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Enhanced Open Source Section */}
        <motion.section 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="relative group"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 rounded-3xl blur-2xl transition-all duration-500 group-hover:blur-3xl" />
          <div className="relative space-y-10 bg-gradient-to-r from-background/80 to-background/90 rounded-2xl p-16 border border-primary/20 backdrop-blur-sm text-center">
            <h2 className="text-5xl font-serif font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary via-primary/90 to-primary/80">
              Open-Source & Self-Hostable
            </h2>
            <p className="text-xl text-muted-foreground/90 max-w-3xl mx-auto leading-relaxed">
              Unlike closed platforms, Pensive is open-source, meaning you can host your own version, 
              customize it, and retain full control over your books. Or, use our hosted service for 
              a hassle-free experience.
            </p>
            <div className="flex flex-wrap justify-center gap-6">
              <Button 
                size="lg" 
                onClick={() => navigate("/auth")}
                className="text-lg px-12 py-6 shadow-lg hover:shadow-xl transition-all duration-500 hover:-translate-y-1 bg-primary/90 hover:bg-primary rounded-xl"
              >
                Start Writing
              </Button>
              <Button 
                size="lg" 
                variant="outline" 
                onClick={() => window.open("https://github.com/ordervschaos/pensive-books", "_blank")}
                className="text-lg px-12 py-6 shadow hover:shadow-md transition-all duration-500 hover:-translate-y-1 rounded-xl border-primary/20 hover:border-primary/40 backdrop-blur-sm"
              >
                View on GitHub
              </Button>
            </div>
          </div>
        </motion.section>
      </main>
    </div>
  );
}