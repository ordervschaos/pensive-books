import { Message } from '@/hooks/use-book-chat';
import { Button } from '@/components/ui/button';
import { Check, X, User, Bot, Plus, Trash2, Move, Edit3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { convertJSONToHTML } from '@/utils/tiptapHelpers';
import ReactMarkdown from 'react-markdown';

interface BookChatMessageProps {
  message: Message;
  onApplyOperation?: (operation: Message['suggested_operations'][0]) => void;
  onRejectOperation?: (operation: Message['suggested_operations'][0]) => void;
}

export const BookChatMessage = ({ message, onApplyOperation, onRejectOperation }: BookChatMessageProps) => {
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

        {/* Operation suggestions */}
        {message.suggested_operations && message.suggested_operations.length > 0 && (
          <div className="mt-3 space-y-2 w-full">
            {message.suggested_operations.map((operation, index) => (
              <OperationSuggestion
                key={index}
                operation={operation}
                onApply={onApplyOperation}
                onReject={onRejectOperation}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

interface OperationSuggestionProps {
  operation: Message['suggested_operations'][0];
  onApply?: (operation: Message['suggested_operations'][0]) => void;
  onReject?: (operation: Message['suggested_operations'][0]) => void;
}

const OperationSuggestion = ({ operation, onApply, onReject }: OperationSuggestionProps) => {
  const getOperationIcon = () => {
    switch (operation.type) {
      case 'add':
        return <Plus className="w-4 h-4" />;
      case 'archive':
        return <Trash2 className="w-4 h-4" />;
      case 'move':
        return <Move className="w-4 h-4" />;
      case 'edit':
        return <Edit3 className="w-4 h-4" />;
      default:
        return <Edit3 className="w-4 h-4" />;
    }
  };

  const getOperationTitle = () => {
    switch (operation.type) {
      case 'add':
        return `Add Page: "${operation.title}"`;
      case 'archive':
        return `Archive Page`;
      case 'move':
        return `Move Page to Position ${(operation.newIndex || 0) + 1}`;
      case 'edit':
        return `Edit Page Content`;
      default:
        return 'Operation';
    }
  };

  const getOperationDescription = () => {
    switch (operation.type) {
      case 'add':
        return `Add new page "${operation.title}" after page ${(operation.newIndex || 0) + 1}`;
      case 'archive':
        return `Archive page with ID ${operation.pageId}`;
      case 'move':
        return `Move page to position ${(operation.newIndex || 0) + 1}`;
      case 'edit':
        return `Update page content`;
      default:
        return 'Perform operation';
    }
  };

  return (
    <div className="border rounded-lg p-3 bg-background">
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center">
          {getOperationIcon()}
        </div>
        <div className="text-sm font-medium text-foreground">
          {getOperationTitle()}
        </div>
      </div>
      
      <div className="text-xs text-muted-foreground mb-3">
        {getOperationDescription()}
      </div>

      {/* Show content preview for add/edit operations */}
      {(operation.type === 'add' || operation.type === 'edit') && (operation.content || operation.contentJson) && (
        <div className="mb-3">
          <div className="text-xs font-medium text-muted-foreground mb-1">Content Preview:</div>
          <div className="text-sm bg-muted/50 p-2 rounded border-l-2 border-blue-500 max-h-32 overflow-y-auto">
            <div 
              className="prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ 
                __html: operation.contentJson 
                  ? convertJSONToHTML(operation.contentJson) 
                  : operation.content || '' 
              }}
            />
          </div>
        </div>
      )}

      {/* Show old vs new content for edit operations */}
      {operation.type === 'edit' && (operation.oldContent || operation.oldContentJson) && (operation.newContent || operation.newContentJson) && (
        <div className="mb-3 space-y-2">
          <div>
            <div className="text-xs font-medium text-destructive mb-1">Current:</div>
            <div className="text-sm bg-destructive/10 p-2 rounded border-l-2 border-destructive max-h-24 overflow-y-auto">
              <div 
                className="prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ 
                  __html: operation.oldContentJson 
                    ? convertJSONToHTML(operation.oldContentJson) 
                    : operation.oldContent || '' 
                }}
              />
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-green-600 mb-1">New:</div>
            <div className="text-sm bg-green-50 p-2 rounded border-l-2 border-green-600 max-h-24 overflow-y-auto">
              <div 
                className="prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ 
                  __html: operation.newContentJson 
                    ? convertJSONToHTML(operation.newContentJson) 
                    : operation.newContent || '' 
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onApply?.(operation)}
          className="flex-1"
        >
          <Check className="w-3 h-3 mr-1" />
          Apply
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onReject?.(operation)}
          className="flex-1"
        >
          <X className="w-3 h-3 mr-1" />
          Reject
        </Button>
      </div>
    </div>
  );
};
