/**
 * TypeScript interfaces matching FastAPI Pydantic models.
 *
 * NOTE: Most types have been consolidated into api.ts.
 * This file retains shared contract types that may be needed
 * if api.ts is refactored into separate modules.
 */

// === Storage ===

export interface UploadResponse {
  filename: string
  file_path: string
  size_bytes: number
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

export interface ClassificationSubmitResponse {
  run_id: string
  status: 'completed' | 'auto_completed'
  message: string
  classified_count: number
}
