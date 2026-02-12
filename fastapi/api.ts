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

import type {
  RunListItem,
  RunStatus,
  UploadResponse,
  ClassificationQueue,
  ClassificationSubmitResponse,
} from './api-types'

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
    // Match crops paths like visual_detector/detections/*/crops/*/*/<sha>.png
    if (key.includes('/crops/') && key.includes(sha8)) {
      return url
    }
  }
  return null
}

/** Find CSV blob URL in manifest */
export function findCsvBlobUrl(manifest: BlobManifest): string | null {
  for (const [key, url] of Object.entries(manifest.files)) {
    if (key.startsWith('csv/') && key.endsWith('.csv')) {
      return url
    }
  }
  return null
}

/** Find integration JSON blob URL in manifest */
export function findIntegrationJsonUrl(manifest: BlobManifest): string | null {
  for (const [key, url] of Object.entries(manifest.files)) {
    if (key.startsWith('json/') && key.endsWith('.json')) {
      return url
    }
  }
  return null
}

// === Legacy Types (for backward compatibility) ===

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

export interface ClassificationRequest {
  run_id: string
  doc_id: string
  doc_name: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  crops: Array<{
    sha: string
    class_name: string
    confidence: number
    image_path: string | null
    page_id: string | null
    metadata?: {
      ai_sam_class?: string
      csv_table_type?: string
      csv_row_class?: string
      class_override_source?: string
      crop_relpath?: string
    }
  }>
  total: number
  reviewed: number
  progress_percent: number
  started_at: string | null
  completed_at: string | null
}

export interface PipelineResults {
  run_id: string
  doc_id: string
  doc_name: string
  status: string
  results: Record<string, unknown>
  output_dir: string
  // Actual results data
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
    // Get FastAPI URL from environment
    // NEXT_PUBLIC_ prefix required for client-side access in Next.js
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

    // Handle empty responses
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

