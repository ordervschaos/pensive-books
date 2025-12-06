import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatMessage } from '@/pages/books/pages/view/components/ChatMessage';
import { useBookChat } from '@/hooks/use-book-chat';
import { Send, Trash2, Loader2, Settings2, FileText, ChevronLeft } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useBookPermissions } from '@/hooks/use-book-permissions';
import { useToast } from '@/hooks/use-toast';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Checkbox } from '@/components/ui/checkbox';

interface Page {
  id: number;
  title: string;
  page_index: number;
  content: Record<string, unknown>;
}

interface Book {
  id: number;
  name: string;
  author: string;
  subtitle: string;
  slug: string;
  page_ids: number[];
}

export default function BookChatPage() {
  const { bookSlug } = useParams<{ bookSlug: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [inputMessage, setInputMessage] = useState('');
  const [book, setBook] = useState<Book | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [isContextSheetOpen, setIsContextSheetOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Extract numeric ID from slug (e.g., "860-book-name" -> 860)
  const getNumericId = (param: string | undefined) => {
    if (!param) return 0;
    const match = param.match(/^(\d+)/);
    return match ? parseInt(match[1]) : 0;
  };

  const numericBookId = getNumericId(bookSlug);

  const { canEdit } = useBookPermissions(bookSlug);
  const {
    messages,
    sending,
    sendMessage,
    clearChat,
    hasMessages,
    selectedPageIds,
    updateSelectedPages,
  } = useBookChat(numericBookId.toString());

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Fetch book and pages
  useEffect(() => {
    if (!numericBookId) return;

    const fetchBookAndPages = async () => {
      try {
        setLoading(true);

        // Fetch book by numeric ID
        const { data: bookData, error: bookError } = await supabase
          .from('books')
          .select('id, name, author, subtitle, slug, page_ids')
          .eq('id', numericBookId)
          .eq('is_archived', false)
          .single();

        if (bookError) throw bookError;

        setBook(bookData);

        // Fetch all pages for this book
        const { data: pagesData, error: pagesError } = await supabase
          .from('pages')
          .select('id, title, page_index, content')
          .eq('book_id', numericBookId)
          .eq('archived', false)
          .order('page_index');

        if (pagesError) throw pagesError;

        setPages(pagesData || []);

        // Initialize with all pages selected by default
        updateSelectedPages(pagesData?.map(p => p.id) || []);
      } catch (error) {
        console.error('Error fetching book:', error);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to load book data',
        });
      } finally {
        setLoading(false);
      }
    };

    fetchBookAndPages();
  }, [numericBookId, toast, updateSelectedPages]);

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || sending || !book) return;

    const message = inputMessage.trim();
    setInputMessage('');

    const bookMetadata = {
      name: book.name,
      author: book.author,
      subtitle: book.subtitle,
      pageCount: pages.length,
      pages: pages
        .filter(p => selectedPageIds.includes(p.id))
        .map(p => ({
          id: p.id,
          title: p.title,
          pageIndex: p.page_index,
          summary: '', // Could add summaries later
        })),
    };

    await sendMessage(message, bookMetadata, canEdit);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleClearChat = () => {
    if (confirm('Are you sure you want to clear the chat history?')) {
      clearChat();
    }
  };

  const handleTogglePage = (pageId: number, checked: boolean) => {
    if (checked) {
      updateSelectedPages([...selectedPageIds, pageId]);
    } else {
      updateSelectedPages(selectedPageIds.filter(id => id !== pageId));
    }
  };

  const handleSelectAll = () => {
    updateSelectedPages(pages.map(p => p.id));
  };

  const handleDeselectAll = () => {
    updateSelectedPages([]);
  };

  const handleConvertToPage = async (messageContent: string) => {
    if (!book || !canEdit) {
      toast({
        variant: 'destructive',
        title: 'Permission denied',
        description: "You don't have permission to create pages",
      });
      return;
    }

    try {
      // Create a new page using the proper RPC function
      const { data: newPage, error: createError } = await supabase
        .rpc('create_next_page', {
          p_book_id: numericBookId,
        })
        .select()
        .single();

      if (createError) throw createError;

      // Update the new page with the chat content
      // Structure: Title heading first, then content
      const pageTitle = 'Chat Response';
      const { error: updateError } = await supabase
        .from('pages')
        .update({
          title: pageTitle,
          content: {
            type: 'doc',
            content: [
              {
                type: 'heading',
                attrs: { level: 1 },
                content: [
                  {
                    type: 'text',
                    text: pageTitle,
                  },
                ],
              },
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: messageContent,
                  },
                ],
              },
            ],
          },
        })
        .eq('id', newPage.id);

      if (updateError) throw updateError;

      toast({
        title: 'Success',
        description: 'Chat response converted to a new page',
      });

      // Navigate to the new page using bookSlug and page ID
      navigate(`/books/${bookSlug}/pages/${newPage.id}`);
    } catch (error) {
      console.error('Error creating page:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to create page from chat response',
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (!book) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-muted-foreground">Book not found</p>
          <Button onClick={() => navigate('/books')} className="mt-4">
            Go to My Books
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="border-b bg-background">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(`/books/${book.slug}`)}
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back to Book
              </Button>
              <div>
                <h1 className="text-xl font-semibold">{book.name}</h1>
                <p className="text-sm text-muted-foreground">
                  Chat with {selectedPageIds.length === pages.length ? 'all pages' : `${selectedPageIds.length} selected page(s)`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsContextSheetOpen(true)}
              >
                <Settings2 className="w-4 h-4 mr-2" />
                Context ({selectedPageIds.length}/{pages.length})
              </Button>
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
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <ScrollArea className="flex-1 container mx-auto px-4 py-6">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center max-w-md mx-auto">
            <FileText className="w-12 h-12 text-muted-foreground mb-4" />
            <h2 className="text-lg font-semibold mb-2">Start a conversation</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Ask questions about {book.name}. I'll use the{' '}
              {selectedPageIds.length === pages.length
                ? 'entire book'
                : `${selectedPageIds.length} selected page(s)`}{' '}
              as context.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsContextSheetOpen(true)}
            >
              <Settings2 className="w-4 h-4 mr-2" />
              Select Pages
            </Button>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-4">
            {messages.map((message, index) => (
              <div key={index}>
                <ChatMessage message={message} />
                {message.role === 'assistant' && (
                  <div className="flex justify-end mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleConvertToPage(message.content)}
                    >
                      <FileText className="w-3 h-3 mr-2" />
                      Convert to Page
                    </Button>
                  </div>
                )}
              </div>
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

      {/* Input Area */}
      <div className="border-t bg-background">
        <div className="container mx-auto px-4 py-4">
          <div className="max-w-4xl mx-auto">
            <div className="flex gap-2">
              <Input
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={`Ask a question about ${book.name}...`}
                disabled={sending || selectedPageIds.length === 0}
                className="flex-1"
              />
              <Button
                onClick={handleSendMessage}
                disabled={!inputMessage.trim() || sending || selectedPageIds.length === 0}
                size="sm"
              >
                {sending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>
            {selectedPageIds.length === 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                Please select at least one page to start chatting
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Context Selection Sheet */}
      <Sheet open={isContextSheetOpen} onOpenChange={setIsContextSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Select Pages for Context</SheetTitle>
            <SheetDescription>
              Choose which pages to include in the conversation context
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6">
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm text-muted-foreground">
                {selectedPageIds.length} of {pages.length} pages selected
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSelectAll}
                  disabled={selectedPageIds.length === pages.length}
                >
                  Select All
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDeselectAll}
                  disabled={selectedPageIds.length === 0}
                >
                  Clear
                </Button>
              </div>
            </div>

            <ScrollArea className="h-[calc(100vh-250px)]">
              <div className="space-y-2">
                {pages.map((page) => (
                  <div
                    key={page.id}
                    className="flex items-start gap-3 p-3 rounded-lg border hover:bg-accent transition-colors"
                  >
                    <Checkbox
                      checked={selectedPageIds.includes(page.id)}
                      onCheckedChange={(checked) =>
                        handleTogglePage(page.id, checked as boolean)
                      }
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{page.title}</div>
                      <div className="text-xs text-muted-foreground">
                        Page {page.page_index + 1}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
