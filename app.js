/* CCA-F Quiz — lógica completa (vanilla JS, sin dependencias) */
"use strict";

// ---------- Estado ----------
const LSKEY = "ccaf-progreso";
const SCHEMA = 1;
let S = null;   // progreso
let BANK = null; // banco
let qById = {}, cById = {};

function freshState() {
  return {
    schemaVersion: SCHEMA, preguntas: {}, tarjetas: {}, dias: {},
    racha: { actual: 0, mejor: 0, ultimoDiaCumplido: null },
    settings: { metaDiaria: 20, apariencia: "auto", idioma: "en" },
    bankVersionVista: null,
  };
}
function loadState() {
  try {
    const raw = localStorage.getItem(LSKEY);
    if (!raw) return freshState();
    const s = JSON.parse(raw);
    // cadena de migradores v1→v2→... (por ahora solo v1)
    if (!s.schemaVersion || s.schemaVersion > SCHEMA) return freshState();
    return Object.assign(freshState(), s);
  } catch (e) { return freshState(); }
}
function save() { try { localStorage.setItem(LSKEY, JSON.stringify(S)); } catch (e) {} }

const today = () => new Date().toISOString().slice(0, 10);
function yesterday() { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }
function daysSince(iso) {
  if (!iso) return 999;
  return Math.max(0, Math.round((new Date(today()) - new Date(iso)) / 86400000));
}
function checkStreakOnLoad() {
  const r = S.racha;
  if (r.ultimoDiaCumplido && r.ultimoDiaCumplido < yesterday()) { r.actual = 0; save(); }
}
function onGoalProgress() {
  const d = S.dias[today()] || { vistas: 0, aciertos: 0 };
  const r = S.racha;
  if (d.vistas >= S.settings.metaDiaria && r.ultimoDiaCumplido !== today()) {
    r.actual = (r.ultimoDiaCumplido === yesterday()) ? r.actual + 1 : 1;
    r.mejor = Math.max(r.mejor, r.actual);
    r.ultimoDiaCumplido = today();
    toast(`🔥 ¡Meta del día cumplida! Racha: ${r.actual} día${r.actual === 1 ? "" : "s"}`);
  }
}

// ---------- Stats derivadas ----------
function temaStats() {
  const out = {};
  for (const slug of Object.keys(BANK.temas)) out[slug] = { intentos: 0, aciertos: 0, cajaSum: 0, conCaja: 0, total: 0, vistas: 0 };
  for (const q of BANK.preguntas) {
    out[q.tema].total++;
    const p = S.preguntas[q.id];
    if (p) {
      out[q.tema].vistas++;
      out[q.tema].intentos += p.intentos; out[q.tema].aciertos += p.aciertos;
      out[q.tema].cajaSum += p.caja; out[q.tema].conCaja++;
    }
  }
  return out;
}
function fuerzaPct(st) { return st.intentos ? Math.round((st.aciertos / st.intentos) * 100) : null; }
function subStats() {
  const out = {};
  for (const c of Object.values(BANK.cursos || {}))
    for (const s of c.subtemas) out[s.slug] = { intentos: 0, aciertos: 0, total: 0, vistas: 0 };
  for (const q of BANK.preguntas) {
    if (!q.sub || !out[q.sub]) continue;
    out[q.sub].total++;
    const p = S.preguntas[q.id];
    if (p) { out[q.sub].vistas++; out[q.sub].intentos += p.intentos; out[q.sub].aciertos += p.aciertos; }
  }
  return out;
}
function temasDebiles() {
  const st = temaStats();
  return new Set(Object.keys(st).filter((t) => { const p = fuerzaPct(st[t]); return p !== null && p < 70; }));
}
function reincidentesElegibles() {
  return BANK.preguntas.filter((q) => { const p = S.preguntas[q.id]; return p && p.intentos >= 1 && p.caja <= 2; });
}

// ---------- Motor de feed ----------
const feed = { mode: null, tema: null, cardsOnly: false, bag: [], cardBag: [], sinceCard: 0, cardTarget: 5, recent: [], current: null, answered: null };

// ---------- Idioma ----------
function lang() { return (S.settings.idioma === "es") ? "es" : "en"; }
function qStem(q) { return (lang() === "es" && q.stem_es) ? q.stem_es : q.stem; }
function qOpts(q) { return (lang() === "es" && q.opciones_es) ? q.opciones_es : q.opciones; }
function qScenTitle(e) { return (lang() === "es" && e.titulo_es) ? e.titulo_es : e.titulo; }
function qScenText(e) { return (lang() === "es" && e.texto_es) ? e.texto_es : e.texto; }
function updateLangBtn() {
  const b = document.getElementById("btn-lang");
  if (b) b.textContent = lang() === "es" ? "🌐 ES" : "🌐 EN";
}
function toggleLang() {
  S.settings.idioma = lang() === "es" ? "en" : "es";
  save(); updateLangBtn();
  // re-renderiza el ítem actual conservando el estado (respuesta ya marcada, explicación visible)
  if (feed.current && !feed.current.esCard) renderQuestion(feed.current.item);
}

function shuffle(a) { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; }

