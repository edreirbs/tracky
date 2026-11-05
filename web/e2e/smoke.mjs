// E2E de grabación (spec 001, NFR-001): Chromium con micrófono simulado (WAV) → VAD → puente local
// (motor "fake") → API y Supabase simulados. Uso: node e2e/smoke.mjs <url-app> <archivo-wav> <codigo-emparejamiento> [modo]
import { createRequire } from "node:module";
// Playwright viene preinstalado globalmente (NODE_PATH) o como devDependency.
const { chromium } = createRequire(import.meta.url)("playwright");
const { installFakeBackend, makeDb } = await import("./fake-backend.mjs");

// 4.º argumento "early": detener a mitad de una frase (el último fragmento sale del flush al detener).
// 4.º argumento "enroll": registra la voz (30 s) y luego graba como "native" (`--speakers fake`).
// 4.º argumento "native": junta en línea con el audio de los demás desde el puente (`--system-audio fake`).
const [appUrl, wav, pairCode, mode] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`, "--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({ permissions: ["microphone"] });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
let noteBody = null;

const db = makeDb();
await installFakeBackend(context, db);
// La nota: el backend real resume en segundo plano; aquí se responde "done" de inmediato.
await context.route((u) => u.pathname === "/v1/notes", async (route) => {
  noteBody = JSON.parse(route.request().postData());
  const result = { noteId: "c0000000-0000-4000-8000-000000000009", title: "Prueba – E2E", tag: "Proyecto Aula", tagConfidence: 0.9, tagAlternatives: [], estado: "Normal", templateId: "general", model: "claude-opus-5-5", usage: null, summaryPending: false, actionItems: [] };
  return route.fulfill({ status: 202, json: { meetingId: noteBody.meetingId, status: "done", event: { event: "done", result } } });
});

await page.goto(`${appUrl}/#grabar`);
await page.getByText("Empareja el puente").waitFor({ timeout: 15000 });
await page.getByLabel("Código").fill(pairCode);
await page.getByRole("button", { name: "Emparejar" }).click();
await page.getByText("Whisper listo").waitFor({ timeout: 15000 });

if (mode === "enroll") {
  await page.getByRole("button", { name: /registra tu voz/ }).click();
  await page.getByText(/Lee en voz alta/).waitFor({ timeout: 10000 });
  await page.getByText(/Tu voz está registrada/).waitFor({ timeout: 60000 });
}
if (mode === "native" || mode === "enroll") {
  await page.getByRole("radio", { name: /En línea/ }).click();
  await page.getByLabel("Audio de los demás").waitFor({ timeout: 5000 });
} else {
  await page.getByRole("radio", { name: /En persona/ }).click();
}
await page.getByRole("button", { name: /Grabar/ }).click();
await page.getByText("● Grabando").waitFor({ timeout: 15000 });
if (mode === "early") await page.waitForTimeout(4000);
else await page.getByText(/fragmento de prueba/).first().waitFor({ timeout: 30000 });
if (mode === "native" || mode === "enroll") await page.waitForTimeout(6000); // varias frases del tono simulado del sistema
await page.getByLabel("Nota rápida").fill("Revisar presupuesto");
await page.keyboard.press("Enter");
await page.screenshot({ path: `${process.env.SHOTS ?? "e2e"}/grabando.png` });
await page.getByRole("button", { name: /Detener/ }).click();
await page.getByText("Abrir la nota").waitFor({ timeout: 60000 });
await page.screenshot({ path: `${process.env.SHOTS ?? "e2e"}/grabacion-guardada.png` });

console.log(JSON.stringify({
  segments: noteBody?.transcript?.length,
  speakers: [...new Set((noteBody?.transcript ?? []).map((s) => `${s.channel}:${s.speaker ?? "-"}`))],
  channels: [...new Set((noteBody?.transcript ?? []).map((s) => s.channel))],
  first: noteBody?.transcript?.[0],
  manualNotes: noteBody?.manualNotes,
  transcription: noteBody?.transcription,
  durationSec: noteBody?.durationSec,
  errors,
}, null, 2));
await browser.close();
