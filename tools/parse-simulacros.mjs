// parse-simulacros.mjs — genera data/questions.json desde los 4 simulacros HTML
// + fusiona data/manual-questions.json y data/manual-cards.json.
// Ejecutar desde la carpeta app/:  node tools/parse-simulacros.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARTEFACTOS = resolve(APP, "..", "artefactos");

const TEMA_MAP = {
  "Elección de mecanismo": "mecanismos",
  "Skills (curso 1)": "skills",
  "Prioridad de skills": "skills",
  "Configuración": "skills",
  "Distribución": "skills",
  "Troubleshooting": "troubleshooting",
  "Troubleshooting skills": "troubleshooting",
  "Subagents": "subagents",
  "Context management": "contexto",
  "Steering": "claude-code",
  "CLAUDE.md": "claude-code",
  "Verificación": "claude-code",
  "Plugins": "claude-code",
  "Hooks": "hooks-permisos",
  "Permission modes": "hooks-permisos",
  "Automatización": "automatizacion",
  "GitHub Actions": "automatizacion",
};

const TEMAS = {
  "mecanismos":     { nombre: "Elección de mecanismo",   dominio: "Agentic Architecture" },
  "skills":         { nombre: "Agent Skills",            dominio: "Agentic Architecture" },
  "troubleshooting":{ nombre: "Troubleshooting de skills", dominio: "Agentic Architecture" },
  "subagents":      { nombre: "Subagents",               dominio: "Agentic Architecture" },
  "contexto":       { nombre: "Gestión de contexto",     dominio: "Context Management" },
  "claude-code":    { nombre: "Claude Code núcleo",      dominio: "Claude Code" },
  "hooks-permisos": { nombre: "Hooks y permisos",        dominio: "Claude Code" },
  "automatizacion": { nombre: "Automatización y CI",     dominio: "Claude Code" },
  "prompting":      { nombre: "Prompt Engineering",      dominio: "Prompt Engineering" },
  "mcp":            { nombre: "Tools y MCP",             dominio: "Tool Design & MCP" },
};

const FILES = [
  { file: "simulacro-01.html", pre: "sim01", curso: 1 },
  { file: "simulacro-02.html", pre: "sim02", curso: 4 },
  { file: "simulacro-03.html", pre: "sim03", curso: 0 },
  { file: "simulacro-04.html", pre: "sim04", curso: 0 },
];

const fail = (msg) => { console.error("❌ " + msg); process.exit(1); };
const preguntas = [];

for (const { file, pre, curso } of FILES) {
  const html = readFileSync(resolve(ARTEFACTOS, file), "utf8");
  // Recorre escenarios y bloques .q EN ORDEN para asociar cada pregunta a su escenario vigente.
  const chunk = /<section class="scenario">\s*<h2>([\s\S]*?)<\/h2>\s*<p>([\s\S]*?)<\/p>\s*<\/section>|<div class="q" data-a="([A-D])" data-dom="([^"]*)">([\s\S]*?<div class="expl">[\s\S]*?<\/div>)\s*<\/div>/g;
  let m, escenario = null, n = 0;
  while ((m = chunk.exec(html)) !== null) {
    if (m[1] !== undefined) {
      escenario = { titulo: m[1].trim(), texto: m[2].trim() };
      continue;
    }
    n++;
    const [, , , correcta, dom, inner] = m;
    const stemM = inner.match(/<p class="stem"><span class="num">Q\d+\.<\/span>([\s\S]*?)<\/p>/);
    if (!stemM) fail(`${file} Q${n}: stem no encontrado`);
    const opts = [...inner.matchAll(/<label class="opt"><input type="radio"[^>]*value="([A-D])"><span>([\s\S]*?)<\/span><\/label>/g)];
    if (opts.length !== 4) fail(`${file} Q${n}: ${opts.length} opciones (esperaba 4)`);
    const explM = inner.match(/<div class="expl">([\s\S]*?)<\/div>/);
    if (!explM) fail(`${file} Q${n}: explicación no encontrada`);
    const explicacion = explM[1].trim();
    const letraExpl = explicacion.match(/<b>([A-D])\./);
    if (!letraExpl || letraExpl[1] !== correcta)
      fail(`${file} Q${n}: la letra de la explicación (${letraExpl && letraExpl[1]}) no coincide con data-a (${correcta})`);
    if (!(dom in TEMA_MAP)) fail(`${file} Q${n}: data-dom desconocido "${dom}"`);
    preguntas.push({
      id: `${pre}-q${String(n).padStart(2, "0")}`,
      origen: file.replace(".html", ""),
      tema: TEMA_MAP[dom],
      subtema: dom,
      curso,
      escenario,
      stem: stemM[1].trim(),
      opciones: opts.map((o) => o[2].trim().replace(/^[A-D]\)\s*/, "")),
      correcta,
      explicacion,
      dificultad: null,
    });
  }
  if (n !== 20) fail(`${file}: ${n} preguntas (esperaba 20)`);
}

// Fusionar insumos manuales
const manualQ = JSON.parse(readFileSync(resolve(APP, "data", "manual-questions.json"), "utf8"));
const cards = JSON.parse(readFileSync(resolve(APP, "data", "manual-cards.json"), "utf8"));
for (const q of manualQ) {
  if (!(q.tema in TEMAS)) fail(`manual ${q.id}: tema desconocido "${q.tema}"`);
  if (!Array.isArray(q.opciones) || q.opciones.length !== 4) fail(`manual ${q.id}: opciones != 4`);
  if (!"ABCD".includes(q.correcta)) fail(`manual ${q.id}: correcta inválida`);
  preguntas.push(q);
}
for (const c of cards) if (!(c.tema in TEMAS)) fail(`card ${c.id}: tema desconocido "${c.tema}"`);

// IDs únicos
const ids = new Set();
for (const it of [...preguntas, ...cards]) {
  if (ids.has(it.id)) fail(`id duplicado: ${it.id}`);
  ids.add(it.id);
}

const bank = {
  schemaVersion: 1,
  bankVersion: new Date().toISOString().slice(0, 10) + ".1",
  temas: TEMAS,
  preguntas,
  tarjetas: cards,
};
writeFileSync(resolve(APP, "data", "questions.json"), JSON.stringify(bank, null, 1), "utf8");

const porTema = {};
for (const q of preguntas) porTema[q.tema] = (porTema[q.tema] || 0) + 1;
console.log(`✅ ${preguntas.length} preguntas + ${cards.length} tarjetas, 0 errores → data/questions.json (banco ${bank.bankVersion})`);
for (const [t, c] of Object.entries(porTema).sort((a, b) => b[1] - a[1]))
  console.log(`   ${TEMAS[t].nombre}: ${c}`);
