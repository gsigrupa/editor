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
  - `Esc` w trybie `T` wychodzi z Tape Measure i wraca do selekcji.
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

### Update Codex 2026-05-26 — Wall Geometry References spike

- Dodano bezpieczną wersję testową SketchUp-style referencji ściany za flagą
  URL `?wallRefs=1`.
- Nowy czysty helper `packages/editor/src/lib/wall-geometry-references.ts`
  liczy z istniejących `WallNode` + dzieci (`DoorNode` / `WindowNode`):
  - wall points: narożniki front/back/top/bottom + midpointy,
  - wall edges: krawędzie front/back/top/end caps,
  - faces: center/front/back/top/start/end,
  - opening references: krawędzie i punkty otworów drzwi/okien w wall-local
    coordinates.
- Ten helper eksportuje też mapowanie do współrzędnych level:
  - `wallLocalToLevelPoint(wall, point)`,
  - `wallLevelToLocalPoint(wall, point)`,
  - `getWallLevelGeometryReferences(wall, nodes)`.
  To jest przygotowanie pod późniejsze snapowanie do rzeczywistych face/edge/point
  ściany bez zgadywania midpointu albo centerline.
- Dodano czysty snap helper:
  - `findNearestWallReferenceSnap(...)`,
  - `findNearestWallReferenceSnapAcrossWalls(...)`.
  Przyjmuje punkt kursora w level coordinates i zwraca najbliższy `point` /
  `edge` / `face` wraz z pozycją snapu, dystansem i stroną face'a.
- `snapWallDraftPoint(...)` ma testowe podpięcie wall refs snap dla Builda
  tylko gdy URL zawiera `?buildRefs=1`. Bez flagi Build
  zostaje na dotychczasowym snap flow. Z flagą najpierw próbuje złapać
  rzeczywistą referencję ściany (`point` / `edge` / `face`), a dopiero potem
  wraca do starego grid/angle/centerline flow.
  Ważne: `?wallRefs=1` jest tylko debugiem. Nie może zmieniać Builda, bo
  snapowanie nowych ścian do face offsetów zamiast do centerline/topologii
  powoduje, że obecne dynamiczne floor/ceiling/zone nie widzą zamkniętego
  pomieszczenia.
- Debug jest obecnie pokazywany bezpiecznie jako zwykły HTML panel poza
  canvasem: `packages/editor/src/components/editor/wall-refs-debug-panel.tsx`.
  Panel aktywuje się tylko przez `?wallRefs=1` i pokazuje liczbę ścian,
  face/edge/point/opening refs oraz detale zaznaczonej ściany.
  Panel słucha istniejącego eventu `grid:move` i pokazuje też `Cursor snap`
  dla najbliższej referencji ściany, bez dodatkowego raycastu i bez R3F
  renderowania. Aktualizacja `Cursor snap` jest throttlowana przez
  `requestAnimationFrame`, żeby debug UI nie renderował React state na każdym
  surowym pointer move.
- Dodano test kontraktowy
  `packages/editor/src/lib/wall-geometry-references.test.ts` dla:
  - prostej ściany,
  - drzwi wycinanych po stronie front,
  - okna wycinanego po stronie back,
  - zdegenerowanego segmentu ściany.
  Test obejmuje też projekcję lokalnych referencji na współrzędne level dla
  ściany poziomej i obróconej oraz snapowanie do face/edge/point.
- Próby R3F/WebGPU overlayu w canvasie powodowały czarny ekran, więc ten
  wariant został usunięty. Do wizualizacji 3D trzeba wrócić później inną
  ścieżką, najlepiej bez portali do wall mesh i po osobnym spike'u WebGPU.
- Overlay jest pasywny:
  - nie zmienia schemy sceny,
  - nie zmienia postMessage,
  - nie zmienia save/load,
  - nie dotyka dynamicznych floor/ceiling/zone ani cutout pipeline drzwi/okien.
- Obecny debug panel nie dotyka WebGPU/canvas.
- TypeScript check OK:
  `./packages/editor/node_modules/.bin/tsc --noEmit -p packages/editor/tsconfig.json`.
- Test runtime OK:
  `/Users/robert/.bun/bin/bun test packages/editor/src/lib/wall-geometry-references.test.ts`
  → 9 pass / 0 fail.
