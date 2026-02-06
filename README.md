# Giljepipeline – Next.js Frontend

## Quick start

```bash
cp .env.local.example .env.local   # adjust values as needed
npm install
npm run dev                        # http://localhost:3000
```

## Logging

All application logging is routed through **`lib/logger.ts`**.
No logs are ever written to disk — output goes to `console.*` only, gated by environment variables.

### Environment variables

| Variable | Side | Values | Default |
|---|---|---|---|
| `NEXT_PUBLIC_DEBUG` | Client | `"true"` / `"false"` | `"false"` |
| `LOG_MODE` | Server | `"console"` / `"off"` / `"file"` | `"console"` locally, `"off"` in prod |
| `LOG_LEVEL` | Server | `"debug"` / `"info"` / `"warn"` / `"error"` | `"info"` |

- **`NEXT_PUBLIC_DEBUG=true`** — enables all client-side log output in the browser console.
- **`LOG_MODE=console`** — enables server-side log output (route handlers, services). Set to `"off"` to suppress.
- **`LOG_MODE=file`** — treated the same as `"off"` (file logging is not supported; a one-time warning is emitted).
- **`LOG_LEVEL`** — minimum severity threshold for server logs when `LOG_MODE=console`.

### Enable debug logs locally

```env
# .env.local
NEXT_PUBLIC_DEBUG=true
LOG_MODE=console
LOG_LEVEL=debug
```

### Vercel / Production

Set the following in Vercel dashboard → Settings → Environment Variables:

```
NEXT_PUBLIC_DEBUG=false
LOG_MODE=off
```

This ensures zero noise in production logs. If you want to see `warn`/`error` level server logs on Vercel:

```
LOG_MODE=console
LOG_LEVEL=warn
```

## Architecture notes

- **Polling-only** — the frontend polls the FastAPI Jobs API. No SSE or WebSocket connections.
- **Next.js API routes** are used only for local file operations (`/api/local-upload`, `/api/files/*`) and legacy pipeline routes.
- **FastAPI** handles job management, pipeline orchestration, and results.
