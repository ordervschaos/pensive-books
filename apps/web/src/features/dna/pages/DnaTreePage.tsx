// DnaTreePage — /books/:slug/dna/tree
// The ONE studio surface: six tabs (overview / tree / voice / analytics / characters / story) over the
// live book_nodes tree. This file is the route shell — data loading, Realtime subscriptions, page-level
// state, and tab layout. The tree UI itself lives in @/features/dna/components/tree/*.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { deleteNode, saveNode, saveNodes } from "@/features/dna/lib/bookNodes";
import { backlinkIndex, beatsInOrder, byId, childrenOf, isEntityKind, newId, pillarOf, refsOf, scenesInOrder, type BookSettings, type DnaIssue, type DnaNode } from "@/features/dna/lib/novelDna";
import { ensureSeed } from "@/features/dna/lib/dnaExpand";
import { ghostBeatsForAct, ghostFromPremise, ghostFromSeed } from "@/features/dna/lib/dnaSkeleton";
import { KIND_LEVEL } from "@/features/dna/lib/dnaSchema";
import type { Brief } from "@/lib/brief";
import { AgentRail } from "@/features/dna/components/AgentRail";
import { TreeOverviewTab } from "@/features/dna/components/TreeOverviewTab";
import { DnaAnalysis } from "@/features/dna/components/DnaAnalysis";
import { CensusPanel, PromisesPanel, ShapePanel, StoryMapPanel } from "@/features/dna/components/tree/analyticsPanels";
import { type AgentProposal } from "@/features/dna/lib/agentThread";
import { buildJourney, dnaHealth, DNA_STAGES, STAGE_KINDS, type StageKey } from "@/features/dna/lib/dnaJourney";
import { useToast } from "@/hooks/use-toast";
import { useBookPermissions } from "@/hooks/use-book-permissions";
import { reconcileDna } from "@/features/dna/lib/novelDnaRender";
import { MONO, QuickToggle, SERIF, setConsoleTheme, T } from "@/features/dna/components/tree/treeChrome";
import { useTheme } from "@/components/theme/ThemeProvider";
import { AppearanceMenu } from "@/components/navigation/AppearanceMenu";
import { DecomposeButton } from "@/features/dna/components/tree/DecomposeButton";
import { nodeTitle } from "@/features/dna/components/tree/nodeDisplay";
import { buildSearchPattern, SearchPanel, searchDna } from "@/features/dna/components/tree/search";
import { indexProposal } from "@/features/dna/components/tree/proposalOverlay";
import { Subtree } from "@/features/dna/components/tree/Subtree";
import { staleActionsFor } from "@/features/dna/components/tree/staleActions";
import { BriefOrigin } from "@/features/dna/components/tree/BriefSection";
import { FocusPanel, JourneyStrip, SpineTimeline, VoiceFeelPanel } from "@/features/dna/components/tree/panels";
import { CharactersPane, StoryPane } from "@/features/dna/components/tree/panes";
import { CraftNotesPane } from "@/features/dna/components/tree/CraftNotesPane";
import { MetersPane } from "@/features/dna/components/tree/MetersPane";
import { LedgerPane } from "@/features/dna/components/tree/LedgerPane";
import { DiscardStoryModal, HistoryModal, NodeDetailsModal, ProseReaderModal } from "@/features/dna/components/tree/modals";
import { useBookNodesLiveSync } from "@/features/dna/hooks/useBookNodesLiveSync";

const getNumericId = (p: string | undefined) => { const m = p?.match(/^(\d+)/); return m ? parseInt(m[1]) : 0; };

