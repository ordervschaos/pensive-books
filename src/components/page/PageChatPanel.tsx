import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatMessage } from './ChatMessage';
import { usePageChat, SuggestedEdit } from '@/hooks/use-page-chat';
import { Send, X, Trash2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PageChatPanelProps {
  pageId: string;
  pageContent: string;
  canEdit: boolean;
  isOpen: boolean;
  onClose: () => void;
  onApplyEdit: (oldText: string, newText: string) => void;
}

export const PageChatPanel = ({
  pageId,
  pageContent,
  canEdit,
  isOpen,
  onClose,
  onApplyEdit
}: PageChatPanelProps) => {
  const [inputMessage, setInputMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const { messages, loading, sending, sendMessage, clearChat, hasMessages } = usePageChat(pageId);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || sending) return;

    const message = inputMessage.trim();
    setInputMessage('');

    await sendMessage(message, pageContent, canEdit);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleApplyEdit = (edit: SuggestedEdit) => {
    onApplyEdit(edit.old, edit.new);
  };

  const handleRejectEdit = (edit: SuggestedEdit) => {
    // For now, just log rejection - could add visual feedback later
    console.log('Edit rejected:', edit);
  };

  const handleClearChat = async () => {
    if (confirm('Are you sure you want to clear the chat history?')) {
      await clearChat();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b flex-shrink-0">
        <div>
          <h3 className="font-semibold">Chat with Page</h3>
          <p className="text-sm text-muted-foreground">
            {canEdit ? 'Full assistant' : 'Read-only mode'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasMessages && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearChat}
              className="text-muted-foreground hover:text-foreground"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Messages - with bottom padding to account for fixed input */}
      <ScrollArea className="flex-1 p-4 min-h-0 pb-20">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <p className="text-muted-foreground mb-2">Start a conversation</p>
            <p className="text-sm text-muted-foreground">
              {canEdit 
                ? 'Ask questions or request edits to improve this page'
                : 'Ask questions about the page content'
              }
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message, index) => (
              <ChatMessage
                key={index}
                message={message}
                onApplyEdit={canEdit ? handleApplyEdit : undefined}
                onRejectEdit={canEdit ? handleRejectEdit : undefined}
              />
            ))}
            {sending && (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
                <div className="text-sm text-muted-foreground">Thinking...</div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* Input - Fixed at bottom of drawer */}
      <div className="absolute bottom-0 left-0 right-0 p-4 border-t bg-background">
        <div className="flex gap-2">
          <Input
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={
              canEdit 
                ? "Ask a question or request an edit..." 
                : "Ask a question about the content..."
            }
            disabled={sending}
            className="flex-1"
          />
          <Button
            onClick={handleSendMessage}
            disabled={!inputMessage.trim() || sending}
            size="sm"
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
