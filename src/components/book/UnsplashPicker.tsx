
import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search, X } from "lucide-react";
import { createApi } from "unsplash-js";
import { supabase } from "@/integrations/supabase/client";

interface UnsplashPickerProps {
  onSelect: (imageUrl: string, photographer: string, photographerUsername: string) => void;
  onClose: () => void;
}

export function UnsplashPicker({ onSelect, onClose }: UnsplashPickerProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [images, setImages] = useState<any[]>([]);
  const [unsplashApi, setUnsplashApi] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);

  // Initialize Unsplash API
  useEffect(() => {
    const initUnsplashApi = async () => {
      // Get Unsplash API key from Supabase secrets
      const { data, error } = await supabase.functions.invoke("get-secret", {
        body: { key: "UNSPLASH_ACCESS_KEY" }
      });

      if (error) {
        console.error("Error fetching Unsplash API key:", error);
        return;
      }

      const api = createApi({
        accessKey: data.secret,
      });

      setUnsplashApi(api);

      // Load popular photos on initial load
      loadPopularPhotos(api);
    };

    initUnsplashApi();
  }, []);

  const loadPopularPhotos = async (api: any) => {
    try {
      setSearching(true);
      const result = await api.photos.list({ page, perPage: 20 });
      
      if (result.errors) {
        console.error("Unsplash API errors:", result.errors);
        return;
      }

      setImages(prev => page === 1 ? result.response.results : [...prev, ...result.response.results]);
      setHasMore(result.response.results.length === 20);
      setInitialLoad(false);
    } catch (error) {
      console.error("Error loading popular photos:", error);
    } finally {
      setSearching(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchTerm.trim() || !unsplashApi) return;

    try {
      setSearching(true);
      setPage(1);

      const result = await unsplashApi.search.getPhotos({
        query: searchTerm,
        page: 1,
        perPage: 20,
        orientation: "landscape",
      });

      if (result.errors) {
        console.error("Unsplash API errors:", result.errors);
        return;
      }

      setImages(result.response.results);
      setHasMore(result.response.results.length === 20);
    } catch (error) {
      console.error("Error searching photos:", error);
    } finally {
      setSearching(false);
    }
  };

  const loadMore = async () => {
    if (!unsplashApi || searching || !hasMore) return;

    try {
      setSearching(true);
      const nextPage = page + 1;
      setPage(nextPage);

      if (searchTerm.trim()) {
        const result = await unsplashApi.search.getPhotos({
          query: searchTerm,
          page: nextPage,
          perPage: 20,
          orientation: "landscape",
        });

        if (result.errors) {
          console.error("Unsplash API errors:", result.errors);
          return;
        }

        setImages(prev => [...prev, ...result.response.results]);
        setHasMore(result.response.results.length === 20);
      } else {
        await loadPopularPhotos(unsplashApi);
      }
    } catch (error) {
      console.error("Error loading more photos:", error);
    } finally {
      setSearching(false);
    }
  };

  const handleSelectImage = async (image: any) => {
    try {
      // Track a download with Unsplash API to comply with API requirements
      if (unsplashApi) {
        await unsplashApi.photos.trackDownload({
          downloadLocation: image.links.download_location,
        });
      }

      // Get photographer info
      const photographer = image.user.name;
      const photographerUsername = image.user.username;

      // Pass both the URL and photographer info to the parent component
      onSelect(image.urls.regular, photographer, photographerUsername);
    } catch (error) {
      console.error("Error tracking download:", error);
      // Still provide the image even if tracking fails
      onSelect(
        image.urls.regular, 
        image.user.name,
        image.user.username
      );
    }
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Choose an Unsplash Image</h3>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      
      <form onSubmit={handleSearch} className="flex gap-2">
        <Input
          placeholder="Search for images..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <Button type="submit" disabled={searching}>
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
      </form>
      
      {initialLoad && searching ? (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 overflow-y-auto">
            {images.map((image) => (
              <div 
                key={image.id} 
                className="relative group cursor-pointer rounded-md overflow-hidden"
                onClick={() => handleSelectImage(image)}
              >
                <img 
                  src={image.urls.small} 
                  alt={image.alt_description || "Unsplash image"} 
                  className="w-full h-40 object-cover transition-transform group-hover:scale-105"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                  <p className="text-white text-xs truncate">
                    Photo by {image.user.name}
                  </p>
                </div>
              </div>
            ))}
          </div>
          
          {hasMore && (
            <div className="flex justify-center mt-4">
              <Button onClick={loadMore} variant="outline" disabled={searching}>
                {searching ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Loading...
                  </>
                ) : (
                  "Load More"
                )}
              </Button>
            </div>
          )}
        </>
      )}
      
      <p className="text-xs text-muted-foreground mt-auto">
        Photos provided by <a href="https://unsplash.com/" target="_blank" rel="noopener noreferrer" className="underline">Unsplash</a>
      </p>
    </div>
  );
}
