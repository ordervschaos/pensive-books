import { useEffect, useState } from "react";

interface PageContentProps {
  content: string;
  title: string;
  onSave: (html: string, content: any, title?: string) => void;
  saving?: boolean;
  pageType?: string;
  editable?: boolean;
  onEditingChange?: (isEditing: boolean) => void;
}

export function PageContent({ 
  content, 
  title, 
  onSave, 
  saving, 
  pageType = 'text',
  editable = false,
  onEditingChange
}: PageContentProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [currentTitle, setCurrentTitle] = useState(title);

  useEffect(() => {
    setCurrentTitle(title);
  }, [title]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value;
    setCurrentTitle(newTitle);
    onSave(content, {}, newTitle);
  };

  const handleSave = () => {
    onSave(content, {}, currentTitle);
    setIsEditing(false);
    if (onEditingChange) {
      onEditingChange(false);
    }
  };

  return (
    <div className="page-content">
      {isEditing ? (
        <div>
          <input 
            type="text" 
            value={currentTitle} 
            onChange={handleTitleChange} 
            className="title-input"
          />
          <textarea 
            value={content} 
            onChange={(e) => onSave(e.target.value, {}, currentTitle)} 
            className="content-textarea"
          />
          <button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      ) : (
        <div>
          <h1>{title}</h1>
          <div dangerouslySetInnerHTML={{ __html: content }} />
          {editable && (
            <button onClick={() => {
              setIsEditing(true);
              if (onEditingChange) {
                onEditingChange(true);
              }
            }}>
              Edit
            </button>
          )}
        </div>
      )}
    </div>
  );
}
