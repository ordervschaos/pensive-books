import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { BookChatMessage } from './BookChatMessage';
import { useBookChat, BookMetadata } from '@/hooks/use-book-chat';
import { Send, Trash2, Loader2 } from 'lucide-react';

interface BookChatPanelProps {
  bookId: string;
  bookMetadata: BookMetadata;
  canEdit: boolean;
  isOpen: boolean;
  onClose: () => void;
  onApplyOperation: (operation: any) => void;
}

export const BookChatPanel = ({
  bookId,
  bookMetadata,
  canEdit,
  isOpen,
  onClose,
  onApplyOperation
}: BookChatPanelProps) => {
  const [inputMessage, setInputMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const { messages, loading, sending, sendMessage, clearChat, hasMessages } = useBookChat(bookId);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || sending) return;

    const message = inputMessage.trim();
    setInputMessage('');

    await sendMessage(message, bookMetadata, canEdit);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleApplyOperation = (operation: any) => {
    onApplyOperation(operation);
  };

  const handleRejectOperation = (operation: any) => {
    // For now, just log rejection - could add visual feedback later
    console.log('Operation rejected:', operation);
  };

  const handleClearChat = async () => {
    if (confirm('Are you sure you want to clear the chat history?')) {
      await clearChat();
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col">
        {/* Header */}
        <SheetHeader className="p-6 pb-4 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <SheetTitle>Chat with Book</SheetTitle>
              <SheetDescription>
                {canEdit ? 'Ask questions or suggest changes' : 'Ask questions about this book'}
              </SheetDescription>
            </div>
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
          </div>
        </SheetHeader>

        {/* Messages */}
        <ScrollArea className="flex-1 p-6 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <p className="text-muted-foreground mb-2">Start a conversation</p>
            <p className="text-sm text-muted-foreground">
              {canEdit 
                ? 'Ask questions about the book or request structural changes like adding, moving, or editing pages'
                : 'Ask questions about the book content and structure'
              }
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message, index) => (
              <BookChatMessage
                key={index}
                message={message}
                onApplyOperation={canEdit ? handleApplyOperation : undefined}
                onRejectOperation={canEdit ? handleRejectOperation : undefined}
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

        {/* Input */}
        <div className="p-6 pt-4 border-t bg-background flex-shrink-0">
          <div className="flex gap-2">
            <Input
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={
                canEdit
                  ? "Ask about the book or request changes..."
                  : "Ask questions about the book..."
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
      </SheetContent>
    </Sheet>
  );
};

