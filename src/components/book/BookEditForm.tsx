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
    <form onSubmit={onSave} className="space-y-6">
      <div className="space-y-4">
        <div>
          <Label htmlFor="name">Book title</Label>
          <Input
            id="name"
            value={book.name}
            onChange={(e) => onBookChange({ ...book, name: e.target.value })}
            placeholder="Enter book title"
          />
        </div>

        <div>
          <Label htmlFor="subtitle">Subtitle</Label>
          <Input
            id="subtitle"
            value={book.subtitle || ""}
            onChange={(e) => onBookChange({ ...book, subtitle: e.target.value })}
            placeholder="Enter subtitle"
          />
        </div>

        <div>
          <Label htmlFor="author">Author</Label>
          <Input
            id="author"
            value={book.author || ""}
            onChange={(e) => onBookChange({ ...book, author: e.target.value })}
            placeholder="Enter author name"
          />
        </div>
      </div>

      <Button type="submit" disabled={saving}>
        {saving ? "Saving..." : "Save changes"}
      </Button>
    </form>
  );
}