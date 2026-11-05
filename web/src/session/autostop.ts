/**
 * ¿Terminó la junta en línea? (ADR-0012). Señales, de la más fiable a la de respaldo:
 * 1. Se dejó de compartir la pestaña/pantalla de la junta → terminó.
 * 2. Una app de videollamada (Teams, Zoom…) tenía el micrófono abierto y lo soltó hace `graceMs`.
 * 3. Si nunca se vio una app de llamada (p. ej. Meet en el navegador): `silenceMs` sin sonido de los demás.
 * Los tiempos son de la junta (sin pausas), en ms.
 */
export class CallEndDetector {
  private seenCall = false;
  private lastCallMs = 0;
  private resetAtMs = 0;

  constructor(
    private readonly graceMs = 8_000,
    private readonly silenceMs = 5 * 60_000,
    private readonly minMeetingMs = 2 * 60_000,
  ) {}

  /** `callApps`: null si el puente no puede saberlo. Devuelve true si la junta parece haber terminado. */
  update(nowMs: number, callApps: readonly string[] | null, lastOtherSoundMs: number, shareEnded: boolean): boolean {
    if (shareEnded) return true;
    if (callApps && callApps.length > 0) {
      this.seenCall = true;
      this.lastCallMs = nowMs;
      return false;
    }
    if (this.seenCall) return callApps !== null && nowMs - this.lastCallMs >= this.graceMs;
    return nowMs >= this.minMeetingMs && nowMs - Math.max(lastOtherSoundMs, this.resetAtMs) >= this.silenceMs;
  }

  /** El usuario eligió seguir grabando: olvida la llamada vista y reinicia el respaldo por silencio. */
  reset(nowMs: number): void {
    this.seenCall = false;
    this.resetAtMs = nowMs;
  }
}
