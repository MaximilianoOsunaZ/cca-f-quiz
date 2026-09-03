// parse-simulacros.mjs — genera data/questions.json desde la fuente canónica
// data/banco-preguntas.json + data/manual-cards.json + data/glosario.json.
// (Desde el banco v4 los simulacros HTML de ../artefactos son solo históricos;
//  el campo `origen` conserva la trazabilidad.)
// Ejecutar desde la carpeta app/:  node tools/parse-simulacros.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Los 5 dominios oficiales del examen (CCAR-F, guía v1.0 jul-2026)
const DOMINIOS = {
  1: { nombre: "Agentic Architecture & Orchestration", peso: 27 },
  2: { nombre: "Tool Design & MCP Integration", peso: 18 },
  3: { nombre: "Claude Code Configuration & Workflows", peso: 20 },
  4: { nombre: "Prompt Engineering & Structured Output", peso: 20 },
  5: { nombre: "Context Management & Reliability", peso: 15 },
};

// Task statements en verde según GUIA-EXAMEN/04-que-puedo-preguntarme-ya.md
// (solo lo cubierto por los 3 cursos terminados). Todo lo demás se rechaza.
const TS_VERDES = new Set([
  "1.2", "1.4", "1.5",
  "2.1", "2.4", "2.5",
  "3.1", "3.2", "3.4", "3.5", "3.6",
  "5.1", "5.4",
]);

// Tipos de distractor de GUIA-EXAMEN/03-anatomia + "feature-inexistente"
// (verificado contra las preguntas de ejemplo del PDF oficial: Q4 y Q10 usan
//  features inventadas que suenan plausibles).
const TIPOS_DIST = new Set([
  "correcta",
  "prompt-sin-determinismo",
  "sobre-ingenieria",
  "resuelve-otro-problema",
  "valido-pero-desproporcionado",
  "indicador-poco-fiable",
  "feature-inexistente",
]);

const DIFICULTADES = new Set(["baja", "media", "alta"]);

const TEMAS = {
  "mecanismos":     { nombre: "Elección de mecanismo",     dominio: "D3 · Claude Code" },
  "skills":         { nombre: "Agent Skills",              dominio: "D3 · Claude Code" },
  "troubleshooting":{ nombre: "Troubleshooting de skills", dominio: "D3 · Claude Code" },
  "subagents":      { nombre: "Subagents",                 dominio: "D1 · Agentic Architecture" },
  "contexto":       { nombre: "Gestión de contexto",       dominio: "D5 · Context Management" },
  "claude-code":    { nombre: "Claude Code núcleo",        dominio: "D3 · Claude Code" },
  "hooks-permisos": { nombre: "Hooks y permisos",          dominio: "D1/D3 · Enforcement" },
  "automatizacion": { nombre: "Automatización y CI",       dominio: "D3 · Claude Code" },
  "prompting":      { nombre: "Prompt Engineering",        dominio: "D4 · Prompt Engineering" },
  "mcp":            { nombre: "Tools y MCP",               dominio: "D2 · Tool Design & MCP" },
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
  c3: {
    nombre: "Introduction to Model Context Protocol",
    subtemas: [
      { slug: "c3-fundamentos", nombre: "Qué es MCP", desc: "El problema fundacional: sin MCP, cada tool de GitHub/Slack/etc. la escribes y mantienes TÚ. MCP no añade capacidad — quita carga: mueve la definición y ejecución de tools a un servidor que publicó otro. MCP y tool use son complementarios, no compiten." },
      { slug: "c3-arquitectura", nombre: "Cliente, servidor y mensajes", desc: "Cliente = el que pide (vive DENTRO de tu app); servidor MCP = el que ejecuta (proceso aparte). El cliente NUNCA ejecuta tools: solo transporta. 4 mensajes en pares request/result: list tools y call tool. Transport agnostic; stdio en local (jamás un print() en el servidor). El Inspector es un cliente MCP más (mcp dev)." },
      { slug: "c3-primitivas", nombre: "Las 3 primitivas", desc: "El criterio es QUIÉN DISPARA, no qué datos hay: tools = model-controlled (Claude decide) · resources = app-controlled (tu código decide) · prompts = user-controlled (botón, menú, slash command). Resources: direct (URI fija) vs templated (URI con {parametro}); mime_type como pista de deserialización." },
      { slug: "c3-tools", nombre: "Diseño de tools", desc: "La description no es documentación — es LA interfaz: el criterio con el que el modelo elige tool. Incluye formatos de entrada, ejemplos de consulta, casos límite y fronteras vs tools parecidas. Descriptions solapadas → enrutado erróneo; tools genéricas → dividir en contratos específicos. Aplica igual a tools nativas (Grep=contenido, Glob=rutas, Edit=texto único, Read+Write=fallback)." },
      { slug: "c3-integracion", nombre: "MCP en Claude Code", desc: "Scoping: .mcp.json a nivel proyecto (equipo, va al repo) vs ~/.claude.json a nivel usuario (personal/experimental). ${VAR} expande variables de entorno para no commitear secretos. Las tools de TODOS los servidores conectados se descubren a la vez. Resources como catálogos de contenido reducen tool calls exploratorias. Si Claude prefiere sus tools nativas, mejora la description de la tool MCP." },
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
      { slug: "x-prompting", nombre: "Prompt Engineering", desc: "Técnicas de instrucción efectiva para Claude. Tema pendiente de estudiar (20% del examen — Dominio 4, se desbloquea con Building with the Claude API)." },
    ],
  },
};

