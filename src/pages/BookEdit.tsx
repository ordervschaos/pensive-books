import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Archive, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { BookInfo } from "@/components/book/BookInfo";
import { BookEditForm } from "@/components/book/BookEditForm";
import { ManageCollaboratorsSheet } from "@/components/book/ManageCollaboratorsSheet";
import { ShareBookSheet } from "@/components/book/ShareBookSheet";
import { BookCoverEdit } from "@/components/book/BookCoverEdit";
import { BookVisibilityToggle } from "@/components/book/BookVisibilityToggle";
import { useBookPermissions } from "@/hooks/use-book-permissions";
import { setPageTitle } from "@/utils/pageTitle";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface Book {
  id?: number;
  name: string;
  subtitle: string | null;
  author: string | null;
  is_public: boolean;
  cover_url?: string | null;
  show_text_on_cover?: boolean;
  created_at?: string;
  updated_at?: string;
  published_at?: string | null;
  view_invitation_token?: string;
  edit_invitation_token?: string;
}

export default function BookEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isOwner, loading: permissionsLoading } = useBookPermissions(id);
  const [book, setBook] = useState<Book>({
    name: "",
    subtitle: "",
    author: "",
    is_public: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    published_at: null
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    if (id) {
      fetchBook();
    } else {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setPageTitle(book.name ? `Edit ${book.name}` : 'Edit Book');
  }, [book.name]);

  const fetchBook = async () => {
    try {
      const { data, error } = await supabase
        .from("books")
        .select("*")
        .eq("id", parseInt(id || "0"))
        .single();

      if (error) throw error;
      
      if (data) {
        setBook(data);
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error fetching book",
        description: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      
      const { error } = await supabase
        .from("books")
        .update(book)
        .eq("id", parseInt(id || "0"));

      if (error) throw error;

      toast({
        title: "Success",
        description: "Book updated successfully"
      });

    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error saving book",
        description: error.message
      });
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async () => {
    try {
      setPublishing(true);
      const newPublishState = !book.is_public;
      
      const { error } = await supabase
        .from("books")
        .update({ 
          is_public: newPublishState,
          published_at: newPublishState ? new Date().toISOString() : null
        })
        .eq("id", parseInt(id || "0"));

      if (error) throw error;

      setBook({
        ...book,
        is_public: newPublishState,
        published_at: newPublishState ? new Date().toISOString() : null
      });

      toast({
        title: newPublishState ? "Book Published" : "Book Unpublished",
        description: newPublishState 
          ? "Your book is now available to the public"
          : "Your book is now private"
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error updating book",
        description: error.message
      });
    } finally {
      setPublishing(false);
    }
  };

  const handleArchiveBook = async () => {
    if (!isOwner) {
      toast({
        variant: "destructive",
        title: "Permission denied",
        description: "Only the book owner can archive books"
      });
      return;
    }

    if (!confirm("Are you sure you want to archive this book? This action cannot be undone.")) {
      return;
    }

    try {
      const { error } = await supabase
        .from("books")
        .update({ is_archived: true })
        .eq("id", parseInt(id || "0"));

      if (error) throw error;

      toast({
        title: "Book archived",
        description: "The book has been moved to archive"
      });

      navigate("/my-books");
    } catch (error: any) {
      console.error("Error archiving book:", error);
      toast({
        variant: "destructive",
        title: "Error archiving book",
        description: error.message
      });
    }
  };

  if (loading || permissionsLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-6">
        <div className="flex justify-end mb-8">
          <div className="flex items-center gap-4">
            <BookVisibilityToggle
              isPublic={book.is_public}
              onTogglePublish={togglePublish}
              publishing={publishing}
            />
            {isOwner && id && book.view_invitation_token && book.edit_invitation_token && (
              <ShareBookSheet
                bookId={parseInt(id)}
                viewToken={book.view_invitation_token}
                editToken={book.edit_invitation_token}
              />
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-6 gap-8">
          <div className="w-full lg:col-span-2">
            <BookCoverEdit 
              bookId={book.id || 0}
              coverUrl={book.cover_url}
              showTextOnCover={book.show_text_on_cover}
              title={book.name}
              subtitle={book.subtitle}
              author={book.author}
              onCoverChange={(url) => setBook({ ...book, cover_url: url })}
              onShowTextChange={(showText) => setBook({ ...book, show_text_on_cover: showText })}
            />
          </div>

          <div className="lg:col-span-4">
            <BookEditForm
              book={book}
              onBookChange={setBook}
              onSave={handleSave}
              saving={saving}
            />

            {isOwner && (
              <div className="mt-12">
                <Separator className="my-6" />
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="flex items-center gap-2 text-destructive hover:text-destructive hover:bg-destructive/10">
                      <h2 className="text-xl font-semibold">Danger Zone</h2>
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <Card className="p-6 mt-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-medium">Archive Book</h3>
                          <p className="text-sm text-muted-foreground">
                            Archive this book and all its contents. This action cannot be undone.
                          </p>
                        </div>
                        <Button 
                          onClick={handleArchiveBook}
                          variant="destructive"
                          className="ml-4"
                        >
                          <Archive className="h-4 w-4 mr-2" />
                          Archive Book
                        </Button>
                      </div>
                    </Card>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
