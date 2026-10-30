# Westeros — frontend

Next.js 15 · React 19 · Tailwind v4 · shadcn/ui · react-three-fiber.

```bash
npm install
npm run dev          # http://localhost:3000 (expects the API at NEXT_PUBLIC_API_URL, default http://localhost:8000)
npm run build && npm start
```

Key places:

- `src/app/story` — Story Mode (episodes as playable 3D scenes)
- `src/components/story` — stage, sets, set dressing, dialogue wheel, scene rail
- `src/components/three` — 3D map, artifacts, character figures, labels
- `src/lib/voice.ts` — character voices (TTS) and voice input (STT)

See the [project README](../README.md) for the full picture.
