import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface GeneratedPage {
  title: string;
  content: string;
  pageType: "text" | "section";
}

export default function GenerateBook() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [bookName, setBookName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [pageType, setPageType] = useState<"text" | "section">("text");

  const handleGenerate = async () => {
    if (!bookName || !prompt) {
      toast({
        title: "Missing information",
        description: "Please provide both a book name and a prompt",
        variant: "destructive",
      });
      return;
    }

    try {
      setGenerating(true);

      // Create the book first
      const { data: bookData, error: bookError } = await supabase
        .from("books")
        .insert({
          name: bookName,
          is_public: false,
        })
        .select()
        .single();

      if (bookError) throw bookError;

      // Generate content using the edge function
      const { data: generatedData, error: generateError } = await supabase.functions.invoke(
        "generate-book-content",
        {
          body: {
            prompt
          },
        }
      );

      if (generateError) throw generateError;
      if (!generatedData?.pages || !Array.isArray(generatedData.pages)) {
        throw new Error("Invalid response format from content generation");
      }

      const pages = generatedData.pages as GeneratedPage[];
      
      // Create pages in sequence
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const { error: pageError } = await supabase
          .from("pages")
          .insert({
            book_id: bookData.id,
            title: page.title,
            html_content: page.content,
            page_type: page.pageType,
            page_index: i,
          });
          
        if (pageError) throw pageError;
      }

      toast({
        title: "Book generated",
        description: "Your book has been created successfully",
      });

      // Navigate to the book edit page
      navigate(`/book/${bookData.id}`);
    } catch (error: any) {
      console.error("Error generating book:", error);
      toast({
        title: "Error generating book",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-6">
        <div className="flex items-center gap-4 mb-8">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/my-books")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-semibold">Generate Book</h1>
        </div>

        <div className="max-w-2xl mx-auto space-y-8">
          <Card className="p-6 space-y-6">
            <div className="space-y-2">
              <Label htmlFor="bookName">Book Name</Label>
              <Input
                id="bookName"
                placeholder="Enter a name for your book"
                value={bookName}
                onChange={(e) => setBookName(e.target.value)}
              />
            </div>


            <div className="space-y-2">
              <Label htmlFor="prompt">Prompt</Label>
              <Textarea
                id="prompt"
                placeholder="Describe the content you want to generate..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={6}
                className="resize-none"
              />
              <p className="text-sm text-muted-foreground">
                Describe what you want your book to be about. The AI will generate structured content based on your prompt.
              </p>
            </div>

            <Button
              className="w-full"
              onClick={handleGenerate}
              disabled={generating || !bookName || !prompt}
            >
              <Wand2 className="h-4 w-4 mr-2" />
              {generating ? "Generating..." : "Generate Book"}
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