const fail = (msg) => { console.error("❌ " + msg); process.exit(1); };
const subsValidos = new Set(Object.values(CURSOS).flatMap((c) => c.subtemas.map((s) => s.slug)));

// ---- Fuente canónica de preguntas -----------------------------------------
const preguntas = JSON.parse(readFileSync(resolve(APP, "data", "banco-preguntas.json"), "utf8"));

for (const q of preguntas) {
  const w = (msg) => fail(`${q.id || "?"}: ${msg}`);
  // Campos base
  for (const k of ["id", "origen", "tema", "stem", "explicacion", "stem_es"])
    if (!q[k] || !String(q[k]).trim()) w(`falta ${k}`);
  if (!(q.tema in TEMAS)) w(`tema desconocido "${q.tema}"`);
  if (![0, 1, 3, 4].includes(q.curso)) w(`curso inválido "${q.curso}"`);
  if (!Array.isArray(q.opciones) || q.opciones.length !== 4) w("opciones != 4");
  if (!Array.isArray(q.opciones_es) || q.opciones_es.length !== 4) w("opciones_es != 4");
  if (q.sub && !subsValidos.has(q.sub)) w(`sub desconocido "${q.sub}"`);
  if (q.escenario && (!q.escenario.titulo || !q.escenario.texto)) w("escenario incompleto");

  // multiRespuesta / correcta
  if (typeof q.multiRespuesta !== "boolean") w("falta multiRespuesta (booleano)");
  let correctas;
  if (q.multiRespuesta) {
    if (!Array.isArray(q.correcta) || q.correcta.length < 2) w("multiRespuesta=true exige correcta como array de 2+");
    correctas = q.correcta;
    if (!/select (two|three)/i.test(q.stem)) w('el stem multiRespuesta debe decir cuántas marcar ("Select TWO/THREE")');
  } else {
    if (typeof q.correcta !== "string") w("correcta debe ser una letra");
    correctas = [q.correcta];
  }
  for (const c of correctas) if (!"ABCD".includes(c)) w(`correcta inválida "${c}"`);
  if (new Set(correctas).size !== correctas.length) w("letras correctas repetidas");

  // Dominio y task statement
  if (!Number.isInteger(q.dominio) || q.dominio < 1 || q.dominio > 5) w(`dominio inválido "${q.dominio}"`);
  if (!TS_VERDES.has(q.taskStatement)) w(`taskStatement "${q.taskStatement}" no está en la lista verde (GUIA-EXAMEN/04)`);
  if (String(q.taskStatement).split(".")[0] !== String(q.dominio)) w(`taskStatement ${q.taskStatement} no pertenece al dominio ${q.dominio}`);

  // Dificultad
  if (!DIFICULTADES.has(q.dificultad)) w(`dificultad inválida "${q.dificultad}"`);

  // Tipos de distractor
  const td = q.tiposDistractor;
  if (!td || Object.keys(td).sort().join("") !== "ABCD") w("tiposDistractor debe cubrir A-D");
  const marcadas = Object.entries(td).filter(([, v]) => v === "correcta").map(([k]) => k).sort();
  if (marcadas.join(",") !== [...correctas].sort().join(",")) w(`tiposDistractor marca [${marcadas}] como correcta(s) pero correcta es [${correctas}]`);
  // Nota: el examen real SÍ repite tipos dentro de un ítem (Q1 oficial: B y C
  // son ambos "probabilistic compliance"), así que no se exige unicidad.
  const tiposUsados = Object.values(td).filter((v) => v !== "correcta");
  for (const t of tiposUsados) if (!TIPOS_DIST.has(t)) w(`tipo de distractor inválido "${t}"`);

  // porQueFallan: exactamente las letras incorrectas
  const incorrectas = [..."ABCD"].filter((l) => !correctas.includes(l)).sort();
  const pf = q.porQueFallan;
  if (!pf || Object.keys(pf).sort().join(",") !== incorrectas.join(",")) w(`porQueFallan debe cubrir exactamente [${incorrectas}]`);
  for (const [l, txt] of Object.entries(pf)) if (!txt || !String(txt).trim()) w(`porQueFallan.${l} vacío`);
}

