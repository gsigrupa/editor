'use client'

/**
 * GSI fork: agregowany panel dla multi-select ścian.
 *
 * Aktywuje się gdy user trzyma Shift i klika kolejne ściany w trybie
 * zaznaczania. Pokazuje:
 *   - liczbę zaznaczonych ścian
 *   - łączną długość (sumę długości każdej, uwzględnia krzywizny)
 *   - łączną powierzchnię (Σ length × height, brutto bez odjęcia okien/drzwi)
 *
 * Live update: useScene selector subskrybuje konkretne nodes po id,
 * więc każda zmiana wymiaru (slider, drag handle, dodanie/usunięcie
 * ze selekcji) re-rendruje sumę bez dodatkowych hooków.
 */

import { type AnyNodeId, getWallCurveLength, useScene, type WallNode } from '@pascal-app/core'
import { useShallow } from 'zustand/react/shallow'
import { PanelSection } from '../controls/panel-section'
import { PanelWrapper } from './panel-wrapper'

const DEFAULT_WALL_HEIGHT_FALLBACK = 2.7

interface WallMultiSelectPanelProps {
  ids: string[]
  onClose: () => void
}

export function WallMultiSelectPanel({ ids, onClose }: WallMultiSelectPanelProps) {
  // useShallow porównuje element-wise — gdy te same wall nodes są w
  // tablicy, Zustand zwraca poprzedni snapshot bez re-render (bez tego
  // każde wywołanie selector tworzy nową tablicę → infinite loop).
  // Aktualizacja triggeruje gdy: zmieniono wymiar wall'a (nowa reference
  // w state.nodes), dodano/usunięto ścianę z selekcji (ids zmienia się
  // przez prop), albo wall usunięty (filter wyłapie i tablica się skróci).
  const walls = useScene(
    useShallow((state) =>
      ids
        .map((id) => state.nodes[id as AnyNodeId])
        .filter((node): node is WallNode => !!node && node.type === 'wall'),
    ),
  )

  const wallCount = walls.length
  const totalLengthM = walls.reduce((sum, wall) => sum + getWallCurveLength(wall), 0)
  const totalAreaM2 = walls.reduce(
    (sum, wall) => sum + getWallCurveLength(wall) * (wall.height ?? DEFAULT_WALL_HEIGHT_FALLBACK),
    0,
  )

  // Edge case: gdy selekcja zawiera nie-wall nody (np. zaczynamy od ściany
  // potem klikamy slab z Shift), wallCount < ids.length. Powiadamiamy
  // o tym żeby user wiedział że agregat dotyczy tylko ścian.
  const hasNonWallSelected = wallCount < ids.length

  return (
    <PanelWrapper
      icon="/icons/wall.png"
      onClose={onClose}
      title={`${wallCount} ${pluralWalls(wallCount)}`}
      width={280}
    >
      <PanelSection title="Łączny pomiar">
        <div className="flex items-center justify-between px-2 py-1 text-muted-foreground text-sm">
          <span>Długość</span>
          <span className="font-mono tabular-nums text-foreground">
            {totalLengthM.toFixed(2)} m
          </span>
        </div>
        <div className="flex items-center justify-between px-2 py-1 text-muted-foreground text-sm">
          <span>Powierzchnia</span>
          <span className="font-mono tabular-nums text-foreground">
            {totalAreaM2.toFixed(2)} m²
          </span>
        </div>
        {hasNonWallSelected && (
          <p className="px-2 pt-1 text-[10px] text-muted-foreground">
            Agregat dotyczy tylko ścian ({wallCount} z {ids.length} zaznaczonych obiektów).
          </p>
        )}
      </PanelSection>
    </PanelWrapper>
  )
}

function pluralWalls(n: number): string {
  if (n === 1) return 'ściana zaznaczona'
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'ściany zaznaczone'
  return 'ścian zaznaczonych'
}