- Browser smoke OK na `http://localhost:3002/?wallRefs=1`:
  - panel `Wall refs debug` widoczny,
  - sekcja `Cursor snap` widoczna,
  - brak czarnego ekranu / fallbacku sceny,
  - brak błędów konsoli.
- Browser smoke po podpięciu Build refs snap: świeży tab
  `http://localhost:3002/?wallRefs=1` działa, panel widoczny, brak Next
  runtime/build error w page inspectorze.
- Po teście użytkownika, w którym nowe ściany nie wygenerowały floor/ceiling/zone,
  rozdzielono flagi: `wallRefs` zostaje pasywnym debugiem, a eksperymentalne
  podpięcie Builda wymaga osobnego `buildRefs`.

### Update Codex 2026-05-27 — Build refs topology-safe spike

- Eksperymentalny Build refs path nadal wymaga `?buildRefs=1`.
- Snap Builda może trafić w rzeczywiste referencje ściany (`face` / `edge` /
  `point`), ale punkt zapisu nowej ściany jest rzutowany z powrotem na
  centerline istniejącej ściany.
- Cel: zachować SketchUp-like referencje do lica/krawędzi/punktów ściany bez
  psucia obecnej topologii `WallNode.start/end`, od której zależy wykrywanie
  zamkniętych pomieszczeń oraz auto floor/ceiling/zone.
- Dodano helper `wallReferenceSnapToCenterlinePoint(...)` i test kontraktowy,
  że face snap wraca do centerline dla topology-safe wall building.
- Poprawiono kolejność snapowania w Build refs: `corner snap` nadal wygrywa na
  surowym kursorze, ale `face` / `edge` / `point` refs są szukane dopiero po
  angle/grid inference. To stabilizuje rysowanie ścian działowych, bo ref snap
  nie omija już SketchUp-style 45° inference.
- Doprecyzowano priorytety Build refs: szerokie `point` refs są wyłączone dla
  eksperymentalnego Build snapu. Narożniki nadal łapie osobny precyzyjny
  `corner snap` (`0.15m`), a wall refs w Buildzie służą głównie do `edge` /
  `face`. To ogranicza przypadkowe przyciąganie ściany działowej do narożnika.
- Dodano test kontraktowy `packages/core/src/lib/space-detection.test.ts`:
  zamknięty prostokąt daje 1 room, prostokąt przecięty ścianą działową daje
  2 roomy. Space detection umie więc obsłużyć topologię po podziale; problem
  do dalszego polishu leży w UI snap/draft flow, nie w samym wykrywaniu pokoi.
- Dodano test w `wall-geometry-references.test.ts`, że wall refs potrafią
  ignorować `point` snap, więc Build może unikać zbyt agresywnego łapania
  narożników.
- TypeScript check OK:
  `./packages/editor/node_modules/.bin/tsc --noEmit -p packages/editor/tsconfig.json`.
- Test runtime OK:
  `/Users/robert/.bun/bin/bun test packages/editor/src/lib/wall-geometry-references.test.ts`
  → 11 pass / 0 fail.
- Test space detection OK:
  `/Users/robert/.bun/bin/bun test packages/core/src/lib/space-detection.test.ts`
  → 4 pass / 0 fail.
- Browser smoke OK na `http://localhost:3002/?wallRefs=1&buildRefs=1`:
  panel `Wall refs debug` widoczny, brak błędów konsoli.
- Browser smoke manual:
  - nowy zamknięty prostokąt w 2D Build wygenerował nowe ściany oraz
    `Pomieszczenie 1 Podłoga` i `Pomieszczenie 1 Sufit`, z widoczną etykietą
    `Pomieszczenie 1`;
  - próba ściany działowej face-to-face przed poprawką kolejności snapowania
    pokazała niestabilny diagonalny snap i duplikowane nazwy ścian po split;
    wymaga ponownego testu po reloadzie/clean scene.
- Browser smoke po poprawce `includePoints: false` dla Build refs:
  - ściana działowa face-to-face w prostokątnym pokoju została narysowana jako
    pionowy segment przez środek, bez ucieczki do narożnika;
  - space detection rozbił pokój na dwa obszary i wygenerował drugą
    podłogę/sufit (`Pomieszczenie 2 Podłoga` / `Pomieszczenie 2 Sufit`);
  - brak błędów konsoli;
  - do polishu zostaje naming auto-zone po split: label drugiej zone wygląda
    jak odziedziczona nazwa, a slab/ceiling dostają kolejny numer.