// ---- Tarjetas y glosario ---------------------------------------------------
const cards = JSON.parse(readFileSync(resolve(APP, "data", "manual-cards.json"), "utf8"));
for (const c of cards) if (!(c.tema in TEMAS)) fail(`card ${c.id}: tema desconocido "${c.tema}"`);

const glosario = JSON.parse(readFileSync(resolve(APP, "data", "glosario.json"), "utf8"));
const TIPOS_GLOS = new Set(["comando", "evento", "opción", "flag", "concepto", "campo", "archivo", "salida", "modo"]);
for (const g of glosario) {
  if (!["c1", "c3", "c4", "gen"].includes(g.curso)) fail(`glosario ${g.id}: curso inválido "${g.curso}"`);
  if (!TIPOS_GLOS.has(g.tipo)) fail(`glosario ${g.id}: tipo inválido "${g.tipo}"`);
  for (const k of ["id", "categoria", "termino", "significado"])
    if (!g[k] || !String(g[k]).trim()) fail(`glosario ${g.id || "?"}: falta ${k}`);
}

// ---- IDs únicos ------------------------------------------------------------
const ids = new Set();
for (const it of [...preguntas, ...cards, ...glosario]) {
  if (ids.has(it.id)) fail(`id duplicado: ${it.id}`);
  ids.add(it.id);
}

// ---- Banco -----------------------------------------------------------------
const bank = {
  schemaVersion: 3,
  bankVersion: new Date().toISOString().slice(0, 10) + ".4",
  dominios: DOMINIOS,
  temas: TEMAS,
  cursos: CURSOS,
  preguntas,
  tarjetas: cards,
  glosario,
};
writeFileSync(resolve(APP, "data", "questions.json"), JSON.stringify(bank, null, 1), "utf8");

const porDominio = {}, porTema = {}, porDif = {};
let multi = 0;
for (const q of preguntas) {
  porDominio[q.dominio] = (porDominio[q.dominio] || 0) + 1;
  porTema[q.tema] = (porTema[q.tema] || 0) + 1;
  porDif[q.dificultad] = (porDif[q.dificultad] || 0) + 1;
  if (q.multiRespuesta) multi++;
}
console.log(`✅ ${preguntas.length} preguntas (${multi} multiRespuesta) + ${cards.length} tarjetas + ${glosario.length} glosario, 0 errores → data/questions.json (banco ${bank.bankVersion})`);
console.log("   Por dominio: " + Object.entries(porDominio).sort().map(([d, n]) => `D${d}=${n} (${Math.round((n / preguntas.length) * 100)}%)`).join(" · "));
console.log("   Dificultad: " + Object.entries(porDif).sort().map(([d, n]) => `${d}=${n}`).join(" · "));
for (const [t, c] of Object.entries(porTema).sort((a, b) => b[1] - a[1]))
  console.log(`   ${TEMAS[t].nombre}: ${c}`);
