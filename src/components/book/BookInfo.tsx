import { useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Clock, Globe } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface BookInfoProps {
  name: string;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  bookId: number;
}

export const BookInfo = ({ name, isPublic, createdAt, updatedAt, publishedAt, bookId }: BookInfoProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [bookName, setBookName] = useState(name);
  const { toast } = useToast();

  const handleNameChange = async (newName: string) => {
    try {
      const { error } = await supabase
        .from("books")
        .update({ name: newName })
        .eq("id", bookId);

      if (error) throw error;

      setBookName(newName);
      toast({
        title: "Book name updated",
        description: "Your book name has been successfully updated."
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error updating book name",
        description: error.message
      });
      setBookName(name); // Reset to original name if update fails
    }
    setIsEditing(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          {isEditing ? (
            <Input
              value={bookName}
              onChange={(e) => setBookName(e.target.value)}
              onBlur={() => {
                if (bookName !== name) {
                  handleNameChange(bookName);
                } else {
                  setIsEditing(false);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (bookName !== name) {
                    handleNameChange(bookName);
                  } else {
                    setIsEditing(false);
                  }
                }
                if (e.key === "Escape") {
                  setBookName(name);
                  setIsEditing(false);
                }
              }}
              className="text-2xl font-semibold w-[300px]"
              autoFocus
            />
          ) : (
            <CardTitle 
              className="text-2xl cursor-pointer hover:text-muted-foreground transition-colors"
              onClick={() => setIsEditing(true)}
            >
              {bookName}
            </CardTitle>
          )}
          {isPublic && (
            <span className="text-sm text-muted-foreground flex items-center">
              <Globe className="mr-1 h-4 w-4" />
              Public
            </span>
          )}
        </div>
        <div className="flex space-x-4 text-sm text-muted-foreground">
          <div className="flex items-center">
            <Calendar className="mr-1 h-4 w-4" />
            Created {new Date(createdAt).toLocaleDateString()}
          </div>
          <div className="flex items-center">
            <Clock className="mr-1 h-4 w-4" />
            Last updated {new Date(updatedAt).toLocaleDateString()}
          </div>
          {publishedAt && (
            <div className="flex items-center">
              <Globe className="mr-1 h-4 w-4" />
              Published {new Date(publishedAt).toLocaleDateString()}
            </div>
          )}
        </div>
      </CardHeader>
    </Card>
  );
};