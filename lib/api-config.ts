/**
 * Centralized API Configuration for v4 Architecture
 * 
 * This file defines how the frontend communicates with backend services.
 * 
 * ARCHITECTURE DECISION:
 * We use DIRECT client-side calls to FastAPI (http://localhost:8000) instead
 * of Next.js rewrites/proxy because:
 * 
 * 1. Clearer separation: Frontend is UI, FastAPI handles all API logic
 * 2. Easier debugging: No proxy magic, requests go directly where expected
 * 3. No routing conflicts: Next.js API routes (/api/files, /api/local-upload) 
 *    work independently without rewrite ordering issues
 * 4. Production-ready: Same pattern you'd use with an API gateway
 * 
 * Next.js API routes are used ONLY for:
 * - /api/local-upload - Local file uploads (stores to output_frontend/)
 * - /api/files/* - Serving local files (from output_frontend/)
 * - /api/health - Next.js health check
 * 
 * All other API calls go directly to FastAPI:
 * - /api/jobs/* - Job management (create, poll, cancel)
 * - /runs/* - Legacy run management
 * - /config/* - Pipeline configuration
 */

// FastAPI backend URL - direct calls, no proxy
// Accept both NEXT_PUBLIC_API_URL (documented) and legacy NEXT_PUBLIC_FASTAPI_URL
// Strip trailing slash to avoid double-slash in constructed paths
const FASTAPI_URL = (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_FASTAPI_URL || 'http://localhost:8000').replace(/\/+$/, '');

// Next.js local API (same origin) - for file operations only
const NEXTJS_API_URL = typeof window !== 'undefined' ? '' : 'http://localhost:3000';

/**
 * Get the FastAPI backend URL for direct API calls.
 * 
 * Usage: Jobs API, runs, config, pipeline operations
 */
export function getFastApiUrl(): string {
    // Check localStorage for user override (settings page)
    if (typeof window !== 'undefined') {
        try {
            const settings = localStorage.getItem('pipeline_settings');
            if (settings) {
                const parsed = JSON.parse(settings);
                if (parsed.apiUrl) return parsed.apiUrl;
            }
        } catch (e) {
            // Ignore
        }
    }
    return FASTAPI_URL;
}

/**
 * Get the Next.js API URL for local operations.
 * 
 * Usage: File uploads, file serving (local dev only)
 */
export function getNextJsApiUrl(): string {
    return NEXTJS_API_URL;
}

/**
 * API endpoint builders for common operations
 */
export const api = {
    // Jobs API (FastAPI)
    jobs: {
        list: (limit = 10) => `${getFastApiUrl()}/api/jobs/?limit=${limit}`,
        get: (jobId: string) => `${getFastApiUrl()}/api/jobs/${jobId}`,
        create: () => `${getFastApiUrl()}/api/jobs/`,
        cancel: (jobId: string) => `${getFastApiUrl()}/api/jobs/${jobId}/cancel`,
        results: (jobId: string) => `${getFastApiUrl()}/api/jobs/${jobId}/results`,
        classification: {
            get: (jobId: string) => `${getFastApiUrl()}/api/jobs/${jobId}/classification`,
            submit: (jobId: string) => `${getFastApiUrl()}/api/jobs/${jobId}/classification`,
            autoSubmit: (jobId: string) => `${getFastApiUrl()}/api/jobs/${jobId}/classification/auto-submit`,
        },
    },

    // Runs API (FastAPI - legacy)
    runs: {
        list: () => `${getFastApiUrl()}/runs/`,
        get: (runId: string) => `${getFastApiUrl()}/runs/${runId}`,
    },

    // Config API (FastAPI)
    config: {
        get: () => `${getFastApiUrl()}/config/`,
        update: () => `${getFastApiUrl()}/config/`,
    },

    // Health checks
    health: {
        fastapi: () => `${getFastApiUrl()}/health`,
        nextjs: () => `${getNextJsApiUrl()}/api/health`,
    },

    // Local file operations (Next.js API routes)
    files: {
        upload: () => `${getNextJsApiUrl()}/api/local-upload`,
        get: (path: string) => `${getNextJsApiUrl()}/api/files/${path}`,
    },
};

/**
 * Backward-compatible getApiUrl() for existing code.
 * Returns FastAPI URL for jobs/runs operations.
 * 
 * @deprecated Use getFastApiUrl() or api.* helpers instead
 */
export function getApiUrl(): string {
    return getFastApiUrl();
}
