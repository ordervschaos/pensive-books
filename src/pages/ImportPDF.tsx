
import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { setPageTitle } from "@/utils/pageTitle";
import { parsePDF } from "@/utils/pdfParser";
import { ArrowLeft, FileUp, Loader2, BookPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEffect } from "react";

interface ExtractedPage {
  content: string;
  title?: string;
  isSection: boolean;
}

const ImportPDF = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [bookTitle, setBookTitle] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCreatingBook, setIsCreatingBook] = useState(false);
  const [parsedPages, setParsedPages] = useState<ExtractedPage[]>([]);
  const [progress, setProgress] = useState(0);
  
  useEffect(() => {
    setPageTitle('Import PDF');
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.type !== 'application/pdf') {
        toast({
          title: "Invalid file type",
          description: "Please select a PDF file",
          variant: "destructive"
        });
        return;
      }
      
      setSelectedFile(file);
      setBookTitle(file.name.replace('.pdf', ''));
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type !== 'application/pdf') {
        toast({
          title: "Invalid file type",
          description: "Please select a PDF file",
          variant: "destructive"
        });
        return;
      }
      
      setSelectedFile(file);
      setBookTitle(file.name.replace('.pdf', ''));
    }
  };

  const handleProcessPDF = async () => {
    if (!selectedFile) return;
    
    try {
      setIsProcessing(true);
      setProgress(10);
      
      const result = await parsePDF(selectedFile);
      
      setBookTitle(result.title);
      setParsedPages(result.pages);
      setProgress(100);
      
      toast({
        title: "PDF processed successfully",
        description: `Found ${result.pages.length} pages in the PDF`
      });
    } catch (error) {
      console.error("Error processing PDF:", error);
      toast({
        title: "Error processing PDF",
        description: "There was an error processing your PDF file",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleImport = async () => {
    if (!bookTitle || parsedPages.length === 0) {
      toast({
        title: "Missing information",
        description: "Please provide a book title and process a PDF file",
        variant: "destructive"
      });
      return;
    }
    
    try {
      setIsCreatingBook(true);
      
      // Create the book
      const { data: bookData, error: bookError } = await supabase
        .from("books")
        .insert({
          name: bookTitle,
          is_public: false
        })
        .select()
        .single();
      
      if (bookError) throw bookError;
      
      const bookId = bookData.id;
      
      // Add pages to the book
      for (let i = 0; i < parsedPages.length; i++) {
        const page = parsedPages[i];
        const { error: pageError } = await supabase
          .from("pages")
          .insert({
            book_id: bookId,
            title: page.title,
            html_content: page.content,
            page_type: page.isSection ? 'section' : 'text',
            page_index: i
          });
        
        if (pageError) throw pageError;
      }
      
      toast({
        title: "Book imported successfully",
        description: `Created a new book with ${parsedPages.length} pages`
      });
      
      navigate(`/book/${bookId}`);
    } catch (error) {
      console.error("Error creating book:", error);
      toast({
        title: "Error creating book",
        description: "There was an error creating the book from your PDF",
        variant: "destructive"
      });
    } finally {
      setIsCreatingBook(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-6">
        <div className="flex items-center mb-8">
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => navigate(-1)}
            className="mr-4"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-semibold">Import Book from PDF</h1>
        </div>
        
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Upload PDF File</CardTitle>
            <CardDescription>
              Select a PDF file to import as a new book. The system will attempt to identify sections and content.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div 
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                accept=".pdf" 
                className="hidden"
              />
              <FileUp className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground mb-2">
                Drag and drop your PDF here or click to browse
              </p>
              {selectedFile && (
                <div className="mt-4 p-2 bg-muted rounded-md inline-block">
                  {selectedFile.name} ({Math.round(selectedFile.size / 1024)} KB)
                </div>
              )}
            </div>
            
            {selectedFile && !parsedPages.length && (
              <div className="mt-4">
                <Button 
                  onClick={handleProcessPDF} 
                  disabled={isProcessing}
                  className="w-full"
                >
                  {isProcessing ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Processing PDF...</span>
                    </div>
                  ) : (
                    <span>Process PDF</span>
                  )}
                </Button>
                
                {isProcessing && (
                  <Progress value={progress} className="mt-4" />
                )}
              </div>
            )}
          </CardContent>
        </Card>
        
        {parsedPages.length > 0 && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>Book Details</CardTitle>
              <CardDescription>
                Review and adjust the details of your imported book
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="bookTitle">Book Title</Label>
                <Input 
                  id="bookTitle" 
                  value={bookTitle} 
                  onChange={(e) => setBookTitle(e.target.value)} 
                  placeholder="Enter book title"
                />
              </div>
              
              <div>
                <Label>Content Summary</Label>
                <div className="mt-2 p-4 bg-muted rounded-md">
                  <p><strong>Total Pages:</strong> {parsedPages.length}</p>
                  <p><strong>Sections:</strong> {parsedPages.filter(p => p.isSection).length}</p>
                  <p><strong>Content Pages:</strong> {parsedPages.filter(p => !p.isSection).length}</p>
                </div>
              </div>
              
              <div>
                <Label>Page Preview</Label>
                <div className="mt-2 border rounded-md max-h-60 overflow-y-auto">
                  {parsedPages.slice(0, 10).map((page, index) => (
                    <div key={index} className={`p-3 ${index % 2 === 0 ? 'bg-muted/50' : ''}`}>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{index + 1}.</span>
                        <span className="font-medium">{page.title}</span>
                        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full ml-auto">
                          {page.isSection ? 'Section' : 'Content'}
                        </span>
                      </div>
                    </div>
                  ))}
                  {parsedPages.length > 10 && (
                    <div className="p-3 text-center text-muted-foreground">
                      ...{parsedPages.length - 10} more pages
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button 
                onClick={handleImport}
                disabled={isCreatingBook || !bookTitle}
                className="w-full"
              >
                {isCreatingBook ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Creating Book...</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <BookPlus className="h-4 w-4" />
                    <span>Import as New Book</span>
                  </div>
                )}
              </Button>
            </CardFooter>
          </Card>
        )}
      </div>
    </div>
  );
};

export default ImportPDF;
