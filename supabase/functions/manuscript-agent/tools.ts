// manuscript-agent tool belt — the JSON tool schemas the model is given each turn.

const CHANGE_SCHEMA = {
  type: "object",
  description: "One reviewable change. `kind` picks the shape.",
  properties: {
    kind: { type: "string", enum: ["page_edit", "page_add", "page_delete", "book_edit"] },
    note: { type: "string", description: "One line on WHY (shown to the author beside the change)." },
    // page_edit
    pageId: { type: "integer", description: "page_edit / page_delete: the page id (from <book> or read_pages)." },
    title: { type: "string", description: "page_edit: a NEW title for the page (omit to keep it). page_add: the new page's title." },
    after: { type: "string", description: "page_edit: the COMPLETE new body text (a rewrite). Use `edits` instead for small fixes." },
    edits: {
      type: "array",
      description: "page_edit: surgical find/replace patches on the page's body text, applied in order. `find` must match the page text EXACTLY once.",
      items: { type: "object", properties: { find: { type: "string" }, replace: { type: "string" } }, required: ["find", "replace"] },
    },
    // page_add
    afterPageId: { type: ["integer", "null"], description: "page_add: insert after this page id; null = make it the first page." },
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
    description: "Find pages whose text contains a phrase (case-insensitive). Returns page ids with a short snippet around each hit — read the page for the full context.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
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
    name: "propose_changes",
    description: "Stage one or more reviewable changes to the book (page text rewrites/patches, retitles, new pages, deletions, book title/subtitle/author). Ends your turn — the author reviews and accepts in whole or in part. Your narration in the same message is your reply.",
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