function startFeed(mode, tema, cardsOnly) {
  feed.mode = mode; feed.tema = tema || null; feed.cardsOnly = !!cardsOnly;
  feed.sinceCard = 0; feed.cardTarget = 4 + Math.floor(Math.random() * 3); feed.recent = [];
  refillBags();
  nav("feed");
  const labels = { random: "🎲 Feed", topic: "📂 " + (tema ? BANK.temas[tema].nombre : "Tema"), reincidentes: "🔁 Reincidentes" };
  document.getElementById("feed-mode").textContent = feed.cardsOnly ? "🃏 " + BANK.temas[tema].nombre : labels[mode];
  nextItem();
}
function refillBags() {
  const qs = feed.tema ? BANK.preguntas.filter((q) => q.tema === feed.tema) : BANK.preguntas;
  feed.bag = shuffle(qs.map((q) => q.id));
  const cs = feed.tema ? BANK.tarjetas.filter((c) => c.tema === feed.tema) : BANK.tarjetas;
  feed.cardBag = shuffle(cs.map((c) => c.id));
}
function pickCard() {
  const debiles = temasDebiles();
  if (!feed.cardBag.length) feed.cardBag = shuffle((feed.tema ? BANK.tarjetas.filter((c) => c.tema === feed.tema) : BANK.tarjetas).map((c) => c.id));
  if (!feed.cardBag.length) return null;
  // ordena la bolsa: temas débiles y menos-recientes primero
  feed.cardBag.sort((a, b) => scoreCard(cById[b], debiles) - scoreCard(cById[a], debiles));
  return cById[feed.cardBag.shift()];
}
function scoreCard(c, debiles) {
  const t = S.tarjetas[c.id];
  let s = debiles.has(c.tema) ? 4 : 0;
  s += t ? Math.min(daysSince(t.ultimoVisto), 7) : 8; // nunca vista pesa más
  if (t && t.caja === 0) s += 3; // marcada "no la tenía"
  return s;
}
function pickReincidente() {
  const el = reincidentesElegibles().filter((q) => !feed.recent.includes(q.id));
  if (el.length < 10) {
    const nunca = BANK.preguntas.filter((q) => !S.preguntas[q.id] && !feed.recent.includes(q.id));
    el.push(...shuffle(nunca).slice(0, 10 - el.length));
  }
  if (!el.length) return null;
  const pesoCaja = [8, 4, 2, 1];
  const pesos = el.map((q) => {
    const p = S.preguntas[q.id];
    return p ? pesoCaja[p.caja] * Math.min(daysSince(p.ultimoVisto) + 1, 7) : 6;
  });
  let r = Math.random() * pesos.reduce((a, b) => a + b, 0);
  for (let i = 0; i < el.length; i++) { r -= pesos[i]; if (r <= 0) return el[i]; }
  return el[el.length - 1];
}
function nextItem() {
  document.getElementById("btn-next").disabled = true;
  let item = null, esCard = false;
  if (feed.cardsOnly) { item = pickCard(); esCard = true; }
  else if ((feed.mode === "random" || feed.mode === "topic") && feed.sinceCard >= feed.cardTarget) {
    item = pickCard(); esCard = !!item;
  }
  if (!item) {
    if (feed.mode === "reincidentes") item = pickReincidente();
    else { if (!feed.bag.length) refillBags(); item = qById[feed.bag.shift()]; }
  }
  if (!item) { toast("No hay elementos para este modo todavía"); nav("home"); return; }
  feed.current = { item, esCard };
  feed.answered = null;
  feed.recent.push(item.id); if (feed.recent.length > 5) feed.recent.shift();
  if (esCard) { feed.sinceCard = 0; feed.cardTarget = 4 + Math.floor(Math.random() * 3); renderCard(item); }
  else renderQuestion(item);
  updateFeedCount();
  window.scrollTo({ top: 0 });
}
function updateFeedCount() {
  const d = S.dias[today()] || { vistas: 0 };
  document.getElementById("feed-count").textContent = `hoy ${d.vistas}/${S.settings.metaDiaria}`;
}

