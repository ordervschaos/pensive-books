import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  suggested_operations?: Array<{
    type: 'add' | 'archive' | 'move' | 'edit';
    pageId?: number;
    newIndex?: number;
    title?: string;
    content?: string;
    oldContent?: string;
    newContent?: string;
  }>;
}

export interface ChatHistory {
  id: number;
  book_id: number;
  user_id: string;
  messages: Message[];
  created_at: string;
  updated_at: string;
}

export interface BookPage {
  id: number;
  title: string;
  pageIndex: number;
  summary: string;
}

export interface BookMetadata {
  name: string;
  author: string;
  subtitle: string;
  pageCount: number;
  pages: BookPage[];
}

export interface ChatResponse {
  message: string;
  suggestedOperations?: Array<{
    type: 'add' | 'archive' | 'move' | 'edit';
    pageId?: number;
    newIndex?: number;
    title?: string;
    content?: string;
    oldContent?: string;
    newContent?: string;
  }>;
}

export const useBookChat = (bookId: string | undefined) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatHistory | null>(null);
  const { toast } = useToast();

  // Fetch chat history when bookId changes
  useEffect(() => {
    if (!bookId) return;

    const fetchChatHistory = async () => {
      try {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data, error } = await supabase
          .from('book_chats')
          .select('*')
          .eq('book_id', parseInt(bookId))
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) throw error;

        if (data) {
          setChatHistory(data);
          setMessages(data.messages || []);
        } else {
          setChatHistory(null);
          setMessages([]);
        }
      } catch (error) {
        console.error('Error fetching chat history:', error);
        toast({
          variant: "destructive",
          title: "Error loading chat",
          description: "Failed to load chat history"
        });
      } finally {
        setLoading(false);
      }
    };

    fetchChatHistory();
  }, [bookId, toast]);

  // Save chat history to database
  const saveChatHistory = useCallback(async (newMessages: Message[]) => {
    if (!bookId) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const chatData = {
        book_id: parseInt(bookId),
        user_id: user.id,
        messages: newMessages,
        updated_at: new Date().toISOString()
      };

      if (chatHistory) {
        // Update existing chat
        const { error } = await supabase
          .from('book_chats')
          .update(chatData)
          .eq('id', chatHistory.id);

        if (error) throw error;
      } else {
        // Create new chat
        const { data, error } = await supabase
          .from('book_chats')
          .insert(chatData)
          .select()
          .single();

        if (error) throw error;
        setChatHistory(data);
      }
    } catch (error) {
      console.error('Error saving chat history:', error);
      toast({
        variant: "destructive",
        title: "Error saving chat",
        description: "Failed to save chat history"
      });
    }
  }, [bookId, chatHistory, toast]);

  // Send message to chat API
  const sendMessage = useCallback(async (
    message: string,
    bookMetadata: BookMetadata,
    canEdit: boolean
  ): Promise<ChatResponse | null> => {
    if (!bookId) return null;

    try {
      setSending(true);

      // Add user message to local state immediately
      const userMessage: Message = {
        role: 'user',
        content: message,
        timestamp: new Date().toISOString()
      };

      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);

      // Call the edge function
      const { data, error } = await supabase.functions.invoke('chat-with-book', {
        body: {
          bookId: parseInt(bookId),
          message,
          bookMetadata,
          canEdit,
          conversationHistory: messages
        }
      });

      if (error) throw error;

      // Add assistant response to local state
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.message,
        timestamp: new Date().toISOString(),
        ...(data.suggestedOperations && { suggested_operations: data.suggestedOperations })
      };

      const finalMessages = [...updatedMessages, assistantMessage];
      setMessages(finalMessages);

      // Save to database
      await saveChatHistory(finalMessages);

      return data;
    } catch (error) {
      console.error('Error sending message:', error);
      toast({
        variant: "destructive",
        title: "Error sending message",
        description: "Failed to send message. Please try again."
      });

      // Remove the user message from state if sending failed
      setMessages(messages);
      return null;
    } finally {
      setSending(false);
    }
  }, [bookId, messages, saveChatHistory, toast]);

  // Clear chat history
  const clearChat = useCallback(async () => {
    if (!bookId || !chatHistory) return;

    try {
      const { error } = await supabase
        .from('book_chats')
        .delete()
        .eq('id', chatHistory.id);

      if (error) throw error;

      setMessages([]);
      setChatHistory(null);
    } catch (error) {
      console.error('Error clearing chat:', error);
      toast({
        variant: "destructive",
        title: "Error clearing chat",
        description: "Failed to clear chat history"
      });
    }
  }, [bookId, chatHistory, toast]);

  return {
    messages,
    loading,
    sending,
    sendMessage,
    clearChat,
    hasMessages: messages.length > 0
  };
};