- Naming auto-zone po split poprawiony:
  - domyślne `Pomieszczenie N` po podziale dostaje spójne nazwy
    `Pomieszczenie 1`, `Pomieszczenie 2`, ... jak slab/ceiling;
  - custom nazwa nadal dziedziczy się sensownie: `Salon`, `Salon 2`, ...
  - test `planAutoZonesForLevel` pokrywa oba przypadki.

### Update Codex 2026-05-27 — Build v2 visual/topology split

- Po teście Roberta miarka nadal nie daje oczekiwanego SketchUp flow, więc
  kierunek wraca do fundamentu: Build v2 / model ściany oparty o jawne
  referencje.
- Dodano `snapWallDraftPointDetailed(...)` w
  `packages/editor/src/components/tools/wall/wall-drafting.ts`.
- Nowy wynik snapu rozdziela:
  - `visualPoint` — dokładna referencja widoczna dla usera, np. lico/krawędź
    ściany,
  - `point` — punkt topologiczny bezpieczny dla `WallNode.start/end` oraz
    obecnego auto floor/ceiling/zone pipeline.
- Dotychczasowe `snapWallDraftPoint(...)` zostaje kompatybilne i zwraca tylko
  `point`, więc pozostałe narzędzia nie muszą znać nowego kontraktu.
- Floorplan Build używa teraz szczegółowego snapu w ruchu i kliknięciu:
  preview/grid event może dostać `visualPoint`, a zapis ściany dostaje nadal
  `point` topologiczny.
- Pliki dotknięte dla Build:
  - `packages/editor/src/components/tools/wall/wall-drafting.ts`
  - `packages/editor/src/components/editor/floorplan-panel.tsx`
  - `packages/editor/src/components/editor/use-floorplan-background-placement.ts`
- TypeScript check OK:
  `./packages/editor/node_modules/.bin/tsc --noEmit -p packages/editor/tsconfig.json`.
- Test runtime OK:
  `/Users/robert/.bun/bin/bun test packages/editor/src/lib/wall-geometry-references.test.ts packages/core/src/lib/space-detection.test.ts`
  → 15 pass / 0 fail.
- Próba dodania osobnego testu `wall-drafting.test.ts` została cofnięta, bo
  import `wall-drafting.ts` w Bun uruchamia viewer/CSG stack i pada na
  `three-mesh-bvh` (`The superclass is not a constructor`). Nie zostawiono
  czerwonego testu.
- Browser smoke OK na `http://localhost:3002/?wallRefs=1&buildRefs=1`:
  `Buduj B` widoczny, panel `Wall refs debug` widoczny, brak Next
  runtime/build error.
- Kolejny krok wykonany: 2D draft preview ma osobny
  `draftVisualStart` / `draftVisualEnd` i rysuje się po `visualPoint`, a nie
  wyłącznie po topologicznym `point`. Zapis ściany nadal używa topologii
  `WallNode.start/end`.
- Ponowny TypeScript check OK po preview split.
- Ponowny test runtime OK:
  `/Users/robert/.bun/bin/bun test packages/editor/src/lib/wall-geometry-references.test.ts packages/core/src/lib/space-detection.test.ts`
  → 15 pass / 0 fail.
- Browser smoke po preview split OK: `Buduj B` widoczny, `Wall refs debug`
  widoczny, brak Next runtime/build error.
- Test Roberta po preview split: działa. Build łapie wizualnie lico/krawędź,
  a zapis zostaje topologiczny.
- Zostaje: ręczny test rysowania face-to-face i decyzja, czy następny etap ma
  przenieść również 2D draft polygon w pełni na `visualPoint`, czy zostawić
  wizualny snap jako marker, a draft wall nadal topologiczny.

#### TODO — Build v2 / SketchUp-like walls

- Nie commitować nowych ścian bezpośrednio po face-offset snapie, jeśli obecny
  generator floor/ceiling/zone nadal oczekuje centerline/topologii ścian.
- Następny krok musi rozdzielić dwa pojęcia:
  - wizualny/precyzyjny snap do `face` / `edge` / `point`,
  - topologiczny punkt ściany używany do zamykania pomieszczeń.
- Alternatywa: zanim Build zacznie zapisywać ściany face-based, trzeba nauczyć
  dynamiczne floor/ceiling/zone rozumieć nową geometrię ścian i zamykanie po
  face/edge references.
