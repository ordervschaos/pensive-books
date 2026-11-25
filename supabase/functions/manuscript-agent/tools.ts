// manuscript-agent tool belt — the JSON tool schemas the model is given each turn.

const CHANGE_SCHEMA = {
  type: "object",
  description: "One reviewable change. `kind` picks the shape.",
  properties: {
    kind: { type: "string", enum: ["page_edit", "page_add", "page_delete", "page_move", "book_edit"] },
    note: { type: "string", description: "One line on WHY (shown to the author beside the change)." },
    // page_edit
    pageId: { type: "integer", description: "page_edit / page_delete / page_move: the page id (from <book> or read_pages)." },
    title: { type: "string", description: "page_edit: a NEW title for the page (omit to keep it). page_add: the new page's title." },
    after: { type: "string", description: "page_edit: the COMPLETE new body text (a rewrite). Use `edits` instead for small fixes." },
    edits: {
      type: "array",
      description: "page_edit: surgical find/replace patches on the page's body text, applied in order. `find` must match the page text EXACTLY once.",
      items: { type: "object", properties: { find: { type: "string" }, replace: { type: "string" } }, required: ["find", "replace"] },
    },
    // page_add
    afterPageId: { type: ["integer", "null"], description: "page_add: insert after this page id. page_move: move the page so it sits right after this page id. null = first page." },
    pageType: { type: "string", enum: ["text", "section"], description: "page_add: 'section' = a part/chapter divider (title only); 'text' = a normal page." },
    text: { type: "string", description: "page_add: the new page's body text ('' for a section)." },
    // book_edit
    field: { type: "string", enum: ["name", "subtitle", "author"], description: "book_edit: which book field." },
    value: { type: "string", description: "book_edit: the new value." },
  },
  required: ["kind"],
};

export const TOOLS = [
  {
    name: "read_pages",
    description: "Read the full text of up to 8 pages by id (ids are in <book>). Returns each page's title and body text in the exact format you must use when proposing text.",
    input_schema: { type: "object", properties: { pageIds: { type: "array", items: { type: "integer" }, minItems: 1, maxItems: 8 } }, required: ["pageIds"] },
  },
  {
    name: "search_pages",
    description: "Find every occurrence of a phrase, a whole word, or a regex across all pages (titles excluded). Returns per-page counts and snippets — read the page for full context. Use match='word' for names (so 'Ann' skips 'Anna').",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        match: { type: "string", enum: ["phrase", "word", "regex"], description: "Default 'phrase' (substring)." },
        caseSensitive: { type: "boolean", description: "Default false." },
      },
      required: ["query"],
    },
  },
  {
    name: "read_chapter",
    description: "Read a whole section (chapter/part): the section page plus every page under it until the next section, up to 12 pages. Give the section's page id from <book> (type 'section').",
    input_schema: { type: "object", properties: { sectionId: { type: "integer" } }, required: ["sectionId"] },
  },
  {
    name: "check_prose",
    description: "A deterministic craft read of up to 8 pages: sentence-length rhythm, the longest sentence, echoes (a word repeated within 60 words), filter words (felt/saw/noticed…), hedges (very/just/suddenly…), -ly adverbs, repeated sentence openers, dialogue share. Numbers, not judgement — use them to ground a line edit; they are not rules.",
    input_schema: { type: "object", properties: { pageIds: { type: "array", items: { type: "integer" }, minItems: 1, maxItems: 8 } }, required: ["pageIds"] },
  },
  {
    name: "record_notes",
    description: "Bank what you learned from reads (one line each) so it survives when old reads are pruned from this conversation. Use it after a sweep of reads; batch it with your next action.",
    input_schema: {
      type: "object",
      properties: { notes: { type: "array", items: { type: "object", properties: { ref: { type: "string", description: "e.g. p3" }, finding: { type: "string" } }, required: ["finding"] }, minItems: 1, maxItems: 20 } },
      required: ["notes"],
    },
  },
  {
    name: "remember",
    description: "Save ONE standing preference the author stated about this book (a style rule, a spelling, a name, a no-go zone) to the book's memory. It survives new chats and rides in <memory> every turn. Only what the author said or clearly confirmed — never your own opinions about the draft. To change an entry, pass its number as `replaces`.",
    input_schema: {
      type: "object",
      properties: { line: { type: "string", description: "One short imperative line, e.g. 'British spelling throughout'." }, replaces: { type: "integer", description: "1-based <memory> entry this line supersedes." } },
      required: ["line"],
    },
  },
  {
    name: "forget",
    description: "Remove one entry from the book's memory when the author withdraws it. Give its 1-based number from <memory>.",
    input_schema: { type: "object", properties: { entry: { type: "integer" } }, required: ["entry"] },
  },
  {
    name: "withdraw_changes",
    description: "Withdraw your own staged changes (ids from <staged_changes>) that are wrong or superseded — e.g. to re-propose a page that already has a staged edit. The author sees them as withdrawn. Does not end your turn.",
    input_schema: {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 }, reason: { type: "string", description: "One line, shown to the author." } },
      required: ["ids", "reason"],
    },
  },
  {
    name: "replace_across_book",
    description: "Stage ONE find/replace across every page (and page titles): a character rename, a spelling standard, a term change. Each affected page becomes a reviewable page_edit. Ends your turn like propose_changes. Search first to see what will match. Pages that already have a staged edit are skipped and reported.",
    input_schema: {
      type: "object",
      properties: {
        find: { type: "string" },
        replace: { type: "string" },
        match: { type: "string", enum: ["phrase", "word", "regex"], description: "Default 'word' — safest for names. In regex mode `$1` refers to a group." },
        caseSensitive: { type: "boolean", description: "Default true." },
        summary: { type: "string", description: "One line for the author, e.g. 'Rename Ann → Anya throughout'." },
      },
      required: ["find", "replace", "summary"],
    },
  },
  {
    name: "propose_changes",
    description: "Stage one or more reviewable changes to the book (page text rewrites/patches, retitles, new pages, deletions, page moves, book title/subtitle/author). Ends your turn — the author reviews and accepts in whole or in part. Your narration in the same message is your reply.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One line describing the whole batch." },
        changes: { type: "array", items: CHANGE_SCHEMA, minItems: 1, maxItems: 20 },
      },
      required: ["summary", "changes"],
    },
  },
  {
    name: "ask_author",
    description: "Ask the author ONE creative decision. Offer 2–4 concrete options when you can (recommendation first, marked '(recommended)'). The conversation pauses until they answer — ask only what genuinely changes the work; never ask permission to proceed.",
    input_schema: {
      type: "object",
      properties: { question: { type: "string" }, options: { type: "array", items: { type: "string" } } },
      required: ["question"],
    },
  },
  {
    name: "suggest_action",
    description: "Render a button in the chat for something only the author can do: 'publish' (publish the book), 'open_page' (jump the canvas to a page — give pageId), 'open_studio' (the story Studio). Put your reply in `reply`.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["publish", "open_page", "open_studio"] },
        pageId: { type: "integer" },
        label: { type: "string", description: "Button text, e.g. 'Publish the book'." },
        reply: { type: "string", description: "Your chat reply accompanying the button." },
      },
      required: ["action", "label"],
    },
  },
  {
    name: "finish",
    description: "End your turn without proposing a change — when the ask is answered by discussion alone.",
    input_schema: { type: "object", properties: { report: { type: "string" } }, required: ["report"] },
  },
];
