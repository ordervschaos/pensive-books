import { Node, mergeAttributes } from '@tiptap/core'

export const Title = Node.create({
  name: 'title',
  group: 'block',
  content: 'text*',
  parseHTML() {
    return [{ tag: 'h1.page-title' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['h1', mergeAttributes(HTMLAttributes, { class: 'page-title text-4xl font-bold mb-8' }), 0]
  },
}) 