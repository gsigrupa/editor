# CODEX.md

## Context

- Repo: `gsigrupa/editor` (Pascal fork, MIT) — 3D plan editor embedded in GSI Platform (`gsi-os`) as an iframe.
- Codex domain: `packages/editor` package (React + R3F + WebGPU r184).
- Workflow split: Claude (`claude.ai`) stays on `gsi-os` main app; Codex works only on the Pascal fork.

## Rules

1. Always read `HANDOFF.md` at the beginning of a session. It contains the current state.
2. After implementation and TypeScript check, stop. Wait for user approval before `git commit`.
3. After commit, stop. Wait for user approval before `git push` because `main` autodeploys to Vercel.
4. Update `HANDOFF.md` after every session with what was done and what remains.
5. If changing the `postMessage` interface or `floor_plans` schema, tell the user that the "Codex Pascal handoff" note in their vault must be updated and Claude must be notified in the `gsi-os` session.
6. Pascal WebGPU pipeline is delicate. `boxGeometry` + `meshBasicMaterial` + `castShadow={false}` is the proven pattern. Line primitives can crash the render pipeline.
7. Default to concise Polish replies. Do not use emoji in files.

## Tech

- TypeScript check:

  ```bash
  ./packages/editor/node_modules/.bin/tsc --noEmit -p packages/editor/tsconfig.json
  ```

  No output means OK.

- Dev server:

  ```bash
  cd packages/editor && npm run dev
  ```

- Dev port: `3002`
- Embed URL: `/embed?projectId=X&parentOrigin=Y`
- Vercel: `main` autodeploys to `gsi-plan-3d.vercel.app`