// ── Page ─────────────────────────────────────────────────────────────────────
export default function DnaTreePage() {
  const { bookSlug } = useParams();
  const bookId = getNumericId(bookSlug);
  // Two views share this page (one route, splat-matched so switching doesn't remount): the structural tree and
  // the "voice & feel" taste surface. Keeping taste on its own /dna/tree/taste tab stops its fields from
  // interleaving with the tree structure.
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  // The studio follows the app theme, collapsed to its two console skins: the "terminal" theme is
  // the original dark mono console; every other theme renders Console-on-Paper. setConsoleTheme
  // swaps the shared token objects in place (idempotent), and key={consoleMode} on the root
  // remounts the studio so every inline style recomputes on switch.
  const { themeName } = useTheme();
  const consoleMode = themeName === "terminal" ? "terminal" as const : "paper" as const;
  setConsoleTheme(consoleMode);
  const themeClass = consoleMode === "terminal" ? "theme-terminal dark" : "theme-paper";
  const tab: "tree" | "taste" | "overview" | "analytics" | "characters" | "story" | "craft" =
    location.pathname.endsWith("/overview") ? "overview"
    : location.pathname.endsWith("/taste") ? "taste"
    : location.pathname.endsWith("/analytics") ? "analytics"
    : location.pathname.endsWith("/characters") ? "characters"
    : location.pathname.endsWith("/story") ? "story"
    : location.pathname.endsWith("/craft") ? "craft"
    : "tree";
  const treePath = `/books/${bookSlug}/dna/tree`;
  const overviewPath = `${treePath}/overview`;
  const analyticsPath = `${treePath}/analytics`;
  const charactersPath = `${treePath}/characters`;
  const storyPath = `${treePath}/story`;
  const craftPath = `${treePath}/craft`;

  // Permission gate — DnaStudioPage used to enforce this (bounce non-editors); the tree had none. RLS
  // protects the data either way, but the page itself should bounce like the old studio did.
  const { canEdit, hasAccess, loading: permLoading } = useBookPermissions(bookSlug);
  useEffect(() => {
    if (permLoading) return;
    if (!hasAccess || !canEdit) navigate(`/books/${bookSlug}`, { replace: true });
  }, [permLoading, hasAccess, canEdit, bookSlug, navigate]);

  const [bookName, setBookName] = useState<string>("");
  const [settings, setSettings] = useState<BookSettings>({});
  const [nodes, setNodes] = useState<DnaNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsedSet, setCollapsedSet] = useState<Set<string>>(new Set());
  const [openSet, setOpenSet] = useState<Set<string>>(new Set()); // detail-only leaves the user dug into
  // The reviser rail's open/closed state persists across tab switches (no remount) AND reloads (localStorage,
  // per book) — the chat thread itself lives server-side in book_agent_runs, this just remembers the rail.
  const railKey = `dna-rail-open:${bookId}`;
  // Default-open: the editor rail is the primary way to work the tree, so show it unless the author explicitly
  // closed it ("0"). Unset (new book / first visit) lands with the rail open.
  const [railOpen, setRailOpen] = useState<boolean>(() => localStorage.getItem(railKey) !== "0");
  useEffect(() => { localStorage.setItem(railKey, railOpen ? "1" : "0"); }, [railKey, railOpen]);
  // Slice 2 (docs/agent-context-model.md): the agent's context tray — DNA node ids the author attached as
  // anchors (Cursor's @-file model). Persisted per book; the agent always sees the whole book, these just
  // bias where it looks. Attach from the node row's "@" icon; detach from the chip in the rail. Opening the rail on
  // attach makes the new context visible immediately.
  const attachKey = `agent-attached:${bookId}`;
  const [attachedIds, setAttachedIds] = useState<string[]>(() => {
    try { const v = localStorage.getItem(attachKey); return v ? (JSON.parse(v) as string[]) : []; } catch { return []; }
  });
  useEffect(() => { try { localStorage.setItem(attachKey, JSON.stringify(attachedIds)); } catch { /* ignore */ } }, [attachKey, attachedIds]);
  const attachNode = useCallback((id: string) => { setAttachedIds((ids) => (ids.includes(id) ? ids : [...ids, id])); setRailOpen(true); }, []);
  const detachNode = useCallback((id: string) => setAttachedIds((ids) => ids.filter((x) => x !== id)), []);
  // #1 — pending proposals from the agent thread (book_agent_runs), mirrored so the tree can overlay them.
  const [agentProposals, setAgentProposals] = useState<AgentProposal[]>([]);
  // The serial spine filmstrip (bottom) — persists across reloads, per book (mirrors railOpen above).
  const timelineKey = `dna-timeline-open:${bookId}`;
  const [timelineOpen, setTimelineOpen] = useState<boolean>(() => localStorage.getItem(timelineKey) === "1");
  useEffect(() => { localStorage.setItem(timelineKey, timelineOpen ? "1" : "0"); }, [timelineKey, timelineOpen]);
  const [contextId, setContextId] = useState<string | null>(null); // #7 — the node whose ref-neighborhood is lit
  // #8 — the search panel: left-docked, persists open/closed per book like the rail/timeline do.
  const searchKey = `dna-search-open:${bookId}`;
  const [searchOpen, setSearchOpen] = useState<boolean>(() => localStorage.getItem(searchKey) === "1");
  useEffect(() => { localStorage.setItem(searchKey, searchOpen ? "1" : "0"); }, [searchKey, searchOpen]);
  const [searchQuery, setSearchQuery] = useState("");
  // Lifted alongside searchQuery (not local to SearchPanel) because the tree ALSO consumes this pattern —
  // TreeRow/EditableField highlight against it directly, so panel + tree must share one computed pattern.
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchWholeWord, setSearchWholeWord] = useState(false);
  const [searchUseRegex, setSearchUseRegex] = useState(false);
  const [searchIncludeKinds, setSearchIncludeKinds] = useState<Set<string>>(new Set());
  const searchPattern = useMemo(
    () => (searchOpen ? buildSearchPattern(searchQuery, { caseSensitive: searchCaseSensitive, wholeWord: searchWholeWord, useRegex: searchUseRegex }) : null),
    [searchOpen, searchQuery, searchCaseSensitive, searchWholeWord, searchUseRegex],
  );
  const [flashId, setFlashId] = useState<string | null>(null); // #1 — the node a jump just revealed
  const [dragId, setDragId] = useState<string | null>(null); // #5 — the node being dragged
  const [brief, setBrief] = useState<Brief | null>(null);
  const [proseOpenSet, setProseOpenSet] = useState<Set<string>>(new Set());
  const [proseReaderSceneId, setProseReaderSceneId] = useState<string | null>(null); // prose reader modal
  const toggleProse = useCallback((id: string) => {
    setProseOpenSet((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardInitialLevel, setDiscardInitialLevel] = useState<"prose" | "everything">("prose");
  const discardStory = useCallback(() => { setDiscardInitialLevel("prose"); setDiscardOpen(true); }, []);
  const clearAllNodes = useCallback(() => { setDiscardInitialLevel("everything"); setDiscardOpen(true); }, []);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [detailsNodeId, setDetailsNodeId] = useState<string | null>(null); // "view details" modal
  // #1 — the status-dot/glyph key, folded off the permanent chrome into a click-to-open popover.
  const [legendOpen, setLegendOpen] = useState(false);
  // #2 — json/fork/history folded into one overflow menu (developer-grade utilities, used rarely).
  const [overflowOpen, setOverflowOpen] = useState(false);
  // #4 — the brief collapses once the tree is past the premise stage (it's reference by then, not active
  // work); persists per book like railOpen/timelineOpen. Unset (new book) falls back to the live journey.
  const briefKey = `dna-brief-open:${bookId}`;
  const [briefOpenPref, setBriefOpenPref] = useState<boolean | null>(() => {
    const v = localStorage.getItem(briefKey);
    return v === null ? null : v === "1";
  });
  const setBriefOpen = useCallback((open: boolean) => {
    setBriefOpenPref(open);
    localStorage.setItem(briefKey, open ? "1" : "0");
  }, [briefKey]);

  const saveBrief = useCallback(async (patch: Partial<Brief>) => {
    const next = { ...brief, ...patch, updated_at: new Date().toISOString() } as Brief;
    setBrief(next);
    const { error: err } = await supabase.from("books").update({ brief: next }).eq("id", bookId);
    if (err) throw new Error(err.message);
    setSettings((prev) => ({ ...prev, word_target: next.scope?.word_target }));
  }, [brief, bookId]);

  // Decline the discovery interview (the journey's first rung): mark the vision skipped so the journey
  // advances to the seed. Goes through saveBrief, so `books` Realtime re-derives everything downstream.
  const skipInterview = useCallback(() => {
    void saveBrief({ vision: { ...(brief?.vision ?? {}), skipped: true } }).catch((e) =>
      toast({ title: "Couldn't skip the interview", description: String((e as Error)?.message ?? e), variant: "destructive" }));
  }, [saveBrief, brief, toast]);

  // Seed an empty tree: create the root `seed` node, prefilling its logline from the brief's idea.
  // Everything else (premise/pillar/cast/spine) grows from here via the reviser or the studio.
  // The load+bootstrap effect runs once per book (also dedupes React strict-mode's double-invoke, so an
  // empty tree can't be auto-seeded into two duplicate roots).
  const bootstrappedFor = useRef<number | null>(null);

  useEffect(() => {
    if (!bookId) { setError("no book id"); return; }
    if (bootstrappedFor.current === bookId) return;
    bootstrappedFor.current = bookId;
    void (async () => {
      const [{ data: nodeRows, error: nodesErr }, { data: book, error: bookErr }] = await Promise.all([
        supabase.from("book_nodes").select("*").eq("book_id", bookId).order("position"),
        supabase.from("books").select("name, author, brief").eq("id", bookId).maybeSingle(),
      ]);
      if (nodesErr || bookErr) { setError((nodesErr ?? bookErr)?.message ?? "error"); return; }
      setBookName(book?.name ?? "");
      const loadedBrief = (book?.brief as Brief | null) ?? null;
      setBrief(loadedBrief);
      setSettings({ title: book?.name ?? undefined, author: (book?.author as string | null) ?? undefined,
        word_target: loadedBrief?.scope?.word_target });
      let loaded = (nodeRows ?? []) as DnaNode[];
      // Bootstrap the ROOT: the agent can't create a parent-less seed node, so an empty tree gets one
      // automatically (the seed = the logline origin, left empty until the author or agent drafts it).
      // The agent builds everything below it — this replaces the old manual "seed the tree" button.
      if (loaded.length === 0) {
        try {
          const seed = await ensureSeed(bookId);
          loaded = [seed];
        } catch { /* leave the tree empty; the live subscription still reflects reality */ }
      }
      setNodes(loaded);
      // Open every node whose ghost preview (dnaSkeleton) has something to show — a childless seed/premise/act
      // defaults CLOSED (openSet is opt-in, unlike collapsedSet) so the forecast of what's next would
      // otherwise be invisible until the author clicks in. This is a one-time default on load, not a live
      // rule, so an author who deliberately re-collapses one doesn't get overridden by a later Realtime tick.
      const frontier = new Set<string>();
      for (const n of loaded) {
        if (n.kind === "seed" && ghostFromSeed(loaded).length) frontier.add(n.id);
        if (n.kind === "premise" && ghostFromPremise(loaded).length) frontier.add(n.id);
        if (n.kind === "act" && ghostBeatsForAct(loaded, n).length) frontier.add(n.id);
      }
      if (frontier.size) setOpenSet((p) => new Set([...p, ...frontier]));
    })();
  }, [bookId]);

  // #1 — mirror the agent thread's pending proposals so the tree can overlay them in place. The AgentRail
  // owns apply/discard; this is read-only (live over Realtime, refresh = no-op).
  useEffect(() => {
    if (!bookId) return;
    let alive = true;
    const load = async () => {
      const { data } = await supabase.from("book_agent_runs").select("proposals").eq("book_id", bookId).eq("kind", "thread").maybeSingle();
      if (alive) setAgentProposals((data?.proposals as AgentProposal[] | null) ?? []);
    };
    void load();
    const ch = supabase.channel(`treeagent_${bookId}_${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "book_agent_runs", filter: `book_id=eq.${bookId}` }, () => void load())
      .subscribe();
    return () => { alive = false; void supabase.removeChannel(ch); };
  }, [bookId]);

  // Live subscription
  useBookNodesLiveSync(bookId, "tree", setNodes);

  // Live subscription on the `books` row — name/author/brief can change from elsewhere (e.g. a second tab
  // on Book Edit), so the tree needs its own live projection of it too (refresh = no-op).
  useEffect(() => {
    if (!bookId) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const reload = () => void supabase.from("books").select("name, author, brief").eq("id", bookId).maybeSingle().then(({ data: book }) => {
      if (!book) return;
      setBookName(book.name ?? "");
      const loadedBrief = (book.brief as Brief | null) ?? null;
      setBrief(loadedBrief);
      setSettings((prev) => ({ ...prev, title: book.name ?? undefined, author: (book.author as string | null) ?? undefined,
        word_target: loadedBrief?.scope?.word_target }));
    });
    const soon = () => { if (t) clearTimeout(t); t = setTimeout(reload, 400); };
    const ch = supabase.channel(`treebook_${bookId}_${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "books", filter: `id=eq.${bookId}` }, soon)
      .subscribe();
    return () => { if (t) clearTimeout(t); void supabase.removeChannel(ch); };
  }, [bookId]);

  const collapseAll = useCallback(() => {
    if (!nodes) return;
    setCollapsedSet(new Set(nodes.filter((n) => childrenOf(nodes, n.id).length > 0).map((n) => n.id)));
    setOpenSet(new Set()); // also fold any dug-into detail leaves
  }, [nodes]);

  const expandAll = useCallback(() => setCollapsedSet(new Set()), []);

  const toggleDetail = useCallback((id: string) => {
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleNode = useCallback((id: string) => {
    setCollapsedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // ── Render / read — project the tree onto pages (ported from DnaStudio's top bar, Phase 3) ────────────
  const [rendering, setRendering] = useState<"render" | "read" | null>(null);
  const renderPages = useCallback(async () => {
    if (!bookId || rendering) return;
    setRendering("render");
    try {
      const r = await reconcileDna(bookId);
      toast({ title: "Rendered", description: `${r.pages} pages · ${r.created} added · ${r.updated} updated · ${r.archived} archived.` });
    } catch (e) {
      toast({ title: "Couldn't render", description: String((e as Error)?.message ?? e), variant: "destructive" });
    } finally { setRendering(null); }
  }, [bookId, rendering, toast]);
  // Render-then-read: project the tree onto pages FIRST (idempotent), then open the reader — so the prose
  // you read is always current, never the stale "I forgot to render" page.
  const renderAndRead = useCallback(async () => {
    if (!bookId || rendering) return;
    setRendering("read");
    try { await reconcileDna(bookId); window.location.href = `/books/${bookSlug}`; }
    catch (e) { toast({ title: "Couldn't render", description: String((e as Error)?.message ?? e), variant: "destructive" }); setRendering(null); }
  }, [bookId, bookSlug, rendering, toast]);

  // ── Fork ──────────────────────────────────────────────────────────────────────
  const [forking, setForking] = useState(false);
  const forkDna = useCallback(async () => {
    if (!nodes || !bookId || forking) return;
    setForking(true);
    try {
      const { data: src } = await supabase.from("books")
        .select("name, author, brief, mode, is_public")
        .eq("id", bookId)
        .single();
      const { data: fork, error: forkErr } = await supabase
        .from("books")
        .insert({
          name: `Fork of ${src?.name ?? bookName}`,
          author: (src?.author as string | null) ?? null,
          brief: (src?.brief as object | null) ?? null,
          mode: (src?.mode as string | null) ?? null,
          is_public: false,
        })
        .select("id")
        .single();
      if (forkErr || !fork) throw forkErr ?? new Error("Could not create fork");
      // Remap all node IDs so the forked tree is independent (same-id rows would violate PK).
      const idMap = new Map(nodes.map((n) => [n.id, newId()]));
      const forkedNodes = nodes.map((n) => ({
        id: idMap.get(n.id)!,
        book_id: fork.id as number,
        parent_id: n.parent_id ? (idMap.get(n.parent_id) ?? null) : null,
        level: n.level, kind: n.kind, position: n.position,
        content: n.content, authoring: n.authoring,
        proposals: null, chosen: (n.chosen as unknown) ?? null,
      }));
      const { error: nodesErr } = await supabase.from("book_nodes").insert(forkedNodes);
      if (nodesErr) throw nodesErr;
      window.open(`/books/${fork.id as number}/dna/tree`, "_blank");
    } catch (e) {
      alert(`Fork failed: ${(e as Error).message}`);
    } finally {
      setForking(false);
    }
  }, [nodes, bookId, bookName, forking]);

  // ── Node CRUD ────────────────────────────────────────────────────────────────
  // Append a fresh empty node of `kind` under `parentId` (position after its existing siblings of that
  // kind). Entities still land on the pillar by construction here, honoring schema §4. Realtime refreshes.
  const addNode = useCallback(async (parentId: string, kind: DnaNode["kind"]) => {
    if (!nodes) return;
    const siblings = nodes.filter((n) => n.parent_id === parentId && n.kind === kind);
    const node: DnaNode = {
      id: newId(), book_id: bookId, parent_id: parentId, level: KIND_LEVEL[kind] ?? 5, kind,
      position: siblings.length ? Math.max(...siblings.map((s) => s.position)) + 1 : 0,
      content: {}, authoring: { source: "user", locked: false, status: "draft" },
    };
    try { await saveNode(node); setOpenSet((p) => new Set(p).add(node.id)); } // open it so its empty fields show
    catch (e) { alert(`Add failed: ${(e as Error).message}`); }
  }, [nodes, bookId]);

  // #4 — delete-safety: surface inbound cross-references (which would be left dangling) before confirming.
  const removeNode = useCallback((node: DnaNode) => {
    if (!nodes) return;
    const kids = childrenOf(nodes, node.id).length;
    const inbound = backlinkIndex(nodes).get(node.id) ?? [];
    const label = nodeTitle(node) || node.kind;
    const refWarn = inbound.length
      ? `\n\n⚠ ${inbound.length} node(s) reference this — they'll be left with a dangling link:\n${inbound.slice(0, 8).map((n) => `• ${n.kind}: ${nodeTitle(n) || n.id}`).join("\n")}${inbound.length > 8 ? `\n…and ${inbound.length - 8} more` : ""}`
      : "";
    if (!window.confirm(`Delete ${node.kind} "${label}"${kids ? ` and its ${kids} child node(s)` : ""}?${refWarn}\n\nThis cannot be undone.`)) return;
    void deleteNode(node.id).catch((e) => alert(`Delete failed: ${(e as Error).message}`));
  }, [nodes]);

  // #5 — drag-to-reorder. Move the dragged node before/after `target` within their shared sibling group,
  // then RENORMALIZE the group's positions to 0..n-1 (this also repairs pre-existing duplicate/zero
  // positions, which is why the old swap-based reorder silently no-op'd). Only the changed rows are written.
  const onDropReorder = useCallback((target: DnaNode, before: boolean) => {
    const draggedId = dragId;
    setDragId(null);
    if (!nodes || !draggedId || draggedId === target.id) return;
    const dragged = nodes.find((n) => n.id === draggedId);
    if (!dragged || dragged.parent_id !== target.parent_id || dragged.kind !== target.kind) return;
    const group = nodes.filter((n) => n.parent_id === target.parent_id && n.kind === target.kind).sort((a, b) => a.position - b.position);
    const without = group.filter((n) => n.id !== draggedId);
    let at = without.findIndex((n) => n.id === target.id);
    if (at < 0) return;
    if (!before) at += 1;
    without.splice(at, 0, dragged);
    const writes = without.map((n, i) => (n.position === i ? null : { ...n, position: i })).filter(Boolean) as DnaNode[];
    if (!writes.length) return;
    void saveNodes(writes).catch((e) => alert(`Reorder failed: ${(e as Error).message}`));
  }, [nodes, dragId]);

  // #1 — jump to a node by id: un-collapse its ancestors (and the synthetic story/world groups it lives in),
  // open it if it's a detail-only leaf, then flash it. The scroll happens in the effect below, after the
  // expansion has committed to the DOM.
  const jumpTo = useCallback((id: string) => {
    if (!nodes) return;
    const idx = byId(nodes);
    const target = idx.get(id);
    if (!target) return;
    const reveal = new Set<string>();
    let cur: DnaNode | undefined = target;
    while (cur) { reveal.add(cur.id); cur = cur.parent_id ? idx.get(cur.parent_id) : undefined; }
    const pillar = pillarOf(nodes);
    if (pillar) {
      reveal.add(pillar.id);
      if (isEntityKind(target.kind)) { reveal.add(`${pillar.id}::world`); reveal.add(`${pillar.id}::world::${target.kind}`); }
      else if (!["pillar", "premise", "seed"].includes(target.kind)) reveal.add(`${pillar.id}::story`);
    }
    setCollapsedSet((prev) => { const next = new Set(prev); for (const r of reveal) next.delete(r); return next; });
    setOpenSet((prev) => new Set(prev).add(id));
    setFlashId(id);
  }, [nodes]);

  // #6 — un-collapse the ancestors (and synthetic story/world groups) of many nodes at once, no flash. Used
  // by the health lens so a broken beat/scene isn't dimmed-AND-hidden inside a collapsed act. Mirrors jumpTo.
  const revealNodes = useCallback((ids: string[]) => {
    if (!nodes || !ids.length) return;
    const idx = byId(nodes);
    const pillar = pillarOf(nodes);
    const reveal = new Set<string>();
    for (const id of ids) {
      let cur: DnaNode | undefined = idx.get(id);
      const target = cur;
      while (cur) { reveal.add(cur.id); cur = cur.parent_id ? idx.get(cur.parent_id) : undefined; }
      if (pillar && target) {
        reveal.add(pillar.id);
        if (isEntityKind(target.kind)) { reveal.add(`${pillar.id}::world`); reveal.add(`${pillar.id}::world::${target.kind}`); }
        else if (!["pillar", "premise", "seed"].includes(target.kind)) reveal.add(`${pillar.id}::story`);
      }
    }
    setCollapsedSet((prev) => { const next = new Set(prev); for (const r of reveal) next.delete(r); return next; });
  }, [nodes]);

  // #8 — while search is active, un-collapse every match's ancestors as you type — otherwise a hit buried in
  // a collapsed act/beat would never actually become visible (or highlighted) in the tree. Mirrors the health
  // lens's reveal-on-toggle; here it re-runs on every pattern/filter change instead of a single toggle click.
  useEffect(() => {
    if (!nodes || !searchPattern) return;
    const matches = searchDna(nodes, searchPattern, searchIncludeKinds);
    if (matches.length) revealNodes(matches.map((m) => m.node.id));
  }, [nodes, searchPattern, searchIncludeKinds, revealNodes]);

  // #1 — once a jump has set flashId (and the reveal has rendered), scroll the node into view; clear the
  // flash after a beat. Re-runs if a new jump fires before the timer elapses.
  useEffect(() => {
    if (!flashId) return;
    document.getElementById(`dna-node-${flashId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setFlashId(null), 1600);
    return () => clearTimeout(t);
  }, [flashId]);

  // ── Proposal overlay (#1) ─────────────────────────────────────────────────────
  // Overlay the union of all the agent thread's pending proposals' ops in the tree, in place.
  const proposalView = useMemo(() => indexProposal(agentProposals.flatMap((p) => p.ops), nodes ?? []), [agentProposals, nodes]);
  const backlinks = useMemo(() => backlinkIndex(nodes ?? []), [nodes]); // #2 — inbound cross-references

  // #7 — context-highlight: toggle the focused node, and auto-reveal its ref-neighborhood so a referenced
  // character/world_fact buried in a collapsed group isn't dimmed-AND-hidden. Clicking the same badge clears.
  const focusContext = useCallback((id: string) => {
    setContextId((cur) => {
      if (cur === id) return null;
      if (nodes) {
        const node = byId(nodes).get(id);
        const neighborhood = [id, ...(node ? refsOf(node) : []), ...(backlinks.get(id) ?? []).map((n) => n.id)];
        revealNodes(neighborhood);
      }
      return id;
    });
  }, [nodes, backlinks, revealNodes]);
  // Journey strip — clicking a stage reveals its whole layer (so nothing's collapsed-and-hidden) and
  // scrolls to the first node of that layer in position order.
  const goStage = useCallback((key: StageKey) => {
    const kinds = STAGE_KINDS[key];
    const matches = nodes.filter((n) => kinds.includes(n.kind));
    if (!matches.length) return;
    revealNodes(matches.map((n) => n.id));
    const target = matches.slice().sort((a, b) => a.position - b.position)[0];
    jumpTo(target.id);
  }, [nodes, revealNodes, jumpTo]);
  // Esc clears the active context focus.
  useEffect(() => {
    if (contextId === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setContextId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [contextId]);

  // #8 — "/" opens search from anywhere except while typing in an editable field (fields are click-to-edit
  // inputs/textareas scattered through the tree, so this can't be a plain global listener).
  useEffect(() => {
    if (searchOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable) return;
      e.preventDefault();
      setSearchOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  // A search hit (or any future off-tab jump) needs to land on the tree tab first — jumpTo only manipulates
  // tree-local reveal state, it doesn't switch tabs itself.
  const goToNode = useCallback((id: string) => { if (tab !== "tree") navigate(treePath); jumpTo(id); }, [tab, navigate, treePath, jumpTo]);

  // The Overview tab's "onOpen" — same off-tab landing as goToNode, then either jump straight to a specific
  // node (a drill-in from the shape map / issues list) or fall back to goStage's first-of-kind jump.
  const openStage = useCallback((key: StageKey, focusId?: string) => {
    if (tab !== "tree") navigate(treePath);
    if (focusId) jumpTo(focusId); else goStage(key);
  }, [tab, navigate, treePath, jumpTo, goStage]);

  const base: React.CSSProperties = {
    margin: 0, minHeight: "100vh",
    fontFamily: MONO,
    background: T.bg, color: T.inkSoft,
    userSelect: "text",
  };
  const smallBtnStyle: React.CSSProperties = { background: "none", border: "none", color: T.muted, fontSize: 10.5, cursor: "pointer", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: MONO, padding: 0 };
  const menuItemStyle: React.CSSProperties = { ...smallBtnStyle, textAlign: "left", textDecoration: "none", padding: "5px 10px", borderRadius: 5, whiteSpace: "nowrap" };

  if (permLoading || !hasAccess || !canEdit) return null;
  if (error) return <div className={themeClass} style={{ ...base, padding: 24, color: T.bad }}>error: {error}</div>;
  if (!nodes) return <div className={themeClass} style={{ ...base, padding: 24, color: T.muted }}>loading…</div>;

  const index = byId(nodes);
  const roots = nodes.filter((n) => n.parent_id === null).sort((a, b) => a.position - b.position);

  // Global reading-order numbers for beats and scenes — ONE numbering shared by the tree badge (below), the
  // timeline strip, and (mirrored) the agent's digest, so "beat 3" / "scene 14" denote the same node in all
  // three. Derived from the same act→beat→scene walk the render uses; a node is only ever one kind, so a
  // single map is unambiguous.
  const seq = new Map<string, number>();
  beatsInOrder(nodes).forEach((b, i) => seq.set(b.id, i + 1));
  scenesInOrder(nodes).forEach((s, i) => seq.set(s.id, i + 1));

  // The journey, for the Overview tab (same computation DnaStudio used to drive its own Overview mount).
  const { stages: journeyStages, nowIndex: journeyNowIndex } = buildJourney(nodes);
  const nowKey = journeyStages[journeyNowIndex]?.key ?? "premise";

  // #4 — DNA health: completeness + strength + the lints behind them (structural faults included).
  const health = dnaHealth(nodes, settings);
  // #6 — group the lints by the node they attach to, for the per-row health glyph + the lens.
  const issuesByNode = new Map<string, DnaIssue[]>();
  for (const i of health.issues) { if (!i.nodeId) continue; const a = issuesByNode.get(i.nodeId); if (a) a.push(i); else issuesByNode.set(i.nodeId, [i]); }
  // #7 — the focused node's neighborhood: what it's built from (refsOf) and what's built on it (backlinks).
  const ctxNode = contextId ? index.get(contextId) : undefined;
  const ctxConsumes = new Set<string>(ctxNode ? refsOf(ctxNode) : []);
  const ctxConsumedBy = new Set<string>(contextId ? (backlinks.get(contextId)?.map((n) => n.id) ?? []) : []);
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const barColor = (n: number) => (n >= 0.8 ? T.good : n >= 0.5 ? T.warn : T.bad);
  const issueTitle = (i: typeof health.issues[number]) => {
    const n = i.nodeId ? index.get(i.nodeId) : undefined;
    return n ? `${n.kind}${nodeTitle(n) ? ` · ${nodeTitle(n)}` : ""}` : i.nodeId ?? "";
  };

  // #4 — the brief defaults to collapsed once the tree has moved past the premise stage (it's the constant
  // origin — reference by then, not active work); an explicit toggle overrides the live journey default.
  const briefOpen = briefOpenPref ?? journeyNowIndex === 0;

  // #2 — json / fork / history: developer-grade + rarely-used utilities, folded into one overflow menu
  // instead of sitting with equal billing next to the core actions.
  const overflowMenu = (
    <div style={{ position: "relative" }}>
      <QuickToggle active={overflowOpen} accent={T.accent} icon="⋯" label="More" onClick={() => setOverflowOpen((v) => !v)} />
      {overflowOpen && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 25, background: T.raised, border: `1px solid ${T.border}`, borderRadius: 8, boxShadow: T.shadow, padding: 5, display: "flex", flexDirection: "column", gap: 1, minWidth: 130 }}>
          {tab === "tree" && (
            <button onClick={() => { setHistoryOpen(true); setOverflowOpen(false); }} style={menuItemStyle}>⟲ history</button>
          )}
          <a href={`/books/${bookSlug}/dna.json`} onClick={() => setOverflowOpen(false)} style={menuItemStyle}>{"{ } json →"}</a>
          <button onClick={() => { setOverflowOpen(false); void forkDna(); }} disabled={forking} title="Copy this DNA tree into a new book to experiment freely" style={{ ...menuItemStyle, color: forking ? T.faint : menuItemStyle.color, cursor: forking ? "default" : "pointer" }}>
            {forking ? "forking…" : "⑂ fork →"}
          </button>
          <button onClick={() => { setOverflowOpen(false); clearAllNodes(); }} title="Delete the entire tree and start fresh" style={{ ...menuItemStyle, color: T.bad }}>
            ✕ clear all
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div key={consoleMode} className={themeClass} style={{ ...base, marginRight: railOpen ? 420 : 0, marginLeft: searchOpen ? 320 : 0 }}>
      {searchOpen && (
        <SearchPanel nodes={nodes} query={searchQuery} onQueryChange={setSearchQuery}
          caseSensitive={searchCaseSensitive} onCaseSensitiveChange={setSearchCaseSensitive}
          wholeWord={searchWholeWord} onWholeWordChange={setSearchWholeWord}
          useRegex={searchUseRegex} onUseRegexChange={setSearchUseRegex}
          includeKinds={searchIncludeKinds} onIncludeKindsChange={setSearchIncludeKinds}
          onJump={goToNode} onClose={() => setSearchOpen(false)} />
      )}
      {/* #1 — the status-dot/glyph key, popover-only (was a permanent chrome row) */}
      {legendOpen && (
        <div style={{
          position: "fixed", top: 96, right: railOpen ? 436 : 16, zIndex: 25, width: 300,
          background: T.raised, border: `1px solid ${T.border}`, borderRadius: 8, boxShadow: T.shadow,
          padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 9.5, color: T.faint, letterSpacing: "0.12em", textTransform: "uppercase" }}>key</span>
            <span onClick={() => setLegendOpen(false)} style={{ cursor: "pointer", color: T.muted, fontSize: 12 }}>✕</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {[["accepted", T.good], ["draft", T.warn], ["empty", T.empty]].map(([s, c]) => (
              <span key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: c }} />
                <span style={{ fontSize: 9.5, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>{s}</span>
              </span>
            ))}
          </div>
          <span style={{ fontSize: 9.5, color: T.stale, letterSpacing: "0.08em", textTransform: "uppercase" }}>amber dot = stale</span>
          <span style={{ fontSize: 9.5, color: T.warn }}>∴ therefore · ↯ but</span>
          <span style={{ fontSize: 9.5, color: T.faint, letterSpacing: "0.04em", lineHeight: 1.5 }}>
            plumbing (state · roles · grounds_in) is AI-maintained — you author taste (Voice &amp; Feel)
          </span>
        </div>
      )}
      {discardOpen && <DiscardStoryModal bookId={bookId} nodes={nodes} initialLevel={discardInitialLevel} onClose={() => setDiscardOpen(false)} />}
      {historyOpen && nodes && <HistoryModal bookId={bookId} nodes={nodes} onClose={() => setHistoryOpen(false)} />}
      {detailsNodeId && index.get(detailsNodeId) && (
        <NodeDetailsModal node={index.get(detailsNodeId)!} nodes={nodes ?? []} onClose={() => setDetailsNodeId(null)} />
      )}
      {/* The tool-using editor's agent (durable book-agent thread), promoted into the tree rail. The
          studio components read the Paper-DS CSS vars, which the theme-paper wrapper above resolves —
          the rail wears the same light paper skin as the rest of the studio. */}
      {railOpen && (
        <div style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 420, zIndex: 20,
          background: T.raised, borderLeft: `1px solid ${T.border}`, display: "flex", flexDirection: "column",
        }}>
          <div style={{ flex: 1, minHeight: 0 }}>
            <AgentRail bookId={bookId} nodes={nodes} settings={settings} bookSlug={bookSlug} brief={brief} attachedIds={attachedIds} onAttach={attachNode} onDetach={detachNode} onClose={() => setRailOpen(false)} onJump={jumpTo} />
          </div>
        </div>
      )}
      {/* #7 — the focus readout: "what controls this" for the badge-clicked node (bottom-left, clears of the rail) */}
      {tab === "tree" && ctxNode && (
        <FocusPanel node={ctxNode} index={index} consumes={ctxConsumes} consumedBy={ctxConsumedBy}
          onJump={jumpTo} onClear={() => setContextId(null)} bottomInset={timelineOpen ? 212 : 16}
          leftInset={searchOpen ? 336 : 16}
          staleActions={staleActionsFor(ctxNode, index)} />
      )}
      {/* The serial spine — reading-order filmstrip across the bottom (acts → beats → scenes) */}
      {tab === "tree" && timelineOpen && (
        <SpineTimeline nodes={nodes} rightInset={railOpen ? 420 : 0} leftInset={searchOpen ? 320 : 0} seq={seq}
          onJump={jumpTo} onClose={() => setTimelineOpen(false)} />
      )}
      {/* Top menu — identity + the two surfaces that are global, not tab-scoped (search, editor). In
          normal flow (not position:fixed) so it can never overlap the tab strip below it, and so it
          shifts with the rail/search panels automatically via the outer container's margin. */}
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${T.borderSoft}`, display: "flex", alignItems: "center", gap: 16 }}>
        <Link to={`/books/${bookSlug}`} title="Back to the book" style={{ display: "inline-flex", alignItems: "baseline", gap: 8, minWidth: 0, textDecoration: "none" }}>
          <span style={{ fontFamily: SERIF, fontSize: 16, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bookName || bookSlug}</span>
          <span style={{ fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: T.faint }}>dna</span>
        </Link>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 3 }}>
          {/* #13 — the payoff action, reachable from anywhere in the studio, not just the Story tab */}
          <button onClick={() => void renderAndRead()} disabled={!!rendering} title="Render the tree onto pages and read the current draft"
            style={{
              display: "flex", alignItems: "center", gap: 5, cursor: rendering ? "default" : "pointer",
              background: `${T.accent}14`, border: `1px solid ${T.accent}55`, borderRadius: 6, padding: "3px 10px",
              fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase",
              color: rendering ? T.faint : T.accent, marginRight: 6,
            }}>
            {rendering === "read" ? "reading…" : "read →"}
          </button>
          <QuickToggle active={searchOpen} accent={T.accent} icon="⌕" label="Search" title="Search ( / )" onClick={() => setSearchOpen((v) => !v)} />
          <QuickToggle active={railOpen} accent={T.accent} icon="✦" label="Editor" onClick={() => setRailOpen((v) => !v)} />
          {/* The app-wide theme picker — the studio renders its own chrome (no main nav), so it
              mounts here too; picking "Terminal" flips the studio to the dark console skin. */}
          <AppearanceMenu />
        </div>
      </div>

      {/* Tab strip — Chrome-style: the active tab's bottom border is erased and its background matches
          the content below, so it visually fuses with whatever pane is open; inactive tabs sit recessed
          on a shared baseline. Working surfaces (overview / tree / voice) vs. read-only projections
          (analytics / characters / story) are visually grouped by a thin divider between them —
          same route, splat path, no remount. */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, padding: "8px 16px 0" }}>
        {([["overview", "overview", overviewPath], ["tree", "tree", treePath], ["taste", "voice", `${treePath}/taste`]] as const).map(([key, label, to]) => (
          <button key={key} onClick={() => navigate(to)} style={{
            background: tab === key ? T.bg : "transparent",
            border: `1px solid ${tab === key ? T.border : "transparent"}`,
            borderBottom: `1px solid ${tab === key ? T.bg : "transparent"}`,
            marginBottom: -1, borderRadius: "7px 7px 0 0",
            color: tab === key ? T.accent : T.muted, fontSize: 11, cursor: "pointer",
            letterSpacing: "0.1em", textTransform: "uppercase", padding: "7px 16px", fontFamily: MONO,
          }}>{label}</button>
        ))}
        <span style={{ width: 1, alignSelf: "stretch", marginBottom: 6, background: T.border }} />
        {([["analytics", "analytics", analyticsPath], ["characters", "characters", charactersPath], ["story", "story", storyPath], ["craft", "craft notes", craftPath]] as const).map(([key, label, to]) => (
          <button key={key} onClick={() => navigate(to)} style={{
            background: tab === key ? T.bg : "transparent",
            border: `1px solid ${tab === key ? T.border : "transparent"}`,
            borderBottom: `1px solid ${tab === key ? T.bg : "transparent"}`,
            marginBottom: -1, borderRadius: "7px 7px 0 0",
            color: tab === key ? T.accent : T.muted, fontSize: 11, cursor: "pointer",
            letterSpacing: "0.1em", textTransform: "uppercase", padding: "7px 16px", fontFamily: MONO,
          }}>{label}</button>
        ))}
        <span style={{ marginLeft: "auto", marginBottom: 6, display: "flex", alignItems: "center" }}>{overflowMenu}</span>
      </div>

      {/* Below-tabs action bar — only rendered off the tree tab, where the journey strip absorbs it (#5). */}
      {tab !== "tree" && (
        <div style={{ padding: "8px 16px", borderBottom: `1px solid ${T.borderSoft}`, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <DecomposeButton bookId={bookId} nodes={nodes} />
          </div>
        </div>
      )}

      {/* ── overview tab: the studio's dashboard — shape, next move, issues ── */}
      {tab === "overview" && (
        <TreeOverviewTab bookId={bookId} nodes={nodes} settings={settings} stages={journeyStages} nowKey={nowKey}
          brief={brief} onSkipInterview={skipInterview}
          onOpen={openStage} onChanged={() => {}} />
      )}

      {/* ── voice tab: the taste surface on its own, off the structural tree ── */}
      {tab === "taste" && (
        <VoiceFeelPanel nodes={nodes} index={index} asPage onJump={(id) => { navigate(treePath); jumpTo(id); }} />
      )}

      {/* ── analytics tab: the ONE surface for understanding the whole book at once. Two halves, in order:
          WHAT IT IS (census · shape pipeline · story map — the projections lifted off the Overview so the
          dashboard stays actionable) then WHAT'S WRONG (deterministic lints, every semantic read trigger —
          Shape/Craft/Cold-read/meters-over-the-spine via MetersPane, continuity via LedgerPane — then
          promises/pacing/topography). Read-only projection of the tree; every row deep-links back into the
          structural tree via goToNode / openStage. ── */}
      {tab === "analytics" && (
        <div style={{ padding: "16px" }}>
          {/* WHAT IT IS — census · the DNA pipeline · the beat-by-beat story map. Pure projections; each row
              jumps into the stage that owns the node (openStage), so this reads as a map, not a dead report. */}
          <div className="mb-5 space-y-4">
            <CensusPanel nodes={nodes} />
            <ShapePanel nodes={nodes} onOpen={openStage} />
            <StoryMapPanel nodes={nodes} onOpen={openStage} />
          </div>

          {/* full health readout (the detail behind the header pip) */}
          <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap", marginBottom: 16 }}>
            {([["complete", health.completeness], ["strong", health.strength]] as const).map(([label, val]) => (
              <span key={label} style={{ display: "flex", alignItems: "center", gap: 6 }} title={label === "complete" ? `${health.stagesDone}/${DNA_STAGES.length} stages · ${pct(health.contentFill)} fields filled` : `${health.errors} errors · ${health.warns} warnings`}>
                <span style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: T.muted }}>{label}</span>
                <span style={{ width: 90, height: 5, background: T.inset, borderRadius: 2, overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: pct(val), background: barColor(val) }} />
                </span>
                <span style={{ fontSize: 10, color: barColor(val), fontVariantNumeric: "tabular-nums" }}>{pct(val)}</span>
              </span>
            ))}
            <span style={{ fontSize: 10, color: T.muted, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              {health.errors}✕ · {health.warns}⚠
            </span>
          </div>

          {/* #4 — the lints behind the score: structural faults (misparented / orphan / duplicate) + craft warns */}
          {(health.errors + health.warns) > 0 ? (
            <div style={{ border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 12px", display: "flex", flexDirection: "column", gap: 3, marginBottom: 16, background: T.raised }}>
              {health.issues.map((i, idx) => (
                <div key={idx} onClick={i.nodeId ? () => goToNode(i.nodeId!) : undefined}
                  style={{ display: "flex", alignItems: "baseline", gap: 8, fontFamily: MONO, fontSize: 11, cursor: i.nodeId ? "pointer" : "default", borderRadius: 3, padding: "1px 4px", marginLeft: -4 }}
                  onMouseEnter={i.nodeId ? (e) => { e.currentTarget.style.background = T.hover; } : undefined}
                  onMouseLeave={i.nodeId ? (e) => { e.currentTarget.style.background = "transparent"; } : undefined}>
                  <span style={{ color: i.severity === "error" ? T.bad : T.warn, flexShrink: 0 }}>{i.severity === "error" ? "✕" : "⚠"}</span>
                  <span style={{ color: T.muted, letterSpacing: "0.04em", flexShrink: 0, width: 140 }}>{i.rule}</span>
                  <span style={{ color: T.inkSoft, flex: 1 }}>{i.message}</span>
                  {i.nodeId && <span style={{ color: T.muted, flexShrink: 0, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{issueTitle(i)} →</span>}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: T.good, fontFamily: MONO, marginBottom: 16 }}>✓ no lints — the tree is conformant</div>
          )}

          {/* Shape / Craft / Cold-read / Meter emotional-trace — same MetersPane the standalone /dna/meters
              route renders; a projection of the live tree, reads write back onto it. */}
          <MetersPane nodes={nodes} bookId={bookId} bookSlug={bookSlug ?? ""} />

          {/* continuity ledger — same LedgerPane the standalone /dna/ledger route renders. */}
          <LedgerPane nodes={nodes} bookId={bookId} bookSlug={bookSlug ?? ""} />

          {/* PROMISES — the obligation ledger across all six debt axes, pressure-ordered, with the manual
              Waive gesture (the one mutation on this tab). DnaAnalysis below reports the same debts read-only;
              this is the actionable view, so it sits first. */}
          <div className="my-4">
            <PromisesPanel nodes={nodes} index={index} onOpen={openStage} />
          </div>

          {/* pacing · topography · causality (lints hidden here — shown in the list above) */}
          <DnaAnalysis nodes={nodes} settings={settings} onOpen={openStage} hideLints />
        </div>
      )}

      {/* ── characters tab: the cast dossier — read view of character/relationship nodes ── */}
      {tab === "characters" && (
        <CharactersPane nodes={nodes} index={index} onJump={goToNode} />
      )}

      {/* ── story tab: the assembled manuscript — every scene's prose in reading order ── */}
      {/* ── craft notes tab: the tier-1 story craft (baked into generation), overridable per book ── */}
      {tab === "craft" && (
        <CraftNotesPane bookId={bookId} />
      )}

      {tab === "story" && (
        <StoryPane nodes={nodes} onJump={goToNode}
          onRender={() => void renderPages()} onRead={() => void renderAndRead()} rendering={rendering} />
      )}

      {/* ── tree tab: journey (+ merged action bar) → brief → the structural tree ── */}
      {tab === "tree" && (<>
      {/* Journey strip — where am I / what's left, merged with the action bar (#5): health pip + the
          tree-only toggles sit in the same row as the stages instead of a whole extra chrome row. */}
      {roots.length > 0 && (
        <JourneyStrip nodes={nodes} onGoStage={goStage}
          onGapClick={(key) => { goStage(key); setRailOpen(true); }}
          right={
            <>
              <DecomposeButton bookId={bookId} nodes={nodes} />
              <button onClick={expandAll} style={smallBtnStyle}>expand all</button>
              <button onClick={collapseAll} style={smallBtnStyle}>collapse all</button>
              <QuickToggle active={timelineOpen} accent={T.accent} icon="▦" label="Timeline" onClick={() => setTimelineOpen((v) => !v)} />
              <QuickToggle active={legendOpen} accent={T.accent} icon="?" label="Key" onClick={() => setLegendOpen((v) => !v)} />
            </>
          } />
      )}

      {/* The BRIEF — the ORIGIN (step 0), above the tree. The seed (logline) below is derived from it.
          Collapses once past the premise stage (#4) — it's reference by then, not active work. */}
      <BriefOrigin brief={brief} onSave={saveBrief} open={briefOpen} onToggleOpen={setBriefOpen} />

      {/* Tree */}
      <div style={{ paddingTop: 8, paddingBottom: timelineOpen ? 220 : 48 }}>
        {roots.map((root) => (
          <Subtree key={root.id} node={root} index={index} nodes={nodes} depth={0}
            collapsedSet={collapsedSet} openSet={openSet}
            h={{ onToggle: toggleNode, onToggleDetail: toggleDetail, onAdd: addNode, onDelete: removeNode, onJump: jumpTo, dragId, onDragStart: setDragId, onDragEnd: () => setDragId(null), onDrop: onDropReorder, backlinks, flashId, proposal: proposalView, issuesByNode, contextId, ctxConsumes, ctxConsumedBy, onContextFocus: focusContext, seq, searchPattern, proseOpenSet, onToggleProse: toggleProse, onDiscardStory: discardStory, onAttachNode: attachNode, onOpenProseReader: setProseReaderSceneId, onOpenDetails: setDetailsNodeId }} />
        ))}
      </div>
      </>)}
      {proseReaderSceneId && nodes && (
        <ProseReaderModal
          sceneId={proseReaderSceneId}
          nodes={nodes}
          onClose={() => setProseReaderSceneId(null)}
          onAttachNode={attachNode}
        />
      )}
    </div>
  );
}
