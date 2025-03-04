
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, ArrowRight, Brain, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

interface GeneratedPage {
  title: string;
  content: string;
  pageType: "text" | "section";
}

type GenerationStep = 'prompt' | 'review' | 'generating' | 'complete';

export default function GenerateBook() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [bookName, setBookName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedContent, setGeneratedContent] = useState<{ pages: GeneratedPage[] } | null>(null);
  const [step, setStep] = useState<GenerationStep>('prompt');
  const [bookId, setBookId] = useState<number | null>(null);

  const handleGenerateOutline = async () => {
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
      setStep('generating');

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

      // Store the generated content for review
      setGeneratedContent(generatedData);
      setStep('review');
    } catch (error: any) {
      console.error("Error generating book:", error);
      toast({
        title: "Error generating book",
        description: error.message,
        variant: "destructive",
      });
      setStep('prompt');
    } finally {
      setGenerating(false);
    }
  };

  const handleCreateBook = async () => {
    if (!generatedContent || !bookName) return;

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
      
      const newBookId = bookData.id;
      setBookId(newBookId);
      
      // Create pages in sequence
      for (let i = 0; i < generatedContent.pages.length; i++) {
        const page = generatedContent.pages[i];
        const { error: pageError } = await supabase
          .from("pages")
          .insert({
            book_id: newBookId,
            title: page.title,
            html_content: page.content,
            page_type: page.pageType,
            page_index: i,
          });
          
        if (pageError) throw pageError;
      }

      toast({
        title: "Book created",
        description: "Your book has been created successfully using Deepseek AI",
      });

      setStep('complete');
    } catch (error: any) {
      console.error("Error creating book:", error);
      toast({
        title: "Error creating book",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const renderStepIndicator = () => (
    <div className="flex items-center justify-center mb-8 w-full max-w-md mx-auto">
      <div className={`h-2 flex-1 rounded-l-full ${step === 'prompt' || step === 'review' || step === 'generating' || step === 'complete' ? 'bg-primary' : 'bg-muted'}`} />
      <div className={`h-2 flex-1 ${step === 'review' || step === 'generating' || step === 'complete' ? 'bg-primary' : 'bg-muted'}`} />
      <div className={`h-2 flex-1 rounded-r-full ${step === 'complete' ? 'bg-primary' : 'bg-muted'}`} />
    </div>
  );

  const renderPromptStep = () => (
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
        <Label htmlFor="prompt">Describe Your Book</Label>
        <Textarea
          id="prompt"
          placeholder="Describe the content you want to generate in detail..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={6}
          className="resize-none"
        />
        <p className="text-sm text-muted-foreground">
          Be specific about the topic, style, and structure you want. For example: "Create a fantasy novel about a young wizard's journey with 10 chapters" or "Generate a technical guide about machine learning with sections on neural networks and data preprocessing."
        </p>
      </div>

      <Button
        className="w-full"
        onClick={handleGenerateOutline}
        disabled={generating || !bookName || !prompt}
      >
        <Brain className="h-4 w-4 mr-2" />
        Generate Book Outline
      </Button>
    </Card>
  );

  const renderGeneratingStep = () => (
    <Card className="p-6 flex flex-col items-center justify-center space-y-4">
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
        <Wand2 className="h-8 w-8 text-primary animate-pulse" />
      </div>
      <h3 className="text-xl font-medium">Generating Your Book Outline</h3>
      <p className="text-center text-muted-foreground">
        Please wait while our AI creates an outline for your book. This may take a minute or two.
      </p>
      <div className="w-full max-w-md h-2 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary animate-progress" style={{ width: '60%' }} />
      </div>
    </Card>
  );

  const renderReviewStep = () => {
    if (!generatedContent) return null;
    
    return (
      <Card className="p-6 space-y-6">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">Book Outline Review</h2>
          <p className="text-muted-foreground">
            Here's the outline generated for your book. Review it before creating the book.
          </p>
        </div>

        <Separator />

        <div className="max-h-[50vh] overflow-y-auto rounded-md border p-4 space-y-4">
          {generatedContent.pages.map((page, idx) => (
            <div key={idx} className="space-y-2">
              <h3 className={`font-medium ${page.pageType === 'section' ? 'text-primary text-lg' : 'text-foreground'}`}>
                {page.title}
              </h3>
              {page.pageType === 'text' && (
                <div className="text-sm text-muted-foreground">
                  {page.content.length > 100 
                    ? `${page.content.replace(/<[^>]*>/g, '').substring(0, 100)}...`
                    : page.content.replace(/<[^>]*>/g, '')}
                </div>
              )}
              {idx < generatedContent.pages.length - 1 && <Separator className="my-2" />}
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setStep('prompt')}
            className="flex-1"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button
            onClick={handleCreateBook}
            disabled={generating}
            className="flex-1"
          >
            <Wand2 className="h-4 w-4 mr-2" />
            Create Book
          </Button>
        </div>
      </Card>
    );
  };

  const renderCompleteStep = () => (
    <Card className="p-6 flex flex-col items-center justify-center space-y-6">
      <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center">
        <div className="h-8 w-8 text-green-600 dark:text-green-400">✓</div>
      </div>
      <h3 className="text-xl font-medium">Book Created Successfully!</h3>
      <p className="text-center text-muted-foreground">
        Your book has been created. You can now view and edit it.
      </p>
      <div className="flex gap-4">
        <Button
          variant="outline"
          onClick={() => navigate("/my-books")}
        >
          Go to My Books
        </Button>
        <Button
          onClick={() => navigate(`/book/${bookId}`)}
        >
          <ArrowRight className="h-4 w-4 mr-2" />
          View Book
        </Button>
      </div>
    </Card>
  );

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

        {renderStepIndicator()}

        <div className="max-w-2xl mx-auto">
          {step === 'prompt' && renderPromptStep()}
          {step === 'generating' && renderGeneratingStep()}
          {step === 'review' && renderReviewStep()}
          {step === 'complete' && renderCompleteStep()}
        </div>
      </div>
    </div>
  );
}
