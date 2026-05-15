import { useState } from "react";
import { createApi } from "unsplash-js";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";

interface UnsplashPickerProps {
  onSelect: (imageUrl: string) => void;
}

export const UnsplashPicker = ({ onSelect }: UnsplashPickerProps) => {
  const [query, setQuery] = useState("");
  const [images, setImages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const searchImages = async () => {
    if (!query.trim()) return;
    
    setLoading(true);
    try {
      console.log('Fetching Unsplash API keys...');
      // Get both Unsplash API keys from Supabase secrets
      const { data: secrets, error: secretError } = await supabase
        .functions.invoke('get-secret', {
          body: { 
            secretNames: ['UNSPLASH_ACCESS_KEY', 'UNSPLASH_SECRET_KEY']
          }
        });

      if (secretError) {
        console.error('Error fetching secrets:', secretError);
        throw secretError;
      }

      console.log('Creating Unsplash API client...');
      const unsplash = createApi({
        accessKey: secrets.UNSPLASH_ACCESS_KEY,
        // The secret key is not needed for client-side operations
        // It's only used for server-side authentication
      });

      console.log('Searching Unsplash images for query:', query);
      const result = await unsplash.search.getPhotos({
        query: query,
        perPage: 20,
      });
      
      if (result.response) {
        console.log('Found', result.response.results.length, 'images');
        setImages(result.response.results);
      }
    } catch (error) {
      console.error("Error searching Unsplash:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          placeholder="Search for images..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              searchImages();
            }
          }}
        />
        <Button onClick={searchImages} disabled={loading}>
          <Search className="h-4 w-4" />
        </Button>
      </div>
      
      <ScrollArea className="h-[400px]">
        <div className="grid grid-cols-2 gap-4">
          {images.map((image) => (
            <div
              key={image.id}
              className="relative group cursor-pointer"
              onClick={() => onSelect(image.urls.regular)}
            >
              <img
                src={image.urls.small}
                alt={image.alt_description}
                className="w-full h-40 object-cover rounded-md transition-opacity group-hover:opacity-75"
              />
              <div className="absolute inset-0 flex items-end p-2 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/60 to-transparent">
                <p className="text-xs text-white">
                  Photo by {image.user.name} on Unsplash
                </p>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};