// ---------- Render ----------
const correctasDe = (q) => q.multiRespuesta ? q.correcta : [q.correcta];
function sameSet(a, b) {
  const A = new Set(a), B = new Set(b);
  return A.size === B.size && [...A].every((x) => B.has(x));
}
function pqfHtml(q) {
  if (!q.porQueFallan) return "";
  const tipos = q.tiposDistractor || {};
  return `<div class="pqf">` + Object.entries(q.porQueFallan).map(([l, txt]) =>
    `<div class="pqfrow"><span class="pqfletter">${l}</span><div><span class="pqftipo">${tipos[l] || ""}</span> ${txt}</div></div>`).join("") + `</div>`;
}
function renderQuestion(q) {
  const host = document.getElementById("feed-item");
  const scen = q.escenario
    ? `<details class="scen"><summary>${qScenTitle(q.escenario)}</summary><p>${qScenText(q.escenario)}</p></details>` : "";
  const letters = ["A", "B", "C", "D"];
  const multi = !!q.multiRespuesta;
  host.innerHTML = `${scen}
    ${multi ? `<div class="multihint">☑️ Respuesta múltiple — marca ${correctasDe(q).length} opciones y comprueba</div>` : ""}
    <p class="stem">${qStem(q)}</p>
    <div class="opts">${qOpts(q).map((o, i) =>
      `<button class="optbtn" data-letter="${letters[i]}"><span class="letter">${letters[i]}</span><span>${o}</span></button>`).join("")}
    </div>
    ${multi ? `<div class="checkwrap"><button class="primary" id="btn-check" disabled>Comprobar</button></div>` : ""}
    <div id="expl-slot"></div>`;
  if (multi) {
    const need = correctasDe(q).length;
    host.querySelectorAll(".optbtn").forEach((b) => b.addEventListener("click", () => {
      if (feed.answered) return;
      b.classList.toggle("picked");
      document.getElementById("btn-check").disabled = host.querySelectorAll(".optbtn.picked").length !== need;
    }));
    document.getElementById("btn-check").addEventListener("click", () => {
      const picks = [...host.querySelectorAll(".optbtn.picked")].map((b) => b.dataset.letter);
      answer(q, picks);
    });
  } else {
    host.querySelectorAll(".optbtn").forEach((b) => b.addEventListener("click", () => answer(q, b.dataset.letter)));
  }
  if (feed.answered) paintResult(q);
}
function paintResult(q) {
  const ans = feed.answered;
  const picks = new Set(Array.isArray(ans.pick) ? ans.pick : [ans.pick]);
  const correctas = new Set(correctasDe(q));
  document.querySelectorAll("#feed-item .optbtn").forEach((b) => {
    b.disabled = true;
    b.classList.remove("picked");
    if (correctas.has(b.dataset.letter)) b.classList.add("right");
    else if (picks.has(b.dataset.letter)) b.classList.add("wrongpick");
    else b.classList.add("dim");
  });
  const chk = document.getElementById("btn-check");
  if (chk) chk.style.display = "none";
  document.getElementById("expl-slot").innerHTML =
    `<div class="expl ${ans.ok ? "" : "bad"}"><div class="verdict ${ans.ok ? "ok" : "no"}">${ans.ok ? "✔ ¡Correcto!" : "✘ Incorrecto"}</div>${q.explicacion}${pqfHtml(q)}</div>`;
}
function answer(q, pick) {
  if (feed.answered) return;
  const ok = Array.isArray(pick) ? sameSet(pick, correctasDe(q)) : pick === q.correcta;
  feed.answered = { pick, ok };
  paintResult(q);
  const p = S.preguntas[q.id] || { caja: 0, intentos: 0, aciertos: 0, ultimoVisto: null, ultimoOk: null };
  p.intentos++; if (ok) { p.aciertos++; p.caja = Math.min(3, p.caja + 1); } else p.caja = 0;
  p.ultimoVisto = today(); p.ultimoOk = ok;
  S.preguntas[q.id] = p;
  const d = S.dias[today()] || { vistas: 0, aciertos: 0 };
  d.vistas++; if (ok) d.aciertos++;
  S.dias[today()] = d;
  feed.sinceCard++;
  onGoalProgress(); save(); updateFeedCount();
  document.getElementById("btn-next").disabled = false;
}
function renderCard(c) {
  const host = document.getElementById("feed-item");
  host.innerHTML = `<div class="studycard">
      <div class="kicker">🃏 Tarjeta · ${BANK.temas[c.tema].nombre}</div>
      <h3>${c.titulo}</h3>
      <div class="body">${c.cuerpo}</div>
      <div class="cardbtns">
        <button class="yes" id="card-yes">La tenía ✔</button>
        <button class="no" id="card-no">No la tenía ✘</button>
      </div>
    </div>`;
  const done = (known) => {
    const t = S.tarjetas[c.id] || { caja: 0, vistas: 0, ultimoVisto: null };
    t.vistas++; t.caja = known ? Math.min(3, t.caja + 1) : 0; t.ultimoVisto = today();
    S.tarjetas[c.id] = t; save();
    nextItem();
  };
  document.getElementById("card-yes").addEventListener("click", () => done(true));
  document.getElementById("card-no").addEventListener("click", () => done(false));
}

// ---------- Home ----------
function renderHome() {
  const d = S.dias[today()] || { vistas: 0 };
  const meta = S.settings.metaDiaria;
  const pct = Math.min(1, d.vistas / meta);
  const C = 188.5;
  document.getElementById("ring-fg").setAttribute("stroke-dashoffset", String(C * (1 - pct)));
  document.getElementById("ring-text").textContent = `${d.vistas}/${meta}`;
  document.getElementById("today-title").textContent = pct >= 1 ? "¡Meta cumplida! 🎉" : "Meta de hoy";
  document.getElementById("today-sub").textContent = pct >= 1 ? "Sigue si quieres — todo suma" : `${meta - d.vistas} preguntas para tu racha`;
  document.getElementById("streak").textContent = `🔥 ${S.racha.actual}`;
  document.getElementById("badge-rein").textContent = String(reincidentesElegibles().length);
  // lista de temas
  const st = temaStats();
  const list = document.getElementById("topiclist");
  list.innerHTML = Object.entries(BANK.temas).map(([slug, t]) => {
    const s = st[slug]; const p = fuerzaPct(s);
    const cls = p === null ? "" : p >= 80 ? "g" : p >= 60 ? "a" : "r";
    const w = p === null ? 0 : p;
    const nQ = s.total, nC = BANK.tarjetas.filter((c) => c.tema === slug).length;
    return `<button class="topicrow" data-tema="${slug}">
      <span>${t.nombre} <span class="muted">· ${nQ}p ${nC ? "· " + nC + "t" : ""}</span></span>
      <span class="minibar"><span class="${cls}" style="width:${w}%"></span></span>
      <span class="pct">${p === null ? "—" : p + "%"}</span>
    </button>`;
  }).join("") + `<label class="cardsonly"><input type="checkbox" id="chk-cards"> Solo tarjetas (repaso puro)</label>`;
  list.querySelectorAll(".topicrow").forEach((b) => b.addEventListener("click", () => {
    const cardsOnly = document.getElementById("chk-cards").checked;
    startFeed("topic", b.dataset.tema, cardsOnly);
  }));
}

