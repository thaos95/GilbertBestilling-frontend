/**
 * API client for communicating with FastAPI backend.
 *
 * IMPORTANT: This client uses TWO API path patterns:
 * - /api/jobs/* (v4) — for job status, results, classification (Redis-backed)
 * - /api/v1/*  (legacy) — for storage, pipeline, filesystem-based operations
 *
 * All v4 job operations go through jobsRequest() → /api/jobs/{id}/...
 * Legacy operations go through request() → /api/v1/...
 *
 * BLOB MODE: When NEXT_PUBLIC_STORAGE_MODE=blob, results and CSV data
 * are fetched directly from Vercel Blob URLs (via manifest_url from Jobs API).
 * Legacy /runs/* endpoints are NOT used in blob mode.
 */

import type {
  RunListItem,
  RunStatus,
  RunManifest,
  PipelineRunResponse,
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

/** Normalize manifest file keys (Windows backslashes → forward slashes) */
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
  status: 'pending' | 'running' | 'completed' | 'classification_complete' | 'failed' | 'cancelled'
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
   * Legacy request method — calls /api/v1/* endpoints (filesystem-based).
   * Used for storage, pipeline, and legacy run operations.
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v1${endpoint}`

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

  /**
   * v4 Jobs API request — calls /api/jobs/* endpoints (Redis-backed).
   * Used for job status, results, classification in v4 architecture.
   */
  private async jobsRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}/api/jobs${endpoint}`

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

  // === Runs ===

  async listRuns(limit = 50): Promise<RunListItem[]> {
    // v4: Use Jobs API for listing (returns v4 job format)
    return this.jobsRequest<RunListItem[]>(`/?limit=${limit}`)
  }

  async getRunStatus(runId: string): Promise<RunStatus> {
    // v4: Use Jobs API for status (Redis-backed, supports v4 jobs)
    return this.jobsRequest<RunStatus>(`/${runId}`)
  }

  async getRunManifest(runId: string): Promise<RunManifest> {
    // Legacy endpoint — manifest lives at /api/v1/runs/{id}/manifest
    return this.request<RunManifest>(`/runs/${runId}/manifest`)
  }

  async deleteRun(runId: string): Promise<void> {
    return this.request<void>(`/runs/${runId}`, { method: 'DELETE' })
  }

  async getRunCsv(runId: string, manifestUrl?: string | null): Promise<{
    headers: string[]
    rows: Record<string, string>[]
    metadata: { rowCount: number; columnCount: number }
  }> {
    // BLOB MODE: fetch CSV directly from blob via manifest
    if (isBlobMode() && manifestUrl) {
      return this.getRunCsvFromBlob(manifestUrl)
    }
    // Legacy: Call FastAPI endpoint (local filesystem)
    return this.request(`/runs/${runId}/csv`)
  }

  // === Pipeline ===

  async runPipeline(filename?: string): Promise<PipelineRunResponse> {
    return this.request<PipelineRunResponse>('/pipeline/run', {
      method: 'POST',
      body: JSON.stringify({ filename }),
    })
  }

  async cancelPipeline(runId: string): Promise<{ run_id: string; status: string; message: string }> {
    // v4: Use Jobs API for cancellation
    return this.jobsRequest(`/${runId}/cancel`, { method: 'POST' })
  }

  async getPipelineProgress(runId: string): Promise<Record<string, unknown>> {
    return this.request(`/pipeline/${runId}/progress`)
  }

  // === Storage ===

  async uploadFile(file: File): Promise<UploadResponse> {
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch(`${this.baseUrl}/api/v1/storage/upload`, {
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
    return this.request('/storage/files')
  }

  async deleteFile(filename: string): Promise<void> {
    return this.request<void>(`/storage/files/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    })
  }

  getImageUrl(runId: string, sha: string): string {
    return `${this.baseUrl}/api/v1/storage/runs/${runId}/images/${sha}`
  }

  getCropImageUrl(runId: string, sha: string): string {
    return `${this.baseUrl}/api/v1/runs/${runId}/classification/crops/${sha}/image`
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
    // Legacy endpoint — no v4 equivalent for data URLs
    return `${this.baseUrl}/api/v1/runs/${runId}/classification/crops/${sha}/image/dataurl`
  }

  getFigureImageUrl(runId: string, sha: string): string {
    // Legacy endpoint — figures served from filesystem
    return `${this.baseUrl}/api/v1/runs/${runId}/figure/${sha}`
  }

  // === Classification ===

  async getClassificationQueue(runId: string): Promise<ClassificationQueue> {
    // v4: Use Jobs API for classification (classification-v4 tag)
    return this.jobsRequest<ClassificationQueue>(`/${runId}/classification`)
  }

  async getClassificationStats(runId: string): Promise<{ total: number; reviewed: number; by_classification: Record<string, number> }> {
    // Legacy endpoint — stats only exists at /api/v1/runs/
    return this.request(`/runs/${runId}/classification/stats`)
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

  async batchSubmitClassifications(runId: string, corrections: Record<string, string>): Promise<void> {
    return this.request<void>(`/runs/${runId}/classification/batch`, {
      method: 'POST',
      body: JSON.stringify(corrections),
    })
  }

  async submitSingleClassification(
    runId: string,
    sha: string,
    classification: string
  ): Promise<{ sha: string; classification: string; timestamp: string }> {
    return this.request(
      `/runs/${runId}/classification/crops/${sha}`,
      {
        method: 'POST',
        body: JSON.stringify({ classification }),
      }
    )
  }

  // === SSE Streaming (DEPRECATED - v4 uses polling) ===
  // DO NOT USE - Kept for backward compatibility only
  // Use useJobStatus hook instead for status updates

  /** @deprecated Use useJobStatus hook instead - v4 uses polling, not SSE */
  createProgressStream(runId: string): EventSource {
    // SSE is not supported in v4 architecture
    throw new Error('createProgressStream uses SSE which is not supported in v4. Use useJobStatus hook instead.')
    return new EventSource(`${this.baseUrl}/api/v1/runs/${runId}/stream`)
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

  async startPipeline(_docId: string, docPath: string): Promise<PipelineRunResponse> {
    // Extract filename from docPath
    const filename = docPath.split('/').pop() || docPath
    return this.runPipeline(filename)
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
    // BLOB MODE: fetch results directly from manifest + integration JSON
    if (isBlobMode() && manifestUrl) {
      return this.getResultsFromBlob(manifestUrl)
    }

    // v4: Call the Jobs API results endpoint (Redis-backed, supports blob manifest)
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
      figures: results.figures,
      pages: results.pages,
      tables: results.tables,
      markdown: results.markdown,
    } as PipelineResults
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
