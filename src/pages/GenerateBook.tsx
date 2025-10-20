
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, ArrowRight, Brain, Trash2, Pencil, Save, Wand2, MoveUp, MoveDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { TipTapEditor } from "@/components/editor/TipTapEditor";
import { htmlToJson } from "@/utils/tiptapHelpers";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface GeneratedPage {
  title: string;
  content: string;
  pageType: "text" | "section";
}

type GenerationStep = 'prompt' | 'review' | 'editing' | 'generating' | 'expanding' | 'complete';

export default function GenerateBook() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [bookName, setBookName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedContent, setGeneratedContent] = useState<{ pages: GeneratedPage[] } | null>(null);
  const [step, setStep] = useState<GenerationStep>('prompt');
  const [bookId, setBookId] = useState<number | null>(null);
  const [editingPage, setEditingPage] = useState<GeneratedPage | null>(null);
  const [editingPageIndex, setEditingPageIndex] = useState<number | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

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

  const movePageUp = (index: number) => {
    if (!generatedContent || index <= 0) return;
    
    const newPages = [...generatedContent.pages];
    [newPages[index - 1], newPages[index]] = [newPages[index], newPages[index - 1]];
    
    setGeneratedContent({
      pages: newPages
    });
  };

  const movePageDown = (index: number) => {
    if (!generatedContent || index >= generatedContent.pages.length - 1) return;
    
    const newPages = [...generatedContent.pages];
    [newPages[index], newPages[index + 1]] = [newPages[index + 1], newPages[index]];
    
    setGeneratedContent({
      pages: newPages
    });
  };

  const deletePage = (index: number) => {
    if (!generatedContent) return;
    
    const newPages = [...generatedContent.pages];
    newPages.splice(index, 1);
    
    setGeneratedContent({
      pages: newPages
    });

    toast({
      title: "Page deleted",
      description: "The page has been removed from the outline",
    });
  };

  const openEditDialog = (page: GeneratedPage, index: number) => {
    setEditingPage({ ...page });
    setEditingPageIndex(index);
    setEditDialogOpen(true);
  };

  const handleSaveEdit = () => {
    if (!editingPage || editingPageIndex === null || !generatedContent) return;
    
    const newPages = [...generatedContent.pages];
    newPages[editingPageIndex] = editingPage;
    
    setGeneratedContent({
      pages: newPages
    });
    
    setEditDialogOpen(false);
    setEditingPage(null);
    setEditingPageIndex(null);

    toast({
      title: "Changes saved",
      description: "Your edits have been applied to the outline",
    });
  };

  const handleCreateBook = async () => {
    if (!generatedContent || !bookName) return;

    try {
      setGenerating(true);
      setStep('expanding');

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
        // AI generates HTML, convert to JSON for storage
        const jsonContent = htmlToJson(page.content);

        const { error: pageError } = await supabase
          .from("pages")
          .insert({
            book_id: newBookId,
            title: page.title,
            content: jsonContent,  // Store as JSON
            page_type: page.pageType,
            page_index: i,
          });

        if (pageError) throw pageError;
      }

      // Now call the flesh-out-book function to expand the content
      const { data: expandedData, error: expandError } = await supabase.functions.invoke(
        "flesh-out-book",
        {
          body: {
            bookId: newBookId,
            prompt: `This is a book about: ${prompt}. Expand the content to be more detailed and engaging.`
          },
        }
      );

      if (expandError) throw expandError;

      toast({
        title: "Book created and expanded",
        description: "Your book has been created and content has been expanded using AI",
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

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!editingPage) return;
    setEditingPage({
      ...editingPage,
      title: e.target.value
    });
  };

  const handleContentChange = (html: string) => {
    if (!editingPage) return;
    setEditingPage({
      ...editingPage,
      content: html
    });
  };

  const renderStepIndicator = () => (
    <div className="flex items-center justify-center mb-8 w-full max-w-md mx-auto">
      <div className={`h-2 flex-1 rounded-l-full ${step === 'prompt' || step === 'review' || step === 'editing' || step === 'generating' || step === 'expanding' || step === 'complete' ? 'bg-primary' : 'bg-muted'}`} />
      <div className={`h-2 flex-1 ${step === 'review' || step === 'editing' || step === 'generating' || step === 'expanding' || step === 'complete' ? 'bg-primary' : 'bg-muted'}`} />
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
        Please wait while we create an outline for your book. This may take a minute or two.
      </p>
      <div className="w-full max-w-md h-2 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary animate-progress" style={{ width: '60%' }} />
      </div>
    </Card>
  );

  const renderExpandingStep = () => (
    <Card className="p-6 flex flex-col items-center justify-center space-y-4">
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
        <Wand2 className="h-8 w-8 text-primary animate-pulse" />
      </div>
      <h3 className="text-xl font-medium">Expanding Your Book Content</h3>
      <p className="text-center text-muted-foreground">
        Please wait while we flesh out the content of your book. This may take several minutes.
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
          <h2 className="text-xl font-semibold">Book Outline Review & Edit</h2>
          <p className="text-muted-foreground">
            Here's the outline generated for your book. You can review, edit, reorder, or delete pages before creating the book.
          </p>
        </div>

        <Separator />

        <div className="max-h-[50vh] overflow-y-auto rounded-md border p-4 space-y-4">
          {generatedContent.pages.map((page, idx) => (
            <div key={idx} className="space-y-2 bg-card rounded-md shadow-sm p-4">
              <div className="flex justify-between items-center">
                <h3 className={`font-medium ${page.pageType === 'section' ? 'text-primary text-lg' : 'text-foreground'}`}>
                  {page.title}
                </h3>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => movePageUp(idx)}
                    disabled={idx === 0}
                    className="h-8 w-8"
                  >
                    <MoveUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => movePageDown(idx)}
                    disabled={idx === generatedContent.pages.length - 1}
                    className="h-8 w-8"
                  >
                    <MoveDown className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openEditDialog(page, idx)}
                    className="h-8 w-8"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deletePage(idx)}
                    className="h-8 w-8 text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {page.pageType === 'text' && (
                <div className="text-sm text-muted-foreground line-clamp-2">
                  {page.content.replace(/<[^>]*>/g, '').substring(0, 150)}
                  {page.content.replace(/<[^>]*>/g, '').length > 150 ? '...' : ''}
                </div>
              )}
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
            disabled={generating || generatedContent.pages.length === 0}
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
        Your book has been created with AI-generated content. You can now view and edit it.
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
          <h1 className="text-2xl font-semibold">Generate Book</h1>
        </div>

        {renderStepIndicator()}

        <div className="max-w-2xl mx-auto">
          {step === 'prompt' && renderPromptStep()}
          {step === 'generating' && renderGeneratingStep()}
          {step === 'review' && renderReviewStep()}
          {step === 'expanding' && renderExpandingStep()}
          {step === 'complete' && renderCompleteStep()}
        </div>

        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Page</DialogTitle>
              <DialogDescription>
                Make changes to the page title and content.
              </DialogDescription>
            </DialogHeader>
            
            {editingPage && (
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="pageTitle">Page Title</Label>
                  <Input
                    id="pageTitle"
                    value={editingPage.title}
                    onChange={handleTitleChange}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>Page Content</Label>
                  <div className="min-h-[300px] border rounded-md">
                    <TipTapEditor 
                      content={editingPage.content}
                      onChange={handleContentChange}
                      editable={true}
                    />
                  </div>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSaveEdit}>
                <Save className="h-4 w-4 mr-2" />
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