// ---------- Dashboard ----------
function renderDashboard() {
  const st = temaStats();
  let intT = 0, aciT = 0, vistasU = 0;
  for (const s of Object.values(st)) { intT += s.intentos; aciT += s.aciertos; vistasU += s.vistas; }
  const stats = document.getElementById("dash-stats");
  stats.innerHTML = `
    <div class="stat"><div class="v">🔥 ${S.racha.actual}</div><div class="k">racha (mejor ${S.racha.mejor})</div></div>
    <div class="stat"><div class="v">${intT ? Math.round((aciT / intT) * 100) + "%" : "—"}</div><div class="k">acierto global</div></div>
    <div class="stat"><div class="v">${vistasU}/${BANK.preguntas.length}</div><div class="k">preguntas vistas</div></div>`;
  const bars = document.getElementById("dash-bars");
  const ss = subStats();
  const colorDe = (p) => p === null ? "var(--line)" : p >= 80 ? "var(--good)" : p >= 60 ? "var(--amber)" : "var(--bad)";
  bars.innerHTML = Object.entries(BANK.cursos || {}).map(([cslug, curso]) => {
    let ci = 0, ca = 0, conPreguntas = false;
    for (const sub of curso.subtemas) { ci += ss[sub.slug].intentos; ca += ss[sub.slug].aciertos; if (ss[sub.slug].total) conPreguntas = true; }
    const cp = ci ? Math.round((ca / ci) * 100) : null;
    const filas = curso.subtemas.map((sub) => {
      const s = ss[sub.slug]; const p = fuerzaPct(s);
      const porEstudiar = !s.total;
      return `<details class="subrow ${porEstudiar ? "future" : ""}">
        <summary>
          <span class="subname">${sub.nombre}</span>
          <span class="minibar"><span style="width:${p ?? 0}%;background:${colorDe(p)}"></span></span>
          <span class="pct">${porEstudiar ? "por estudiar" : (p === null ? "s/d" : p + "%")}</span>
        </summary>
        <div class="subdesc">${sub.desc}${s.total ? `<div class="subcount">${s.total} pregunta${s.total === 1 ? "" : "s"} en el banco · ${s.vistas} vistas · ${s.intentos} intentos</div>` : ""}</div>
      </details>`;
    }).join("");
    return `<details class="cursoacc" ${cslug !== "cx" ? "open" : ""}>
      <summary class="cursohead">
        <span class="cursoname">${curso.nombre}</span>
        <span class="minibar big"><span style="width:${cp ?? 0}%;background:${colorDe(cp)}"></span></span>
        <span class="pct">${conPreguntas ? (cp === null ? "s/d" : cp + "%") : "—"}</span>
      </summary>
      <div class="subrows">${filas}</div>
    </details>`;
  }).join("");
  // top reincidentes
  const rein = reincidentesElegibles()
    .map((q) => ({ q, p: S.preguntas[q.id] }))
    .sort((a, b) => (b.p.intentos - b.p.aciertos) - (a.p.intentos - a.p.aciertos))
    .slice(0, 5);
  document.getElementById("dash-rein").innerHTML = rein.length
    ? rein.map(({ q, p }) => `<div class="row"><span>${q.id} · ${BANK.temas[q.tema].nombre}</span><span>${p.intentos - p.aciertos}✘/${p.intentos}</span></div>`).join("")
    : `<span class="muted">Sin reincidentes — ¡bien!</span>`;
  const flojas = BANK.tarjetas.filter((c) => S.tarjetas[c.id] && S.tarjetas[c.id].caja === 0);
  document.getElementById("dash-cards").innerHTML = flojas.length
    ? flojas.slice(0, 5).map((c) => `<div class="row"><span>${c.titulo}</span><span>${BANK.temas[c.tema].nombre}</span></div>`).join("")
    : `<span class="muted">Ninguna marcada "no la tenía"</span>`;
}
function buildCopyText() {
  const st = temaStats();
  let intT = 0, aciT = 0, vistasU = 0;
  for (const s of Object.values(st)) { intT += s.intentos; aciT += s.aciertos; vistasU += s.vistas; }
  const d = S.dias[today()] || { vistas: 0 };
  const lines = [];
  lines.push(`CCA-F progreso — ${today()}`);
  lines.push(`Banco v${BANK.bankVersion} · ${BANK.preguntas.length} preguntas + ${BANK.tarjetas.length} tarjetas · Racha: ${S.racha.actual} días (mejor ${S.racha.mejor}; meta ${S.settings.metaDiaria}/día, hoy ${d.vistas})`);
  lines.push(`Global: ${vistasU} vistas únicas de ${BANK.preguntas.length} · ${intT} intentos · ${intT ? Math.round((aciT / intT) * 100) : 0}% acierto`);
  const ss = subStats();
  for (const [cslug, curso] of Object.entries(BANK.cursos || {})) {
    if (cslug === "cx") continue;
    let ci = 0, ca = 0;
    for (const sub of curso.subtemas) { ci += ss[sub.slug].intentos; ca += ss[sub.slug].aciertos; }
    lines.push(`Curso "${curso.nombre}": ${ci ? Math.round((ca / ci) * 100) + "% acierto · " + ci + " intentos" : "sin datos"}`);
  }
  lines.push(`Por tema (acierto% · intentos · caja media):`);
  for (const [slug, t] of Object.entries(BANK.temas)) {
    const s = st[slug]; const p = fuerzaPct(s);
    const cm = s.conCaja ? (s.cajaSum / s.conCaja).toFixed(1) : "—";
    lines.push(`- ${t.nombre}: ${p === null ? "sin datos" : p + "%"} · ${s.intentos} · ${cm}`);
  }
  const rein = reincidentesElegibles().map((q) => ({ q, p: S.preguntas[q.id] }))
    .sort((a, b) => (b.p.intentos - b.p.aciertos) - (a.p.intentos - a.p.aciertos)).slice(0, 8);
  lines.push(`Top reincidentes (id · fallos/intentos): ` + (rein.length ? rein.map(({ q, p }) => `${q.id} ${p.intentos - p.aciertos}/${p.intentos}`).join(" | ") : "ninguno"));
  const nunca = {};
  for (const q of BANK.preguntas) if (!S.preguntas[q.id]) nunca[q.tema] = (nunca[q.tema] || 0) + 1;
  lines.push(`Nunca vistas: ${BANK.preguntas.length - vistasU}` + (Object.keys(nunca).length ? ` (${Object.entries(nunca).map(([t, n]) => `${t}: ${n}`).join(", ")})` : ""));
  const flojas = BANK.tarjetas.filter((c) => S.tarjetas[c.id] && S.tarjetas[c.id].caja === 0);
  if (flojas.length) lines.push(`Tarjetas "no la tenía": ${flojas.map((c) => c.id).join(", ")}`);
  return lines.join("\n");
}

