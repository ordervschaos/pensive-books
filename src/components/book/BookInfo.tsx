import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Clock, Globe } from "lucide-react";

interface BookInfoProps {
  name: string;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export const BookInfo = ({ name, isPublic, createdAt, updatedAt, publishedAt }: BookInfoProps) => {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-2xl">{name}</CardTitle>
          {isPublic && (
            <span className="text-sm text-muted-foreground flex items-center">
              <Globe className="mr-1 h-4 w-4" />
              Public
            </span>
          )}
        </div>
        <div className="flex space-x-4 text-sm text-muted-foreground">
          <div className="flex items-center">
            <Calendar className="mr-1 h-4 w-4" />
            Created {new Date(createdAt).toLocaleDateString()}
          </div>
          <div className="flex items-center">
            <Clock className="mr-1 h-4 w-4" />
            Last updated {new Date(updatedAt).toLocaleDateString()}
          </div>
          {publishedAt && (
            <div className="flex items-center">
              <Globe className="mr-1 h-4 w-4" />
              Published {new Date(publishedAt).toLocaleDateString()}
            </div>
          )}
        </div>
      </CardHeader>
    </Card>
  );
};