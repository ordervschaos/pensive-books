import { Database } from '@/integrations/supabase/types';
import { supabase } from '@/integrations/supabase/client';
import { generateEPUB } from './epub';
import { prepareEPUBContent, EPUBOptions } from './epub-generator';
import jsPDF from 'jspdf';

type Page = Database['public']['Tables']['pages']['Row'] & {
  page_type: 'section' | 'page';
};

interface DownloadOptions {
  bookId: number;
  name: string;
  author?: string | null;
  coverUrl?: string | null;
  subtitle?: string | null;
  showTextOnCover?: boolean;
  returnBlob?: boolean;
}

interface GenerateResult {
  success: boolean;
  blob?: Blob;
  error?: {
    message: string;
    details?: unknown;
  };
}

const loadImage = (url: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
};

interface PageData extends Database['public']['Tables']['pages']['Row'] {
  page_type: 'section' | 'page';
}

const fetchBookPages = async (bookId: number): Promise<PageData[]> => {
  const { data: pages, error } = await supabase
    .from("pages")
    .select("*")
    .eq("book_id", bookId)
    .eq("archived", false)
    .order("page_index", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch pages: ${error.message}`);
  }

  return (pages || []).map(page => ({
    ...page,
    page_type: page.page_type as 'section' | 'page'
  }));
};

const processHtmlContent = (html: string): { lines: string[]; images: Array<{ url: string; afterLine: number }> } => {
  if (!html) return { lines: [], images: [] };

  const div = document.createElement('div');
  div.innerHTML = html;

  const lines: string[] = [];
  const images: Array<{ url: string; afterLine: number }> = [];
  let sectionCount = 0;

  div.querySelectorAll('br').forEach(br => {
    br.replaceWith('\n');
  });

  div.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src');
    if (src) {
      images.push({
        url: src,
        afterLine: lines.length
      });
      lines.push('\n');
      lines.push('\n');
    }
  });

  div.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
    lines.push('\n');
    lines.push(heading.textContent?.trim() || '');
    lines.push('\n');
  });

  div.querySelectorAll('p').forEach(p => {
    const text = p.textContent?.trim();
    if (text) {
      lines.push('\n');
      text.split('\n').forEach(line => {
        if (line.trim()) {
          lines.push(line.trim());
        } else {
          lines.push('');
        }
      });
      lines.push('\n');
    }
  });

  div.querySelectorAll('ul, ol').forEach(list => {
    lines.push('\n');
    list.querySelectorAll('li').forEach(li => {
      const text = li.textContent?.trim();
      if (text) {
        text.split('\n').forEach((line, index) => {
          if (line.trim()) {
            if (index === 0) {
              lines.push(`  • ${line.trim()}`);
            } else {
              lines.push(`    ${line.trim()}`);
            }
          } else {
            lines.push('');
          }
        });
      }
    });
    lines.push('\n');
  });

  div.querySelectorAll('blockquote').forEach(quote => {
    lines.push('\n');
    const text = quote.textContent?.trim();
    if (text) {
      text.split('\n').forEach(line => {
        if (line.trim()) {
          lines.push(`  "${line.trim()}"`);
        } else {
          lines.push('');
        }
      });
    }
    lines.push('\n');
  });

  div.querySelectorAll('pre, code').forEach(code => {
    lines.push('\n');
    const text = code.textContent?.trim();
    if (text) {
      text.split('\n').forEach(line => {
        if (line.trim()) {
          lines.push(`  ${line}`);
        } else {
          lines.push('');
        }
      });
    }
    lines.push('\n');
  });

  const filteredLines = lines.reduce((acc: string[], line: string) => {
    const lastLine = acc[acc.length - 1];
    if (!(line.trim() === '' && lastLine?.trim() === '' && acc[acc.length - 2]?.trim() === '')) {
      acc.push(line);
    }
    return acc;
  }, []);

  while (filteredLines.length > 0 && !filteredLines[0].trim()) {
    filteredLines.shift();
  }
  while (filteredLines.length > 0 && !filteredLines[filteredLines.length - 1].trim()) {
    filteredLines.pop();
  }

  return { lines: filteredLines, images };
};

export const generatePDF = async (
  options: DownloadOptions
): Promise<GenerateResult> => {
  try {
    const pages = await fetchBookPages(options.bookId);
    
    const pdf = new jsPDF({
      unit: 'pt',
      format: 'a4',
      orientation: 'portrait'
    }) as any;

    const pageWidth = pdf.internal.pageSize.width;
    const pageHeight = pdf.internal.pageSize.height;
    const margin = 50;
    const contentWidth = pageWidth - (2 * margin);
    const baseLineHeight = 20;
    const paragraphSpacing = 30;
    const maxImageHeight = pageHeight * 0.7;

    const tocPageNumbers: { [key: string]: number } = {};
    let currentPdfPage = 0;

    if (options.coverUrl) {
      try {
        const coverImg = await loadImage(options.coverUrl);
        const coverAspectRatio = coverImg.height / coverImg.width;
        
        let imgWidth = pageWidth;
        let imgHeight = imgWidth * coverAspectRatio;

        if (imgHeight < pageHeight) {
          imgHeight = pageHeight;
          imgWidth = imgHeight / coverAspectRatio;
        }

        const xPos = (pageWidth - imgWidth) / 2;
        const yPos = 0;

        pdf.addImage(coverImg, 'JPEG', xPos, yPos, imgWidth, imgHeight);

        pdf.setFillColor(0, 0, 0);
        pdf.setGState(new pdf.GState({ opacity: 0.4 }));
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
        pdf.setGState(new pdf.GState({ opacity: 1 }));

        pdf.setTextColor(255, 255, 255);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(42);

        const titleLines = pdf.splitTextToSize(options.name, pageWidth * 0.8);
        let textY = pageHeight * 0.4;

        titleLines.forEach(line => {
          const textWidth = pdf.getStringUnitWidth(line) * pdf.getFontSize();
          const textX = (pageWidth - textWidth) / 2;
          
          pdf.setTextColor(0, 0, 0);
          pdf.text(line, textX + 2, textY + 2);
          
          pdf.setTextColor(255, 255, 255);
          pdf.text(line, textX, textY);
          
          textY += 60;
        });

        if (options.subtitle) {
          textY += 25;
          pdf.setFontSize(28);
          pdf.setFont('helvetica', 'italic');
          const subtitleLines = pdf.splitTextToSize(options.subtitle, pageWidth * 0.8);
          subtitleLines.forEach(line => {
            const textWidth = pdf.getStringUnitWidth(line) * pdf.getFontSize();
            const textX = (pageWidth - textWidth) / 2;
            
            pdf.setTextColor(0, 0, 0);
            pdf.text(line, textX + 1, textY + 1);
            
            pdf.setTextColor(255, 255, 255);
            pdf.text(line, textX, textY);
            
            textY += 40;
          });
        }

        if (options.author) {
          textY += 45;
          pdf.setFontSize(24);
          pdf.setFont('helvetica', 'normal');
          const authorText = `by ${options.author}`;
          const textWidth = pdf.getStringUnitWidth(authorText) * pdf.getFontSize();
          const textX = (pageWidth - textWidth) / 2;
          
          pdf.setTextColor(0, 0, 0);
          pdf.text(authorText, textX + 1, textY + 1);
          
          pdf.setTextColor(255, 255, 255);
          pdf.text(authorText, textX, textY);
        }

        currentPdfPage++;
      } catch (error) {
        console.warn('Failed to add cover image:', error);
      }
    } else {
      pdf.setFillColor(20, 20, 20);
      pdf.rect(0, 0, pageWidth, pageHeight, 'F');

      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(36);

      const titleLines = pdf.splitTextToSize(options.name, pageWidth * 0.8);
      let textY = pageHeight * 0.4;

      titleLines.forEach(line => {
        const textWidth = pdf.getStringUnitWidth(line) * pdf.getFontSize();
        const textX = (pageWidth - textWidth) / 2;
        pdf.text(line, textX, textY);
        textY += 50;
      });

      if (options.subtitle) {
        textY += 20;
        pdf.setFontSize(24);
        pdf.setFont('helvetica', 'italic');
        const subtitleLines = pdf.splitTextToSize(options.subtitle, pageWidth * 0.8);
        subtitleLines.forEach(line => {
          const textWidth = pdf.getStringUnitWidth(line) * pdf.getFontSize();
          const textX = (pageWidth - textWidth) / 2;
          pdf.text(line, textX, textY);
          textY += 35;
        });
      }

      if (options.author) {
        textY += 40;
        pdf.setFontSize(20);
        pdf.setFont('helvetica', 'normal');
        const authorText = `by ${options.author}`;
        const textWidth = pdf.getStringUnitWidth(authorText) * pdf.getFontSize();
        const textX = (pageWidth - textWidth) / 2;
        pdf.text(authorText, textX, textY);
      }
    }

    pdf.setTextColor(0, 0, 0);
    pdf.setGState(new pdf.GState({ opacity: 1 }));

    pdf.addPage();
    currentPdfPage++;
    const tocPageNumber = currentPdfPage;

    for (const page of pages) {
      pdf.addPage();
      currentPdfPage++;
      
      tocPageNumbers[page.id] = currentPdfPage;

      let y = margin;

      if (page.page_type === 'section') {
        pdf.setFont('times', 'bold');
        pdf.setFontSize(32);
        const title = page.title || `Section ${sectionCount + 1}`;
        
        const titleLines = pdf.splitTextToSize(title, contentWidth);
        const lineHeight = 40;
        const totalHeight = titleLines.length * lineHeight;
        const centerY = (pageHeight - totalHeight) / 2;
        
        titleLines.forEach((line, index) => {
          const textWidth = pdf.getStringUnitWidth(line) * pdf.getFontSize();
          const centerX = (pageWidth - textWidth) / 2;
          pdf.text(line, centerX, centerY + (index * lineHeight));
        });
        
        continue;
      }

      pdf.setFont('times', 'bold');
      pdf.setFontSize(20);
      const title = page.title || `Page ${page.page_index + 1}`;
      pdf.text(title, margin, y);
      y += 45;

      let contentData = { lines: [], images: [] };
      if (page.html_content) {
        contentData = processHtmlContent(page.html_content);
      }

      let lineCount = 0;
      for (const line of contentData.lines) {
        const imageToInsert = contentData.images.find(img => img.afterLine === lineCount);
        
        if (line.trim()) {
          const wrappedLines = pdf.splitTextToSize(line, contentWidth);
          wrappedLines.forEach((textLine: string) => {
            if (y > pageHeight - margin) {
              pdf.addPage();
              currentPdfPage++;
              y = margin;
            }
            const isIndented = textLine.startsWith('  ');
            const xOffset = isIndented ? margin + 20 : margin;
            pdf.text(textLine.trimStart(), xOffset, y);
            y += baseLineHeight;
          });
        } else {
          y += paragraphSpacing;
        }

        if (imageToInsert) {
          try {
            const img = await loadImage(imageToInsert.url);
            
            let imgWidth = contentWidth;
            let imgHeight = (img.height / img.width) * imgWidth;

            if (imgHeight > maxImageHeight) {
              imgHeight = maxImageHeight;
              imgWidth = (img.width / img.height) * imgHeight;
            }

            if (y + imgHeight > pageHeight - margin) {
              pdf.addPage();
              currentPdfPage++;
              y = margin;
            }

            const xPos = (pageWidth - imgWidth) / 2;
            pdf.addImage(img, 'PNG', xPos, y, imgWidth, imgHeight);
            y += imgHeight + paragraphSpacing;
          } catch (error) {
            console.warn('Failed to add image to PDF:', error);
          }
        }

        lineCount++;
      }
    }

    pdf.setPage(tocPageNumber);
    pdf.setFont('times', 'bold');
    pdf.setFontSize(24);
    pdf.text('Table of Contents', margin, margin + 20);

    let tocY = margin + 60;
    let sectionCount = 0;
    let pageCount = 0;

    pages.forEach((page, index) => {
      if (tocY > pageHeight - margin) {
        pdf.addPage();
        currentPdfPage++;
        tocY = margin + 20;
      }

      const pageNum = tocPageNumbers[page.id];
      
      if (page.page_type === 'section') {
        sectionCount++;
        const title = page.title || `Section ${sectionCount}`;
        pdf.setFont('times', 'bold');
        pdf.setFontSize(18);
        
        pdf.text(`${sectionCount}. ${title}`, margin, tocY);
        
        const pageNumText = pageNum.toString();
        const pageNumWidth = pdf.getStringUnitWidth(pageNumText) * pdf.getFontSize();
        pdf.text(pageNumText, pageWidth - margin - pageNumWidth, tocY);
        
        pdf.link(margin, tocY - 15, pageWidth - (2 * margin), 20, { pageNumber: pageNum });
        
        tocY += 30;
      } else {
        pageCount++;
        pdf.setFont('times', 'normal');
        pdf.setFontSize(14);
        const title = page.title || `Page ${pageCount}`;
        
        pdf.text(`${title}`, margin + 20, tocY);
        
        const titleWidth = pdf.getStringUnitWidth(title) * pdf.getFontSize();
        const pageNumText = pageNum.toString();
        const pageNumWidth = pdf.getStringUnitWidth(pageNumText) * pdf.getFontSize();
        const dotsStart = margin + 20 + titleWidth + 10;
        const dotsEnd = pageWidth - margin - pageNumWidth - 10;
        
        for (let x = dotsStart; x < dotsEnd; x += 5) {
          pdf.text('.', x, tocY);
        }
        
        pdf.text(pageNumText, pageWidth - margin - pageNumWidth, tocY);
        
        pdf.link(margin + 20, tocY - 15, pageWidth - (2 * margin) - 20, 20, { pageNumber: pageNum });
        
        tocY += 25;
      }
    });

    if (options.returnBlob) {
      return { success: true, blob: pdf.output('blob') };
    }

    const url = window.URL.createObjectURL(pdf.output('blob'));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${options.name}.pdf`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    return { success: true };
  } catch (error) {
    console.error('Error generating PDF:', error);
    return {
      success: false,
      error: {
        message: "Failed to generate PDF",
        details: error instanceof Error ? error.message : error
      }
    };
  }
};