// ---------- Glosario ----------
const glos = { curso: "all", q: "" };
const GLOS_CURSO = { c1: "Agent Skills", c3: "Intro to MCP", c4: "Claude Code in Action", gen: "Base" };
const GLOS_MONO = new Set(["comando", "flag", "evento", "campo", "salida"]);
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
function renderGlosario() {
  const host = document.getElementById("glos-list");
  const entries = (BANK.glosario || []).filter((g) => {
    if (glos.curso !== "all" && g.curso !== glos.curso) return false;
    if (glos.q && !norm(g.termino + " " + g.significado + " " + g.categoria).includes(norm(glos.q))) return false;
    return true;
  });
  if (!entries.length) {
    host.innerHTML = `<p class="muted" style="text-align:center;padding:1.5rem 0">Nada coincide con tu búsqueda.</p>`;
    return;
  }
  // agrupa por categoría preservando el orden del banco
  const cats = [], byCat = new Map();
  for (const g of entries) {
    if (!byCat.has(g.categoria)) { byCat.set(g.categoria, []); cats.push(g.categoria); }
    byCat.get(g.categoria).push(g);
  }
  host.innerHTML = cats.map((cat) => `
    <h3 class="gloscat">${cat} <span class="muted">· ${byCat.get(cat).length}</span></h3>
    <div class="glosgrid">${byCat.get(cat).map((g) => `
      <button class="flipcard" data-id="${g.id}" aria-expanded="false">
        <span class="flipinner">
          <span class="flipfront">
            <span class="fliptipo">${g.tipo}</span>
            <span class="flipterm${GLOS_MONO.has(g.tipo) ? " mono" : ""}">${g.termino}</span>
            <span class="fliphint">toca para voltear ↻</span>
          </span>
          <span class="flipback">
            <span class="flipmean">${g.significado}</span>
            <span class="flipfoot">${cat} · ${GLOS_CURSO[g.curso]}</span>
          </span>
        </span>
      </button>`).join("")}
    </div>`).join("");
  host.querySelectorAll(".flipcard").forEach((b) => b.addEventListener("click", () => {
    b.setAttribute("aria-expanded", String(b.classList.toggle("flipped")));
  }));
}

// ---------- Simulacro ----------
// Reparto por dominio de GUIA-EXAMEN/04 (peso de lo estudiado, no del examen real)
const SIM_REPARTO = { 3: 21, 2: 18, 1: 12, 5: 9 }; // = 60
const SIM_DUR = 120 * 60; // 120 minutos, en segundos
let simTimer = null;
let simResultado = null; // resultado transitorio de la última entrega (para la revisión)

function simState() {
  if (!S.simulacro) S.simulacro = { activa: null, historial: [] };
  return S.simulacro;
}
function simBuild() {
  const porD = {};
  for (const q of BANK.preguntas) (porD[q.dominio] = porD[q.dominio] || []).push(q);
  const sel = [];
  for (const [d, n] of Object.entries(SIM_REPARTO)) sel.push(...shuffle(porD[d] || []).slice(0, n));
  if (sel.length < 60) {
    const usados = new Set(sel.map((q) => q.id));
    sel.push(...shuffle(BANK.preguntas.filter((q) => !usados.has(q.id))).slice(0, 60 - sel.length));
  }
  // agrupa por escenario: bloques en orden aleatorio, preguntas del mismo escenario juntas
  const bloques = new Map();
  for (const q of sel) {
    const k = q.escenario ? q.escenario.titulo : "·libre·";
    if (!bloques.has(k)) bloques.set(k, []);
    bloques.get(k).push(q);
  }
  const qids = [];
  for (const k of shuffle([...bloques.keys()])) for (const q of bloques.get(k)) qids.push(q.id);
  return { qids, respuestas: {}, marcadas: [], idx: 0, inicio: Date.now(), terminado: false };
}
function simRestante(sim) { return Math.max(0, SIM_DUR - Math.floor((Date.now() - sim.inicio) / 1000)); }
function fmtMMSS(s) { return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; }

