
import { supabase } from "@/integrations/supabase/client";

export async function getBookCover(
  title: string,
  genre?: string,
  author?: string
): Promise<string> {
  // For now, we'll return a placeholder image URL
  // In a production app, you might want to use an AI service to generate covers
  return "https://via.placeholder.com/800x1200/2563eb/ffffff?text=" + encodeURIComponent(`${title || 'Book Title'}`);
}
