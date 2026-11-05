// E2E de la interfaz de Tracky (specs 002–004) con Supabase y API simulados.
// Uso: VITE_SUPABASE_URL=https://fake.supabase.co VITE_SUPABASE_PUBLISHABLE_KEY=x pnpm --filter @tracky/web exec vite build
//      pnpm --filter @tracky/web exec vite preview --port 4173 &   node e2e/tracky.mjs http://localhost:4173 [carpeta-capturas]
import { createRequire } from "node:module";
import { installFakeBackend, makeDb } from "./fake-backend.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const [appUrl = "http://localhost:4173", shots = "e2e"] = process.argv.slice(2);

const browser = await chromium.launch();
const failures = [];
async function run(name, viewport, fn) {
  const context = await browser.newContext({ viewport, locale: "es-MX", timezoneId: "America/Mexico_City" });
  const db = makeDb();
  const calls = [];
  await installFakeBackend(context, db, calls);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  try {
    await page.goto(appUrl);
    await page.getByRole("heading", { name: "Tablero" }).waitFor({ timeout: 15000 });
    await fn(page, db, calls);
    if (errors.length) throw new Error(`Errores en la página: ${errors.join(" | ")}`);
    console.warn(`✓ ${name}`);
  } catch (e) {
    failures.push(name);
    console.error(`✗ ${name}: ${e instanceof Error ? e.message : e}`);
    await page.screenshot({ path: `${shots}/fallo-${name.replace(/\W+/g, "-")}.png`, fullPage: true });
  } finally {
    await context.close();
  }
}

const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

await run("tablero: máximo 3 en Ahora, Siguientes y Esperando", { width: 1280, height: 900 }, async (page) => {
  await page.getByText("Mandar la minuta por correo al comité").waitFor();
  await page.getByText("Firma de jurídico").first().waitFor();
  expect(await page.getByText("1 de 3").isVisible(), "contador de Ahora");
  await page.getByText(/¿Ya te respondió Jurídico\?/).waitFor();
  await page.screenshot({ path: `${shots}/tablero.png` });
});

await run("cargador: Enter guarda, chips de Claude, @persona", { width: 1280, height: 900 }, async (page, db, calls) => {
  const input = page.getByLabel("¿Qué tienes en mente?");
  await page.keyboard.press("n");
  expect(await input.evaluate((el) => el === document.activeElement), "N enfoca la captura");
  await input.fill("llamar a laura mañana por lo de la sala");
  await page.keyboard.press("Enter");
  await page.getByText("Guardada en Bandeja").waitFor();
  await page.getByRole("button", { name: /📅 mañana/ }).waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: /me esperan/ }).waitFor();
  expect(calls.includes("API /v1/tasks/parse"), "pidió sugerencias");
  const t = db.tasks.find((x) => x.text === "llamar a laura mañana por lo de la sala");
  expect(t && t.status === "inbox", "tarea guardada en la Bandeja");
  await page.waitForTimeout(300);
  expect(t.person_id === "p1" && t.blocking === true && t.due, "sugerencias aplicadas");
  await page.screenshot({ path: `${shots}/cargador.png` });
  // Quitar una sugerencia con un clic
  await page.getByRole("button", { name: /me esperan/ }).click();
  await page.waitForTimeout(300);
  expect(t.blocking === false, "chip revierte la sugerencia");
});

await run("procesar: una tarjeta, tres preguntas, a Ahora", { width: 1280, height: 900 }, async (page, db) => {
  await page.getByRole("tab", { name: /Procesar/ }).click();
  await page.getByText("1. ¿Cuál es la siguiente acción física?").waitFor();
  await page.getByLabel(/siguiente acción física/).fill("Escribirle a Luis para reservar la sala 3");
  await page.screenshot({ path: `${shots}/procesar.png` });
  await page.getByRole("button", { name: "→ Ahora" }).click();
  await page.getByText("Bandeja vacía").waitFor();
  const t = db.tasks.find((x) => x.text === "lo de la sala");
  expect(t.status === "now" && t.action === "Escribirle a Luis para reservar la sala 3", "procesada a Ahora");
});

