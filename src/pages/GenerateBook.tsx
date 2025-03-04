
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Wand2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface GeneratedPage {
  title: string;
  content: string;
  pageType: "text" | "section";
}

interface GenerateBookProps {
  presetBookId?: number;
  onComplete?: () => void;
}

export default function GenerateBook({ presetBookId, onComplete }: GenerateBookProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [bookName, setBookName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [pageType, setPageType] = useState<"text" | "section">("text");
  const [bookId, setBookId] = useState<number | null>(null);

  useEffect(() => {
    if (presetBookId) {
      setBookId(presetBookId);
      // Fetch book info if we have a preset bookId
      fetchBookInfo(presetBookId);
    }
  }, [presetBookId]);

  const fetchBookInfo = async (id: number) => {
    try {
      const { data, error } = await supabase
        .from("books")
        .select("name")
        .eq("id", id)
        .single();

      if (error) throw error;
      if (data) {
        setBookName(data.name);
        // Set a default prompt based on the book name
        setPrompt(`Create a well-structured outline for a book titled "${data.name}" with multiple chapters and sections.`);
      }
    } catch (error) {
      console.error("Error fetching book info:", error);
    }
  };

  const handleGenerate = async () => {
    if (!bookId && !bookName) {
      toast({
        title: "Missing information",
        description: "Please provide a book name",
        variant: "destructive",
      });
      return;
    }

    if (!prompt) {
      toast({
        title: "Missing information",
        description: "Please provide a prompt for content generation",
        variant: "destructive",
      });
      return;
    }

    try {
      setGenerating(true);

      // Create the book first if we don't have a bookId yet
      let targetBookId = bookId;
      if (!targetBookId) {
        const { data: bookData, error: bookError } = await supabase
          .from("books")
          .insert({
            name: bookName,
            is_public: false,
          })
          .select()
          .single();

        if (bookError) throw bookError;
        targetBookId = bookData.id;
        setBookId(targetBookId);
      }

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
            book_id: targetBookId,
            title: page.title,
            html_content: page.content,
            page_type: page.pageType,
            page_index: i,
          });
          
        if (pageError) throw pageError;
      }

      toast({
        title: "Book outline generated",
        description: "Your book structure has been created successfully using Deepseek AI",
      });

      // If in the flow, call onComplete, otherwise navigate to the book
      if (onComplete) {
        onComplete();
      } else {
        navigate(`/book/${targetBookId}`);
      }
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

  // If used as a standalone page
  if (!presetBookId) {
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
            <h1 className="text-2xl font-semibold">Generate Book with Deepseek AI</h1>
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
                  Describe what you want your book to be about. Deepseek AI will generate structured content based on your prompt.
                </p>
              </div>

              <Button
                className="w-full"
                onClick={handleGenerate}
                disabled={generating || !bookName || !prompt}
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Wand2 className="h-4 w-4 mr-2" />
                    Generate Book
                  </>
                )}
              </Button>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // If used within the creation flow
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="prompt">Outline Generation Prompt</Label>
        <Textarea
          id="prompt"
          placeholder="Describe the structure you want for your book..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={6}
          className="resize-none"
        />
        <p className="text-sm text-muted-foreground">
          Describe the structure and content of your book. The AI will generate a detailed outline with chapters and sections.
        </p>
      </div>

      <Button
        className="w-full md:w-auto"
        onClick={handleGenerate}
        disabled={generating || !prompt}
      >
        {generating ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Generating Outline...
          </>
        ) : (
          <>
            <Wand2 className="h-4 w-4 mr-2" />
            Generate Book Outline
          </>
        )}
      </Button>
    </div>
  );
}
