import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { InputRule } from '@tiptap/core';

/**
 * SmartTypography Extension
 * Automatically converts typing patterns into proper typography:
 *
 * Dashes:
 * - `--` → `—` (em dash) - for parenthetical breaks
 *
 * Ellipsis:
 * - `...` → `…` (proper ellipsis character)
 *
 * Fractions:
 * - `1/2` → `½`
 * - `1/4` → `¼`
 * - `3/4` → `¾`
 *
 * Arrows:
 * - `->` → `→` (right arrow)
 * - `<-` → `←` (left arrow)
 * - `<->` → `↔` (bidirectional arrow)
 * - `=>` → `⇒` (right double arrow)
 *
 * Math & Symbols:
 * - `(c)` → `©` (copyright)
 * - `(r)` → `®` (registered trademark)
 * - `(tm)` → `™` (trademark)
 * - `+-` → `±` (plus-minus)
 * - `!=` → `≠` (not equal)
 * - `<=` → `≤` (less than or equal)
 * - `>=` → `≥` (greater than or equal)
 *
 * This extension uses TipTap's InputRule system to detect patterns
 * and replace them in real-time as the user types.
 */
export const SmartTypography = Extension.create({
  name: 'smartTypography',

  addInputRules() {
    return [
      // Em dash: -- → —
      new InputRule({
        find: /--$/,
        handler: ({ state, range }) => {
          const { tr } = state;
          tr.insertText('—', range.from, range.to);
        },
      }),

      // Ellipsis: ... → …
      new InputRule({
        find: /\.\.\.$/,
        handler: ({ state, range }) => {
          const { tr } = state;
          tr.insertText('…', range.from, range.to);
        },
      }),

      // Right arrow: -> → →
      new InputRule({
        find: /->$/,
        handler: ({ state, range }) => {
          const { tr } = state;
          tr.insertText('→', range.from, range.to);
        },
      }),

      // Left arrow: <- → ←
      new InputRule({
        find: /<-$/,
        handler: ({ state, range }) => {
          const { tr } = state;
          tr.insertText('←', range.from, range.to);
        },
      }),

      // Right double arrow: => → ⇒
      new InputRule({
        find: /=>$/,
        handler: ({ state, range }) => {
          const { tr } = state;
          tr.insertText('⇒', range.from, range.to);
        },
      }),

      // Bidirectional arrow: <-> → ↔
      new InputRule({
        find: /<->$/,
        handler: ({ state, range }) => {
          const { tr } = state;
          tr.insertText('↔', range.from, range.to);
        },
      }),

      // Copyright: (c) → ©
      new InputRule({
        find: /\(c\)$/i,
        handler: ({ state, range }) => {
          const { tr } = state;
          tr.insertText('©', range.from, range.to);
        },
      }),

      // Registered trademark: (r) → ®
      new InputRule({
        find: /\(r\)$/i,
        handler: ({ state, range }) => {
          const { tr } = state;
          tr.insertText('®', range.from, range.to);
        },
      }),

      // Trademark: (tm) → ™
      new InputRule({
        find: /\(tm\)$/i,
        handler: ({ state, range }) => {
          const { tr } = state;
          tr.insertText('™', range.from, range.to);
        },
      }),

      // Plus-minus: +- → ±
      new InputRule({
        find: /\+-$/,
        handler: ({ state, range }) => {
          const { tr } = state;
          tr.insertText('±', range.from, range.to);
        },
      }),

      // Not equal: != → ≠
      new InputRule({
        find: /!=$/,
        handler: ({ state, range }) => {
          const { tr } = state;
          tr.insertText('≠', range.from, range.to);
        },
      }),

      // Less than or equal: <= → ≤
      new InputRule({
        find: /<=$/,
        handler: ({ state, range }) => {
          const { tr } = state;
          tr.insertText('≤', range.from, range.to);
        },
      }),

      // Greater than or equal: >= → ≥
      new InputRule({
        find: />=$/,
        handler: ({ state, range }) => {
          const { tr } = state;
          tr.insertText('≥', range.from, range.to);
        },
      }),

      // Fraction 1/2 → ½
      new InputRule({
        find: /\b1\/2$/,
        handler: ({ state, range }) => {
          const { tr } = state;
          tr.insertText('½', range.from, range.to);
        },
      }),

      // Fraction 1/4 → ¼
      new InputRule({
        find: /\b1\/4$/,
        handler: ({ state, range }) => {
          const { tr } = state;
          tr.insertText('¼', range.from, range.to);
        },
      }),

      // Fraction 3/4 → ¾
      new InputRule({
        find: /\b3\/4$/,
        handler: ({ state, range }) => {
          const { tr } = state;
          tr.insertText('¾', range.from, range.to);
        },
      }),
    ];
  },

  // Backup: Plugin-based approach for edge cases
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('smartTypographyPlugin'),

        appendTransaction: (transactions, _oldState, newState) => {
          // Only process if there are actual document changes
          const docChanged = transactions.some(tr => tr.docChanged);
          if (!docChanged) return null;

          let modified = false;
          const tr = newState.tr;

          // Scan the document for any remaining -- patterns
          newState.doc.descendants((node, pos) => {
            if (node.isText && node.text) {
              const text = node.text;
              let index = 0;

              while ((index = text.indexOf('--', index)) !== -1) {
                const from = pos + index;
                const to = from + 2;

                tr.insertText('—', from, to);
                modified = true;

                // Move past this replacement
                index += 1;
              }
            }
          });

          return modified ? tr : null;
        },
      }),
    ];
  },
});
