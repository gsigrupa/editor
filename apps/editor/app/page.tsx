'use client'

import { Editor, ItemsPanel } from '@pascal-app/editor'
import { Layers, Package, Settings } from 'lucide-react'
import Link from 'next/link'
import {
  CommunityViewerToolbarLeft,
  CommunityViewerToolbarRight,
} from '@/components/viewer-toolbar'

const SIDEBAR_TABS = [
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

const PROJECT_ID = 'local-editor'

// GSI fork: banner "Edytor lokalny — bez zapisu" jako sibling w viewerToolbarLeft
// (zaraz po 3D/2D/Split). Pozycjonowanie naturalne przez flex gap-2 + ml-[26px]
// daje dystans ~34px od konca Split toolbar'a.
function LocalSceneBanner() {
  return (
    <div className="ml-[26px] flex items-center gap-2 rounded-full border border-border/60 bg-background/90 px-3 py-1 text-xs shadow-sm backdrop-blur">
      <span className="text-muted-foreground">Edytor lokalny — bez zapisu</span>
      <Link className="font-medium text-foreground hover:underline" href="/scenes">
        Otwórz
      </Link>
      <span aria-hidden className="text-muted-foreground">
        ·
      </span>
      <Link className="font-medium text-foreground hover:underline" href="/scenes">
        Nowy
      </Link>
    </div>
  )
}

export default function Home() {
  return (
    <div className="relative h-screen w-screen">
      <Editor
        layoutVersion="v2"
        projectId={PROJECT_ID}
        sidebarTabs={SIDEBAR_TABS}
        viewerToolbarLeft={
          <>
            <CommunityViewerToolbarLeft />
            {PROJECT_ID === 'local-editor' && <LocalSceneBanner />}
          </>
        }
        viewerToolbarRight={<CommunityViewerToolbarRight />}
      />
    </div>
  )
}
