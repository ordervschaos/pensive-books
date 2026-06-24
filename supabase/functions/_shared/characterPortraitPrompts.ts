// characterPortraitPrompts — the shared craft for composing a character REFERENCE PORTRAIT prompt. Used by
// both the foundations-cast flow (generate-character-portrait) and the node-keyed picture-book flow
// (generate-dna-character-portrait). The craft (the labelled-line portrait contract + the no-AI fallback)
// is identical; only WHERE the character record comes from differs (foundations.cast vs a book_nodes node).

export const PORTRAIT_SYSTEM = `You compose ONE structured image prompt for a character REFERENCE PORTRAIT for a novel. The author will edit it, then it is sent VERBATIM to an image model — so it must be complete and self-contained.

Given the character's name, role, appearance, and inner life, output EXACTLY these labelled lines, in this order, each on its own line, nothing before or after:

SUBJECT: the character's face, apparent age, build, hair, and distinguishing features, their typical dress, and an expression that reflects who they are — a believable, specific person.
FRAMING: head-and-shoulders character reference portrait.
BACKGROUND: neutral, with even soft lighting.
STYLE: the rendering look. If a HOUSE LOOK is given, this line MUST honour it; otherwise default to photorealistic. Keep features consistent and suitable as a reusable reference.
EXCLUDE: no text, captions, watermarks, or signatures.

Weave any author art direction into the relevant lines.`;

// The character fields the portrait composer reads — sourced from foundations.cast OR a DNA character node.
export interface PortraitSubject { name: string; role?: string; appearance?: string; want?: string; wound?: string }

// Fallback when the author renders WITHOUT composing a prompt — mirrors the structured format so a no-AI
// portrait still carries the framing/background/exclude guidance the composer would have written.
export const fallbackPortrait = (m: PortraitSubject, houseLook: string): string =>
  [
    `SUBJECT: ${m.name}${m.appearance?.trim() ? ` — ${m.appearance.trim()}` : ""}, an expression true to who they are.`,
    "FRAMING: head-and-shoulders character reference portrait.",
    "BACKGROUND: neutral, with even soft lighting.",
    `STYLE: ${houseLook || "photorealistic"}, consistent features suitable as a reusable reference.`,
    "EXCLUDE: no text, captions, watermarks, or signatures.",
  ].join("\n");

// The user-content block the composer reads, built from the character record + house look + art direction.
export const portraitUserContent = (m: PortraitSubject, houseLook: string, instruction?: string): string =>
  [
    `NAME: ${m.name}`,
    m.role ? `ROLE: ${m.role}` : null,
    m.appearance?.trim() ? `APPEARANCE: ${m.appearance.trim()}` : null,
    m.want?.trim() ? `WANTS: ${m.want.trim()}` : null,
    m.wound?.trim() ? `WOUND (informs expression): ${m.wound.trim()}` : null,
    houseLook ? `HOUSE LOOK (the book's settled visual style — the STYLE line MUST honour this so the cast looks like one book): ${houseLook}` : null,
    instruction?.trim() ? `ART DIRECTION (author — honor this): ${instruction.trim()}` : null,
    "Write the portrait prompt.",
  ].filter(Boolean).join("\n");
