/**
 * Unified logger for Next.js frontend (client + server safe).
 *
 * RULES:
 * - NEVER writes to disk (no fs usage).
 * - Server logs gated by LOG_MODE ("console" | "off" | "file") and LOG_LEVEL.
 *   - LOG_MODE=file is treated as "off" with a one-time warning.
 * - Client logs gated by NEXT_PUBLIC_DEBUG ("true" | "false").
 *
 * Environment variables:
 *   NEXT_PUBLIC_DEBUG   – "true" to enable client console logs (default "false")
 *   LOG_MODE            – "console" | "off" | "file" (default "off" in prod, "console" locally)
 *   LOG_LEVEL           – "debug" | "info" | "warn" | "error" (default "info")
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Level = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
  [key: string]: unknown
}

export interface Logger {
  debug: (msg: string, ctx?: LogContext) => void
  info: (msg: string, ctx?: LogContext) => void
  warn: (msg: string, ctx?: LogContext) => void
  error: (msg: string, ctx?: LogContext) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LEVEL_PRIORITY: Record<Level, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const isServer = typeof window === 'undefined'

/** One-time guard so LOG_MODE=file warning is emitted only once. */
let fileWarningEmitted = false

/**
 * Resolve whether logging should actually emit for a given level.
 *
 * On the **server** the decision uses `LOG_MODE` + `LOG_LEVEL`.
 * On the **client** the decision uses `NEXT_PUBLIC_DEBUG` only
 * (all levels pass when debug is enabled; nothing when disabled).
 */
function shouldLog(level: Level): boolean {
  if (isServer) {
    // Server-side gating --------------------------------------------------------
    const rawMode = process.env.LOG_MODE ?? (process.env.NODE_ENV === 'production' ? 'off' : 'console')
    let mode: string = rawMode

    if (mode === 'file') {
      if (!fileWarningEmitted) {
        fileWarningEmitted = true
        // eslint-disable-next-line no-console
        console.warn('[logger] LOG_MODE=file is not supported in this frontend; falling back to off')
      }
      mode = 'off'
    }

    if (mode === 'off') return false
    // mode === 'console'

    const threshold = (process.env.LOG_LEVEL as Level) || 'info'
    return LEVEL_PRIORITY[level] >= (LEVEL_PRIORITY[threshold] ?? LEVEL_PRIORITY.info)
  }

  // Client-side gating ----------------------------------------------------------
  return process.env.NEXT_PUBLIC_DEBUG === 'true'
}

/**
 * Format context into a short string: `[key=value, …]`
 */
function fmtCtx(ctx?: LogContext): string {
  if (!ctx) return ''
  const parts: string[] = []
  for (const [k, v] of Object.entries(ctx)) {
    if (v === undefined || v === null) continue
    try {
      let s = typeof v === 'object' ? JSON.stringify(v) : String(v)
      if (s.length > 120) s = s.slice(0, 117) + '...'
      parts.push(`${k}=${s}`)
    } catch {
      parts.push(`${k}=[unserializable]`)
    }
  }
  return parts.length ? ` [${parts.join(', ')}]` : ''
}

// ---------------------------------------------------------------------------
// Core emit
// ---------------------------------------------------------------------------

function emit(level: Level, tag: string, msg: string, ctx?: LogContext): void {
  if (!shouldLog(level)) return

  const prefix = `[${tag}]`
  const suffix = fmtCtx(ctx)
  const text = `${prefix} ${msg}${suffix}`

  switch (level) {
    case 'error':
      // eslint-disable-next-line no-console
      console.error(text)
      break
    case 'warn':
      // eslint-disable-next-line no-console
      console.warn(text)
      break
    case 'debug':
      // eslint-disable-next-line no-console
      console.debug(text)
      break
    default:
      // eslint-disable-next-line no-console
      console.log(text)
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a tagged logger. The tag appears as `[tag]` prefix in every message.
 *
 * ```ts
 * import { createLogger } from '@/lib/logger'
 * const log = createLogger('dashboard')
 * log.info('Upload started', { jobId })
 * ```
 */
export function createLogger(tag: string): Logger {
  return {
    debug: (msg, ctx?) => emit('debug', tag, msg, ctx),
    info: (msg, ctx?) => emit('info', tag, msg, ctx),
    warn: (msg, ctx?) => emit('warn', tag, msg, ctx),
    error: (msg, ctx?) => emit('error', tag, msg, ctx),
  }
}

/**
 * Default logger with tag "app".
 */
export const log = createLogger('app')
