import React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import SectionPageContent from "./SectionPageContent";
import TextPageContent from "./TextPageContent";

interface PageContentProps {
  bookId: number;
  pageId: number;
  pageType: "section" | "page";
  content: string;
  title?: string;
  onPageChange?: (pageId: number) => void;
}

const PageContent: React.FC<PageContentProps> = ({
  bookId,
  pageId,
  pageType,
  content,
  title,
  onPageChange
}) => {
  if (pageType === "section") {
    return (
      <SectionPageContent
        bookId={bookId}
        pageId={pageId}
        content={content}
        onPageChange={onPageChange}
      />
    );
  }

  if (pageType === "page") {
    return (
      <TextPageContent
        bookId={bookId}
        pageId={pageId}
        content={content}
      />
    );
  }

  return (
    <div>
      <Skeleton className="h-4 w-[250px]" />
      <Skeleton className="h-4 w-[200px]" />
    </div>
  );
};

export default PageContent;