await run("terminar: confeti, monedas y deshacer", { width: 1280, height: 900 }, async (page, db) => {
  const before = db.wallet.balance;
  await page.getByRole("button", { name: "✓ Terminar" }).first().click();
  await page.locator("canvas.celebrate-canvas").waitFor({ timeout: 1000 });
  await page.locator(".reward-pop").waitFor({ timeout: 3000 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${shots}/celebracion.png` });
  expect(db.wallet.balance > before, "se cobraron monedas");
  await page.getByText(/Hecho hoy/).first().waitFor();
  expect((await page.locator(".coins").innerText()).includes(String(db.wallet.balance)), "saldo actualizado en el encabezado");
  await page.getByRole("button", { name: "Deshacer" }).click();
  await page.getByText(/Deshecho/).waitFor();
  expect(db.wallet.balance === before, "deshacer regresa las monedas");
});

await run("sapo: fiesta", { width: 1280, height: 900 }, async (page) => {
  await page.getByRole("button", { name: "→ Ahora" }).nth(1).click();
  await page.getByRole("button", { name: "✓ Terminar" }).nth(1).click();
  await page.locator(".reward-pop.party").waitFor({ timeout: 3000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${shots}/fiesta-sapo.png` });
});

await run("monedas: canjear por tiempo libre", { width: 1280, height: 900 }, async (page, db) => {
  await page.locator(".coins").click();
  await page.getByText("Canjear por tiempo libre").waitFor();
  await page.getByRole("button", { name: "Canjear" }).first().click();
  await page.getByText(/Tiempo libre: disfrútalo/).waitFor();
  expect(db.wallet.balance === 10, "descuenta el costo");
  await page.screenshot({ path: `${shots}/monedas.png`, fullPage: true });
});

await run("pregúntale a Tracky: respuesta con cita y propuesta", { width: 1280, height: 900 }, async (page, db) => {
  await page.getByRole("button", { name: /Pregúntale a Tracky/ }).click();
  await page.getByRole("button", { name: /¿Qué hago ahora\?/ }).click();
  await page.getByText("¿Lo hago?").waitFor();
  await page.screenshot({ path: `${shots}/preguntale.png` });
  await page.getByRole("button", { name: "Sí, hazlo" }).click();
  await page.getByText("Hecho ✓").waitFor();
  expect(db.tasks.some((t) => t.text === "Pedir cotización final a Luis" && t.source === "assistant"), "creó la tarea propuesta");
  await page.getByRole("button", { name: "Proyecto Aula – Cotización de proyectores" }).click();
  await page.getByText("Acuerdos → tareas").waitFor();
});

await run("notas: lista, detalle y acuerdos a tareas", { width: 1280, height: 900 }, async (page, db) => {
  await page.getByRole("tab", { name: "Notas" }).click();
  await page.getByText("Proyecto Aula – Cotización de proyectores").click();
  await page.getByText("tres cotizaciones").waitFor();
  await page.screenshot({ path: `${shots}/nota.png`, fullPage: true });
  await page.getByRole("button", { name: /Crear 1 tarea en la Bandeja/ }).click();
  await page.waitForTimeout(300);
  expect(db.tasks.some((t) => t.text === "Pedir cotización final" && t.source === "meeting" && t.person_id === "p2"), "acuerdo → tarea con persona");
});

await run("archivo y Ctrl+K", { width: 1280, height: 900 }, async (page) => {
  await page.getByRole("tab", { name: "Archivo" }).click();
  await page.getByText("Luis Pérez").waitFor();
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder(/Buscar tareas, notas/).fill("proyectores");
  await page.getByText("Revisar cotización de proyectores").waitFor();
  await page.screenshot({ path: `${shots}/buscar.png` });
});

await run("móvil 390 px sin scroll horizontal", { width: 390, height: 844 }, async (page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow <= 0, `scroll horizontal de ${overflow}px`);
  await page.screenshot({ path: `${shots}/movil.png`, fullPage: true });
});

await browser.close();
if (failures.length) {
  console.error(`${failures.length} fallaron`);
  process.exit(1);
}
console.warn("E2E de interfaz: todo bien");
