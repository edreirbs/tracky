export interface MicDevice {
  deviceId: string;
  label: string;
}

export async function listMics(): Promise<MicDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "audioinput")
    .map((d) => ({ deviceId: d.deviceId, label: d.label || "Micrófono" }));
}

/** Micrófono: el predeterminado del sistema salvo que el usuario elija otro. */
export async function openMic(deviceId?: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId && deviceId !== "default" ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
    video: false,
  });
}

export class NoSharedAudioError extends Error {
  constructor() {
    super("No se compartió audio. Al elegir la pestaña o pantalla, activa “Compartir audio”.");
  }
}

export type PlatformHint = "teams" | "zoom" | "meet" | "other" | null;

export function platformFromLabel(label: string): PlatformHint {
  const l = label.toLowerCase();
  if (l.includes("teams")) return "teams";
  if (l.includes("zoom")) return "zoom";
  if (l.includes("meet")) return "meet";
  return label ? "other" : null;
}

/**
 * Audio de los demás: el navegador SIEMPRE muestra el diálogo de compartir (restricción de
 * seguridad). En Mac lo fiable es compartir la pestaña de Teams/Zoom/Meet web con audio.
 */
export async function openSystemAudio(): Promise<{ stream: MediaStream; platform: PlatformHint }> {
  const options: DisplayMediaStreamOptions & Record<string, unknown> = {
    video: { frameRate: 1, width: 320, height: 180 },
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    systemAudio: "include",
    selfBrowserSurface: "exclude",
    surfaceSwitching: "include",
    preferCurrentTab: false,
  };
  const display = await navigator.mediaDevices.getDisplayMedia(options);
  const videoLabel = display.getVideoTracks()[0]?.label ?? "";
  // No grabamos pantalla: el video se descarta en cuanto llega.
  display.getVideoTracks().forEach((t) => {
    t.stop();
    display.removeTrack(t);
  });
  if (display.getAudioTracks().length === 0) {
    throw new NoSharedAudioError();
  }
  return { stream: display, platform: platformFromLabel(videoLabel) };
}

export function onDeviceChange(cb: () => void): () => void {
  navigator.mediaDevices.addEventListener("devicechange", cb);
  return () => navigator.mediaDevices.removeEventListener("devicechange", cb);
}
