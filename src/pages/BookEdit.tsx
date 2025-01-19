import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { BookInfo } from "@/components/book/BookInfo";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Book {
  id?: number;
  name: string;
  subtitle: string | null;
  author: string | null;
  is_public: boolean;
  cover_url?: string | null;
  created_at?: string;
  updated_at?: string;
  published_at?: string | null;
}

const BookEdit = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
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
  const [inviteEmail, setInviteEmail] = useState("");
  const [accessLevel, setAccessLevel] = useState<"view" | "edit">("view");

  useEffect(() => {
    if (id) {
      fetchBook();
    } else {
      setLoading(false);
    }
  }, [id]);

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

      navigate(`/book/${id}`);
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

  const handleInvite = async () => {
    if (!inviteEmail || !id) return;

    try {
      const { error } = await supabase
        .from("book_access")
        .insert({
          book_id: parseInt(id),
          user_id: null, // Will be updated when user accepts invitation
          access_level: accessLevel,
          created_by: (await supabase.auth.getUser()).data.user?.id
        });

      if (error) throw error;

      toast({
        title: "Invitation sent",
        description: `Invitation sent to ${inviteEmail}`
      });

      setInviteEmail("");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error sending invitation",
        description: error.message
      });
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => navigate(-1)}
              className="mr-4"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-2xl font-semibold">Edit Book</h1>
          </div>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">
                <UserPlus className="mr-2 h-4 w-4" />
                Invite
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Invite Collaborator</SheetTitle>
              </SheetHeader>
              <div className="space-y-4 mt-4">
                <div>
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="collaborator@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="access">Access level</Label>
                  <Select
                    value={accessLevel}
                    onValueChange={(value: "view" | "edit") => setAccessLevel(value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select access level" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="view">View only</SelectItem>
                      <SelectItem value="edit">Can edit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button 
                  className="w-full" 
                  onClick={handleInvite}
                  disabled={!inviteEmail}
                >
                  Send Invitation
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <BookInfo 
              name={book.name}
              isPublic={book.is_public}
              createdAt={book.created_at || new Date().toISOString()}
              updatedAt={book.updated_at || new Date().toISOString()}
              publishedAt={book.published_at}
              bookId={book.id || 0}
              coverUrl={book.cover_url}
              onTogglePublish={async () => {
                const newValue = !book.is_public;
                setBook({ ...book, is_public: newValue });
                await handleSave({ preventDefault: () => {} } as React.FormEvent);
              }}
              publishing={saving}
            />
          </div>

          <form onSubmit={handleSave} className="space-y-6">
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Book title</Label>
                <Input
                  id="name"
                  value={book.name}
                  onChange={(e) => setBook({ ...book, name: e.target.value })}
                  placeholder="Enter book title"
                />
              </div>

              <div>
                <Label htmlFor="subtitle">Subtitle</Label>
                <Input
                  id="subtitle"
                  value={book.subtitle || ""}
                  onChange={(e) => setBook({ ...book, subtitle: e.target.value })}
                  placeholder="Enter subtitle"
                />
              </div>

              <div>
                <Label htmlFor="author">Author</Label>
                <Input
                  id="author"
                  value={book.author || ""}
                  onChange={(e) => setBook({ ...book, author: e.target.value })}
                  placeholder="Enter author name"
                />
              </div>
            </div>

            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default BookEdit;