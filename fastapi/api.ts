/**
 * API client for communicating with FastAPI backend.
 *
 * All endpoints live under /api/* (v4 architecture):
 * - /api/jobs/*    — job status, results, classification, images, download
 * - /api/storage/* — file upload/list/delete (local dev)
 *
 * BLOB MODE: When NEXT_PUBLIC_STORAGE_MODE=blob, results and CSV data
 * are fetched directly from Vercel Blob URLs (via manifest_url from Jobs API).
 */

// === Blob / Manifest Types ===

export interface BlobManifest {
  job_id: string
  status: string
  completed_at: string
  outputs: Record<string, unknown>
  files: Record<string, string>  // relative path → blob URL
}

/** Check if we're running in blob mode */
export function isBlobMode(): boolean {
  return typeof window !== 'undefined'
    && process.env.NEXT_PUBLIC_STORAGE_MODE === 'blob'
}

/**
 * Normalize manifest file keys (Windows backslashes → forward slashes).
 * Safety net: the Celery worker now uses .as_posix() for all paths,
 * but we keep this for backward compatibility with old manifests.
 */
function normalizeManifestKeys(files: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(files)) {
    normalized[key.replace(/\\/g, '/')] = value
  }
  return normalized
}

/** Fetch and parse a manifest from a blob URL */
export async function fetchBlobManifest(manifestUrl: string): Promise<BlobManifest> {
  const response = await fetch(manifestUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch manifest: ${response.status} ${response.statusText}`)
  }
  const manifest = await response.json() as BlobManifest
  // Normalize Windows backslash keys
  manifest.files = normalizeManifestKeys(manifest.files)
  return manifest
}

/** Find a crop image blob URL in manifest by SHA prefix */
export function findCropBlobUrl(manifest: BlobManifest, sha: string): string | null {
  const sha8 = sha.slice(0, 8)
  for (const [key, url] of Object.entries(manifest.files)) {
    if (key.includes('/crops/') && key.includes(sha8)) {
      return url
    }
  }
  return null
}

// === Types used by consumers ===

export interface PipelineStatus {
  run_id: string
  status: 'pending' | 'downloading' | 'running' | 'completed' | 'classification_pending' | 'classification_complete' | 'uploading' | 'failed' | 'cancelled' | 'cancellation_requested'
  message: string
  progress?: {
    percent_overall: number
    current_phase: string | null
    message: string
  }
}

export interface PipelineResults {
  run_id: string
  doc_id: string
  doc_name: string
  status: string
  results: Record<string, unknown>
  output_dir: string
  figures?: Array<{
    sha: string
    class_name: string
    confidence?: number
    image_path?: string
    page_id?: string
    bbox?: number[]
  }>
  pages?: Array<{
    page_id: string
    page_number: number
    image_path: string
    figures?: Array<unknown>
  }>
  tables?: Array<{
    sha: string
    markdown: string
    page?: number
    table_type?: string
    table_index?: number
  }>
  markdown?: string
}

class ApiRequestError extends Error {
  constructor(
    message: string,
    public detail?: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export { ApiRequestError }

class ApiClient {
  private baseUrl: string

  constructor() {
    this.baseUrl = (process.env.NEXT_PUBLIC_API_URL || process.env.FAST_API_URL || 'http://localhost:8000').replace(/\/+$/, '')
  }

  /**
   * Generic request method — calls any endpoint on the FastAPI backend.
   */
  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        error: `HTTP ${response.status}`,
        detail: response.statusText,
      }))
      throw new ApiRequestError(error.error, error.detail)
    }

    if (response.status === 204) {
      return undefined as T
    }

    return response.json() as Promise<T>
  }

  /** Convenience: call /api/jobs/* endpoints */
  private async jobsRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    return this.request<T>(`/api/jobs${endpoint}`, options)
  }

  // === Used by components ===

  getCropImageUrl(runId: string, sha: string): string {
    return `${this.baseUrl}/api/jobs/${runId}/images/${sha}`
  }

  async getRunCsv(runId: string): Promise<{
    headers: string[]
    rows: Record<string, string>[]
    metadata: { rowCount: number; columnCount: number }
  }> {
    return this.jobsRequest(`/${runId}/csv`)
  }

  async getResults(runId: string): Promise<PipelineResults> {
    const results = await this.jobsRequest<{
      run_id: string
      doc_id: string
      doc_name: string
      status: string
      figures?: Array<{
        sha: string
        class_name: string
        confidence?: number
        image_path?: string
        image_url?: string
        page_id?: string
        bbox?: number[]
      }>
      pages?: Array<{
        page_id: string
        page_number: number
        image_path: string
        figures?: Array<unknown>
      }>
      tables?: Array<{
        sha: string
        markdown: string
        page?: number
      }>
      markdown?: string
    }>(`/${runId}/results`)

    return {
      run_id: results.run_id,
      doc_id: results.doc_id,
      doc_name: results.doc_name,
      status: results.status,
      results: {},
      output_dir: '',
      figures: results.figures?.map(fig => ({
        ...fig,
        image_path: fig.image_path || fig.image_url || undefined,
      })),
      pages: results.pages,
      tables: results.tables,
      markdown: results.markdown,
    } as PipelineResults
  }

  /**
   * Fetch the integration document JSON (products, generalInfo, etc.).
   * Server handles blob/local manifest resolution.
   */
  async getDocumentJson(runId: string): Promise<Record<string, unknown> | null> {
    try {
      return await this.jobsRequest<Record<string, unknown>>(`/${runId}/integration`)
    } catch {
      return null
    }
  }
}

// Singleton instance
export const api = new ApiClient()
