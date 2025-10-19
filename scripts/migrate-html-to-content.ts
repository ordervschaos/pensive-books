import { createClient } from '@supabase/supabase-js';
import { generateJSON } from '@tiptap/html';
import Document from '@tiptap/extension-document';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { common, createLowlight } from 'lowlight';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables from .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const lowlight = createLowlight(common);

// Custom Title extension (simplified for migration)
const Title = Document.extend({
  content: "heading block*",
});

// TipTap extensions - matching your editor config
const extensions = [
  Title,
  StarterKit.configure({
    document: false,
    codeBlock: false,
  }),
  CodeBlockLowlight.configure({
    lowlight,
  }),
  Link,
  Image,
  Table,
  TableRow,
  TableCell,
  TableHeader,
];

interface Page {
  id: number;
  html_content: string | null;
  content: Record<string, unknown> | null;
}

interface MigrationStats {
  total: number;
  alreadyHaveContent: number;
  emptyContent: number;
  noHtmlContent: number;
  migrated: number;
  failed: number;
  errors: Array<{ id: number; error: string }>;
}

async function migrateHtmlToContent() {
  // Get environment variables
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing required environment variables:');
    if (!supabaseUrl) console.error('  - SUPABASE_URL');
    if (!supabaseServiceKey) console.error('  - SUPABASE_SERVICE_ROLE_KEY');
    console.error('\nMake sure these are set in your .env.local file');
    process.exit(1);
  }

  console.log('🔧 Initializing Supabase client with service role key...\n');

  // Create Supabase client with service role key
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const stats: MigrationStats = {
    total: 0,
    alreadyHaveContent: 0,
    emptyContent: 0,
    noHtmlContent: 0,
    migrated: 0,
    failed: 0,
    errors: [],
  };

  console.log('📊 Fetching pages from database...\n');

  const BATCH_SIZE = 1000;
  let offset = 0;
  let hasMore = true;
  let batchNumber = 1;

  while (hasMore) {
    console.log(`📦 Fetching batch ${batchNumber} (offset: ${offset})...\n`);

    // Fetch pages in batches
    const { data: pages, error: fetchError } = await supabase
      .from('pages')
      .select('id, html_content, content')
      .order('id')
      .range(offset, offset + BATCH_SIZE - 1);

    if (fetchError) {
      console.error('❌ Error fetching pages:', fetchError);
      process.exit(1);
    }

    if (!pages || pages.length === 0) {
      hasMore = false;
      break;
    }

    console.log(`Found ${pages.length} pages in this batch\n`);

    // Process each page
    for (const page of pages as Page[]) {
      stats.total++;

      // Helper function to check if content is empty
      const isEmptyContent = (content: Record<string, unknown> | null): boolean => {
        if (!content) return true;
        if (Object.keys(content).length === 0) return true;
        return false;
      };

      // Skip if already has valid content
      if (page.content && !isEmptyContent(page.content)) {
        stats.alreadyHaveContent++;
        continue;
      }

      // Track empty content objects
      if (page.content && isEmptyContent(page.content)) {
        stats.emptyContent++;
      }

      // Skip if no html_content
      if (!page.html_content) {
        stats.noHtmlContent++;
        continue;
      }

      try {
        console.log(`🔄 Converting page ${page.id}...`);

        // Convert HTML to TipTap JSON
        const json = generateJSON(page.html_content, extensions);

        // Update the page with the new content
        const { error: updateError } = await supabase
          .from('pages')
          .update({ content: json })
          .eq('id', page.id);

        if (updateError) {
          throw updateError;
        }

        stats.migrated++;
        console.log(`✅ Successfully migrated page ${page.id}`);
      } catch (error) {
        stats.failed++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        stats.errors.push({ id: page.id, error: errorMessage });
        console.error(`❌ Failed to migrate page ${page.id}:`, errorMessage);
      }
    }

    // Check if there are more pages to fetch
    if (pages.length < BATCH_SIZE) {
      hasMore = false;
    } else {
      offset += BATCH_SIZE;
      batchNumber++;
    }
  }

  console.log(`\n✅ Processed all batches (${batchNumber} total)\n`);

  // Print summary
  console.log('='.repeat(60));
  console.log('📈 MIGRATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total pages processed:      ${stats.total}`);
  console.log(`Already have content:       ${stats.alreadyHaveContent}`);
  console.log(`Empty content ({} or null): ${stats.emptyContent}`);
  console.log(`No HTML content:            ${stats.noHtmlContent}`);
  console.log(`Successfully migrated:      ${stats.migrated}`);
  console.log(`Failed:                     ${stats.failed}`);
  console.log('='.repeat(60));

  if (stats.errors.length > 0) {
    console.log('\n❌ ERRORS:\n');
    stats.errors.forEach(({ id, error }) => {
      console.log(`  Page ${id}: ${error}`);
    });
  }

  if (stats.migrated > 0) {
    console.log(`\n✅ Successfully migrated ${stats.migrated} page(s)!`);
  }
}

// Run the migration
migrateHtmlToContent().catch((error) => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