function renderSimulacro() {
  const st = simState();
  // simulacro activo con banco actualizado: valida que las preguntas sigan existiendo
  if (st.activa && st.activa.qids.some((id) => !qById[id])) {
    st.activa = null; save();
    toast("El banco cambió — el simulacro anterior se descartó");
  }
  if (st.activa && !st.activa.terminado) { renderSimExam(); return; }
  if (simResultado) { renderSimResult(); return; }
  renderSimStart();
}
function renderSimStart() {
  const st = simState();
  const host = document.getElementById("sim-root");
  const hist = (st.historial || []).slice(-5).reverse();
  host.innerHTML = `
    <button class="backbtn" data-nav="home">← Inicio</button>
    <h2 style="margin-bottom:0.3rem">Simulacro 🎯</h2>
    <div class="panel">
      <p style="margin:0 0 0.6rem"><b>60 preguntas · 120 minutos</b> — como el examen real: cronómetro visible, preguntas agrupadas por escenario, sin retroalimentación hasta entregar. Al final: % por dominio, como el score report oficial.</p>
      <p class="muted" style="margin:0 0 0.6rem">Reparto (peso de lo ya estudiado): D3 Claude Code ×21 · D2 Tool Design &amp; MCP ×18 · D1 Agentic Architecture ×12 · D5 Context ×9. El examen real aprueba con 720/1000 escalado — en la práctica apunta a <b>75%+</b> aquí.</p>
      <p class="muted" style="margin:0">Puedes salir y volver: el cronómetro sigue corriendo (como el real). Recargar la página no lo pierde.</p>
    </div>
    <button class="primary" id="sim-go" style="width:100%">🚀 Comenzar simulacro</button>
    ${hist.length ? `<div class="panel" style="margin-top:1rem"><h3>Historial</h3>${hist.map((h) =>
      `<div class="row"><span>${h.fecha} · ${h.pct}%</span><span class="muted">${Object.entries(h.porDominio).map(([d, r]) => `D${d} ${Math.round((r.ok / r.n) * 100)}%`).join(" · ")}</span></div>`).join("")}</div>` : ""}`;
  host.querySelector("[data-nav]").addEventListener("click", () => nav("home"));
  document.getElementById("sim-go").addEventListener("click", () => {
    simState().activa = simBuild(); save();
    renderSimExam();
  });
}
function renderSimExam() {
  const sim = simState().activa;
  const host = document.getElementById("sim-root");
  const q = qById[sim.qids[sim.idx]];
  const letters = ["A", "B", "C", "D"];
  const multi = !!q.multiRespuesta;
  const resp = sim.respuestas[q.id];
  const marcada = sim.marcadas.includes(q.id);
  const respondidas = Object.keys(sim.respuestas).length;
  // escenario: encabezado del bloque actual
  const scen = q.escenario
    ? `<details class="scen" ${sim.idx === 0 || (qById[sim.qids[sim.idx - 1]].escenario || {}).titulo !== q.escenario.titulo ? "open" : ""}><summary>${qScenTitle(q.escenario)}</summary><p>${qScenText(q.escenario)}</p></details>` : "";
  host.innerHTML = `
    <div class="simbar">
      <span id="sim-timer">--:--</span>
      <span class="simpos">${sim.idx + 1}/60</span>
      <button class="iconbtn" id="sim-lang" aria-label="Cambiar idioma">🌐 ${lang() === "es" ? "ES" : "EN"}</button>
      <button class="iconbtn ${marcada ? "flagged" : ""}" id="sim-flag" aria-label="Marcar para revisar">🚩</button>
      <button class="iconbtn" id="sim-grid" aria-label="Mapa de preguntas">▦</button>
      <button class="iconbtn" id="sim-exit" aria-label="Salir">✕</button>
    </div>
    <div class="palette" id="sim-palette" hidden></div>
    ${scen}
    ${multi ? `<div class="multihint">☑️ Respuesta múltiple — marca ${correctasDe(q).length}</div>` : ""}
    <p class="stem">${qStem(q)}</p>
    <div class="opts" id="sim-opts">${qOpts(q).map((o, i) =>
      `<button class="optbtn ${resp && (Array.isArray(resp) ? resp.includes(letters[i]) : resp === letters[i]) ? "picked" : ""}" data-letter="${letters[i]}"><span class="letter">${letters[i]}</span><span>${o}</span></button>`).join("")}
    </div>
    <div class="simnav">
      <button class="iconbtn" id="sim-prev" ${sim.idx === 0 ? "disabled" : ""}>← Anterior</button>
      <button class="iconbtn" id="sim-next" ${sim.idx === 59 ? "disabled" : ""}>Siguiente →</button>
      <button class="primary" id="sim-end">Entregar (${respondidas}/60)</button>
    </div>`;
  // opciones
  host.querySelectorAll("#sim-opts .optbtn").forEach((b) => b.addEventListener("click", () => {
    const l = b.dataset.letter;
    if (multi) {
      const cur = new Set(Array.isArray(sim.respuestas[q.id]) ? sim.respuestas[q.id] : []);
      cur.has(l) ? cur.delete(l) : cur.add(l);
      if (cur.size) sim.respuestas[q.id] = [...cur].sort(); else delete sim.respuestas[q.id];
    } else {
      sim.respuestas[q.id] = l;
    }
    save(); renderSimExam();
  }));
  document.getElementById("sim-lang").addEventListener("click", () => {
    S.settings.idioma = lang() === "es" ? "en" : "es"; save(); updateLangBtn(); renderSimExam();
  });
  document.getElementById("sim-flag").addEventListener("click", () => {
    const i = sim.marcadas.indexOf(q.id);
    i >= 0 ? sim.marcadas.splice(i, 1) : sim.marcadas.push(q.id);
    save(); renderSimExam();
  });
  document.getElementById("sim-grid").addEventListener("click", () => {
    const pal = document.getElementById("sim-palette");
    if (!pal.hidden) { pal.hidden = true; return; }
    pal.innerHTML = sim.qids.map((id, i) =>
      `<button class="palcell ${sim.respuestas[id] ? "done" : ""} ${sim.marcadas.includes(id) ? "flag" : ""} ${i === sim.idx ? "cur" : ""}" data-i="${i}">${i + 1}</button>`).join("");
    pal.hidden = false;
    pal.querySelectorAll(".palcell").forEach((c) => c.addEventListener("click", () => { sim.idx = parseInt(c.dataset.i, 10); save(); renderSimExam(); }));
  });
  document.getElementById("sim-prev").addEventListener("click", () => { sim.idx--; save(); renderSimExam(); window.scrollTo({ top: 0 }); });
  document.getElementById("sim-next").addEventListener("click", () => { sim.idx++; save(); renderSimExam(); window.scrollTo({ top: 0 }); });
  document.getElementById("sim-end").addEventListener("click", () => {
    const faltan = 60 - Object.keys(sim.respuestas).length;
    if (confirm(faltan ? `Te faltan ${faltan} preguntas sin responder — cuentan como incorrectas. ¿Entregar?` : "¿Entregar el simulacro?")) simFinish(false);
  });
  document.getElementById("sim-exit").addEventListener("click", () => {
    if (confirm("¿Salir? El simulacro queda activo y el cronómetro SIGUE corriendo (como el examen real).")) nav("home");
  });
  // cronómetro
  if (simTimer) clearInterval(simTimer);
  const tick = () => {
    const el = document.getElementById("sim-timer");
    if (!el) { clearInterval(simTimer); simTimer = null; return; }
    const r = simRestante(sim);
    el.textContent = fmtMMSS(r);
    el.classList.toggle("warn", r <= 600);
    if (r <= 0) { clearInterval(simTimer); simTimer = null; simFinish(true); }
  };
  tick();
  simTimer = setInterval(tick, 1000);
}
function simFinish(porTiempo) {
  const st = simState();
  const sim = st.activa;
  if (!sim) return;
  if (simTimer) { clearInterval(simTimer); simTimer = null; }
  const porDominio = {};
  const items = [];
  let aciertos = 0;
  const d = S.dias[today()] || { vistas: 0, aciertos: 0 };
  for (const id of sim.qids) {
    const q = qById[id];
    const pick = sim.respuestas[id] ?? null;
    const ok = pick !== null && (Array.isArray(pick) ? sameSet(pick, correctasDe(q)) : pick === q.correcta);
    if (ok) aciertos++;
    const pd = porDominio[q.dominio] = porDominio[q.dominio] || { n: 0, ok: 0 };
    pd.n++; if (ok) pd.ok++;
    items.push({ id, pick, ok });
    // alimenta el Leitner y las stats generales
    const p = S.preguntas[id] || { caja: 0, intentos: 0, aciertos: 0, ultimoVisto: null, ultimoOk: null };
    p.intentos++; if (ok) { p.aciertos++; p.caja = Math.min(3, p.caja + 1); } else p.caja = 0;
    p.ultimoVisto = today(); p.ultimoOk = ok;
    S.preguntas[id] = p;
    d.vistas++; if (ok) d.aciertos++;
  }
  S.dias[today()] = d;
  const pct = Math.round((aciertos / sim.qids.length) * 100);
  simResultado = { fecha: today(), pct, aciertos, total: sim.qids.length, porDominio, items, porTiempo: !!porTiempo };
  st.historial = (st.historial || []).slice(-9);
  st.historial.push({ fecha: today(), pct, porDominio });
  st.activa = null;
  onGoalProgress(); save();
  renderSimResult();
}
function renderSimResult() {
  const r = simResultado;
  const host = document.getElementById("sim-root");
  const domNombre = { 1: "Agentic Architecture", 2: "Tool Design & MCP", 3: "Claude Code", 5: "Context Management" };
  const colorDe = (p) => p >= 80 ? "var(--good)" : p >= 60 ? "var(--amber)" : "var(--bad)";
  host.innerHTML = `
    <button class="backbtn" id="sim-back">← Salir de la revisión</button>
    <h2 style="margin-bottom:0.3rem">${r.pct >= 75 ? "¡Aprobado! 🎉" : "Resultado 📊"}${r.porTiempo ? " <span class='muted' style='font-size:0.8rem'>(entregado por tiempo)</span>" : ""}</h2>
    <div class="panel" style="text-align:center">
      <div style="font-size:2.2rem;font-weight:800">${r.pct}%</div>
      <div class="muted">${r.aciertos}/${r.total} correctas · ${r.fecha} · referencia de aprobado real: 720/1000 escalado (~75% aquí)</div>
    </div>
    <div class="panel"><h3>% por dominio — como el score report</h3>
      ${Object.entries(r.porDominio).sort().map(([dnum, s]) => {
        const p = Math.round((s.ok / s.n) * 100);
        return `<div class="domrow"><span>D${dnum} · ${domNombre[dnum] || ""}</span>
          <span class="minibar big"><span style="width:${p}%;background:${colorDe(p)}"></span></span>
          <span class="pct">${s.ok}/${s.n} · ${p}%</span></div>`;
      }).join("")}
    </div>
    <h3 style="margin:1rem 0 0.5rem">Revisión <span class="muted" style="font-weight:400">· toca una pregunta para ver la explicación</span></h3>
    <div id="sim-review">${r.items.map((it, i) => {
      const q = qById[it.id];
      const pickTxt = it.pick === null ? "sin responder" : (Array.isArray(it.pick) ? it.pick.join("+") : it.pick);
      const corrTxt = correctasDe(q).join("+");
      return `<details class="revrow ${it.ok ? "ok" : "no"}">
        <summary><span class="revnum">${i + 1}</span><span class="revverdict">${it.ok ? "✔" : "✘"}</span><span class="revstem">${qStem(q)}</span></summary>
        <div class="revbody">
          <div class="revmeta">Tu respuesta: <b>${pickTxt}</b> · Correcta: <b>${corrTxt}</b> · D${q.dominio} · TS ${q.taskStatement} · ${q.dificultad}</div>
          <div class="opts">${qOpts(q).map((o, j) => {
            const l = ["A", "B", "C", "D"][j];
            const esCorr = correctasDe(q).includes(l);
            const esPick = it.pick !== null && (Array.isArray(it.pick) ? it.pick.includes(l) : it.pick === l);
            return `<div class="optbtn ${esCorr ? "right" : esPick ? "wrongpick" : "dim"}" style="cursor:default"><span class="letter">${l}</span><span>${o}</span></div>`;
          }).join("")}</div>
          <div class="expl ${it.ok ? "" : "bad"}">${q.explicacion}${pqfHtml(q)}</div>
        </div>
      </details>`;
    }).join("")}</div>`;
  document.getElementById("sim-back").addEventListener("click", () => { simResultado = null; nav("home"); });
}

