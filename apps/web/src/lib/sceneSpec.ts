// sceneSpec — the structured form behind the studio's "Scene" rail editor. Instead of one freeform
// prompt blob, a page's scene is authored as a SPEC: a list of subjects (each a character with an
// editable build/clothing/expression/action) plus the scene-wide fields. The AI composer SEEDS the
// spec from the beat + cast; the author then edits any field. At render time `specToPrompt` flattens
// the spec into the same 8 labelled lines the image pipeline already renders verbatim — so the render
// path is untouched and the spec is the single editable source of truth (persisted on pages.scene_spec).

export interface SceneSubject {
  /** The character (usually a cast name, but free to add an unnamed subject). The focal subject is first. */
  name: string;
  /** Physique / size — height, build, age read. */
  build?: string;
  /** What they're wearing. */
  clothing?: string;
  /** Their expression in this moment. */
  expression?: string;
  /** What they are doing in this moment. */
  action?: string;
  /** The character's Foundations portraits chosen to condition this render for likeness. `undefined` =
   *  untouched (the editor defaults to the first portrait); an explicit array (incl. []) = author's pick. */
  refImages?: string[];
}

export interface SceneSpec {
  /** Subjects in the frame; the FIRST is the focal character (built around), the rest subordinate. */
  subjects: SceneSubject[];
  setting?: string;
  /** The single moment being depicted. */
  action?: string;
  composition?: string;
  lighting?: string;
  mood?: string;
  exclude?: string;
}

export const EMPTY_SPEC: SceneSpec = { subjects: [] };

export const DEFAULT_EXCLUDE =
  "no text, captions, watermarks, or signatures; no posed group line-up or symmetrically spaced cast; no one posing for or looking at the camera";

/** Normalise an unknown value (DB row / AI output) into a well-formed SceneSpec. */
export function asSpec(value: unknown): SceneSpec {
  const v = (value ?? {}) as Partial<SceneSpec>;
  const subjects = Array.isArray(v.subjects)
    ? v.subjects
        .map((s) => ({
          name: String((s as SceneSubject)?.name ?? "").trim(),
          build: str((s as SceneSubject)?.build),
          clothing: str((s as SceneSubject)?.clothing),
          expression: str((s as SceneSubject)?.expression),
          action: str((s as SceneSubject)?.action),
          refImages: Array.isArray((s as SceneSubject)?.refImages)
            ? (s as SceneSubject).refImages!.filter((u): u is string => typeof u === "string" && !!u.trim())
            : undefined,
        }))
        .filter((s) => s.name || s.build || s.clothing || s.expression || s.action)
    : [];
  return {
    subjects,
    setting: str(v.setting),
    action: str(v.action),
    composition: str(v.composition),
    lighting: str(v.lighting),
    mood: str(v.mood),
    exclude: str(v.exclude),
  };
}

const str = (x: unknown): string | undefined => {
  const t = typeof x === "string" ? x.trim() : "";
  return t || undefined;
};

/** A subject rendered as one clause: "Name (build), wearing clothing — expression, action." */
function subjectClause(s: SceneSubject, focal: boolean): string {
  const parens = [s.build].filter(Boolean).join(", ");
  const head = parens ? `${s.name} (${parens})` : s.name;
  const tail = [
    s.clothing ? `wearing ${s.clothing}` : null,
    s.expression,
    s.action,
  ].filter(Boolean).join(", ");
  const body = tail ? `${head} — ${tail}` : head;
  return focal ? body : `In the background, ${body}`;
}

/** True when the spec has nothing worth rendering yet (used to gate the Generate button + auto-compose). */
export function isSpecEmpty(spec: SceneSpec): boolean {
  if (spec.subjects.some((s) => s.name || s.action || s.expression)) return false;
  return !(spec.setting || spec.action || spec.composition || spec.lighting || spec.mood);
}

/** Flatten the spec → the 8 labelled lines the image pipeline renders verbatim. `style` is the book's
 *  house-look text (the STYLE line); it is NOT stored in the spec so a re-style never rewrites it. */
export function specToPrompt(spec: SceneSpec, style?: string): string {
  const subjects = spec.subjects.filter((s) => s.name || s.build || s.clothing || s.expression || s.action);
  const subjectLine = subjects.length
    ? subjects.map((s, i) => subjectClause(s, i === 0)).join(" ")
    : "the scene's focal moment";
  const styleLine = style?.trim()
    || "cinematic, painterly digital illustration with a rich, atmospheric, naturalistic palette";

  const lines: [string, string | undefined][] = [
    ["SUBJECT", subjectLine],
    ["SETTING", spec.setting],
    ["ACTION", spec.action],
    ["COMPOSITION", spec.composition],
    ["LIGHTING", spec.lighting],
    ["MOOD", spec.mood],
    ["STYLE", styleLine],
    ["EXCLUDE", spec.exclude?.trim() || DEFAULT_EXCLUDE],
  ];
  return lines
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `${k}: ${v!.trim()}`)
    .join("\n");
}
