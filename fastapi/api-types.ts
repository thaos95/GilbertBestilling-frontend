/**
 * TypeScript interfaces matching FastAPI Pydantic models.
 * These types ensure type safety between frontend and backend.
 */

// === Runs ===

export interface RunListItem {
  run_id: string
  doc_id: string
  doc_name: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  message: string
  progress: RunProgress | null
  started_at: string | null
  completed_at: string | null
}

export interface RunStatus {
  run_id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'initializing'
  message: string
  progress: RunProgress
}

export interface RunProgress {
  percent_overall: number
  current_phase: string | null
  message: string
}

export interface RunManifest {
  run_id: string
  doc_id: string
  original_filename: string
  source_path: string
  started_at: string
  frontend_output_dir: string
  completed_at: string | null
}

export interface RunResults {
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
    table_type?: string
    table_index?: number
  }>
  markdown?: string
}

// === Pipeline ===

export interface PipelineRunResponse {
  run_id: string
  task_id: string | null
  status: 'started' | 'failed'
  message: string
}

export interface PipelineCancelResponse {
  run_id: string
  status: string
  message: string
}

// === Storage ===

export interface UploadResponse {
  filename: string
  file_path: string
  size_bytes: number
}

export interface FileInfo {
  name: string
  size_bytes: number
  modified: string
}

// === Classification ===

export interface ClassificationCrop {
  sha: string
  class_name: 'window' | 'door' | 'unknown' | 'reject'
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
}

export interface ClassificationQueue {
  run_id: string
  doc_id: string
  doc_name: string
  crops: ClassificationCrop[]
  total: number
  reviewed: number
  progress_percent: number
}

export interface ClassificationStats {
  run_id: string
  total: number
  reviewed: number
  by_classification: {
    window: number
    door: number
    unknown: number
  }
}

export interface ClassificationSubmitResponse {
  run_id: string
  status: 'completed' | 'auto_completed'
  message: string
  classified_count: number
}

// === API Error ===

export interface ApiError {
  error: string
  detail?: string
  request_id?: string
}
