/**
 * Paragraph Objective extension for TipTap.
 *
 * Attaches an author-only "objective" (what this paragraph must achieve) to prose
 * blocks, as `data-objective` + `data-objective-id` attributes. Invisible to readers;
 * the author's planning + self-evaluation undercurrent. Opt-in — a block carries an
 * objective only once one is set.
 *
 * This is the DATA LAYER only. The `//` planning input-rule and the gutter affordance
 * (set/show/edit) are wired on top in the editor UI; both call `setObjective` /
 * `unsetObjective` below. Stripping the attributes from reader/EPUB/Kindle output is
 * handled at serialization, not here.
 *
 * Modeled on AudioBlocks.ts (addGlobalAttributes across block types) and
 * HeadingWithId.ts (attribute parseHTML/renderHTML).
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

// Prose blocks an author would annotate with an objective. Intentionally narrower than
// AudioBlocks (no listItem/codeBlock) — an objective on those is rarely meaningful.
const OBJECTIVE_BLOCK_TYPES = ['paragraph', 'heading', 'blockquote'] as const;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphObjective: {
      /** Set the objective on the block at the current selection (generates a stable id). */
      setObjective: (objective: string) => ReturnType;
      /** Remove the objective (and its id) from the block at the current selection. */
      unsetObjective: () => ReturnType;
    };
  }
}

export const ParagraphObjective = Extension.create({
  name: 'paragraphObjective',

  // Run our Enter handler before StarterKit's paragraph-split. It returns false for any
  // line that isn't a `// …` objective, so normal Enter and the page-link popup are
  // unaffected. (editorConfig loads this extension early, i.e. at lower array priority.)
  priority: 1000,

  addGlobalAttributes() {
    return [
      {
        types: [...OBJECTIVE_BLOCK_TYPES],
        attributes: {
          objective: {
            default: null,
            parseHTML: element => element.getAttribute('data-objective'),
            renderHTML: attributes =>
              attributes.objective ? { 'data-objective': attributes.objective } : {},
          },
          objectiveId: {
            default: null,
            parseHTML: element => element.getAttribute('data-objective-id'),
            renderHTML: attributes =>
              attributes.objectiveId ? { 'data-objective-id': attributes.objectiveId } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    // Walk up from the selection to the nearest block that supports objectives, and
    // apply `patch` to its attrs. Returns false if no such block is found.
    const updateNearestBlock =
      (patch: (attrs: Record<string, unknown>) => Record<string, unknown>) =>
      ({ state, dispatch }: { state: import('@tiptap/pm/state').EditorState; dispatch?: (tr: import('@tiptap/pm/state').Transaction) => void }) => {
        const { $from } = state.selection;
        for (let depth = $from.depth; depth > 0; depth--) {
          const node = $from.node(depth);
          if ((OBJECTIVE_BLOCK_TYPES as readonly string[]).includes(node.type.name)) {
            if (dispatch) {
              const pos = $from.before(depth);
              dispatch(state.tr.setNodeMarkup(pos, undefined, patch({ ...node.attrs })));
            }
            return true;
          }
        }
        return false;
      };

    return {
      setObjective:
        (objective: string) =>
        props =>
          updateNearestBlock(attrs => ({
            ...attrs,
            objective,
            // Preserve an existing id; mint one the first time an objective is attached.
            objectiveId: (attrs.objectiveId as string | null) ?? crypto.randomUUID(),
          }))(props),

      unsetObjective:
        () =>
        props =>
          updateNearestBlock(attrs => ({ ...attrs, objective: null, objectiveId: null }))(props),
    };
  },

  addKeyboardShortcuts() {
    return {
      // Planning trigger: type `// <objective>` on its own line, press Enter, and the
      // line becomes an empty paragraph whose objective is that text — ready for prose.
      // (`>` is taken by blockquote; `//` reads as "a comment, not part of the output".)
      Enter: () => {
        const { editor } = this;
        const { $from, empty } = editor.state.selection;
        if (!empty) return false;
        const block = $from.parent;
        if (block.type.name !== 'paragraph' || block.attrs.objective) return false;
        const match = block.textContent.match(/^\/\/\s+(.+\S)\s*$/);
        if (!match) return false;

        const blockPos = $from.before($from.depth);
        const contentStart = blockPos + 1;
        const contentEnd = blockPos + block.nodeSize - 1;
        const objectiveId = (block.attrs.objectiveId as string | null) ?? crypto.randomUUID();

        return editor
          .chain()
          .command(({ tr }) => {
            tr.delete(contentStart, contentEnd); // strip the "// …" text
            tr.setNodeMarkup(blockPos, undefined, {
              ...block.attrs,
              objective: match[1],
              objectiveId,
            });
            return true;
          })
          .setTextSelection(contentStart) // cursor back in the now-empty paragraph
          .run();
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('paragraphObjectiveDedup'),
        // An objectiveId is unique to one block. Pressing Enter splits a block and copies
        // its attrs to the new block, so the split-off paragraph would inherit the same
        // objective. Clear any block whose objectiveId duplicates an earlier one: the
        // original (first occurrence) keeps the objective, the new block starts clean.
        // setNodeMarkup doesn't change node sizes, so positions stay valid while mutating.
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some(t => t.docChanged)) return null;
          const seen = new Set<string>();
          const tr = newState.tr;
          let modified = false;
          newState.doc.descendants((node, pos) => {
            const id = node.attrs.objectiveId as string | null | undefined;
            if (!id) return true;
            if (seen.has(id)) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, objective: null, objectiveId: null });
              modified = true;
            } else {
              seen.add(id);
            }
            return true;
          });
          return modified ? tr : null;
        },
      }),
    ];
  },
});
