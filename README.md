# CCA-F Quiz 🎓

PWA de estudio para la certificación **Claude Certified Architect – Foundations**.
Preguntas tipo simulacro + tarjetas de estudio, con progreso local, racha diaria y
dashboard de fuerza por tema. Hecha en vanilla HTML/CSS/JS — sin frameworks ni build.

## Publicar en GitHub Pages (una sola vez)

1. Entra a **github.com** con tu cuenta (o crea una gratis).
2. Botón **"+"** (arriba derecha) → **New repository** → nombre: `cca-f-quiz` → **Public** → NO marques "Add a README" → **Create repository**.
3. En PowerShell, dentro de esta carpeta (`app\`):
   ```
   git init -b main
   git add .
   git commit -m "CCA-F Quiz v1"
   git remote add origin https://github.com/TU-USUARIO/cca-f-quiz.git
   git push -u origin main
   ```
   (Al hacer push se abre el navegador para autorizar — un clic.)
4. En el repo: **Settings → Pages → Deploy from a branch → Branch: `main` / (root) → Save**. Espera 1–3 min.
5. Tu app queda en: `https://TU-USUARIO.github.io/cca-f-quiz/`

## Instalarla en el celular

- **Android (Chrome):** abre la URL → menú ⋮ → **"Agregar a la pantalla principal"** → Instalar.
- **iPhone:** abre la URL en **Safari** (obligatorio) → botón Compartir → **"Agregar a pantalla de inicio"**.

Una vez instalada funciona **offline** (preguntas, tarjetas y progreso incluidos).

## Actualizar el banco de preguntas después

1. Agrega preguntas/tarjetas nuevas a `data/manual-questions.json` / `data/manual-cards.json`
   (o pídele a Claude Code que lo haga).
2. Regenera el banco: `node tools/parse-simulacros.mjs`
3. Publica: `git add data/ ; git commit -m "más preguntas" ; git push`
4. La app instalada trae el banco nuevo sola la próxima vez que se abra con red.

## Estructura

- `index.html` / `styles.css` / `app.js` — la app (SPA de 4 vistas)
- `data/questions.json` — banco generado (NO editar a mano; correr el script)
- `data/manual-questions.json` + `data/manual-cards.json` — insumos editables
- `tools/parse-simulacros.mjs` — parsea los 4 simulacros HTML + fusiona insumos
- `sw.js` + `manifest.webmanifest` + `icons/` + `fonts/` — capa PWA/offline

El progreso vive en `localStorage` del dispositivo. Respaldo ligero: botón
**"Copiar para Claude"** en el Dashboard (pégalo en tu chat para análisis).
