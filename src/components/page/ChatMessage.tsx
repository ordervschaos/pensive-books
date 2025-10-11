import { Message, SuggestedEdit } from '@/hooks/use-page-chat';
import { Button } from '@/components/ui/button';
import { Check, X, User, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';

interface ChatMessageProps {
  message: Message;
  onApplyEdit?: (edit: SuggestedEdit) => void;
  onRejectEdit?: (edit: SuggestedEdit) => void;
}

export const ChatMessage = ({ message, onApplyEdit, onRejectEdit }: ChatMessageProps) => {
  const isUser = message.role === 'user';
  const timestamp = new Date(message.timestamp).toLocaleTimeString([], { 
    hour: '2-digit', 
    minute: '2-digit' 
  });

  return (
    <div className={cn(
      "flex gap-3 mb-4",
      isUser ? "flex-row-reverse" : "flex-row"
    )}>
      {/* Avatar */}
      <div className={cn(
        "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
        isUser 
          ? "bg-primary text-primary-foreground" 
          : "bg-muted text-muted-foreground"
      )}>
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>

      {/* Message content */}
      <div className={cn(
        "flex-1 max-w-[80%]",
        isUser ? "flex flex-col items-end" : "flex flex-col items-start"
      )}>
        {/* Message bubble */}
        <div className={cn(
          "rounded-lg px-4 py-2 text-sm",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
        )}>
          {isUser ? (
            <div className="whitespace-pre-wrap">{message.content}</div>
          ) : (
            <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          )}
        </div>

        {/* Timestamp */}
        <div className={cn(
          "text-xs text-muted-foreground mt-1",
          isUser ? "text-right" : "text-left"
        )}>
          {timestamp}
        </div>

        {/* Edit suggestions */}
        {message.applied_edits && message.applied_edits.length > 0 && (
          <div className="mt-3 space-y-2 w-full">
            {message.applied_edits.map((edit, index) => (
              <EditSuggestion
                key={index}
                edit={edit}
                onApply={onApplyEdit}
                onReject={onRejectEdit}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

interface EditSuggestionProps {
  edit: SuggestedEdit;
  onApply?: (edit: SuggestedEdit) => void;
  onReject?: (edit: SuggestedEdit) => void;
}

const EditSuggestion = ({ edit, onApply, onReject }: EditSuggestionProps) => {
  return (
    <div className="border rounded-lg p-3 bg-background">
      <div className="text-xs font-medium text-muted-foreground mb-2">
        Suggested Edit:
      </div>
      
      <div className="space-y-2">
        {/* Old text */}
        <div>
          <div className="text-xs font-medium text-destructive mb-1">Remove:</div>
          <div className="text-sm bg-destructive/10 p-2 rounded border-l-2 border-destructive">
            <div 
              className="prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: edit.old }}
            />
          </div>
        </div>

        {/* New text */}
        <div>
          <div className="text-xs font-medium text-green-600 mb-1">Add:</div>
          <div className="text-sm bg-green-50 p-2 rounded border-l-2 border-green-600">
            <div 
              className="prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: edit.new }}
            />
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mt-3">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onApply?.(edit)}
          className="flex-1"
        >
          <Check className="w-3 h-3 mr-1" />
          Apply
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onReject?.(edit)}
          className="flex-1"
        >
          <X className="w-3 h-3 mr-1" />
          Reject
        </Button>
      </div>
    </div>
  );
};