const stripHtmlAndFormatText = (html: string): string => {
  const temp = document.createElement('div');
  temp.innerHTML = html;
  
  temp.querySelectorAll('li').forEach(li => {
    li.textContent = `• ${li.textContent}`;
  });
  
  temp.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(header => {
    header.textContent = `\n${header.textContent}\n`;
  });
  
  temp.querySelectorAll('p').forEach(p => {
    p.textContent = `${p.textContent}\n`;
  });
  
  return temp.textContent || temp.innerText || '';
};

const downloadImage = async (url: string): Promise<Blob | null> => {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
    return await response.blob();
  } catch (error) {
    console.warn(`Failed to download image: ${url}`, error);
    return null;
  }
};

const extractImageUrls = (html: string): string[] => {
  if (!html) return [];
  const div = document.createElement('div');
  div.innerHTML = html;
  const images = div.querySelectorAll('img');
  return Array.from(images)
    .map(img => img.getAttribute('src'))
    .filter((src): src is string => src !== null && src.startsWith('http'));
};

export const generateAndDownloadEPUB = async (
  options: DownloadOptions
): Promise<GenerateResult> => {
  try {
    const pages = await fetchBookPages(options.bookId);
    const { processedPages, images } = await prepareEPUBContent(pages);

    const epubOptions: EPUBOptions = {
      title: options.name,
      subtitle: options.subtitle,
      author: options.author,
      coverUrl: options.coverUrl,
      identifier: options.bookId.toString()
    };

    const epubBlob = await generateEPUB(epubOptions, processedPages, images, options.showTextOnCover);

    if (options.returnBlob) {
      return { success: true, blob: epubBlob };
    }

    const url = window.URL.createObjectURL(epubBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${options.name}.epub`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    return { success: true };
  } catch (error) {
    console.error('Error generating EPUB:', error);
    return {
      success: false,
      error: {
        message: "Failed to generate EPUB",
        details: error instanceof Error ? error.message : error
      }
    };
  }
};
