/**
 * Audio Blocks Extension for TipTap
 * Adds data-audio-block attributes to rendered elements for audio highlighting
 * Uses same extraction logic as the edge function for consistency
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { extractAudioBlocks } from '@/utils/audioBlockExtractor';

export const AudioBlocks = Extension.create({
  name: 'audioBlocks',

  addGlobalAttributes() {
    return [
      {
        // Apply to all block-level nodes
        types: [
          'paragraph',
          'heading',
          'blockquote',
          'listItem',
          'codeBlock',
        ],
        attributes: {
          audioBlock: {
            default: null,
            parseHTML: element => element.getAttribute('data-audio-block'),
            renderHTML: attributes => {
              // Only add attribute if audioBlocks are enabled
              const enabled = localStorage.getItem('audio_blocks_enabled') === 'true';
              if (!enabled || attributes.audioBlock === null) {
                return {};
              }
              
              return {
                'data-audio-block': attributes.audioBlock,
              };
            },
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('audioBlocks'),
        appendTransaction: (transactions, oldState, newState) => {
          const tr = newState.tr;
          let modified = false;

          // Only add attributes if feature is enabled
          const enabled = localStorage.getItem('audio_blocks_enabled') === 'true';
          if (!enabled) {
            return null;
          }

          // Extract blocks using the same logic as the edge function
          const tiptapJSON = newState.doc.toJSON();
          const audioBlocks = extractAudioBlocks(tiptapJSON);
          
          // Create a map of text content to block index for matching
          const blockIndexMap = new Map<string, number>();
          audioBlocks.forEach(block => {
            blockIndexMap.set(block.textContent.trim(), block.index);
          });

          // Traverse the document and assign matching block indices
          newState.doc.descendants((node, pos) => {
            if (
              node.isBlock &&
              (node.type.name === 'paragraph' ||
                node.type.name === 'heading' ||
                node.type.name === 'blockquote' ||
                node.type.name === 'listItem' ||
                node.type.name === 'codeBlock')
            ) {
              // Check if node has text content
              const hasContent = node.textContent.trim().length > 0;
              
              if (hasContent) {
                const nodeText = node.textContent.trim();
                const blockIndex = blockIndexMap.get(nodeText);
                
                if (blockIndex !== undefined && node.attrs.audioBlock !== blockIndex) {
                  tr.setNodeMarkup(pos, undefined, {
                    ...node.attrs,
                    audioBlock: blockIndex,
                  });
                  modified = true;
                }
              }
            }
            return true;
          });

          return modified ? tr : null;
        },
      }),
    ];
  },
});