  /** Convenience: call /api/storage/* endpoints */
  private async storageRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    return this.request<T>(`/api/storage${endpoint}`, options)
  }

  // === Runs ===

  async listRuns(limit = 50): Promise<RunListItem[]> {
    // v4: Use Jobs API for listing (returns v4 job format)
    return this.jobsRequest<RunListItem[]>(`/?limit=${limit}`)
  }

  async getRunStatus(runId: string): Promise<RunStatus> {
    // v4: Use Jobs API for status (Redis-backed, supports v4 jobs)
    return this.jobsRequest<RunStatus>(`/${runId}`)
  }

  async deleteRun(runId: string): Promise<void> {
    return this.jobsRequest<void>(`/${runId}`, { method: 'DELETE' })
  }

  async getRunCsv(runId: string, manifestUrl?: string | null): Promise<{
    headers: string[]
    rows: Record<string, string>[]
    metadata: { rowCount: number; columnCount: number }
  }> {
    // Always use the FastAPI Jobs API endpoint.
    // The server handles blob manifest resolution, per-table grouping,
    // and filesystem fallback — no need to duplicate that logic client-side.
    return this.jobsRequest(`/${runId}/csv`)
  }

  // === Jobs ===

  async cancelJob(runId: string): Promise<{ run_id: string; status: string; message: string }> {
    return this.jobsRequest(`/${runId}/cancel`, { method: 'POST' })
  }

  // === Storage ===

  async uploadFile(file: File): Promise<UploadResponse> {
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch(`${this.baseUrl}/api/storage/upload`, {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        error: `HTTP ${response.status}`,
        detail: response.statusText,
      }))
      throw new ApiRequestError(error.error, error.detail)
    }

    return response.json() as Promise<UploadResponse>
  }

  async listFiles(): Promise<Array<{ name: string; size_bytes: number; modified: string }>> {
    return this.storageRequest('/files')
  }

  async deleteFile(filename: string): Promise<void> {
    return this.storageRequest<void>(`/files/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    })
  }

  /** Get image URL — v4 serves images via /api/jobs/{id}/images/{sha} */
  getImageUrl(runId: string, sha: string): string {
    return `${this.baseUrl}/api/jobs/${runId}/images/${sha}`
  }

  getCropImageUrl(runId: string, sha: string): string {
    return `${this.baseUrl}/api/jobs/${runId}/images/${sha}`
  }

  /**
   * Resolve a crop image URL - blob mode returns blob URL, legacy returns API URL.
   * In blob mode, requires a manifest to be loaded first.
   */
  getCropImageUrlFromManifest(manifest: BlobManifest | null, runId: string, sha: string): string {
    if (isBlobMode() && manifest) {
      const blobUrl = findCropBlobUrl(manifest, sha)
      if (blobUrl) return blobUrl
    }
    // Fallback to legacy endpoint
    return this.getCropImageUrl(runId, sha)
  }

  getCropImageDataUrl(runId: string, sha: string): string {
    return `${this.baseUrl}/api/jobs/${runId}/images/${sha}`
  }

  getFigureImageUrl(runId: string, sha: string): string {
    return `${this.baseUrl}/api/jobs/${runId}/images/${sha}`
  }

  // === Classification ===

  async getClassificationQueue(runId: string): Promise<ClassificationQueue> {
    // v4: Use Jobs API for classification (classification-v4 tag)
    return this.jobsRequest<ClassificationQueue>(`/${runId}/classification`)
  }

  async getClassificationStats(runId: string): Promise<{ total: number; reviewed: number; by_classification: Record<string, number> }> {
    return this.jobsRequest(`/${runId}/classification/stats`)
  }

  async submitClassifications(
    runId: string,
    classifications: Array<{ sha: string; class_name: string; confidence: number }>
  ): Promise<ClassificationSubmitResponse> {
    // v4: Use Jobs API for classification submission
    return this.jobsRequest<ClassificationSubmitResponse>(
      `/${runId}/classification`,
      {
        method: 'POST',
        body: JSON.stringify({
          classifications,
        }),
      }
    )
  }

  async autoSubmitClassifications(runId: string): Promise<ClassificationSubmitResponse> {
    // v4: Use Jobs API for auto-submit
    return this.jobsRequest<ClassificationSubmitResponse>(
      `/${runId}/classification/auto-submit`,
      { method: 'POST' }
    )
  }



  // === Legacy Methods (for backward compatibility) ===

  async getPipelineStatus(runId: string): Promise<PipelineStatus> {
    const status = await this.getRunStatus(runId)
    return {
      run_id: status.run_id,
      status: status.status as PipelineStatus['status'],
      message: status.message,
      progress: status.progress ? {
        percent_overall: status.progress.percent_overall,
        current_phase: status.progress.current_phase,
        message: status.progress.message,
      } : undefined,
    }
  }

  /** @deprecated Use cancelJob instead */
  async cancelPipeline(runId: string): Promise<{ run_id: string; status: string; message: string }> {
    return this.cancelJob(runId)
  }

  async getClassificationStatus(runId: string): Promise<ClassificationRequest> {
    const queue = await this.getClassificationQueue(runId)
    return {
      run_id: queue.run_id,
      doc_id: queue.doc_id,
      doc_name: queue.doc_name,
      status: 'running' as const,
      crops: queue.crops.map(crop => ({
        sha: crop.sha,
        class_name: crop.class_name,
        confidence: crop.confidence,
        image_path: crop.image_path,
        page_id: crop.page_id,
        metadata: crop.metadata,
      })),
      total: queue.total,
      reviewed: queue.reviewed,
      progress_percent: queue.progress_percent,
      started_at: null,
      completed_at: null,
    }
  }

  async submitClassification(
    runId: string,
    classifications: Array<{ sha: string; class_name: string; confidence?: number }>
  ): Promise<ClassificationSubmitResponse> {
    return this.submitClassifications(
      runId,
      classifications.map(c => ({ sha: c.sha, class_name: c.class_name, confidence: c.confidence || 0 }))
    )
  }

  async autoSubmitClassification(runId: string): Promise<ClassificationSubmitResponse> {
    return this.autoSubmitClassifications(runId)
  }

  async getResults(runId: string, manifestUrl?: string | null): Promise<PipelineResults> {
    // Always use the Jobs API endpoint.
    // The server correctly handles both blob (manifest URLs) and local
    // (filesystem) modes, including page/figure/table extraction.
    // Blob-direct client-side parsing (getResultsFromBlob) had bugs with
    // page image patterns and missing per-table CSV support.
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
        image_url?: string  // FastAPI may return blob URL here instead of image_path
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
      // Merge image_url into image_path for consistent frontend usage.
      // FastAPI returns both fields; prefer image_path but fall back to image_url.
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
   * - Blob mode: fetch from manifest integration JSON URL
   * - Local mode: try /api/jobs/{id}/integration endpoint
   */
  async getDocumentJson(runId: string, manifestUrl?: string | null): Promise<Record<string, unknown> | null> {
    // Always use the Jobs API integration endpoint.
    // Server handles blob/local manifest resolution.
    try {
      return await this.jobsRequest<Record<string, unknown>>(`/${runId}/integration`)
    } catch {
      // Endpoint may not exist, return null
      return null
    }
  }

  /**
   * Blob-native results fetching.
   * Fetches manifest → integration JSON → builds PipelineResults from blob data.
   */
  private async getResultsFromBlob(manifestUrl: string): Promise<PipelineResults> {
    const manifest = await fetchBlobManifest(manifestUrl)

    // Fetch integration JSON (the main structured output)
    const integrationJsonUrl = findIntegrationJsonUrl(manifest)
    let integrationData: Record<string, unknown> = {}
    if (integrationJsonUrl) {
      const resp = await fetch(integrationJsonUrl)
      if (resp.ok) {
        integrationData = await resp.json()
      }
    }

    // Extract products from integration JSON
    const products = (integrationData.products || []) as Array<Record<string, unknown>>

    // Build pages array from manifest images/*.png keys
    const pages: PipelineResults['pages'] = []
    const pagePattern = /^images\/page[_-]?(\d+)\.png$/i
    for (const [key, url] of Object.entries(manifest.files)) {
      const match = key.match(pagePattern)
      if (match) {
        const pageNum = parseInt(match[1], 10)
        pages.push({
          page_id: `page_${pageNum}`,
          page_number: pageNum,
          image_path: url,
        })
      }
    }
    pages.sort((a, b) => (a.page_number ?? 0) - (b.page_number ?? 0))

    // Build figures from products that have figure_sha8
    const figures: PipelineResults['figures'] = products
      .filter(p => p.figure_sha8)
      .map(p => {
        const sha8 = p.figure_sha8 as string
        // Find the crop blob URL in manifest
        const blobUrl = findCropBlobUrl(manifest, sha8)
        return {
          sha: sha8,
          class_name: (p.component as string || p.entity_type as string || 'unknown').toLowerCase(),
          confidence: 1.0,
          image_path: blobUrl || undefined,
          page_id: p.source_page as string || undefined,
        }
      })

    // Build tables from products that have table data (markdown representation)
    const tables: PipelineResults['tables'] = products.map((p, idx) => {
      // Build a simple markdown table from product fields
      const relevantKeys = Object.keys(p).filter(k =>
        !['figure_sha8', 'frame', 'entity_type', 'Oppniss', 'component'].includes(k)
      )
      const mdLines = ['| Field | Value |', '|---|---|']
      for (const key of relevantKeys) {
        const val = p[key]
        if (val !== null && val !== undefined && typeof val !== 'object') {
          mdLines.push(`| ${key} | ${String(val)} |`)
        }
      }
      return {
        sha: (p.figure_sha8 as string) || `table-${idx}`,
        markdown: mdLines.join('\n'),
        page: p.source_page ? parseInt(String(p.source_page)) : undefined,
      }
    })

    return {
      run_id: manifest.job_id,
      doc_id: manifest.job_id,
      doc_name: (integrationData.generalInfo as Record<string, unknown>)?.projectName as string
        || manifest.job_id,
      status: manifest.status,
      results: integrationData,
      output_dir: '',
      figures,
      pages,
      tables,
    }
  }

  /**
   * Blob-native CSV fetching.
   * Fetches manifest → CSV blob URL → parses CSV text into structured data.
   */
  async getRunCsvFromBlob(manifestUrl: string): Promise<{
    headers: string[]
    rows: Record<string, string>[]
    metadata: { rowCount: number; columnCount: number }
  }> {
    const manifest = await fetchBlobManifest(manifestUrl)
    const csvUrl = findCsvBlobUrl(manifest)

    if (!csvUrl) {
      throw new ApiRequestError('CSV not found in manifest', 'No csv/ file in manifest.files')
    }

    const resp = await fetch(csvUrl)
    if (!resp.ok) {
      throw new ApiRequestError(`Failed to fetch CSV: ${resp.status}`, resp.statusText)
    }

    const csvText = await resp.text()
    return this.parseCsvText(csvText)
  }

  /**
   * Parse raw CSV text into structured data.
   * Simple CSV parser that handles quoted fields.
   */
  private parseCsvText(csvText: string): {
    headers: string[]
    rows: Record<string, string>[]
    metadata: { rowCount: number; columnCount: number }
  } {
    const lines = csvText.split('\n').filter(line => line.trim().length > 0)
    if (lines.length === 0) {
      return { headers: [], rows: [], metadata: { rowCount: 0, columnCount: 0 } }
    }

    // Parse CSV with proper quote handling
    const parseLine = (line: string): string[] => {
      const result: string[] = []
      let current = ''
      let inQuotes = false

      for (let i = 0; i < line.length; i++) {
        const char = line[i]
        if (char === '"') {
          if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
            current += '"'
            i++ // skip escaped quote
          } else {
            inQuotes = !inQuotes
          }
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim())
          current = ''
        } else {
          current += char
        }
      }
      result.push(current.trim())
      return result
    }

    const headers = parseLine(lines[0])
    const rows = lines.slice(1).map(line => {
      const values = parseLine(line)
      const row: Record<string, string> = {}
      headers.forEach((header, idx) => {
        row[header] = values[idx] || ''
      })
      return row
    })

    return {
      headers,
      rows,
      metadata: { rowCount: rows.length, columnCount: headers.length }
    }
  }
}

// Singleton instance
export const api = new ApiClient()