// ---------- Navegación / UI ----------
function nav(view) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById("view-" + view).classList.add("active");
  if (view !== "simulacro" && simTimer) { clearInterval(simTimer); simTimer = null; }
  if (view === "home") renderHome();
  if (view === "dashboard") renderDashboard();
  if (view === "glosario") renderGlosario();
  if (view === "simulacro") renderSimulacro();
  window.scrollTo({ top: 0 });
}
let toastT = null;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2600);
}
function applyTheme() {
  const a = S.settings.apariencia;
  if (a === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", a);
}

// ---------- Init ----------
async function init() {
  S = loadState();
  checkStreakOnLoad();
  applyTheme();
  try {
    const res = await fetch("./data/questions.json");
    BANK = await res.json();
  } catch (e) {
    document.body.innerHTML = "<p style='padding:2rem;text-align:center'>No pude cargar el banco de preguntas. Revisa tu conexión e intenta de nuevo.</p>";
    return;
  }
  for (const q of BANK.preguntas) qById[q.id] = q;
  for (const c of BANK.tarjetas) cById[c.id] = c;
  if (S.bankVersionVista !== BANK.bankVersion) { S.bankVersionVista = BANK.bankVersion; save(); }

  // listeners
  document.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => nav(b.dataset.nav)));
  document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => startFeed(b.dataset.mode)));
  document.getElementById("btn-topics").addEventListener("click", () => document.getElementById("topiclist").classList.toggle("open"));
  document.getElementById("btn-next").addEventListener("click", nextItem);
  document.getElementById("btn-lang").addEventListener("click", toggleLang);
  updateLangBtn();
  document.querySelectorAll("#glos-chips .chip").forEach((b) => b.addEventListener("click", () => {
    glos.curso = b.dataset.curso;
    document.querySelectorAll("#glos-chips .chip").forEach((x) => x.classList.toggle("on", x === b));
    renderGlosario();
  }));
  document.getElementById("glos-search").addEventListener("input", (e) => {
    glos.q = e.target.value.trim();
    renderGlosario();
  });
  document.getElementById("btn-copy").addEventListener("click", async () => {
    const text = buildCopyText();
    const out = document.getElementById("copy-out");
    out.value = text; out.classList.add("show");
    try { await navigator.clipboard.writeText(text); toast("📋 Copiado — pégalo en tu chat con Claude"); }
    catch (e) { out.focus(); out.select(); toast("Selecciona y copia el texto de abajo"); }
  });
  const metaSel = document.getElementById("set-meta");
  metaSel.value = String(S.settings.metaDiaria);
  metaSel.addEventListener("change", () => { S.settings.metaDiaria = parseInt(metaSel.value, 10); save(); renderHome(); });
  const themeSel = document.getElementById("set-theme");
  themeSel.value = S.settings.apariencia;
  themeSel.addEventListener("change", () => { S.settings.apariencia = themeSel.value; save(); applyTheme(); });
  document.getElementById("set-bank").textContent = `v${BANK.bankVersion} · ${BANK.preguntas.length}p + ${BANK.tarjetas.length}t + ${(BANK.glosario || []).length}g`;
  document.getElementById("btn-reset").addEventListener("click", () => {
    if (confirm("¿Borrar TODO tu progreso? Esto no se puede deshacer.") && confirm("¿Seguro seguro? Considera copiar tu progreso primero.")) {
      S = freshState(); save(); applyTheme(); renderHome(); toast("Progreso reiniciado");
    }
  });
  renderHome();

  // service worker + recarga única en update
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./sw.js");
      let reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!reloaded) { reloaded = true; location.reload(); }
      });
    } catch (e) { /* sin SW la app funciona igual con red */ }
  }
}
init();
