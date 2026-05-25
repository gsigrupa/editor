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

### Update Codex 2026-05-25

- `CODEX.md` dodany w root repo z zasadami pracy Codexa.
- Dodano ikonki toolbar:
  - `Miarka T` w dolnym pasku trybów używa `Ruler` z `lucide-react`.
  - `Gumka` w dolnym pasku trybów zastępuje generyczny `Usuń/D` i używa
    `Eraser` z `lucide-react`; skrót narzędzia zostaje `E`.
- Unit toolbar:
  - Grid snap automatycznie dopasowuje się do `useViewer.lengthUnit`:
    `m -> 1 m`, `cm -> 1 cm`, `mm -> 1 mm`.
  - Lista `GridSnapStep` ma teraz krok `1` (`1 m`) obok wcześniejszych
    `0.5 / 0.25 / 0.1 / 0.05 / 0.01 / 0.001`.
  - Dolny przycisk grid snap pokazuje samą wartość snapu bez ikony siatki,
    bo przy automatycznym dopasowaniu do jednostek pełni rolę parametru, nie
    osobnego narzędzia.
- Dodano SketchUp-style Eraser:
  - Skrót `E` aktywuje narzędzie `eraser` w `structure/build`.
  - Gumka usuwa pojedyncze module-scope guides (`point` / `line` /
    `vertical`) przez hover + klik.
  - Nie usuwa measurements ani geometrii sceny.
- Tape Measure przepisany od nowa jako prostszy SketchUp-style v2:
  - Osobny model: `Guide` (`point` / `line` / `vertical`), `Measurement`,
    `SnapResult`, `Draft`.
  - Domyślny tryb po `T` to GUIDE, bliżej SketchUpowego kursora z `+`;
    `Ctrl/Meta` przełącza GUIDE/POMIAR.
  - Snap engine ma jeden priorytetowy path: Y axis / guides / measurements /
    wall endpoint / midpoint / edge / X/Z axes / empty.
  - X/Z axes tworzą horizontal infinite guide lines.
  - Y axis tworzy offsetowaną vertical guide line (`Guide.kind = 'vertical'`)
    w miejscu drugiego kliknięcia/drag, z osobnym render path.
  - Y axis nie polega już tylko na podłogowym grid snapie: Tape Measure liczy
    dystans promienia myszy do pionowego odcinka osi Y (`Ray.distanceSqToSegment`),
    więc można złapać widoczną zieloną oś jak osobny hit target.
  - Wall face snap dodany dla obu stron ściany (`wall.thickness / 2`), żeby
    guide'y można było brać z centerline albo z lica ściany.
  - Tape Measure nie używa już `snapWallDraftPoint` przed własnym snap engine,
    bo ten helper dociągał kursor do centerline ściany i gubił informację,
    po której stronie/lucu ściany jest user.
  - Priorytet snapów ściany: wall face endpoint / wall face / centerline
    endpoint / midpoint / centerline edge. Dzięki temu pomiary domyślnie
    łapią wewnętrzne/zewnętrzne lico, nie środek ściany.
  - Dodano SketchUp-style axis lock strzałkami podczas draftu:
    `ArrowRight` = X, `ArrowUp` = Z, `ArrowLeft` = Y, `ArrowDown` = clear.
    W trybie GUIDE wybrana oś ustala orientację nowego guide'a niezależnie od
    tego, z jakiej osi/guide'a rozpoczęto drag. W trybie POMIAR blokuje kierunek
    pomiaru.
  - Snap `Origin`/Y axis jest liczony od rogu działki (`siteCorner`), spójnie
    z `SceneAxes`.
  - Event listenery narzędzia są rejestrowane raz i czytają bieżący stan z refs.
  - Render zostaje przy WebGPU-safe `boxGeometry` + `meshBasicMaterial` +
    `castShadow={false}`.
- Sprawdzone:
  - TypeScript check OK:
    `./packages/editor/node_modules/.bin/tsc --noEmit -p packages/editor/tsconfig.json`
  - Browser smoke: `T` pokazuje HUD w GUIDE, `Ctrl` przełącza na POMIAR,
    bez błędów konsoli.
  - Browser smoke Eraser: `E` pokazuje HUD gumki, bez błędów konsoli.
  - Browser smoke Axis Lock: po `T` + pierwszy klik + `ArrowRight` HUD pokazuje
    `blokada X`, bez błędów konsoli.
  - Browser smoke toolbar: widoczne przyciski `Miarka T` i `Gumka E`; klik
    `Miarka T` aktywuje HUD miarki, klik `Gumka E` aktywuje tryb gumki.