- Po zgłoszeniu crasha Next dev server został uruchomiony ponownie i panel
  został sprawdzony po reloadzie; nie udało się odtworzyć błędu Next. W starym
  logu była jednorazowa seria WebGPU validation errors, ale po throttlingu
  `Cursor snap` browser smoke przeszedł bez błędów konsoli.

### Update Codex 2026-05-27 — Tape Measure wall refs snap

- Tape Measure zaczyna używać wspólnego silnika
  `findNearestWallReferenceSnapAcrossWalls(...)` zamiast własnej ręcznej logiki
  snapowania ścian.
- Snap miarki rozróżnia teraz referencje ściany:
  - `point` → punkt/narożnik/midpoint ściany,
  - `edge` → krawędź ściany albo krawędź otworu,
  - `face` → rzeczywiste lico ściany (`front` / `back` / `top` / `start` /
    `end` / `center`).
- Guide wyciągany z lica/krawędzi dostaje linię równoległą albo prostopadłą do
  ściany na podstawie referencji, więc zachowanie jest bliżej SketchUp: guide
  startuje z prawdziwego lica/krawędzi, a nie z midpointu/centerline.
- Pliki dotknięte:
  - `packages/editor/src/components/tools/measure/measure-tool.tsx`
  - `HANDOFF.md`
- TypeScript check OK:
  `./packages/editor/node_modules/.bin/tsc --noEmit -p packages/editor/tsconfig.json`.
- Test runtime OK:
  `/Users/robert/.bun/bin/bun test packages/editor/src/lib/wall-geometry-references.test.ts`
  → 11 pass / 0 fail.
- Browser smoke OK na `http://localhost:3002/?wallRefs=1&buildRefs=1`:
  - strona ładuje się bez runtime crasha,
  - `Miarka T` aktywuje się z toolbaru,
  - panel `Wall refs debug` widzi ściany i referencje.
- Zostaje do ręcznego sprawdzenia UX: czy hover-snap miarki na konkretnych
  licach/krawędziach zachowuje się dokładnie jak oczekiwany SketchUp flow
  podczas realnego przeciągania guide'ów po obu stronach ścian.
- Update po teście Roberta: sama ścieżka `grid:move` łapała głównie dolne
  płaszczyzny, więc dodano drugi snap path oparty o promień z kamery do
  podwyższonych referencji ściany (`y > 0`): górne narożniki, top edges i
  pionowe krawędzie. Cel: dać miarce możliwość złapania wysokości pomieszczenia
  i górnych referencji ścian, a nie tylko dolnych linii na podłodze.
- Ponowny TypeScript check OK:
  `./packages/editor/node_modules/.bin/tsc --noEmit -p packages/editor/tsconfig.json`.
- Browser smoke po zmianie height snap OK:
  `Miarka T` aktywna, `Wall refs debug` widoczny, brak Next runtime/build error.
- Update po decyzji produktowej: WIP snapowania wysokości w Tape Measure został
  wycofany z aktualnego diffu. Dalszy kierunek idzie przez Build v2 /
  SketchUp-like wall refs jako fundament, a nie przez łatanie miarki.

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

### Osobny task — Plan 3D multi-kind po stronie Pascala

#### Prompt dla Codexa

```md
# Plan 3D multi-kind — implementacja po stronie Pascala (zadanie dla Codex)

## Kontekst

Robert decyzja produktowa 2026-05-25: każdy projekt w GSI ma dwa autonomiczne floor_plans:
- `kind='site_state'` — stan zastany (fizyczne wymiary, pomiary przed remontem)
- `kind='designed'` — projektowany (po zmianach: ściany docelowe, meble, układ)

GSI side (claude.ai, gsi-os repo) już zaimplementowane i przetestowane lokalnie 2026-05-26
(w worktree, do commit'a wkrótce):
- migracja `floor_plans.kind ENUM('site_state','designed')` + composite unique `(project_id, kind)`
- API: `GET/PUT/DELETE /api/inwestycje/[id]/floor-plan?kind=K` (fallback 'designed')
- nowy endpoint: `POST /api/inwestycje/[id]/floor-plan/clone` body `{from, to}`
- `PascalEmbed` przekazuje `kind` w URL jako `&kind=K` i handluje `pascal:clone` → POST clone → `gsi:clone-ack`
- `/app/inwestycje/[id]/plan-3d?kind=K` z sub-tabami (Stan zastany amber / Projektowany indigo)
- `ProjectTabModels3D` ma 2 karty Pascal w grid'zie per kind (zamiast 1 empty state)

## Co Codex robi (gsigrupa/editor)

### 1. URL parser w `/embed` page

Dorzuć parsowanie `kind` z searchParams obok istniejącego `projectId` + `parentOrigin`:

```ts
const kindParam = searchParams.get('kind');
const kind: 'site_state' | 'designed' =
  kindParam === 'site_state' || kindParam === 'designed' ? kindParam : 'designed';
