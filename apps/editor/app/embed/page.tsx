/**
 * GSI fork: embed entrypoint dla Pascal w iframe na gsi-platform.pl.
 *
 * Query params:
 *   - projectId (required): id GSI projektu, scope dla floor_plan storage
 *   - parentOrigin (required): origin GSI parent (np. https://gsi-platform.pl)
 *
 * Pełna architektura — patrz `embed-scene-loader.tsx`.
 */

import { EmbedSceneLoader } from '@/components/embed-scene-loader'

export const dynamic = 'force-dynamic'

interface EmbedPageProps {
  searchParams: Promise<{ projectId?: string; parentOrigin?: string }>
}

export default async function EmbedPage({ searchParams }: EmbedPageProps) {
  const { projectId, parentOrigin } = await searchParams

  if (!projectId || !parentOrigin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md rounded-lg border border-destructive/50 bg-background p-6 text-center shadow-xl">
          <p className="font-mono text-muted-foreground text-xs uppercase tracking-wide">400</p>
          <h1 className="mt-2 font-semibold text-lg">Brakuje parametrów</h1>
          <p className="mt-2 text-muted-foreground text-sm">
            Embed wymaga{' '}
            <code className="font-mono text-xs">?projectId=X&amp;parentOrigin=https://...</code>
          </p>
        </div>
      </div>
    )
  }

  // Walidacja parent origin — musi byc HTTPS URL (anti-injection).
  try {
    const parsed = new URL(parentOrigin)
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
      throw new Error('parentOrigin musi byc HTTPS')
    }
  } catch {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md rounded-lg border border-destructive/50 bg-background p-6 text-center shadow-xl">
          <p className="font-medium text-destructive text-sm">
            Nieprawidłowy parentOrigin (oczekiwany HTTPS URL).
          </p>
        </div>
      </div>
    )
  }

  return <EmbedSceneLoader parentOrigin={parentOrigin} projectId={projectId} />
}
