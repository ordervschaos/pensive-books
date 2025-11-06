import { useState, useEffect } from 'react';
import { Link, LinkProps } from 'react-router-dom';
import { preloadPages } from '@/utils/pagePreloader';

interface PreloadLinkProps extends Omit<LinkProps, 'to'> {
  to: string;
  bookId: number;
  pageId: number;
  children: React.ReactNode;
}

export const PreloadLink = ({ to, bookId, pageId, children, ...props }: PreloadLinkProps) => {
  const [isHovered, setIsHovered] = useState(false);
  
  // Preload the page when the link is hovered
  useEffect(() => {
    if (isHovered && bookId && pageId) {
      preloadPages(bookId, [pageId]);
    }
  }, [isHovered, bookId, pageId]);
  
  return (
    <Link
      to={to}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      {...props}
    >
      {children}
    </Link>
  );
}; 