import { Keyboard } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from './../../../../../components/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './../../../../../components/ui/primitives/dialog'
import { ShortcutToken } from './../../../../../components/ui/primitives/shortcut-token'

type Shortcut = {
  keys: string[]
  action: string
  note?: string
}

type ShortcutCategory = {
  title: string
  shortcuts: Shortcut[]
}

const KEY_DISPLAY_MAP: Record<string, string> = {
  'Arrow Up': '↑',
  'Arrow Down': '↓',
  Esc: '⎋',
  Shift: '⇧',
  Space: '␣',
}

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    title: 'Nawigacja edytora',
    shortcuts: [
      { keys: ['1'], action: 'Faza Teren' },
      { keys: ['2'], action: 'Faza Konstrukcja' },
      { keys: ['3'], action: 'Faza Umebluj' },
      { keys: ['S'], action: 'Warstwa konstrukcji' },
      { keys: ['F'], action: 'Warstwa umeblowania' },
      { keys: ['Z'], action: 'Warstwa stref' },
      {
        keys: ['Cmd/Ctrl', 'Arrow Up'],
        action: 'Następne piętro w aktywnym budynku',
      },
      {
        keys: ['Cmd/Ctrl', 'Arrow Down'],
        action: 'Poprzednie piętro w aktywnym budynku',
      },
      { keys: ['Cmd/Ctrl', 'B'], action: 'Przełącz panel boczny' },
    ],
  },
  {
    title: 'Tryby i historia',
    shortcuts: [
      { keys: ['Space'], action: 'Tryb zaznaczania (alias: V)' },
      { keys: ['B'], action: 'Tryb budowania' },
      {
        keys: ['Esc'],
        action: 'Anuluj aktywne narzędzie i wróć do trybu zaznaczania',
      },
      { keys: ['Delete / Backspace'], action: 'Usuń zaznaczone obiekty' },
      { keys: ['Cmd/Ctrl', 'Z'], action: 'Cofnij' },
      { keys: ['Cmd/Ctrl', 'Shift', 'Z'], action: 'Powtórz' },
    ],
  },
  {
    title: 'Zaznaczenie',
    shortcuts: [
      {
        keys: ['Shift', 'Lewy klik'],
        action: 'Dodaj lub usuń obiekt z zaznaczenia (multi-select)',
        note: 'Działa w trybie zaznaczania. Cmd/Ctrl też zadziała (alias).',
      },
    ],
  },
  {
    title: 'Narzędzia rysowania',
    shortcuts: [
      {
        keys: ['Shift'],
        action: 'Tymczasowo wyłącz przyciąganie kątowe (ściany, podłogi, sufity)',
        note: 'Przytrzymaj podczas rysowania.',
      },
      {
        keys: ['0-9', 'Enter'],
        action: 'Wpisz długość ściany (np. 105 + Enter — w aktywnej jednostce)',
        note: 'Działa po pierwszym kliku ściany.',
      },
    ],
  },
  {
    title: 'Umieszczanie elementu',
    shortcuts: [
      { keys: ['R'], action: 'Obróć obiekt zgodnie z ruchem wskazówek / przełącz drzwi otwarte/zamknięte' },
      { keys: ['T'], action: 'Obróć obiekt przeciwnie do wskazówek / zamknij wybrane drzwi' },
      {
        keys: ['Shift'],
        action: 'Tymczasowo pomiń walidację umiejscowienia',
        note: 'Przytrzymaj podczas umieszczania.',
      },
    ],
  },
  {
    title: 'Kamera',
    shortcuts: [
      {
        keys: ['H'],
        action: 'Tryb Pan (SketchUp toggle)',
        note: 'Wciśnij H — kamera w trybie przesuwania. Drugi raz H / Esc / O = wyjście.',
      },
      {
        keys: ['O'],
        action: 'Tryb Orbit',
        note: 'Wciśnij O — kamera w trybie obrotu. Drugi raz O / Esc / H = wyjście.',
      },
      {
        keys: ['Middle click'],
        action: 'Orbit override (chwilowy)',
        note: 'Przytrzymaj scroll wheel + drag = orbit, niezależnie od aktywnego trybu. Zwolnienie wraca do trybu.',
      },
      {
        keys: ['Right click'],
        action: 'Orbit kamery (bez modyfikatora)',
      },
    ],
  },
]

function getDisplayKey(key: string, isMac: boolean): string {
  if (key === 'Cmd/Ctrl') return isMac ? '⌘' : 'Ctrl'
  if (key === 'Delete / Backspace') return isMac ? '⌫' : 'Backspace'
  return KEY_DISPLAY_MAP[key] ?? key
}

function ShortcutKeys({ keys }: { keys: string[] }) {
  const [isMac, setIsMac] = useState(true)

  useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().indexOf('MAC') >= 0)
  }, [])

  return (
    <div className="flex flex-wrap items-center gap-1">
      {keys.map((key, index) => (
        <div className="flex items-center gap-1" key={`${key}-${index}`}>
          {index > 0 ? <span className="text-[10px] text-muted-foreground">+</span> : null}
          <ShortcutToken displayValue={getDisplayKey(key, isMac)} value={key} />
        </div>
      ))}
    </div>
  )
}

export function KeyboardShortcutsDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="w-full justify-start gap-2" variant="outline">
          <Keyboard className="size-4" />Skróty klawiszowe</Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>Skróty klawiszowe</DialogTitle>
          <DialogDescription>
            Skróty są zależne od aktualnej fazy i wybranego narzędzia.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4">
          {SHORTCUT_CATEGORIES.map((category) => (
            <section className="space-y-2" key={category.title}>
              <h3 className="font-medium text-sm">{category.title}</h3>
              <div className="overflow-hidden rounded-md border border-border/80">
                {category.shortcuts.map((shortcut, index) => (
                  <div
                    className="grid grid-cols-[minmax(130px,220px)_1fr] gap-3 px-3 py-2"
                    key={`${category.title}-${shortcut.action}`}
                  >
                    <ShortcutKeys keys={shortcut.keys} />
                    <div>
                      <p className="text-sm">{shortcut.action}</p>
                      {shortcut.note ? (
                        <p className="text-muted-foreground text-xs">{shortcut.note}</p>
                      ) : null}
                    </div>
                    {index < category.shortcuts.length - 1 ? (
                      <div className="col-span-2 border-border/60 border-b" />
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
