
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, ArrowRight, Book, Wand2, Layers, Edit3, LayoutList } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { setPageTitle } from "@/utils/pageTitle";
import { useEffect } from "react";
import GenerateBookContent from "./GenerateBook";
import { BookCoverEdit } from "@/components/book/BookCoverEdit";
import { BookEditForm } from "@/components/book/BookEditForm";
import { FleshOutBookDialog } from "@/components/book/FleshOutBookDialog";

interface Book {
  id?: number;
  name: string;
  subtitle: string | null;
  author: string | null;
  is_public: boolean;
  cover_url?: string | null;
  show_text_on_cover?: boolean;
}

const steps = [
  { id: "info", label: "Book Info", icon: Book },
  { id: "outline", label: "Generate Outline", icon: Wand2 },
  { id: "structure", label: "Organize", icon: Layers },
  { id: "expand", label: "Expand Content", icon: Edit3 },
  { id: "review", label: "Review", icon: LayoutList },
];

export default function BookCreationFlow() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState("info");
  const [progress, setProgress] = useState(20);
  const [book, setBook] = useState<Book>({
    name: "",
    subtitle: null,
    author: null,
    is_public: false,
    cover_url: null,
    show_text_on_cover: true
  });
  const [bookId, setBookId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setPageTitle('Create a Book - Step by Step');

    // Update progress based on current step
    const stepIndex = steps.findIndex(step => step.id === currentStep);
    setProgress(((stepIndex + 1) / steps.length) * 100);
  }, [currentStep]);

  const handleInfoSave = async () => {
    if (!book.name.trim()) {
      toast({
        title: "Book name required",
        description: "Please provide a name for your book",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsSaving(true);
      
      const { data, error } = await supabase
        .from("books")
        .insert({
          name: book.name,
          subtitle: book.subtitle,
          author: book.author,
          is_public: false,
          cover_url: book.cover_url,
          show_text_on_cover: book.show_text_on_cover
        })
        .select()
        .single();

      if (error) throw error;

      setBookId(data.id);
      toast({
        title: "Book created",
        description: "Book information saved successfully"
      });
      
      setCurrentStep("outline");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error saving book",
        description: error.message
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCoverChange = (url: string) => {
    setBook(prev => ({ ...prev, cover_url: url }));
  };

  const handleShowTextChange = (showText: boolean) => {
    setBook(prev => ({ ...prev, show_text_on_cover: showText }));
  };

  const handleStepChange = (step: string) => {
    if (step === "outline" && !bookId) {
      toast({
        title: "Save book first",
        description: "Please complete the book info step first",
        variant: "destructive",
      });
      return;
    }
    setCurrentStep(step);
  };

  const handleStructureComplete = () => {
    setCurrentStep("expand");
  };

  const handleExpandComplete = () => {
    setCurrentStep("review");
  };

  const handleNavigateToBook = () => {
    if (bookId) {
      navigate(`/book/${bookId}`);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-6">
        <div className="flex items-center gap-4 mb-6">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/my-books")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-semibold">Create a Book - Step by Step</h1>
        </div>

        <div className="mb-8">
          <Progress value={progress} className="h-2" />
          
          <div className="mt-4">
            <Tabs value={currentStep} onValueChange={handleStepChange} className="w-full">
              <TabsList className="grid grid-cols-5 w-full">
                {steps.map((step) => (
                  <TabsTrigger 
                    key={step.id} 
                    value={step.id}
                    className="flex items-center gap-2"
                    disabled={(step.id !== "info" && !bookId)}
                  >
                    <step.icon className="h-4 w-4" />
                    <span className="hidden md:inline">{step.label}</span>
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value="info" className="mt-6">
                <Card className="p-6">
                  <h2 className="text-xl font-semibold mb-4">Book Information</h2>
                  <div className="grid grid-cols-1 lg:grid-cols-6 gap-8">
                    <div className="w-full lg:col-span-2">
                      <BookCoverEdit 
                        bookId={0}
                        coverUrl={book.cover_url}
                        showTextOnCover={book.show_text_on_cover}
                        title={book.name}
                        subtitle={book.subtitle}
                        author={book.author}
                        onCoverChange={handleCoverChange}
                        onShowTextChange={handleShowTextChange}
                      />
                    </div>

                    <div className="lg:col-span-4">
                      <BookEditForm
                        book={book}
                        onBookChange={setBook}
                        onSave={(e) => {
                          e.preventDefault();
                          handleInfoSave();
                        }}
                        saving={isSaving}
                      />
                    </div>
                  </div>

                  <div className="flex justify-end mt-6">
                    <Button 
                      onClick={handleInfoSave} 
                      disabled={isSaving || !book.name.trim()}
                      className="flex items-center gap-2"
                    >
                      Next
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              </TabsContent>

              <TabsContent value="outline" className="mt-6">
                <Card className="p-6">
                  <h2 className="text-xl font-semibold mb-4">Generate Book Outline</h2>
                  <p className="text-muted-foreground mb-6">
                    Use AI to generate a structured outline for your book. You can refine this outline in the next step.
                  </p>
                  
                  {bookId && (
                    <div className="mt-4">
                      <GenerateBookContent presetBookId={bookId} onComplete={() => setCurrentStep("structure")} />
                    </div>
                  )}
                </Card>
              </TabsContent>

              <TabsContent value="structure" className="mt-6">
                <Card className="p-6">
                  <h2 className="text-xl font-semibold mb-4">Organize Your Book</h2>
                  <p className="text-muted-foreground mb-6">
                    Organize and edit the structure of your book. You can reorder pages, add new sections, and edit content.
                  </p>
                  
                  {bookId && (
                    <div className="flex flex-col gap-4">
                      <Button 
                        onClick={() => navigate(`/book/${bookId}`)}
                        className="w-full md:w-auto"
                      >
                        Edit Book Structure
                      </Button>
                      
                      <div className="flex justify-end mt-4">
                        <Button 
                          onClick={handleStructureComplete}
                          className="flex items-center gap-2"
                        >
                          Continue to Expand Content
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              </TabsContent>

              <TabsContent value="expand" className="mt-6">
                <Card className="p-6">
                  <h2 className="text-xl font-semibold mb-4">Expand Your Content</h2>
                  <p className="text-muted-foreground mb-6">
                    Use AI to expand the content of your book based on the outline you've created.
                  </p>
                  
                  {bookId && (
                    <div className="flex flex-col gap-4">
                      <FleshOutBookDialog 
                        bookId={bookId} 
                        onComplete={handleExpandComplete}
                      />
                      
                      <div className="flex justify-end mt-4">
                        <Button 
                          onClick={handleExpandComplete}
                          className="flex items-center gap-2"
                        >
                          Continue to Review
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              </TabsContent>

              <TabsContent value="review" className="mt-6">
                <Card className="p-6">
                  <h2 className="text-xl font-semibold mb-4">Review Your Book</h2>
                  <p className="text-muted-foreground mb-6">
                    Review your book and make any final edits before publishing.
                  </p>
                  
                  {bookId && (
                    <div className="flex flex-col gap-4">
                      <Button 
                        onClick={handleNavigateToBook}
                        className="flex items-center gap-2"
                      >
                        View Complete Book
                        <Book className="h-4 w-4 ml-2" />
                      </Button>
                    </div>
                  )}
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  );
}
