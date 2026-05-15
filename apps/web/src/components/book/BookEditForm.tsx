import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Book {
  id?: number;
  name: string;
  subtitle: string | null;
  author: string | null;
  is_public: boolean;
  cover_url?: string | null;
}

interface BookEditFormProps {
  book: Book;
  onBookChange: (book: Book) => void;
  onSave: (e: React.FormEvent) => void;
  saving: boolean;
}

export function BookEditForm({ book, onBookChange, onSave, saving }: BookEditFormProps) {
  return (
    <form onSubmit={onSave} className="space-y-8">
      <div className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="name" className="text-sm font-medium">Book title</Label>
          <Input
            id="name"
            value={book.name}
            onChange={(e) => onBookChange({ ...book, name: e.target.value })}
            placeholder="Enter book title"
            style={{ 
              fontSize: 'clamp(1.5rem, 4vw, 2.5rem)'
            }}
            className="h-14 sm:h-16 md:h-20 px-3 sm:px-4 py-4 sm:py-6 font-bold w-full"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="subtitle">Subtitle</Label>
            <Input
              id="subtitle"
              value={book.subtitle || ""}
              onChange={(e) => onBookChange({ ...book, subtitle: e.target.value })}
              placeholder="Enter subtitle"
              className="w-full"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="author">Author</Label>
            <Input
              id="author"
              value={book.author || ""}
              onChange={(e) => onBookChange({ ...book, author: e.target.value })}
              placeholder="Enter author name"
              className="w-full"
            />
          </div>
        </div>
      </div>

      <Button type="submit" disabled={saving} className="w-full sm:w-auto">
        {saving ? "Saving..." : "Save changes"}
      </Button>
    </form>
  );
}