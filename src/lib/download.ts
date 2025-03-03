import { supabase } from "@/integrations/supabase/client";

interface Page {
  id: number;
  book_id: number;
  title: string;
  html_content: string;
  page_index: number;
  page_type: "section" | "text";
  created_at: string;
  updated_at: string;
  archived: boolean;
  content: any;
  owner_id: string;
  // Add other properties as needed
}

export const downloadBook = async (bookId: number) => {
  try {
    const { data: pagesData, error: pagesError } = await supabase
      .from("pages")
      .select("*")
      .eq("book_id", bookId)
      .eq("archived", false)
      .order("page_index", { ascending: true });

    if (pagesError) throw pagesError;

    const contentHtml = pagesData.map(page => `
      <div>
        <h1>${page.title}</h1>
        <div>${page.html_content}</div>
      </div>
    `).join("");

    const content = new Blob([contentHtml], { type: 'application/xhtml+xml' });

    const url = URL.createObjectURL(content);
    const a = document.createElement("a");
    a.href = url;
    a.download = `book-${bookId}.xhtml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Error downloading book:", error);
  }
};