- Zostaje:
  - DB persistence guides nadal poza zakresem; wymaga postMessage/schema
    koordynacji z GSI/Claude.

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
- **Domyślnie GUIDE jak w SketchUp.** `Ctrl/Meta` przełącza GUIDE/POMIAR;
  intent jest łapany przy klik 1 i może zostać przełączony podczas drag przed
  drugim kliknięciem.
- **Delete hover'em** — `Del/Backspace` + hover na guide / guide-point /
  measurement endpoint = usuwa pojedynczy element. `Y` = clear all.
- **Snap detection** — `getCurrentLevelWalls` używa `level.children[]`
  (Pascal hierarchy), nie filter po `parentId === levelId` (poprzedni
  pattern nigdy nie znajdował ścian — fix wczoraj).

### Co nie działa / wymaga decyzji

1. **Y axis vertical guide line** — zrobione w rewrite v2 jako
   `Guide.kind = 'vertical'` + osobny render path.
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

Aktualne message types (Faza 1, single-kind):
- `pascal:ready` — Pascal mountowany, wysyła do parent (GSI). Parent
  odpowiada `gsi:scene` (load).
- `pascal:save` — autosave debounce 1s. Parent zapisuje do
  `floor_plans.data_json` (MySQL upsert).
- `pascal:navigate-back` — klik "Wróć do projektu" w toolbar. Parent
  push do `/app/inwestycje/[id]?tab=model3d`.

Pola URL Pascal embed (Faza 1):
- `/embed?projectId=X&parentOrigin=Y`

### 🆕 Faza 2 (2026-05-25): multi-kind support — site_state vs designed

Decyzja produktowa: każdy projekt ma DWA autonomiczne floor_plans:
- `kind = 'site_state'` — stan zastany (fizyczne wymiary, ground truth)
- `kind = 'designed'` — wersja projektowana (meble, zmiany układu)

**Co Codex robi po stronie Pascala:**

1. URL parser w `/embed` page — czytaj `kind` z searchParams (default `'designed'` gdy brak).
2. `pascal:ready` payload rozszerz o `kind`: `{ projectId, kind }`.
3. `pascal:save` payload rozszerz o `kind`: `{ projectId, kind, data }`.
4. `pascal:navigate-back` payload rozszerz o `kind`: `{ projectId, kind }`.
5. Nowy message type `pascal:clone` — wysyłany przez klik buttona "Skopiuj
   jako bazę projektu" w toolbarze (widoczny TYLKO gdy `kind === 'site_state'`):
   `{ projectId, from: 'site_state', to: 'designed' }`.
6. Toolbar — dorzuć badge w lewym-górnym albo obok 3D/2D/Split:
   - `kind === 'site_state'` → badge "🏗️ STAN ZASTANY" (np. amber-100 bg, amber-900 text)
   - `kind === 'designed'` → badge "📐 PROJEKTOWANY" (np. indigo-100 bg, indigo-900 text)
7. Button "Skopiuj jako bazę projektu" (tylko site_state) — analogicznie do
   "Wróć do projektu", wysyła `pascal:clone` i pokazuje toast "Skopiowano"
   po `gsi:clone-ack`.

**GSI po drugiej stronie:**
- Migracja SQL: `floor_plans.kind ENUM('site_state','designed')` + composite unique
- API: `?kind=K` query param + `POST /floor-plan/clone` endpoint
- `PascalEmbed` prop `kind`, URL `?kind=K`
- `/app/inwestycje/[id]/plan-3d` — 2 sub-taby

Zmiana w obu stronach jednoczesna. Bez kind = 'designed' (backward compat).

Pełen contract w atomic note Roberta.

---

## Roadmap (kolejność delegowania)

W kolejności priorytetu:

1. **Tape Measure cleanup** (current WIP) — decyzja Codex jak wyżej.
2. **🆕 2026-05-25: Multi-kind support (site_state vs designed)** — sekcja wyżej.
3. **Faza 5/7 — Furniture catalog drawer** (drag&drop, 10-20 mebli starter set GLTF z CC0)
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
