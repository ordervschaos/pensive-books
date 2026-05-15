import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  ChevronDown, 
  ChevronUp, 
  Plus, 
  Brain, 
  Edit, 
  Trash2, 
  Eye,
  BookOpen,
  Settings
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Flashcard } from "@/hooks/use-flashcards";
import { cn } from "@/lib/utils";

interface IntegratedFlashcardSectionProps {
  flashcards: Flashcard[];
  loading: boolean;
  onGenerate: () => void;
  onEdit: (flashcard: Flashcard) => void;
  onDelete: (flashcard: Flashcard) => void;
  onStudy: (flashcard: Flashcard) => void;
  onView: (flashcard: Flashcard) => void;
  isEnabled: boolean;
  onToggleEnabled: () => void;
  preferencesLoading?: boolean;
}

export const IntegratedFlashcardSection = ({
  flashcards,
  loading,
  onGenerate,
  onEdit,
  onDelete,
  onStudy,
  onView,
  isEnabled,
  onToggleEnabled,
  preferencesLoading = false
}: IntegratedFlashcardSectionProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleToggle = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <div className="mt-8">
      <Card className={cn(
        "transition-all duration-200",
        isEnabled 
          ? "border-dashed border-2 border-muted-foreground/20" 
          : "border border-muted-foreground/10 bg-muted/20"
      )}>
        <CardHeader className={cn(
          "transition-all duration-200",
          !isEnabled && "py-3"
        )}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                "p-2 rounded-lg transition-all duration-200",
                isEnabled 
                  ? "bg-primary/10" 
                  : "bg-muted-foreground/10"
              )}>
                <Brain className={cn(
                  "h-5 w-5 transition-all duration-200",
                  isEnabled 
                    ? "text-primary" 
                    : "text-muted-foreground/60"
                )} />
              </div>
              <div>
                <CardTitle className={cn(
                  "text-lg flex items-center gap-2 transition-all duration-200",
                  !isEnabled && "text-muted-foreground/70"
                )}>
                  Flashcards
                  {isEnabled && (
                    <Badge variant="secondary" className="text-xs">
                      {flashcards.length}
                    </Badge>
                  )}
                </CardTitle>
                <p className={cn(
                  "text-sm transition-all duration-200",
                  isEnabled 
                    ? "text-muted-foreground" 
                    : "text-muted-foreground/50"
                )}>
                  {isEnabled 
                    ? "Study and review key concepts from this book"
                    : "Enable flashcards to study and review key concepts"
                  }
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Flashcard Settings */}
              <div className="flex items-center space-x-2">
                <Settings className={cn(
                  "h-4 w-4 transition-all duration-200",
                  isEnabled 
                    ? "text-muted-foreground" 
                    : "text-muted-foreground/50"
                )} />
                <Switch
                  checked={isEnabled}
                  onCheckedChange={onToggleEnabled}
                  disabled={preferencesLoading}
                  className="scale-75"
                />
              </div>

              {isEnabled && (
                <>
                  {flashcards.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onStudy(flashcards[0])}
                      className="opacity-70 hover:opacity-100"
                    >
                      <BookOpen className="h-4 w-4 mr-1" />
                      Study
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onGenerate}
                    className="opacity-70 hover:opacity-100"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Generate
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleToggle}
                    className="opacity-70 hover:opacity-100"
                  >
                    {isExpanded ? (
                      <ChevronUp className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-muted-foreground" />
                    )}
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>

        {isEnabled && isExpanded && (
          <CardContent className="pt-0">
            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(3)].map((_, i) => (
                  <Card key={i} className="animate-pulse">
                    <CardContent className="p-4">
                      <div className="h-4 bg-muted rounded mb-2"></div>
                      <div className="h-3 bg-muted rounded mb-4"></div>
                      <div className="h-8 bg-muted rounded"></div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : flashcards.length === 0 ? (
              <div className="text-center py-8">
                <Brain className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">No flashcards yet</h3>
                <p className="text-muted-foreground mb-4">
                  Generate flashcards from your book content or create them manually
                </p>
                <Button onClick={onGenerate} className="gap-2">
                  <Plus className="h-4 w-4" />
                  Generate Flashcards
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {flashcards.map((flashcard) => (
                  <FlashcardPreviewCard
                    key={flashcard.id}
                    flashcard={flashcard}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onStudy={onStudy}
                    onView={onView}
                  />
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
};

interface FlashcardPreviewCardProps {
  flashcard: Flashcard;
  onEdit: (flashcard: Flashcard) => void;
  onDelete: (flashcard: Flashcard) => void;
  onStudy: (flashcard: Flashcard) => void;
  onView: (flashcard: Flashcard) => void;
}

const FlashcardPreviewCard = ({
  flashcard,
  onEdit,
  onDelete,
  onStudy,
  onView
}: FlashcardPreviewCardProps) => {
  const [isFlipped, setIsFlipped] = useState(false);

  const handleFlip = () => {
    setIsFlipped(!isFlipped);
  };

  const truncateText = (text: string, maxLength: number = 100) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  };

  return (
    <Card className="group hover:shadow-md transition-all duration-200 cursor-pointer">
      <CardContent className="p-4">
        <div className="space-y-3">
          {/* Front/Back indicator */}
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="text-xs">
              {isFlipped ? "BACK" : "FRONT"}
            </Badge>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onView(flashcard);
                }}
                className="h-6 w-6 p-0"
              >
                <Eye className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(flashcard);
                }}
                className="h-6 w-6 p-0"
              >
                <Edit className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(flashcard);
                }}
                className="h-6 w-6 p-0 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Content */}
          <div 
            className="min-h-[80px] flex items-center justify-center text-center"
            onClick={handleFlip}
          >
            <p className="text-sm leading-relaxed">
              {truncateText(isFlipped ? flashcard.back : flashcard.front)}
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onStudy(flashcard);
              }}
              className="flex-1 text-xs"
            >
              <BookOpen className="h-3 w-3 mr-1" />
              Study
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleFlip}
              className="text-xs"
            >
              Flip
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
