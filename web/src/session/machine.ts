import type { MeetingState } from "../storage/db.js";

/** Transiciones válidas (data-model.md). Cualquier otra es un error de programación. */
const TRANSITIONS: Record<MeetingState, readonly MeetingState[]> = {
  recording: ["finalizing"],
  finalizing: ["queued"],
  queued: ["processing", "queued"],
  processing: ["saved", "partially_saved", "queued", "failed"],
  partially_saved: ["processing", "queued"],
  failed: ["queued"],
  saved: ["processing", "saved"],
};

export function canTransition(from: MeetingState, to: MeetingState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Juntas que hay que retomar al abrir la app (cierre de pestaña, sin red, puente apagado). */
export function needsRecovery(state: MeetingState): boolean {
  return state === "recording" || state === "finalizing" || state === "queued" || state === "processing";
}
