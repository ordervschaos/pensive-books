import { TipTapEditor } from "@/components/editor/TipTapEditor";
import { PageHistory } from "./PageHistory";
import { AudioPlayer } from "./AudioPlayer";

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
  // Check beta flag
  const isBetaEnabled = localStorage.getItem('is_beta') === 'true';

  // Always use the prop content directly - don't maintain separate state
  // This ensures content updates immediately when navigating between pages
  const displayContent = content || `<h1 class="page-title">${title}</h1><p></p>`;

  return (
    <div className={`flex-1 ${!isEditing ? '' : ''}`}>
      {/* Audio Player - Only visible in beta */}
      {pageId && isBetaEnabled && (
        <div className="mb-4 flex justify-end">
          <AudioPlayer
            pageId={parseInt(pageId)}
            content={content}
            compact={false}
          />
        </div>
      )}

      <TipTapEditor
        key={pageId} // Force remount on page change to ensure fresh content
        content={displayContent}
        onChange={onChange}
        editable={canEdit}
        isEditing={isEditing}
        onToggleEdit={canEdit ? onToggleEdit : undefined}
        onToggleChat={onToggleChat}
        hasActiveChat={hasActiveChat}
        className={centerContent ? "text-center" : undefined}
        customButtons={canEdit && pageId && <PageHistory pageId={parseInt(pageId)} />}
      />
    </div>
  );
};
