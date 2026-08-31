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

const SUBTEMA_MAP = {
  "Hooks": "c4-hooks", "Permission modes": "c4-permisos", "Steering": "c4-steering",
  "CLAUDE.md": "c4-claudemd", "Automatización": "c4-auto", "GitHub Actions": "c4-actions",
  "Verificación": "c4-trust", "Plugins": "c4-plugins",
  "Subagents": "c1-subagents", "Elección de mecanismo": "c1-vs",
  "Prioridad de skills": "c1-prioridad", "Configuración": "c1-config",
  "Distribución": "c1-sharing", "Troubleshooting": "c1-ts", "Troubleshooting skills": "c1-ts",
  "Skills (curso 1)": "c1-fundamentos", "Context management": "c1-pd",
};

const CURSOS = {
  c1: {
    nombre: "Introduction to Agent Skills",
    subtemas: [
      { slug: "c1-fundamentos", nombre: "Qué son las skills", desc: "Una skill es un directorio con un SKILL.md que le enseña algo a Claude una sola vez; se activa por matching semántico contra su description. Viven en 4 ubicaciones (enterprise, personal, project, plugins)." },
      { slug: "c1-anatomia", nombre: "Crear una skill", desc: "El frontmatter lleva name (máx 64 chars, = nombre de la carpeta) y description (máx 1,024, el criterio de matching); debajo van las instrucciones. Editar → reiniciar Claude Code; borrar = eliminar el directorio." },
      { slug: "c1-prioridad", nombre: "Prioridad y conflictos", desc: "Con nombres repetidos gana una sola: Enterprise → Personal → Project → Plugins (E-P-P-P). Personal le gana a Project. Para evitar conflictos: nombres descriptivos." },
      { slug: "c1-config", nombre: "Configuración avanzada", desc: "Campos opcionales: allowed-tools restringe herramientas mientras la skill está activa (omitirlo = sin restricción); model elige qué modelo la ejecuta." },
      { slug: "c1-pd", nombre: "Progressive disclosure", desc: "Tres niveles: metadata (siempre cargada) → instrucciones (al activarse) → recursos (solo si la tarea lo pide). references/ se LEEN, scripts/ se EJECUTAN (solo el output cuesta), assets/ se USAN. SKILL.md bajo ~500 líneas." },
      { slug: "c1-vs", nombre: "Skills vs otras features", desc: "La escalera de decisión: ¿falta acceso externo? MCP · ¿debe ocurrir ante un evento? Hook · ¿tarea grande que ensucia contexto? Subagent · ¿aplica siempre? CLAUDE.md · ¿conocimiento a veces? Skill. Se combinan, no compiten." },
      { slug: "c1-subagents", nombre: "Subagents", desc: "Otro Claude con contexto aislado: recibe una tarea, trabaja aparte y devuelve resultados. No heredan skills (se listan en skills:); los built-in (Explore, Plan, Verify) no pueden usarlas jamás; en subagents las skills cargan todas al arrancar." },
      { slug: "c1-sharing", nombre: "Compartir skills", desc: "Tres canales por alcance: commit al repo (equipo, updates con git pull) → plugin en marketplace (comunidad) → enterprise managed settings (obligatorio organización, keyword \"must\")." },
      { slug: "c1-ts", nombre: "Troubleshooting", desc: "Síntoma → arreglo: no dispara = description sin trigger phrases · no carga = directorio con nombre + SKILL.md exacto (claude --debug) · skill equivocada = descriptions muy parecidas · tapada = renombrar · runtime = dependencias, chmod +x, forward slashes. Primero siempre: el validator." },
    ],
  },
  c4: {
    nombre: "Claude Code in Action",
    subtemas: [
      { slug: "c4-steering", nombre: "Steering de sesiones largas", desc: "Acota primero (plan mode) y corrige durante: /compact dirigido (di qué conservar), rewind con checkpoints (doble Esc), /goal (el evaluador solo lee el transcript), /loop para estado externo, y worktrees para sesiones paralelas." },
      { slug: "c4-claudemd", nombre: "CLAUDE.md que se cumple", desc: "Es guidance, no enforcement: cada línea compite por atención — archivo flaco se cumple más. Los 4 archivos (managed, user, project, local) SE APILAN al arrancar. Los imports @ruta organizan pero NO reducen contexto. Hard rules → hooks." },
      { slug: "c4-permisos", nombre: "Permission modes", desc: "Seis modos: Manual, Accept edits, Plan, Auto (clasificador revisa cada acción — guarda intención, no corrección), Don't ask (pipelines sin humano: auto-deniega sin colgar) y Bypass (solo contenedor/VM aislado)." },
      { slug: "c4-hooks", nombre: "Hooks a fondo", desc: "Código determinista en puntos del loop: PreToolUse (puede bloquear o REESCRIBIR con updatedInput), PostToolUse, Stop (gate del turno), SessionStart+matcher compact (re-inyecta contexto). Exit 2 bloquea; exit 1 NO." },
      { slug: "c4-auto", nombre: "Routines y headless", desc: "El espectro de control: routines en la nube de Anthropic (cron/HTTP/GitHub, máx cada hora, ramas claude/) → claude -p (pipea como shell) → --bare (salta auto-discovery) → Agent SDK. Output estructurado en structured_output; multi-paso con session_id + --resume." },
      { slug: "c4-actions", nombre: "GitHub Actions y Code Review", desc: "Dos caminos: Code Review administrado (solo señala — nunca aprueba/bloquea, sin autofix; arreglo local con /code-review --fix) y el action DIY para hacer más que revisar (claude_args: max-turns + modo sin preguntas + tools mínimas)." },
      { slug: "c4-trust", nombre: "Confiar y verificar", desc: "\"The less you watched, the more you verify\": empieza por el diff (no el resumen), tests como gate cableado (Stop hook + exit 2), verificación de que ningún test fue debilitado, y segunda opinión fría de un subagent fresco." },
      { slug: "c4-plugins", nombre: "Plugins", desc: "Una unidad instalable (skills+agents+hooks+MCP). Corre con TUS privilegios: sus hooks se APILAN con los tuyos; su clave agent puede cambiar el hilo principal. Read before you install; reviewed ≠ trusted." },
    ],
  },
  cx: {
    nombre: "Próximos temas",
    subtemas: [
      { slug: "x-api", nombre: "Fundamentos de API", desc: "La base para el curso de la Claude API: ciclo request→response, JSON sobre HTTP, API key como credencial, tokens como unidad de medida y cobro, y SDK vs API (la librería que llena los formatos por ti)." },
      { slug: "x-mcp", nombre: "Tools y MCP", desc: "Model Context Protocol: cómo darle \"manos\" a Claude — servers, tools, resources y prompts. Curso pendiente de estudiar (18% del examen)." },
      { slug: "x-prompting", nombre: "Prompt Engineering", desc: "Técnicas de instrucción efectiva para Claude. Tema pendiente de estudiar (20% del examen)." },
    ],
  },
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

// Traducciones al español (stems, opciones y escenarios)
const TRAD = JSON.parse(readFileSync(resolve(APP, "data", "traducciones-es.json"), "utf8"));
const TRAD_ESC = TRAD.escenarios || {};
let sinTraduccion = 0;
function conTraduccion(q) {
  const t = TRAD[q.id];
  if (t && Array.isArray(t.opciones) && t.opciones.length === 4) {
    q.stem_es = t.stem; q.opciones_es = t.opciones;
  } else if (!q.stem_es) {
    sinTraduccion++; console.warn(`⚠️  sin traducción: ${q.id}`);
  }
  if (q.escenario && TRAD_ESC[q.escenario.titulo]) {
    q.escenario = { ...q.escenario, titulo_es: TRAD_ESC[q.escenario.titulo].titulo, texto_es: TRAD_ESC[q.escenario.titulo].texto };
  }
  return q;
}

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
    preguntas.push(conTraduccion({
      id: `${pre}-q${String(n).padStart(2, "0")}`,
      origen: file.replace(".html", ""),
      tema: TEMA_MAP[dom],
      subtema: dom,
      sub: SUBTEMA_MAP[dom],
      curso,
      escenario,
      stem: stemM[1].trim(),
      opciones: opts.map((o) => o[2].trim().replace(/^[A-D]\)\s*/, "")),
      correcta,
      explicacion,
      dificultad: null,
    }));
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
  if (!q.sub) q.sub = SUBTEMA_MAP[q.subtema] || null;
  if (q.sub) {
    const subsValidos = new Set(Object.values(CURSOS).flatMap((c) => c.subtemas.map((s) => s.slug)));
    if (!subsValidos.has(q.sub)) fail(`manual ${q.id}: sub desconocido "${q.sub}"`);
  }
  preguntas.push(conTraduccion(q));
}
for (const c of cards) if (!(c.tema in TEMAS)) fail(`card ${c.id}: tema desconocido "${c.tema}"`);

// IDs únicos
const ids = new Set();
for (const it of [...preguntas, ...cards]) {
  if (ids.has(it.id)) fail(`id duplicado: ${it.id}`);
  ids.add(it.id);
}

const bank = {
  schemaVersion: 2,
  bankVersion: new Date().toISOString().slice(0, 10) + ".2",
  temas: TEMAS,
  cursos: CURSOS,
  preguntas,
  tarjetas: cards,
};
writeFileSync(resolve(APP, "data", "questions.json"), JSON.stringify(bank, null, 1), "utf8");

const porTema = {};
for (const q of preguntas) porTema[q.tema] = (porTema[q.tema] || 0) + 1;
const traducidas = preguntas.filter((q) => q.stem_es).length;
console.log(`✅ ${preguntas.length} preguntas (${traducidas} con traducción ES, ${sinTraduccion} sin) + ${cards.length} tarjetas, 0 errores → data/questions.json (banco ${bank.bankVersion})`);
for (const [t, c] of Object.entries(porTema).sort((a, b) => b[1] - a[1]))
  console.log(`   ${TEMAS[t].nombre}: ${c}`);
