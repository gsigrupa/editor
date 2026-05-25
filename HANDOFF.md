# HANDOFF — Pascal fork (gsigrupa/editor)

> **Workflow split 2026-05-25:** Codex (ChatGPT) przejmuje pracę nad Pascal forkiem.
> Claude (claude.ai) zostaje przy `gsi-os` (main app). Briefy dla Codexa są
> wpisywane do tego pliku przez Claude i kopiowane przez Roberta do Codexa.
>
> **Push rules:** Codex commit'uje + push do `main` (autodeploy do
> `gsi-plan-3d.vercel.app`). Claude `git pull` przed każdą zmianą bridge-related
> w `gsi-os`. Konflikty postMessage interface'u rozwiązywane przez review
> atomic note `~/Vaults/Knowledge/Codex Pascal handoff.md` (interface contract).

---

## Aktualny WIP: SketchUp-style Tape Measure (klawisz T)

Wczoraj (2026-05-24) Claude pracował nad miarką. Commit handoff w pipeline.
Po nim Codex bierze tę pracę i decyduje czy:
1. Domyka (kilka drobnych UX fixów, niżej)
2. Robi rewrite od zera (Claude'owa wersja zbyt rozdęta, ~1200 linii)
3. Cofa i robi prościej

### Co już działa

- **Snap system** — endpoint / midpoint / on-edge / on-axis-x/y/z / origin /
  guide-point / on-guide-line / measurement-endpoint. Z hover tooltipami
  ("Endpoint", "Midpoint", "On Edge", "Oś X · Ctrl+klik = guide" itd.)
- **Axis inference podczas drag** — kursor blisko osi X/Y/Z od origin → snap
  + linia w kolorze osi (czerwony X / niebieski Z / zielony Y).
- **Numeric input** — 0-9 + . + Enter (cm/mm/m wg `useViewer.lengthUnit`).
- **HUD** — status badge lewy-dolny (POMIAR / GUIDE) + measurement box
  prawy-dolny (Photoshop-like).
- **Mesh lines** — `boxGeometry` + `meshBasicMaterial` z `castShadow={false}`.
  Pascal WebGPU pipeline crashował na line primitive + custom node materials
  ("Invalid RenderPipeline"). To proven pattern.
- **MeasureOverlay** (`packages/editor/src/components/tools/measure/measure-tool.tsx`)
  — guides + measurements + guide points renderowane przez
  `createPortal(siteObj)` w `editor/index.tsx`. Przetrwają switch narzędzia
  (module-scope store: `moduleGuideLines`, `moduleGuidePoints`,
  `moduleMeasurements`).
- **SceneAxes** (`packages/editor/src/components/editor/scene-axes.tsx`) —
  osie XYZ przeniesione z origin sceny `(0,0,0)` na lewy-tylny róg działki
  (`min(X,Z)` z `SiteNode.polygon.points`). Mount przez
  `createPortal(siteObj)` — naturalny update gdy polygon się zmienia.
- **Pull guide z osi** — `Ctrl + klik` na oś X/Y/Z → drag → czarna dashed
  infinite parallel line (`COLOR_AXIS_GUIDE #0f172a`, period 12cm =
  6cm dash + 6cm gap, length 200m). Drugi klik = guide zostaje.
- **Bez Ctrl = pomiar segmentowy.** Ctrl jako modifier per-click (intent
  łapany w `guideIntentRef` w momencie kliku 1, trwa do końca draftu).
  Bez ukrytego mode toggle'a.
- **Delete hover'em** — `Del/Backspace` + hover na guide / guide-point /
  measurement endpoint = usuwa pojedynczy element. `Y` = clear all.
- **Snap detection** — `getCurrentLevelWalls` używa `level.children[]`
  (Pascal hierarchy), nie filter po `parentId === levelId` (poprzedni
  pattern nigdy nie znajdował ścian — fix wczoraj).

### Co nie działa / wymaga decyzji

1. **Y axis vertical guide line** — aktualnie klik na Y axis snap (corner)
   tworzy `guide point` jako fallback. Pełen support wymaga rozszerzenia
   struct `GuideLine` o `kind: 'horizontal' | 'vertical'` + separate
   render path w `GuideLineRender`.
2. **DB persystencja guides** — module-scope store przeżyje switch
   narzędzia, ale nie reload iframe. Wymaga:
   - Extension `floor_plans` table w GSI o pole `measure_guides LONGTEXT`
   - postMessage handlers: `pascal:save-guides` / `gsi:load-guides`
   - Sync w `useEffect` w MeasureTool / MeasureOverlay
3. **Komentarze użytkownika z 2026-05-24** sugerują że obecna implementacja
   może być za rozdęta. Codex powinien obejrzeć `measure-tool.tsx` (~1200
   linii) i zdecydować: refactor / rewrite / accept-as-is.

### Pliki dotknięte (HEAD~0 lokalny + commit handoff)

```
packages/editor/src/components/editor/index.tsx                 (+2 lines, MeasureOverlay mount)
packages/editor/src/components/editor/scene-axes.tsx            (~100 lines, createPortal + site corner)
packages/editor/src/components/tools/measure/measure-tool.tsx   (~1200 lines, full rewrite)
```

Poprzednie commit'y w branch:
```
a5861c52 feat(plan3d): tape measure — wall reference + 3D linie + measurement box + persist po tool switch
40ec984d feat(plan3d): tape measure 2 tryby (MEASURE/GUIDE) + persistent + Y clear
e48376a5 feat(plan3d): SceneAxes — 3 widoczne osie XYZ (RGB) przy origin
b76fc83f feat(plan3d): SketchUp-style tape measure tool — Etap A (HTML overlay MVP)
```

---

## Interfejs GSI ↔ Pascal (postMessage)

Pełen aktualny contract w `~/Vaults/Knowledge/Codex Pascal handoff.md`
po stronie Roberta. Nie modyfikuj message types ani schemy bez aktualizacji
tej notki + powiadomienia Claude (po stronie GSI musi być parity).

Aktualne message types:
- `pascal:ready` — Pascal mountowany, wysyła do parent (GSI). Parent
  odpowiada `gsi:scene` (load).
- `pascal:save` — autosave debounce 1s. Parent zapisuje do
  `floor_plans.data_json` (MySQL upsert).
- `pascal:navigate-back` — klik "Wróć do projektu" w toolbar. Parent
  push do `/app/inwestycje/[id]?tab=model3d`.

Pola URL Pascal embed:
- `/embed?projectId=X&parentOrigin=Y`

---

## Roadmap (kolejność delegowania)

W kolejności priorytetu:

1. **Tape Measure cleanup** (current WIP) — decyzja Codex jak wyżej.
2. **Faza 5/7 — Furniture catalog drawer** (drag&drop, 10-20 mebli starter set GLTF z CC0)
3. **Faza 6/7 — Materials/textures picker** (kafelki, parkiet, tapeta, farba ścian, beton — 10-15 starter tekstur)
4. **Vertical guide line (oś Y)** — extension struct GuideLine + render path
5. **DB persystencja guides** — postMessage extension + GSI API
6. **Pascal Engine PFM spike** — `cabinet` kind (~3-4 dni dev) — patrz `~/Vaults/Knowledge/Pascal jako Engine Modulu Mebli.md`
7. **Faza 7/7 — Stairs/Roof/Columns custom** (opcjonalna)

---

## Dev / deploy

- Lokalnie: `npm run dev` w `/Users/robert/Code/editor/packages/editor`
- Port: `localhost:3002` (GSI iframe'uje stamtąd w dev mode)
- Vercel: autodeploy z `main` na `gsi-plan-3d.vercel.app`
- GSI embed: `/Users/robert/Code/gsi-os/app/core/src/components/floor-plan/PascalEmbed.tsx`
  (env-aware: dev → localhost:3002, prod → gsi-plan-3d.vercel.app)

## TypeScript check

```bash
cd /Users/robert/Code/editor/packages/editor
./node_modules/.bin/tsc --noEmit
```

Brak outputu = OK. Każda zmiana musi przejść TS check przed commitem.
