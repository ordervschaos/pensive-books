export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      book_access: {
        Row: {
          access_level: Database["public"]["Enums"]["book_access_level"]
          book_id: number | null
          created_at: string | null
          created_by: string | null
          id: number
          status: string | null
          user_id: string | null
        }
        Insert: {
          access_level: Database["public"]["Enums"]["book_access_level"]
          book_id?: number | null
          created_at?: string | null
          created_by?: string | null
          id?: number
          status?: string | null
          user_id?: string | null
        }
        Update: {
          access_level?: Database["public"]["Enums"]["book_access_level"]
          book_id?: number | null
          created_at?: string | null
          created_by?: string | null
          id?: number
          status?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "book_access_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
      books: {
        Row: {
          archived: boolean | null
          author: string | null
          book_id: number | null
          bookmarked_page_index: number | null
          cover_url: string | null
          created_at: string | null
          digest_bookmarked_page_index: number | null
          id: number
          is_public: boolean | null
          last_published_at: string | null
          last_read: string | null
          name: string | null
          owner_id: string | null
          page_ids: Json | null
          pinned: boolean | null
          published_at: string | null
          subtitle: string | null
          updated_at: string | null
        }
        Insert: {
          archived?: boolean | null
          author?: string | null
          book_id?: number | null
          bookmarked_page_index?: number | null
          cover_url?: string | null
          created_at?: string | null
          digest_bookmarked_page_index?: number | null
          id?: number
          is_public?: boolean | null
          last_published_at?: string | null
          last_read?: string | null
          name?: string | null
          owner_id?: string | null
          page_ids?: Json | null
          pinned?: boolean | null
          published_at?: string | null
          subtitle?: string | null
          updated_at?: string | null
        }
        Update: {
          archived?: boolean | null
          author?: string | null
          book_id?: number | null
          bookmarked_page_index?: number | null
          cover_url?: string | null
          created_at?: string | null
          digest_bookmarked_page_index?: number | null
          id?: number
          is_public?: boolean | null
          last_published_at?: string | null
          last_read?: string | null
          name?: string | null
          owner_id?: string | null
          page_ids?: Json | null
          pinned?: boolean | null
          published_at?: string | null
          subtitle?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      leads: {
        Row: {
          created_at: string
          email: string
          id: number
          name: string | null
          source: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: number
          name?: string | null
          source?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: number
          name?: string | null
          source?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          archived: boolean
          created_at: string | null
          due_at: string | null
          id: number
          notebook_id: number | null
          owner_id: string
          page_id: number | null
          reminder_id: number | null
          repeat_description: string | null
          status: string | null
          unique_id: string | null
          updated_at: string | null
        }
        Insert: {
          archived?: boolean
          created_at?: string | null
          due_at?: string | null
          id?: number
          notebook_id?: number | null
          owner_id?: string
          page_id?: number | null
          reminder_id?: number | null
          repeat_description?: string | null
          status?: string | null
          unique_id?: string | null
          updated_at?: string | null
        }
        Update: {
          archived?: boolean
          created_at?: string | null
          due_at?: string | null
          id?: number
          notebook_id?: number | null
          owner_id?: string
          page_id?: number | null
          reminder_id?: number | null
          repeat_description?: string | null
          status?: string | null
          unique_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_journal_id_fkey"
            columns: ["notebook_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_reminder_id_fkey"
            columns: ["reminder_id"]
            isOneToOne: false
            referencedRelation: "reminders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "public_notifications_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
        ]
      }
      pages: {
        Row: {
          archived: boolean | null
          book_id: number | null
          content: Json | null
          created_at: string | null
          embedding: string | null
          html_content: string | null
          id: number
          last_published_at: string | null
          old_content: string | null
          owner_id: string | null
          page_index: number | null
          page_type: string
          title: string | null
          updated_at: string | null
        }
        Insert: {
          archived?: boolean | null
          book_id?: number | null
          content?: Json | null
          created_at?: string | null
          embedding?: string | null
          html_content?: string | null
          id?: number
          last_published_at?: string | null
          old_content?: string | null
          owner_id?: string | null
          page_index?: number | null
          page_type?: string
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          archived?: boolean | null
          book_id?: number | null
          content?: Json | null
          created_at?: string | null
          embedding?: string | null
          html_content?: string | null
          id?: number
          last_published_at?: string | null
          old_content?: string | null
          owner_id?: string | null
          page_index?: number | null
          page_type?: string
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pages_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
      reminders: {
        Row: {
          archived: boolean | null
          book_id: number | null
          created_at: string | null
          id: number
          is_active: boolean | null
          owner_id: string | null
          page_id: number | null
          read_option: string | null
          reminder_type: string | null
          repeat_config: Json | null
          repeat_type: string | null
          time: string | null
          updated_at: string | null
        }
        Insert: {
          archived?: boolean | null
          book_id?: number | null
          created_at?: string | null
          id?: number
          is_active?: boolean | null
          owner_id?: string | null
          page_id?: number | null
          read_option?: string | null
          reminder_type?: string | null
          repeat_config?: Json | null
          repeat_type?: string | null
          time?: string | null
          updated_at?: string | null
        }
        Update: {
          archived?: boolean | null
          book_id?: number | null
          created_at?: string | null
          id?: number
          is_active?: boolean | null
          owner_id?: string | null
          page_id?: number | null
          read_option?: string | null
          reminder_type?: string | null
          repeat_config?: Json | null
          repeat_type?: string | null
          time?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_schedules_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "user_data"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "public_notification_schedules_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
      user_data: {
        Row: {
          created_at: string | null
          default_notebook: number | null
          email: string | null
          one_time_events: Json | null
          timezone: string | null
          updated_at: string | null
          user_id: string
          username: string | null
        }
        Insert: {
          created_at?: string | null
          default_notebook?: number | null
          email?: string | null
          one_time_events?: Json | null
          timezone?: string | null
          updated_at?: string | null
          user_id?: string
          username?: string | null
        }
        Update: {
          created_at?: string | null
          default_notebook?: number | null
          email?: string | null
          one_time_events?: Json | null
          timezone?: string | null
          updated_at?: string | null
          user_id?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_data_default_journal_fkey"
            columns: ["default_notebook"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      highlight_search_results_in_page: {
        Args: {
          search_query: string
        }
        Returns: {
          page_id: number
          highlighted_content: string
          notebook_id: number
        }[]
      }
      match_documents: {
        Args: {
          query_embedding: string
          match_threshold: number
          match_count: number
          min_content_length: number
          owner_id: string
        }
        Returns: {
          archived: boolean | null
          book_id: number | null
          content: Json | null
          created_at: string | null
          embedding: string | null
          html_content: string | null
          id: number
          last_published_at: string | null
          old_content: string | null
          owner_id: string | null
          page_index: number | null
          page_type: string
          title: string | null
          updated_at: string | null
        }[]
      }
      search_book_contents: {
        Args: {
          search_query: string
          book_id: number
        }
        Returns: {
          page_id: number
          highlighted_content: string
          notebook_id: number
          title: string
        }[]
      }
      similarity_search: {
        Args: {
          query_embedding: string
          match_threshold: number
          match_count: number
          min_content_length: number
        }
        Returns: {
          id: number
          content: Json
          html_content: string
          embedding: string
          distance: number
        }[]
      }
      vector_page_search: {
        Args: {
          query_embedding: string
          match_threshold: number
          min_content_length: number
          match_count: number
        }
        Returns: {
          id: number
          content: string
          embedding: string
        }[]
      }
    }
    Enums: {
      book_access_level: "view" | "edit"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof PublicSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof PublicSchema["CompositeTypes"]
    ? PublicSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never
