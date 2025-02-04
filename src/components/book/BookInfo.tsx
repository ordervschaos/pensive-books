import { Card, CardHeader } from "@/components/ui/card";
import { ImageIcon } from "lucide-react";

interface BookInfoProps {
  name: string;
  coverUrl?: string | null;
}

export const BookInfo = ({ 
  coverUrl,
}: BookInfoProps) => {
  return (
    <Card className="bg-white shadow-sm">
      <CardHeader className="space-y-6">
        <div className="space-y-4">
          <div className="w-full aspect-[3/4] relative rounded-lg overflow-hidden bg-blue-100">
            {coverUrl ? (
              <img 
                src={coverUrl} 
                alt="Book cover" 
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <ImageIcon className="w-16 h-16 text-blue-300" />
              </div>
            )}
          </div>
        </div>
      </CardHeader>
    </Card>
  );
};