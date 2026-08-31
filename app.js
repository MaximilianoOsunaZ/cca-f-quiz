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
function renderQuestion(q) {
  const host = document.getElementById("feed-item");
  const scen = q.escenario
    ? `<details class="scen"><summary>${qScenTitle(q.escenario)}</summary><p>${qScenText(q.escenario)}</p></details>` : "";
  const letters = ["A", "B", "C", "D"];
  host.innerHTML = `${scen}
    <p class="stem">${qStem(q)}</p>
    <div class="opts">${qOpts(q).map((o, i) =>
      `<button class="optbtn" data-letter="${letters[i]}"><span class="letter">${letters[i]}</span><span>${o}</span></button>`).join("")}
    </div>
    <div id="expl-slot"></div>`;
  host.querySelectorAll(".optbtn").forEach((b) => b.addEventListener("click", () => answer(q, b.dataset.letter)));
  if (feed.answered) paintResult(q, feed.answered.letter, feed.answered.ok);
}
function paintResult(q, letter, ok) {
  document.querySelectorAll(".optbtn").forEach((b) => {
    b.disabled = true;
    if (b.dataset.letter === q.correcta) b.classList.add("right");
    else if (b.dataset.letter === letter) b.classList.add("wrongpick");
    else b.classList.add("dim");
  });
  document.getElementById("expl-slot").innerHTML =
    `<div class="expl ${ok ? "" : "bad"}"><div class="verdict ${ok ? "ok" : "no"}">${ok ? "✔ ¡Correcto!" : "✘ Incorrecto"}</div>${q.explicacion}</div>`;
}
function answer(q, letter) {
  if (feed.answered) return;
  const ok = letter === q.correcta;
  feed.answered = { letter, ok };
  paintResult(q, letter, ok);
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

// ---------- Navegación / UI ----------
function nav(view) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById("view-" + view).classList.add("active");
  if (view === "home") renderHome();
  if (view === "dashboard") renderDashboard();
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
  document.getElementById("set-bank").textContent = `v${BANK.bankVersion} · ${BANK.preguntas.length}p + ${BANK.tarjetas.length}t`;
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
