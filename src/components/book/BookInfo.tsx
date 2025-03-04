
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { BookCoverEdit } from "./BookCoverEdit";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Skeleton } from "@/components/ui/skeleton";

interface BookInfoProps {
  bookId: number;
  canEdit?: boolean;
  showCover?: boolean;
  showTitleOnCover?: boolean;
}

export function BookInfo({ bookId, canEdit = false, showCover = true, showTitleOnCover }: BookInfoProps) {
  const [book, setBook] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBook = async () => {
      if (!bookId) return;
      
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from("books")
          .select("*")
          .eq("id", bookId)
          .single();
          
        if (error) throw error;
        setBook(data);
      } catch (error) {
        console.error("Error fetching book:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchBook();
  }, [bookId]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-[250px] w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  if (!book) return null;

  const coverUrl = book.cover_url;
  const showText = showTitleOnCover !== undefined ? showTitleOnCover : book.show_text_on_cover;

  return (
    <div className="space-y-4">
      {showCover && (
        <div className="relative">
          <AspectRatio ratio={3/4} className="bg-muted overflow-hidden rounded-lg">
            {coverUrl ? (
              <div className="w-full h-full relative">
                <img
                  src={coverUrl}
                  alt={book.name}
                  className="w-full h-full object-cover rounded-lg"
                />
                {showText && (
                  <div className="absolute inset-0 flex flex-col justify-center items-center p-4 bg-black/30">
                    <h1 className="text-white text-2xl md:text-3xl font-bold text-center">
                      {book.name}
                    </h1>
                    {book.author && (
                      <p className="text-white text-sm mt-2">
                        {book.author}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full w-full flex flex-col justify-center items-center bg-slate-200 dark:bg-slate-800 text-center p-4">
                <span className="text-2xl font-bold">{book.name}</span>
                {book.author && <span className="text-sm mt-2">{book.author}</span>}
              </div>
            )}
          </AspectRatio>
          
          {/* Photographer attribution */}
          {coverUrl && book.photographer && (
            <div className="absolute bottom-2 right-2 text-white text-xs bg-black/50 px-2 py-1 rounded">
              Photo by{" "}
              <a 
                href={`https://unsplash.com/@${book.photographer_username}?utm_source=pensive&utm_medium=referral`} 
                target="_blank" 
                rel="noopener noreferrer"
                className="underline"
              >
                {book.photographer}
              </a>{" "}
              on{" "}
              <a 
                href="https://unsplash.com/?utm_source=pensive&utm_medium=referral" 
                target="_blank" 
                rel="noopener noreferrer"
                className="underline"
              >
                Unsplash
              </a>
            </div>
          )}
          
          {canEdit && <BookCoverEdit bookId={bookId} />}
        </div>
      )}
    </div>
  );
}
