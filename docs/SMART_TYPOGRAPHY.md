# Smart Typography Guide

The Pensive editor includes automatic smart typography replacements that convert common typing patterns into proper typographic characters in real-time.

## How It Works

As you type in the editor, certain character combinations are automatically replaced with their typographically correct equivalents. This happens instantly and seamlessly, improving the visual quality of your writing without any extra effort.

## Available Replacements

### Dashes

| You Type | You Get | Character Name | Use Case |
|----------|---------|----------------|----------|
| `--` | `—` | Em dash | Parenthetical breaks—like this—in sentences |

**Examples:**
- Type: `This is great--really great`
- Result: `This is great—really great`

### Ellipsis

| You Type | You Get | Character Name | Use Case |
|----------|---------|----------------|----------|
| `...` | `…` | Ellipsis | Trailing off or omitted text |

**Examples:**
- Type: `I was thinking...`
- Result: `I was thinking…`

### Fractions

| You Type | You Get | Character Name |
|----------|---------|----------------|
| `1/2` | `½` | One half |
| `1/4` | `¼` | One quarter |
| `3/4` | `¾` | Three quarters |

**Examples:**
- Type: `Add 1/2 cup of sugar`
- Result: `Add ½ cup of sugar`

### Arrows

| You Type | You Get | Character Name | Use Case |
|----------|---------|----------------|----------|
| `->` | `→` | Right arrow | Showing direction or flow |
| `<-` | `←` | Left arrow | Showing backward direction |
| `<->` | `↔` | Bidirectional arrow | Two-way relationships |
| `=>` | `⇒` | Right double arrow | Logical implication |

**Examples:**
- Type: `Step 1 -> Step 2 -> Step 3`
- Result: `Step 1 → Step 2 → Step 3`
- Type: `A => B means if A then B`
- Result: `A ⇒ B means if A then B`

### Math & Logic Symbols

| You Type | You Get | Character Name | Use Case |
|----------|---------|----------------|----------|
| `+-` | `±` | Plus-minus | Tolerances, margins of error |
| `!=` | `≠` | Not equal | Mathematical inequality |
| `<=` | `≤` | Less than or equal | Mathematical comparison |
| `>=` | `≥` | Greater than or equal | Mathematical comparison |

**Examples:**
- Type: `Temperature: 20+-2 degrees`
- Result: `Temperature: 20±2 degrees`
- Type: `x != y`
- Result: `x ≠ y`
- Type: `score >= 90`
- Result: `score ≥ 90`

### Legal & Brand Symbols

| You Type | You Get | Character Name | Use Case |
|----------|---------|----------------|----------|
| `(c)` | `©` | Copyright | Copyright notices |
| `(r)` | `®` | Registered trademark | Registered trademarks |
| `(tm)` | `™` | Trademark | Trademarks |

**Examples:**
- Type: `Copyright (c) 2025`
- Result: `Copyright © 2025`
- Type: `iPhone(r) is a product of Apple(tm)`
- Result: `iPhone® is a product of Apple™`

## Tips & Tricks

### When You DON'T Want Replacement

If you need to type the literal characters without replacement (for example, in code blocks or technical documentation), you can:

1. **Use code blocks** - Smart typography is disabled in code blocks
2. **Use inline code** - Surround text with backticks: \`--\` will display as `--`
3. **Undo** - Press `Cmd+Z` (Mac) or `Ctrl+Z` (Windows) immediately after the replacement to revert

### Best Practices

1. **Em Dashes**: Use em dashes—without spaces—for parenthetical breaks
2. **Math Symbols**: Great for technical writing without switching to LaTeX
3. **Arrows**: Perfect for diagrams, flowcharts, and process documentation
4. **Fractions**: Use common fractions for recipes and measurements

## Technical Details

The smart typography feature is implemented as a custom TipTap extension using:
- **Input Rules**: Detect patterns as you type and replace them immediately
- **ProseMirror Plugins**: Backup system that catches any patterns that slip through

The replacements happen client-side in your browser and are stored in the document as the actual Unicode characters, ensuring they display correctly everywhere.

## Disabling Smart Typography

If you prefer not to use smart typography, you can remove or comment out the `SmartTypography` extension from the editor configuration:

```typescript
// In src/components/editor/config/editorConfig.ts
extensions: [
  Title,
  // SmartTypography,  // Comment this line to disable
  StarterKit.configure({
    // ...
  }),
  // ...
]
```

## Future Enhancements

Potential additions we could make:
- En dash (`–`) for ranges: `pages 10-20` → `pages 10–20`
- More fractions: `1/3`, `2/3`, `1/8`, etc.
- Multiplication sign: `2x3` → `2×3`
- Degrees: `90deg` → `90°`
- Prime marks for feet/inches: `5'10"` → `5′10″`
- En-space and em-space for proper spacing
- Superscripts and subscripts for common patterns

---

**Last Updated**: October 2025
