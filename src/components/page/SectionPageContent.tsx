import { Input } from "@/components/ui/input";
import { ChangeEvent } from "react";
import { TipTapEditor } from "@/components/editor/TipTapEditor";
import { getEditorConfig } from "../editor/config/editorConfig";
import StarterKit from '@tiptap/starter-kit';
import { SectionDocument } from "../editor/extensions/SectionDocument";
import { Button } from "@/components/ui/button";
import { Pencil, Eye, EyeOff } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

interface SectionPageContentProps {
  title: string;
  isEditing: boolean;
  onChange: (html: string, json: any) => void;
  content: string;
  onToggleEdit?: () => void;
  canEdit?: boolean;
}

export const SectionPageContent = ({ 
  title, 
  isEditing, 
  onChange,
  content,
  onToggleEdit,
  canEdit = false
}: SectionPageContentProps) => {
  const isMobile = useIsMobile();
  const initialContent = content || `<h1 class="page-title">${title}</h1>`;

  const sectionEditorConfig = {
    ...getEditorConfig(initialContent, onChange),
    extensions: [
      SectionDocument,
      StarterKit.configure({
        document: false,
        heading: {
          levels: [1],
          HTMLAttributes: {
            class: 'text-4xl font-bold text-center',
          }
        },
        // Disable all other nodes/marks
        paragraph: false,
        text: true,
        bold: false,
        italic: false,
        strike: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        hardBreak: false,
      }),
    ],
  };

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-full max-w-3xl relative group">
        {canEdit && onToggleEdit && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleEdit}
            className={`absolute right-4 top-4 ${
              isMobile || isEditing
                ? 'opacity-100' 
                : 'opacity-0 group-hover:opacity-100 transition-opacity'
            }`}
            title={isEditing ? "Preview" : "Edit"}
          >
            {isEditing ? (
              <Eye className="h-4 w-4" />
            ) : (
              <Pencil className="h-4 w-4" />
            )}
          </Button>
        )}
        <TipTapEditor 
          content={initialContent}
          onChange={onChange}
          editable={canEdit}
          isEditing={isEditing}
          onToggleEdit={onToggleEdit}
          editorConfig={sectionEditorConfig}
          hideToolbar
          className="min-h-[200px] flex items-center justify-center"
        />
      </div>
    </div>
  );
};
