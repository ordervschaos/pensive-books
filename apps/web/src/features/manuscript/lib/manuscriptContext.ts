// One pure contract shared with the edge function; neither side trusts browser-provided names.
export { canvasSnapshot } from "../../../../../../supabase/functions/manuscript-agent/canvas";
export type { CanvasSnapshot, ManuscriptCanvas } from "../../../../../../supabase/functions/manuscript-agent/canvas";
