#!/usr/bin/env node
// Genera módulos TypeScript a partir de prompts/*.md.
// Los prompts son código versionado (prompts/README.md): el backend los empaqueta con su hash.
// Las etiquetas ya no viven aquí: cada usuario define las suyas en Supabase (spec 005, FR-409).
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw.trim() };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: m[2].trim() };
}

const system = parseFrontmatter(readFileSync(join(root, "prompts/system-summary.md"), "utf8"));
const assistant = parseFrontmatter(readFileSync(join(root, "prompts/assistant.md"), "utf8"));
const taskParse = parseFrontmatter(readFileSync(join(root, "prompts/task-parse.md"), "utf8"));

const templatesDir = join(root, "prompts/templates");
const templates = readdirSync(templatesDir)
  .filter((f) => f.endsWith(".md"))
  .sort()
  .map((f) => {
    const { meta, body } = parseFrontmatter(readFileSync(join(templatesDir, f), "utf8"));
    if (!meta.id || !meta.nombre) throw new Error(`Plantilla sin id/nombre: ${f}`);
    return { id: meta.id, nombre: meta.nombre, descripcion: meta.descripcion ?? "", body };
  });


const hash = createHash("sha256")
  .update(JSON.stringify({ system, assistant, taskParse, templates }))
  .digest("hex")
  .slice(0, 12);

const header = "// AUTO-GENERADO por scripts/gen-prompts.mjs. No editar a mano.\n";

const workerOut = join(root, "worker/src/generated/prompts.ts");
mkdirSync(dirname(workerOut), { recursive: true });
writeFileSync(
  workerOut,
  `${header}
export const PROMPTS_VERSION = ${JSON.stringify(`${system.meta.version ?? "0"}+${hash}`)};
export const SYSTEM_PROMPT: string = ${JSON.stringify(system.body)};
export const TEMPLATES: Record<string, { nombre: string; descripcion: string; body: string }> = ${JSON.stringify(
    Object.fromEntries(templates.map((t) => [t.id, { nombre: t.nombre, descripcion: t.descripcion, body: t.body }])),
    null,
    2,
  )};
export const ASSISTANT_PROMPT: string = ${JSON.stringify(assistant.body)};
export const TASK_PARSE_PROMPT: string = ${JSON.stringify(taskParse.body)};
`,
);

const webOut = join(root, "web/src/generated/templates.ts");
mkdirSync(dirname(webOut), { recursive: true });
writeFileSync(
  webOut,
  `${header}
export const TEMPLATES: ReadonlyArray<{ id: string; nombre: string; descripcion: string }> = ${JSON.stringify(
    templates.map(({ id, nombre, descripcion }) => ({ id, nombre, descripcion })),
    null,
    2,
  )};
`,
);

console.warn(`prompts ${hash}: ${templates.length} plantillas`);
