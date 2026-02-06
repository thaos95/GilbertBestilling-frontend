/**
 * DEPRECATED — compatibility shim.
 *
 * All logging now goes through `@/lib/logger`.
 * This file re-exports helpers so that existing `import { loggers } from '@/lib/v4-logger'`
 * statements keep working without code changes in callers.
 *
 * NO file-based logging. NO fs imports.
 */

import { createLogger, type Logger } from './logger'

// Re-export the core factory under the old name
export function createV4Logger(module: string): Logger & {
    section: (title: string, ctx?: Record<string, unknown>) => void
    httpRequest: (method: string, url: string, ctx?: Record<string, unknown>) => void
    httpResponse: (status: number, ctx?: Record<string, unknown>) => void
} {
    const base = createLogger(module)
    return {
        ...base,
        section: (title: string, ctx?: Record<string, unknown>) =>
            base.info(`${'='.repeat(20)} ${title.toUpperCase()} ${'='.repeat(20)}`, ctx),
        httpRequest: (method: string, url: string, ctx?: Record<string, unknown>) =>
            base.info(`HTTP ${method} -> ${url}`, { ...ctx, url }),
        httpResponse: (status: number, ctx?: Record<string, unknown>) =>
            base.info(`HTTP Response: ${status}`, { ...ctx, status }),
    }
}

export const v4Logger = createV4Logger('v4')

export const loggers = {
    localUpload: createV4Logger('local-upload'),
    files: createV4Logger('files'),
    jobs: createV4Logger('jobs-proxy'),
    dashboard: createV4Logger('dashboard'),
}
