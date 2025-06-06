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
          invitation_token: string | null
          invited_email: string | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          access_level: Database["public"]["Enums"]["book_access_level"]
          book_id?: number | null
          created_at?: string | null
          created_by?: string | null
          id?: number
          invitation_token?: string | null
          invited_email?: string | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          access_level?: Database["public"]["Enums"]["book_access_level"]
          book_id?: number | null
          created_at?: string | null
          created_by?: string | null
          id?: number
          invitation_token?: string | null
          invited_email?: string | null
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
          author: string | null
          book_id: number | null
          bookmarked_page_index: number | null
          cover_url: string | null
          created_at: string | null
          digest_bookmarked_page_index: number | null
          edit_invitation_token: string | null
          id: number
          is_archived: boolean | null
          is_public: boolean | null
          last_published_at: string | null
          last_read: string | null
          name: string | null
          owner_id: string | null
          page_ids: Json | null
          photographer: string | null
          photographer_username: string | null
          pinned: boolean | null
          published_at: string | null
          show_text_on_cover: boolean | null
          slug: string | null
          subtitle: string | null
          updated_at: string | null
          view_invitation_token: string | null
        }
        Insert: {
          author?: string | null
          book_id?: number | null
          bookmarked_page_index?: number | null
          cover_url?: string | null
          created_at?: string | null
          digest_bookmarked_page_index?: number | null
          edit_invitation_token?: string | null
          id?: number
          is_archived?: boolean | null
          is_public?: boolean | null
          last_published_at?: string | null
          last_read?: string | null
          name?: string | null
          owner_id?: string | null
          page_ids?: Json | null
          photographer?: string | null
          photographer_username?: string | null
          pinned?: boolean | null
          published_at?: string | null
          show_text_on_cover?: boolean | null
          slug?: string | null
          subtitle?: string | null
          updated_at?: string | null
          view_invitation_token?: string | null
        }
        Update: {
          author?: string | null
          book_id?: number | null
          bookmarked_page_index?: number | null
          cover_url?: string | null
          created_at?: string | null
          digest_bookmarked_page_index?: number | null
          edit_invitation_token?: string | null
          id?: number
          is_archived?: boolean | null
          is_public?: boolean | null
          last_published_at?: string | null
          last_read?: string | null
          name?: string | null
          owner_id?: string | null
          page_ids?: Json | null
          photographer?: string | null
          photographer_username?: string | null
          pinned?: boolean | null
          published_at?: string | null
          show_text_on_cover?: boolean | null
          slug?: string | null
          subtitle?: string | null
          updated_at?: string | null
          view_invitation_token?: string | null
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
      page_history: {
        Row: {
          batch_id: string | null
          created_at: string | null
          created_at_minute: string | null
          created_by: string | null
          html_content: string | null
          id: number
          page_id: number | null
        }
        Insert: {
          batch_id?: string | null
          created_at?: string | null
          created_at_minute?: string | null
          created_by?: string | null
          html_content?: string | null
          id?: never
          page_id?: number | null
        }
        Update: {
          batch_id?: string | null
          created_at?: string | null
          created_at_minute?: string | null
          created_by?: string | null
          html_content?: string | null
          id?: never
          page_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_page"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_history_page_id_fkey"
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
          slug: string | null
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
          slug?: string | null
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
          slug?: string | null
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
            referencedRelation: "public_user_profiles"
            referencedColumns: ["user_id"]
          },
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
          bookmarked_pages: Json | null
          created_at: string | null
          default_notebook: number | null
          email: string | null
          kindle_configured: boolean | null
          kindle_email: string | null
          kindle_verification_expires: string | null
          kindle_verification_otp: string | null
          one_time_events: Json | null
          timezone: string | null
          updated_at: string | null
          user_id: string
          username: string | null
        }
        Insert: {
          bookmarked_pages?: Json | null
          created_at?: string | null
          default_notebook?: number | null
          email?: string | null
          kindle_configured?: boolean | null
          kindle_email?: string | null
          kindle_verification_expires?: string | null
          kindle_verification_otp?: string | null
          one_time_events?: Json | null
          timezone?: string | null
          updated_at?: string | null
          user_id?: string
          username?: string | null
        }
        Update: {
          bookmarked_pages?: Json | null
          created_at?: string | null
          default_notebook?: number | null
          email?: string | null
          kindle_configured?: boolean | null
          kindle_email?: string | null
          kindle_verification_expires?: string | null
          kindle_verification_otp?: string | null
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
      public_user_profiles: {
        Row: {
          updated_at: string | null
          user_id: string | null
          username: string | null
        }
        Insert: {
          updated_at?: string | null
          user_id?: string | null
          username?: string | null
        }
        Update: {
          updated_at?: string | null
          user_id?: string | null
          username?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      check_book_access: {
        Args: { book_id: number; user_email: string }
        Returns: boolean
      }
      generate_slug: {
        Args: { input_text: string }
        Returns: string
      }
      highlight_search_results_in_page: {
        Args: { search_query: string }
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
          slug: string | null
          title: string | null
          updated_at: string | null
        }[]
      }
      search_book_contents: {
        Args: { search_query: string; book_id: number }
        Returns: {
          page_id: number
          highlighted_content: string
          notebook_id: number
          title: string
        }[]
      }
      create_next_page: {
        Args: { p_book_id: number }
        Returns: {
          id: number
          book_id: number
          page_index: number
          content: Json
          html_content: string
          page_type: string
          created_at: string
          updated_at: string
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

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      book_access_level: ["view", "edit"],
    },
  },
} as const