```

Trzymaj `kind` w state komponentu; będzie potrzebne we wszystkich wychodzących
messages i w conditional rendering toolbar'a.

### 2. Rozszerz wychodzące postMessage o `kind`

GSI back-compat działa (gdy brak kind używa propsa), ale preferuj explicit:

| Type | Payload (nowe pole) |
|---|---|
| `pascal:ready` | `{ type, projectId, kind }` |
| `pascal:save` | `{ type, projectId, kind, graph }` |
| `pascal:navigate-back` (alias `gsi:navigate-back`) | `{ type, projectId, kind }` |

GSI odpowiada na `pascal:ready`: `{ type: 'gsi:scene', graph, kind }`; graph już
respektuje kind po stronie GSI fetcha.

### 3. Nowy message `pascal:clone`

Trigger: button "Skopiuj jako bazę projektu" w toolbar (widoczny tylko gdy
`kind === 'site_state'`).

Payload do parent:

```ts
{
  type: 'pascal:clone',
  projectId: string,
  from: 'site_state',
  to: 'designed'
}
```

GSI ack:

```ts
{
  type: 'gsi:clone-ack',
  ok: boolean,
  from?: 'site_state' | 'designed',
  to?: 'site_state' | 'designed',
  error?: string
}
```

UX: confirm dialog "Skopiujesz stan zastany do projektu. Aktualny projektowy
plan zostanie nadpisany. Kontynuować?" GSI clone robi upsert i nadpisze istniejący
`designed`. Po ack:
- `ok: true` → toast "Skopiowano"
- `ok: false` → toast `ack.error || 'Błąd kopiowania'`

### 4. Toolbar badge per kind

Flat icons, bez emoji. Reguła Robert 2026-05-26: zero emoji w kodzie. Używaj
`lucide-react`, ten sam stack co dla `Ruler` / `Eraser`.

Propozycja:

```tsx
import { Construction, Ruler as RulerIcon } from 'lucide-react';

{kind === 'site_state' ? (
  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-100 text-amber-900 text-xs font-medium">
    <Construction className="w-3.5 h-3.5" />
    STAN ZASTANY
  </span>
) : (
  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-indigo-100 text-indigo-900 text-xs font-medium">
    <RulerIcon className="w-3.5 h-3.5" />
    PROJEKTOWANY
  </span>
)}
```

Alternatywy z `lucide-react`: `HardHat`, `Pencil`, `Wrench`, `PencilRuler`.
Zero emoji w label'ach toolbar'a.

### 5. Button "Skopiuj jako bazę projektu"

Lokalizacja: toolbar obok "Wróć do projektu", widoczny tylko gdy
`kind === 'site_state'`. Klik → confirm → `pascal:clone` → czeka na
`gsi:clone-ack` → toast.

### 6. TS check + commit + push

```bash
cd /Users/robert/Code/editor/packages/editor
./node_modules/.bin/tsc --noEmit
```

Commit message przykład:

```bash
feat(embed): multi-kind support (site_state vs designed)
```

Push do `gsigrupa/editor:main` → autodeploy do `gsi-plan-3d.vercel.app`.
GSI iframe (lokalny `localhost:3002` + prod) auto-podejmie nowy build.

### Test e2e wspólny

1. Project 4 w GSI → tab Model 3D → 2 karty Plan 3D (Stan zastany + Projektowany).
2. Klik "Stan zastany" → page `/plan-3d?kind=site_state` → Pascal pokazuje pustą scenę + toolbar badge "STAN ZASTANY" (amber).
3. Rysuję ściany → autosave → GSI PUT `?kind=site_state` → zapisane w `floor_plans WHERE kind='site_state'`.
4. Toolbar button "Skopiuj jako bazę projektu" widoczny (bo kind=site_state) → klik → confirm → `pascal:clone` → GSI POST clone → ack OK → toast.
5. Sub-tab GSI "Projektowany" → page `/plan-3d?kind=designed` → Pascal pokazuje skopiowane ściany ze stanu zastanego + badge "PROJEKTOWANY" (indigo).
6. Dorzucam meble → autosave → GSI PUT `?kind=designed` → niezależnie od `site_state`.
7. Wracam na "Stan zastany" — ściany dalej takie same jak w kroku 3, bez mebli dodanych w kroku 6.

### Po skończeniu

Zaktualizuj `HANDOFF.md` sekcję "Update Codex 2026-05-26 — Multi-kind" z:
- listą plików dotkniętych,
- co działa (browser smoke wyniki),
- co zostaje,
- TS check OK / fail.
```

