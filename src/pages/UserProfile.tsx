
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useNavigate } from "react-router-dom";
import { PageLoading } from "@/components/page/PageLoading";
import { useToast } from "@/hooks/use-toast";
import { Edit } from "lucide-react";

export default function UserProfile() {
  const [books, setBooks] = useState<any[]>([]);
  const [userData, setUserData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isOwnProfile, setIsOwnProfile] = useState(false);
  const { username: paramUsername } = useParams();
  const { toast } = useToast();
  const navigate = useNavigate();

  // Remove @ prefix if present and decode the username
  const username = paramUsername ?
    decodeURIComponent(paramUsername.startsWith('@') ? paramUsername.slice(1) : paramUsername)
    : null;

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        if (!username) {
          toast({
            variant: "destructive",
            title: "Invalid username",
            description: "No username provided in the URL.",
          });
          navigate("/");
          return;
        }

        console.log("Fetching user data for:", username);

        // Check if this is the current user's profile
        const { data: { user } } = await supabase.auth.getUser();

        // First fetch user data based on username from the public view
        const { data: userDataResult, error: userError } = await supabase
          .from("public_user_profiles")
          .select("*")
          .eq("username", username)
          .single();

        if (userError) throw userError;
        if (!userDataResult) {
          toast({
            variant: "destructive",
            title: "User not found",
            description: "The requested user profile does not exist.",
          });
          navigate("/");
          return;
        }

        setUserData(userDataResult);
        setIsOwnProfile(user?.id === userDataResult.user_id);

        // Then fetch their published books
        const { data: booksData, error: booksError } = await supabase
          .from("books")
          .select("*")
          .eq("owner_id", userDataResult.user_id)
          .eq("is_public", true)
          .eq("is_archived", false)
          .order("created_at", { ascending: false });

        if (booksError) throw booksError;
        setBooks(booksData || []);
      } catch (error: any) {
        console.error("Error fetching profile:", error);
        toast({
          variant: "destructive",
          title: "Error loading profile",
          description: error.message,
        });
      } finally {
        setLoading(false);
      }
    };

    fetchUserData();
  }, [username, navigate, toast]);

  if (loading) {
    return <PageLoading />;
  }

  const userInitials = username
    ? username.substring(0, 2).toUpperCase()
    : "?";

  return (
    <div className="container mx-auto p-6">
      <div className="max-w-5xl mx-auto">
        {/* Profile Header */}
        <header className="mb-12">
          <div className="flex items-start gap-6 mb-6">
            <Avatar className="h-24 w-24">
              <AvatarImage src={userData?.profile_pic || ""} alt={username || "User"} />
              <AvatarFallback className="text-2xl">{userInitials}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex items-center gap-4 mb-2">
                <div className="flex flex-col items-start">
                  <h1 className="text-4xl font-bold">
                    {userData?.name || `@${username}`}
                  </h1>
                  {userData?.name && (
                    <p className="text-lg text-muted-foreground mt-1">
                      @{username}
                    </p>
                  )}
                  {isOwnProfile && (
                    <div className="flex items-center gap-2 mt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate("/profile/edit")}
                        className="flex items-center gap-2"
                      >
                        <Edit className="h-3 w-3" />
                        <span className="text-muted-foreground text-sm">Edit Profile</span>
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {userData?.intro && (
                <p className="text-muted-foreground whitespace-pre-wrap mb-4 mt-3">
                  {userData.intro}
                </p>
              )}
            </div>
          </div>

          <h2 className="text-2xl font-semibold mb-2">Published Books</h2>
          <p className="text-muted-foreground">
            {books.length} {books.length === 1 ? 'book' : 'books'} published
          </p>
        </header>

        {books.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No published books yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {books.map((book) => (
              <div key={book.id} className="flex flex-col sm:block">
                <div className="flex sm:block items-start gap-4 sm:gap-0">
                  <Card
                    className="relative cursor-pointer group overflow-hidden w-24 sm:w-full aspect-[3/4]"
                    onClick={() => navigate(`/library/book/${book.id}`)}
                  >
                    {book.cover_url ? (
                      <div className="relative w-full h-full">
                        <img
                          src={book.cover_url}
                          alt={book.name}
                          className="w-full h-full object-cover transition-transform group-hover:scale-105"
                        />
                        {book.show_text_on_cover && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/30 p-4">
                            <h2 className="text-base sm:text-xl font-semibold text-white text-center mb-1 sm:mb-2">
                              {book.name}
                            </h2>
                            {book.subtitle && (
                              <p className="text-xs sm:text-sm text-white/90 text-center mb-1 sm:mb-2">
                                {book.subtitle}
                              </p>
                            )}
                            {book.author && (
                              <p className="text-xs sm:text-sm text-white/90 text-center">
                                by {book.author}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted p-4">
                        <h2 className="text-xs md:text-2xl font-semibold text-center text-white break-words line-clamp-3">
                          {book.name}
                        </h2>
                        {book.subtitle && (
                          <p className="text-xs sm:text-sm text-white/90 text-center mb-1 sm:mb-2">
                            {book.subtitle}
                          </p>
                        )}
                        {book.author && (
                          <p className="text-xs sm:text-sm text-white/90 text-center">
                            by {book.author}
                          </p>
                        )}
                      </div>
                    )}
                  </Card>
                  <div className="flex-1 sm:mt-2 space-y-1 sm:text-center text-left">
                    <h3
                      className="text-sm text-muted-foreground font-medium truncate cursor-pointer"
                      onClick={() => navigate(`/library/book/${book.id}`)}
                    >
                      {book.name}
                    </h3>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
