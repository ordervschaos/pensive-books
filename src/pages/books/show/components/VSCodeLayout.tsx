/**
 * VSCodeLayout Component
 *
 * VSCode-style layout with collapsible left sidebar and main content area
 * - Left sidebar contains tabs (Changes, Pages, Versions)
 * - Main content shows diff viewer or selected content
 * - Remembers last selected tab in localStorage
 */

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileEdit,
  PanelLeftClose,
  PanelLeft
} from "lucide-react";
import { UncommittedChangesPanel } from "./UncommittedChangesPanel";
import { PageDiffViewer } from "@/components/book/PageDiffViewer";
import { cn } from "@/lib/utils";

interface VSCodeLayoutProps {
  bookId: number;
  bookSlug: string;
  bookName: string;
  pages: any[];
  canEdit: boolean;
  isOwner: boolean;
  isReorderMode?: boolean;
  isDeleteMode?: boolean;
  onDeleteModeChange?: (isDelete: boolean) => void;
  onChatToggle?: () => void;
  hasActiveChat?: boolean;
}

const SIDEBAR_WIDTH_KEY = "vscode-sidebar-width";
const SIDEBAR_COLLAPSED_KEY = "vscode-sidebar-collapsed";
const ACTIVE_TAB_KEY = "vscode-active-tab";

export function VSCodeLayout({
  bookId,
  bookSlug,
  bookName,
  pages,
  canEdit,
  isOwner,
  isReorderMode = false,
  isDeleteMode = false,
  onDeleteModeChange,
  onChatToggle,
  hasActiveChat,
}: VSCodeLayoutProps) {
  // Load persisted state from localStorage
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    return stored === "true";
  });

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return stored ? parseInt(stored) : 320;
  });

  const [activeTab, setActiveTab] = useState(() => {
    const stored = localStorage.getItem(ACTIVE_TAB_KEY);
    return stored || "changes";
  });

  const [selectedFile, setSelectedFile] = useState<number | null>(null);

  // Persist sidebar state
  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_TAB_KEY, activeTab);
  }, [activeTab]);

  const toggleSidebar = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  return (
    <>
      {/* Full-Screen Diff Viewer */}
      {selectedFile && (
        <div className="fixed inset-0 bg-background z-50 flex flex-col">
          {/* Diff Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSelectedFile(null)}
              >
                <PanelLeftClose className="h-4 w-4" />
              </Button>
              <h3 className="font-semibold text-sm">
                {pages.find(p => p.id === selectedFile)?.title || "Page Diff"}
              </h3>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedFile(null)}
            >
              Close
            </Button>
          </div>

          {/* Full-Screen Diff Content */}
          <div className="flex-1 overflow-auto p-6">
            <div className="max-w-7xl mx-auto">
              <PageDiffViewer
                pageId={selectedFile}
                bookId={bookId}
                compact={false}
              />
            </div>
          </div>
        </div>
      )}

      {/* Sidebar Toggle Button (when collapsed and no diff open) */}
      {sidebarCollapsed && !selectedFile && (
        <Button
          variant="ghost"
          size="icon"
          className="fixed bottom-4 right-4 z-50 h-12 w-12 rounded-full shadow-lg"
          onClick={toggleSidebar}
        >
          <PanelLeft className="h-6 w-6" />
        </Button>
      )}

      {/* Sidebar Overlay (only show when sidebar open and no diff) */}
      {!sidebarCollapsed && !selectedFile && (
        <div
          className="fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={toggleSidebar}
        />
      )}

      {/* Sidebar Panel (hide when showing full-screen diff) */}
      {!selectedFile && (
        <div
          className={cn(
            "fixed top-0 right-0 h-full bg-background border-l border-border shadow-2xl z-50 transition-transform duration-300 ease-in-out flex flex-col",
            sidebarCollapsed ? "translate-x-full" : "translate-x-0"
          )}
          style={{ width: sidebarWidth }}
        >
          {/* Sidebar Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="font-semibold text-sm truncate">{bookName}</h3>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 flex-shrink-0"
              onClick={toggleSidebar}
            >
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          </div>

          {/* Tabs - Only Changes */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="m-2 grid w-auto grid-cols-1 rounded-md">
              <TabsTrigger value="changes" className="gap-1.5 text-xs">
                <FileEdit className="h-3.5 w-3.5" />
                <span>Changes</span>
              </TabsTrigger>
            </TabsList>

            {/* Tab Content */}
            <div className="flex-1 overflow-hidden">
              <TabsContent value="changes" className="h-full m-0 p-2 overflow-y-auto">
                <UncommittedChangesPanel
                  bookId={bookId}
                  bookSlug={bookSlug}
                  pages={pages}
                  canEdit={canEdit}
                  onFileSelect={setSelectedFile}
                  selectedFile={selectedFile}
                  vsCodeMode={false}
                />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      )}
    </>
  );
}
