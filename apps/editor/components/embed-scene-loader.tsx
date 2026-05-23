'use client'

/**
 * GSI fork: embed scene loader — Pascal w iframe na gsi-platform.pl/app/plan-test.
 *
 * Architektura: brak własnego /api/scenes storage — wszystko via postMessage
 * do parent (GSI Next.js). GSI utrzymuje floor plan w MySQL (tabela
 * floor_plans, jeden per projekt). Pascal embed jest stateless od strony
 * persistencji.
 *
 * Protokół (origin: gsi-plan-3d.vercel.app ↔ parent: gsi-platform.pl):
 *   1. Pascal mount → postMessage({ type: 'pascal:ready', projectId })
 *   2. GSI fetch GET /api/inwestycje/[projectId]/floor-plan → postMessage
 *      ({ type: 'gsi:scene', graph }) gdzie graph może być null (nowy plan)
 *   3. Pascal autosave → postMessage({ type: 'pascal:save', projectId, graph })
 *   4. GSI PUT /api/inwestycje/[projectId]/floor-plan z graphem
 *
 * Origin validation: nasłuchujemy tylko messages z parent origin
 * (z URL search params lub document.referrer fallback).
 */

import {
  applySceneGraphToEditor,
  Editor,
  ItemsPanel,
  type SceneGraph,
  type SidebarTab,
} from '@pascal-app/editor'
import { ArrowLeft, Layers, Package, Settings } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CollapseSidebarButton,
  CommunityViewerToolbarRight,
  ViewModeControl,
} from './viewer-toolbar'

/**
 * GSI fork: button "Wróć do projektu" w viewer toolbar (lewa strona).
 * Styl matchujący Pascal toolbar (TOOLBAR_CONTAINER pattern), pozycja
 * przed CollapseSidebarButton + ViewModeControl. Klik → postMessage do
 * GSI parent z prośbą o nawigację (parent czeka 1.2s na flush autosave,
 * potem push do /app/inwestycje/[id]?tab=model3d).
 */
function BackToProjectButton({ parentOrigin }: { parentOrigin: string }) {
  const handleClick = () => {
    if (typeof window === 'undefined' || !window.parent || window.parent === window) return
    window.parent.postMessage({ type: 'gsi:navigate-back' }, parentOrigin)
  }
  return (
    <div className="inline-flex h-8 items-stretch overflow-hidden rounded-xl border border-border bg-background/90 shadow-2xl backdrop-blur-md">
      <button
        aria-label="Wróć do projektu"
        className="flex items-center gap-1.5 px-3 text-muted-foreground/80 text-xs transition-colors hover:bg-accent hover:text-foreground/90"
        onClick={handleClick}
        type="button"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <span>Wróć do projektu</span>
      </button>
    </div>
  )
}

const SIDEBAR_TABS: (SidebarTab & { component: React.ComponentType })[] = [
  {
    id: 'site',
    label: 'Scena',
    component: () => null,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Layers className="h-5 w-5" />,
  },
  {
    id: 'items',
    label: 'Elementy',
    component: ItemsPanel,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Package className="h-5 w-5" />,
  },
  {
    id: 'settings',
    label: 'Ustawienia',
    component: () => null,
    mobileDefaultSnap: 0.5,
    mobileIcon: <Settings className="h-5 w-5" />,
  },
]

interface EmbedSceneLoaderProps {
  projectId: string
  parentOrigin: string
}

const EMPTY_GRAPH: SceneGraph = { nodes: {}, rootNodeIds: [] }

export function EmbedSceneLoader({ projectId, parentOrigin }: EmbedSceneLoaderProps) {
  const [initialGraph, setInitialGraph] = useState<SceneGraph | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const initialGraphRef = useRef<SceneGraph | null>(null)

  // Postsuj 'pascal:ready' po mount + nasłuchuj na 'gsi:scene' z parent.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.parent || window.parent === window) {
      setLoadError('Pascal embed musi być w iframe (window.parent missing).')
      return
    }

    const handler = (event: MessageEvent) => {
      // Origin validation — odrzucamy messages z innych źródeł.
      if (event.origin !== parentOrigin) return
      const data = event.data as { type?: string; graph?: SceneGraph | null }
      if (!data || typeof data !== 'object') return

      if (data.type === 'gsi:scene') {
        const graph = data.graph ?? EMPTY_GRAPH
        initialGraphRef.current = graph
        setInitialGraph(graph)
        // Apply do live editor w przypadku gdyby Editor już był mounted.
        applySceneGraphToEditor(graph)
      }
    }

    window.addEventListener('message', handler)

    // Powiadom parent że jesteśmy gotowi do otrzymania sceny.
    window.parent.postMessage({ type: 'pascal:ready', projectId }, parentOrigin)

    return () => window.removeEventListener('message', handler)
  }, [projectId, parentOrigin])

  // onLoad handler — Editor woła to zamiast czytać z /api/scenes.
  // Jeśli GSI nie odpisał jeszcze, zwracamy EMPTY_GRAPH (user widzi puste
  // płótno) i czekamy na 'gsi:scene' message (applySceneGraphToEditor
  // później wstrzyknie graph).
  const handleLoad = useCallback(async (): Promise<SceneGraph> => {
    return initialGraphRef.current ?? EMPTY_GRAPH
  }, [])

  // onSave handler — Pascal autosave woła to, my forwardujemy do parent.
  const handleSave = useCallback(
    async (graph: SceneGraph): Promise<void> => {
      if (typeof window === 'undefined' || !window.parent || window.parent === window) return
      setSaveStatus('saving')
      try {
        window.parent.postMessage({ type: 'pascal:save', projectId, graph }, parentOrigin)
        // Optymistic — zakładamy że GSI zapisze. Real ack przez 'gsi:save-ack'
        // (TODO faza B11 gdy będzie potrzebne).
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 1200)
      } catch {
        setSaveStatus('error')
      }
    },
    [projectId, parentOrigin],
  )

  const handleThumbnail = useCallback(
    async (_blob: Blob): Promise<void> => {
      // TODO: postMessage z blob jako base64/ArrayBuffer dla GSI thumbnail upload.
      // YAGNI na MVP — embed nie wymaga thumbnaila.
    },
    [],
  )

  if (loadError) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background p-6">
        <div className="max-w-md rounded-lg border border-destructive/50 bg-background p-4 text-center shadow-xl">
          <p className="font-medium text-destructive text-sm">{loadError}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-screen w-screen">
      {saveStatus === 'saving' && (
        <div className="pointer-events-none absolute right-4 bottom-4 z-50 rounded-md border border-border bg-background/90 px-3 py-1.5 text-muted-foreground text-xs shadow-sm backdrop-blur">
          Zapisuję…
        </div>
      )}
      {saveStatus === 'error' && (
        <div className="pointer-events-none absolute right-4 bottom-4 z-50 rounded-md border border-destructive/50 bg-background px-3 py-1.5 text-destructive text-xs shadow-sm">
          Błąd zapisu — sprawdź połączenie
        </div>
      )}
      <Editor
        layoutVersion="v2"
        onLoad={handleLoad}
        onSave={handleSave}
        onThumbnailCapture={handleThumbnail}
        projectId={projectId}
        sidebarTabs={SIDEBAR_TABS}
        viewerToolbarLeft={
          <>
            <CollapseSidebarButton />
            <BackToProjectButton parentOrigin={parentOrigin} />
            <ViewModeControl />
          </>
        }
        viewerToolbarRight={<CommunityViewerToolbarRight />}
      />
    </div>
  )
}
