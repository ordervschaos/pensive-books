import { TipTapEditor } from "@/components/editor/TipTapEditor";
import { PageHistory } from "./PageHistory";
import { FloatingActions } from "./FloatingActions";

interface TextPageContentProps {
  content: string;
  isEditing: boolean;
  onChange: (html: string, json: any) => void;
  title: string;
  onToggleEdit?: () => void;
  canEdit?: boolean;
  pageId?: string;
  onToggleChat?: () => void;
  hasActiveChat?: boolean;
  centerContent?: boolean;
}

export const TextPageContent = ({
  content,
  isEditing,
  onChange,
  title,
  onToggleEdit,
  canEdit = false,
  pageId,
  onToggleChat,
  hasActiveChat,
  centerContent = false
}: TextPageContentProps) => {
  // Always use the prop content directly - don't maintain separate state
  // This ensures content updates immediately when navigating between pages
  const displayContent = content || `<h1 class="page-title">${title}</h1><p></p>`;

  return (
    <div className={`flex-1 ${!isEditing ? '' : ''}`}>
      <TipTapEditor
        key={pageId} // Force remount on page change to ensure fresh content
        content={displayContent}
        onChange={onChange}
        editable={canEdit}
        isEditing={isEditing}
        onToggleEdit={undefined} // Edit button now handled by FloatingActions
        onToggleChat={undefined} // Chat button now handled by FloatingActions
        hasActiveChat={hasActiveChat}
        centerContent={centerContent}
        customButtons={canEdit && pageId && <PageHistory pageId={parseInt(pageId)} />}
      />
      
      {/* Floating action buttons */}
      <FloatingActions
        isEditing={isEditing}
        onToggleEdit={onToggleEdit}
        canEdit={canEdit}
        onToggleChat={onToggleChat}
        hasActiveChat={hasActiveChat}
        pageId={pageId}
        content={content}
      />
    </div>
  );
};
