import { 
  Card,
  CardHeader 
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ImageIcon, Download, Book } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { generatePDF, generateAndDownloadEPUB } from "@/lib/download";

interface BookInfoProps {
  name: string;
  coverUrl?: string | null;
  bookId: number;
  author?: string | null;
  subtitle?: string | null;
  showTextOnCover?: boolean;
}

export const BookInfo = ({ 
  name,
  coverUrl,
  bookId,
  author,
  subtitle,
  showTextOnCover = false
}: BookInfoProps) => {
  const { toast } = useToast();

  const handleDownloadPDF = async () => {
    const result = await generatePDF({ 
      bookId, 
      name, 
      author,
      coverUrl
    });
    
    if (!result.success) {
      toast({
        variant: "destructive",
        title: "Error generating PDF",
        description: result.error?.message
      });
    }
  };

  const handleDownloadEPUB = async () => {
    const result = await generateAndDownloadEPUB({ 
      bookId, 
      name, 
      author,
      coverUrl,
      showTextOnCover
    });
    
    if (result.success) {
      toast({
        title: "EPUB Generated",
        description: "Your book has been downloaded as EPUB"
      });
    } else {
      toast({
        variant: "destructive",
        title: "Error generating EPUB",
        description: result.error?.message
      });
    }
  };

  return (
    <Card className="bg-background shadow-sm w-full lg:max-w-[300px]">
      <div className="flex flex-col gap-4">
        <CardHeader className="space-y-6">
          <div className="w-full aspect-[3/4] relative rounded-lg overflow-hidden bg-muted">
            {coverUrl ? (
              <div className="relative w-full h-full">
                <img 
                  src={coverUrl} 
                  alt="Book cover"
                  className="w-full h-full object-cover"
                />
                {showTextOnCover && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 p-4">
                    <h1 className="text-sm sm:text-base lg:text-2xl font-bold text-white text-center mb-1 sm:mb-2">
                      {name}
                    </h1>
                    {subtitle && (
                      <p className="text-xs sm:text-sm lg:text-lg text-white/90 text-center mb-1 sm:mb-4">
                        {subtitle}
                      </p>
                    )}
                    {author && (
                      <p className="text-xs sm:text-sm lg:text-lg text-white/90 text-center">
                        by {author}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <ImageIcon className="w-16 h-16 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="flex flex-col sm:flex-row lg:flex-col gap-2">
            <Button
              onClick={handleDownloadEPUB}
              variant="outline"
              className="w-full text-xs sm:text-sm"
            >
              <Download className="h-4 w-4 mr-2" />
              Download EPUB
            </Button>
          </div>
        </CardHeader>
      </div>
    </Card>
  );
};
