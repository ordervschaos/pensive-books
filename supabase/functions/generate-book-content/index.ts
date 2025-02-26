import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const openAIApiKey = Deno.env.get('OPENAI_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Page {
  title: string;
  pageType: "text" | "section";
  content: string;
}

interface GeneratedContent {
  pages: Page[];
}

interface OutlineItem {
  type: "chapter" | "section" | "subsection";
  title: string;
  description: string;
  wordCount?: number;
  children?: OutlineItem[];
}

interface BookOutline {
  title: string;
  genre: string;
  targetAudience: string;
  estimatedLength: string;
  description: string;
  outline: OutlineItem[];
}

function convertOutlineToPages(bookOutline: BookOutline): GeneratedContent {
  const pages: Page[] = [];

  // Add book overview
  pages.push({
    pageType: "section",
    title: "Book Overview",
    content: `<h1>Book Overview</h1>
<h2>${bookOutline.title}</h2>
<p><strong>Genre:</strong> ${bookOutline.genre}</p>
<p><strong>Target Audience:</strong> ${bookOutline.targetAudience}</p>
<p><strong>Estimated Length:</strong> ${bookOutline.estimatedLength}</p>
<p><strong>Description:</strong> ${bookOutline.description}</p>`
  });

  // Process each chapter
  bookOutline.outline.forEach((chapter, chapterIndex) => {
    // Add chapter section
    pages.push({
      pageType: "section",
      title: `Chapter ${chapterIndex + 1}: ${chapter.title}`,
      content: `<h1>Chapter ${chapterIndex + 1}: ${chapter.title}</h1>
<p><strong>Word Count:</strong> ${chapter.wordCount || 'TBD'}</p>
<p>${chapter.description}</p>`
    });

    // Process sections within chapter
    if (chapter.children) {
      chapter.children.forEach((section, sectionIndex) => {
        pages.push({
          pageType: "text",
          title: section.title,
          content: `<h1>${section.title}</h1>
<p><strong>Estimated Words:</strong> ${section.wordCount || 'TBD'}</p>
<p>${section.description}</p>
${section.children ? '<h2>Subsections:</h2><ul>' + 
  section.children.map(subsection => 
    `<li><strong>${subsection.title}</strong> - ${subsection.description} (${subsection.wordCount || 'TBD'} words)</li>`
  ).join('\n') + '</ul>' : ''}`
        });
      });
    }
  });

  return { pages };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prompt } = await req.json();

    const systemPrompt = `You are an AI assistant that generates structured book outlines. Generate a detailed outline for a book with the following structure:

    {
      "title": "Book Title",
      "genre": "Primary genre with optional subgenre",
      "targetAudience": "Description of target readers",
      "estimatedLength": "Estimated word count and pages",
      "description": "2-3 sentence book pitch",
      "outline": [
        {
          "type": "chapter",
          "title": "Chapter Title",
          "description": "Brief chapter summary including key plot points and character development",
          "wordCount": estimated_word_count,
          "children": [
            {
              "type": "section",
              "title": "Section Title",
              "description": "Detailed section description with key scenes and developments",
              "wordCount": estimated_word_count,
              "children": [
                {
                  "type": "subsection",
                  "title": "Subsection Title",
                  "description": "Specific scene or plot point description",
                  "wordCount": estimated_word_count
                }
              ]
            }
          ]
        }
      ]
    }

    Rules for outline generation:
    1. Create a well-structured outline with 8-15 chapters
    2. Each chapter should have 2-4 main sections
    3. Sections can optionally have subsections for important scenes
    4. Provide realistic word count estimates based on genre standards
    5. Ensure the outline follows a logical progression
    6. Include character development and plot points in descriptions
    7. Target total word count should match common lengths for the chosen genre
    
    Return only valid JSON that matches this exact structure.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          { 
            role: 'system', 
            content: systemPrompt
          },
          { 
            role: 'user', 
            content: prompt 
          }
        ],
        temperature: 0.7
      }),
    });

    const data = await response.json();
    console.log('OpenAI API response:', data);

    if (data.error) {
      throw new Error(data.error.message || 'Error from OpenAI API');
    }

    const bookOutline = JSON.parse(data.choices[0].message.content) as BookOutline;

    // Validate the response structure
    if (!bookOutline.title || !bookOutline.genre || !bookOutline.outline || !Array.isArray(bookOutline.outline)) {
      throw new Error('Invalid response format: missing required fields');
    }

    // Convert the outline to the required page format
    const generatedContent = convertOutlineToPages(bookOutline);

    return new Response(JSON.stringify(generatedContent), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in generate-book-outline function:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
