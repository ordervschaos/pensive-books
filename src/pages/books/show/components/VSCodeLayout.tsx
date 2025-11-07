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
  FileText,
  History,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeft
} from "lucide-react";
import { UncommittedChangesPanel } from "./UncommittedChangesPanel";
import { PagesList } from "./PagesList";
import { VersionHistory } from "./VersionHistory";
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
    <div className="flex h-screen w-full bg-background">
      {/* Left Sidebar */}
      <div
        className={cn(
          "flex flex-col border-r border-border bg-background transition-all duration-200",
          sidebarCollapsed ? "w-0" : ""
        )}
        style={{ width: sidebarCollapsed ? 0 : sidebarWidth }}
      >
        {!sidebarCollapsed && (
          <>
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

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
              <TabsList className="m-2 grid w-auto grid-cols-3 rounded-md">
                <TabsTrigger value="changes" className="gap-1.5 text-xs">
                  <FileEdit className="h-3.5 w-3.5" />
                  <span>Changes</span>
                </TabsTrigger>
                <TabsTrigger value="pages" className="gap-1.5 text-xs">
                  <FileText className="h-3.5 w-3.5" />
                  <span>Pages</span>
                </TabsTrigger>
                {canEdit && (
                  <TabsTrigger value="versions" className="gap-1.5 text-xs">
                    <History className="h-3.5 w-3.5" />
                    <span>Versions</span>
                  </TabsTrigger>
                )}
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
                    vsCodeMode={true}
                  />
                </TabsContent>

                <TabsContent value="pages" className="h-full m-0 p-2 overflow-y-auto">
                  <PagesList
                    pages={pages}
                    bookId={bookId}
                    isReorderMode={isReorderMode}
                    isDeleteMode={isDeleteMode}
                    canEdit={canEdit}
                    onDeleteModeChange={onDeleteModeChange}
                    onChatToggle={onChatToggle}
                    hasActiveChat={hasActiveChat}
                  />
                </TabsContent>

                {canEdit && (
                  <TabsContent value="versions" className="h-full m-0 p-2 overflow-y-auto">
                    <VersionHistory
                      bookId={bookId}
                      bookName={bookName}
                      allowRollback={isOwner}
                      onPreview={(versionId) => {
                        window.location.href = `/books/${bookSlug}/version/${versionId}`;
                      }}
                    />
                  </TabsContent>
                )}
              </div>
            </Tabs>
          </>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-background">
          {sidebarCollapsed && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={toggleSidebar}
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="flex-1">
            {selectedFile ? (
              <div className="text-sm font-medium">
                Viewing diff for page {pages.find(p => p.id === selectedFile)?.title || selectedFile}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                Select a file from the sidebar to view changes
              </div>
            )}
          </div>
        </div>

        {/* Diff Viewer or Empty State */}
        <div className="flex-1 overflow-auto p-4">
          {selectedFile ? (
            <div className="max-w-7xl mx-auto">
              {/* This will be rendered by UncommittedChangesPanel in VSCode mode */}
              <div id="vscode-diff-viewer" />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <FileEdit className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium">No file selected</p>
                <p className="text-sm mt-2">Select a file from the Changes tab to view the diff</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
