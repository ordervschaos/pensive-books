/**
 * BookSidebar Component
 *
 * A collapsible sidebar for book management showing:
 * - Uncommitted Changes (with revert capabilities)
 * - Pages List
 * - Version History
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FileEdit, FileText, History, ChevronRight } from "lucide-react";
import { UncommittedChangesPanel } from "./UncommittedChangesPanel";
import { PagesList } from "./PagesList";
import { VersionHistory } from "./VersionHistory";
import { cn } from "@/lib/utils";

interface BookSidebarProps {
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
  defaultTab?: "changes" | "pages" | "versions";
}

export function BookSidebar({
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
  defaultTab = "pages",
}: BookSidebarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(defaultTab);

  return (
    <>
      {/* Floating Sidebar Toggle Button */}
      <Button
        onClick={() => setIsOpen(true)}
        className="fixed right-6 top-24 z-40 rounded-full shadow-lg hover:shadow-xl transition-all"
        size="icon"
      >
        <ChevronRight className="h-5 w-5" />
      </Button>

      {/* Sidebar Sheet */}
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent side="right" className="w-full sm:w-[500px] sm:max-w-[500px] p-0 flex flex-col">
          <SheetHeader className="px-6 py-4 border-b">
            <SheetTitle>{bookName}</SheetTitle>
          </SheetHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
            <TabsList className="mx-6 mt-4 grid w-auto grid-cols-3">
              <TabsTrigger value="changes" className="gap-2">
                <FileEdit className="h-4 w-4" />
                <span className="hidden sm:inline">Changes</span>
              </TabsTrigger>
              <TabsTrigger value="pages" className="gap-2">
                <FileText className="h-4 w-4" />
                <span className="hidden sm:inline">Pages</span>
              </TabsTrigger>
              {canEdit && (
                <TabsTrigger value="versions" className="gap-2">
                  <History className="h-4 w-4" />
                  <span className="hidden sm:inline">Versions</span>
                </TabsTrigger>
              )}
            </TabsList>

            <div className="flex-1 overflow-hidden">
              <TabsContent value="changes" className="h-full mt-4 mx-6 overflow-y-auto">
                <UncommittedChangesPanel
                  bookId={bookId}
                  bookSlug={bookSlug}
                  pages={pages}
                  canEdit={canEdit}
                />
              </TabsContent>

              <TabsContent value="pages" className="h-full mt-4 overflow-y-auto">
                <div className="px-6">
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
                </div>
              </TabsContent>

              {canEdit && (
                <TabsContent value="versions" className="h-full mt-4 mx-6 overflow-y-auto">
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
        </SheetContent>
      </Sheet>
    </>
  );
}