Pełna robocza specyfikacja implementacji jest w sekcji poniżej:
`Faza 2 (2026-05-25 → 2026-05-26): multi-kind support — site_state vs designed`.

### Faza 2 (2026-05-25 → 2026-05-26): multi-kind support — site_state vs designed

Decyzja produktowa Robert 2026-05-25: każdy projekt ma DWA autonomiczne `floor_plans`:
- `kind = 'site_state'` — stan zastany (fizyczne wymiary, ground truth)
- `kind = 'designed'` — wersja projektowana (meble, zmiany układu)

**GSI side — GOTOWE i przetestowane 2026-05-26 (commit do push w worktree):**

- ✅ Migracja `2026-05-26a_floor_plans_multi_kind.sql` — `ADD COLUMN kind ENUM('site_state','designed') DEFAULT 'designed'` + composite UNIQUE `(project_id, kind)`. Backfill: istniejące rekordy → `kind='designed'`. **Już zaaplikowana lokalnie.**
- ✅ API `/api/inwestycje/[id]/floor-plan` — query `?kind=K` (fallback `'designed'`). GET/PUT/DELETE wszystkie respektują kind. **Back-compat: brak `?kind=` → 'designed', niezmieniony stary klient nadal działa.**
- ✅ API `/api/inwestycje/[id]/floor-plan/clone` (NOWY) — `POST` body `{from, to}` → kopiuje `data_json` z source kind do target kind. Walidacja: from i to muszą być różne i być valid kind enum.
- ✅ `PascalEmbed.tsx` — prop `kind: 'site_state' | 'designed'` (default `'designed'`), URL embed param `&kind=K`. Handler `pascal:clone` → POST clone → `gsi:clone-ack { ok, from?, to?, error? }`.
- ✅ `/app/inwestycje/[id]/plan-3d/page.tsx` — sub-tab bar (Stan zastany amber / Projektowany indigo) + description per kind. `key={kind}` na PascalEmbed wymusza remount przy zmianie sub-taba (świeży iframe URL → fresh pascal:ready dla nowego kind).
- ✅ `ProjectTabModels3D.tsx` — 2 osobne karty per kind w grid'zie (zamiast 1). Thumbnail każdej karty fetcha `/floor-plan?kind=K`. Badge amber/indigo. Link `?kind=K`.

**Co Codex robi po stronie Pascala (do zrobienia):**

#### 1. URL parser w `/embed` page

W komponencie `embed-scene-loader.tsx` (albo gdziekolwiek parsujesz `projectId` + `parentOrigin` z URL'a):

```ts
const kindParam = searchParams.get('kind');
const kind: 'site_state' | 'designed' =
  kindParam === 'site_state' || kindParam === 'designed' ? kindParam : 'designed';
```

Trzymaj `kind` w state komponentu — będzie potrzebne we wszystkich wychodzących messages.

#### 2. Rozszerz wychodzące postMessage payloads o `kind`

GSI patrzy w pierwszej kolejności na `data.kind` z payload (jeśli go nie ma, używa kindu z propsa `kind` przekazywanego do `PascalEmbed`). Czyli back-compat jest, ale **preferujemy explicit** w payloadach:

| Type | Payload (nowe pole pogrubione) |
|---|---|
| `pascal:ready` | `{ type, projectId, **kind** }` |
| `pascal:save` | `{ type, projectId, **kind**, graph }` |
| `pascal:navigate-back` (alias `gsi:navigate-back`) | `{ type, projectId, **kind** }` |

GSI odpowiada na `pascal:ready` payloadem `{ type: 'gsi:scene', graph, kind }` — graph już respektuje kind po stronie GSI fetcha.

#### 3. Nowy message `pascal:clone`

Trigger: button "Skopiuj jako bazę projektu" w toolbar (widoczny **tylko gdy `kind === 'site_state'`** — patrz #5).

Payload:
```ts
{
  type: 'pascal:clone',
  projectId: string,
  from: 'site_state',
  to: 'designed'
}
```

GSI odpowiada:
```ts
{
  type: 'gsi:clone-ack',
  ok: boolean,
  from?: 'site_state' | 'designed',
  to?: 'site_state' | 'designed',
  error?: string,  // gdy ok === false
}
```

Po sukcesie pokaż toast "Skopiowano jako projekt" (albo coś podobnego). Po błędzie toast error z `ack.error`. Możesz potem programmatycznie przełączyć user'a na widok `kind='designed'` (jeśli sensowne UX) — to wymaga komunikatu **z parent do iframe** typu `gsi:switch-kind` lub po prostu zostawiamy user'owi sub-tab w GSI shell'u.

#### 4. Toolbar badge per kind — flat icons z lucide-react

**Reguła: zero emoji** (Robert 2026-05-26). Użyj flat icons z `lucide-react` (ten sam stack co masz dla `Ruler` / `Eraser`). Propozycja:

```tsx
import { Construction, Ruler as RulerIcon } from 'lucide-react';

{kind === 'site_state' ? (
  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded
                   bg-amber-100 text-amber-900 text-xs font-medium">
    <Construction className="w-3.5 h-3.5" />
    STAN ZASTANY
  </span>
) : (
  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded
                   bg-indigo-100 text-indigo-900 text-xs font-medium">
    <RulerIcon className="w-3.5 h-3.5" />
    PROJEKTOWANY
  </span>
)}
```

`Construction` (hełm budowlany, semantyczne dla "remont/zastany") i `Ruler` (linijka/kątomierz, semantyczne dla "projektowanie") to propozycja — wybierz swoje jeśli pasują lepiej (np. `HardHat`, `Pencil`, `Wrench`, `PencilRuler`). **Bez emoji w label'ach.**

#### 5. Button "Skopiuj jako bazę projektu"

Lokalizacja: toolbar (np. obok "Wróć do projektu"), widoczny **TYLKO gdy `kind === 'site_state'`**. Klik → `pascal:clone`.

Optymalne UX: confirm dialog "Skopiujesz stan zastany do projektu. Aktualny projektowy plan zostanie nadpisany. Kontynuować?" — bo clone nadpisuje istniejący `designed` jeśli był (upsert po stronie GSI).

Po ack:
- `ok: true` → toast "Skopiowano" + opcjonalnie poinformuj user'a żeby przełączył się na widok "Projektowany" w GSI sub-tab barze.
- `ok: false` → toast `ack.error || 'Błąd kopiowania'`.

#### 6. TS check + commit + push do `gsigrupa/editor:main`

Po pushu autodeploy do `gsi-plan-3d.vercel.app`. GSI iframe (lokalny `localhost:3002` + prod `gsi-plan-3d.vercel.app`) auto-podejmie nowy build.

**Test e2e wspólny:**
1. Project 4 w GSI → tab Model 3D → 2 karty Plan 3D (Stan zastany + Projektowany).
2. Klik "Stan zastany" → page `/plan-3d?kind=site_state` → Pascal pokazuje pustą scenę + toolbar badge "STAN ZASTANY" (amber).
3. Rysuję ściany → autosave → GSI PUT `?kind=site_state` → zapisane w `floor_plans WHERE kind='site_state'`.
4. Toolbar button "Skopiuj jako bazę projektu" widoczny (bo kind=site_state) → klik → `pascal:clone` → GSI POST clone → ack OK → toast.
5. Sub-tab GSI "Projektowany" → page `/plan-3d?kind=designed` → Pascal pokazuje skopiowane ściany ze stanu zastanego + badge "PROJEKTOWANY" (indigo).
6. Dorzucam meble → autosave → GSI PUT `?kind=designed` → niezależnie od `site_state`.
7. Wracam na "Stan zastany" — ściany dalej takie same jak w kroku 3, BEZ mebli dodanych w kroku 6.

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
