import { NextRequest, NextResponse } from 'next/server'
import { readFile, readdir } from 'fs/promises'
import { join, resolve } from 'path'
import { createLogger } from '@/lib/logger'
import { getFastApiUrl } from '@/lib/api-config'

const log = createLogger('api/results')

// Resolve OUTPUT_DIR relative to PROJECT_ROOT (parent of cwd, since Next.js runs from frontend/)
const PROJECT_ROOT = resolve(process.cwd(), '..')
const OUTPUT_DIR = process.env.OUTPUT_DIR
  ? resolve(PROJECT_ROOT, process.env.OUTPUT_DIR)
  : resolve(PROJECT_ROOT, 'output_frontend')

// Storage mode detection (same logic as dashboard)
const STORAGE_MODE = process.env.NEXT_PUBLIC_STORAGE_MODE || (process.env.NEXT_PUBLIC_USE_BLOB === 'true' ? 'blob' : 'local')
const IS_BLOB_MODE = STORAGE_MODE === 'blob'

// UUID v4 validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isValidUUID(str: string): boolean {
  return UUID_REGEX.test(str)
}

interface FigureResult {
  sha: string
  class_name: string
  image_path?: string
  image_url?: string
  page_id?: string
  bbox?: number[]
}

interface TableResult {
  sha: string
  markdown: string
  page?: number
}

/**
 * Find a crop image file by SHA prefix in the output directory.
 * Returns a /api/files/ URL or null if not found.
 */
async function findCropImage(outputDir: string, sha: string): Promise<string | null> {
  try {
    // Walk the visual_detector/detections tree to find files matching SHA
    const detectionsDir = join(outputDir, 'visual_detector', 'detections')
    const pages = await readdir(detectionsDir).catch(() => [])
    for (const pageId of pages) {
      const cropsDir = join(detectionsDir, pageId, 'crops')
      const classes = await readdir(cropsDir).catch(() => [])
      for (const cls of classes) {
        const clsDir = join(cropsDir, cls, pageId)
        const files = await readdir(clsDir).catch(() => [])
        const match = files.find(f => f.startsWith(sha) && f.endsWith('.png'))
        if (match) {
          // Derive run_id from outputDir (last path segment)
          const runId = outputDir.split(/[\\/]/).pop() || ''
          return `/api/files/${runId}/visual_detector/detections/${pageId}/crops/${cls}/${pageId}/${match}`
        }
      }
    }
  } catch {
    // Fall through
  }
  return null
}

interface ResultsResponse {
  run_id: string
  doc_id: string
  doc_name: string
  status: string
  figures: FigureResult[]
  tables: TableResult[]
  markdown?: string
}

// Read manifest to get doc_name (local mode)
async function getManifest(outputDir: string): Promise<{ doc_id: string; doc_name: string } | null> {
  try {
    const manifestPath = join(outputDir, 'manifest.json')
    const content = await readFile(manifestPath, 'utf-8')
    const manifest = JSON.parse(content)
    return {
      doc_id: manifest.doc_id || '',
      doc_name: manifest.doc_name || ''
    }
  } catch {
    return null
  }
}

/**
 * Get results from FastAPI (which reads Redis / blob storage on its side).
 */
async function getResultsFromBlob(runId: string): Promise<ResultsResponse | null> {
  try {
    const res = await fetch(`${getFastApiUrl()}/api/jobs/${runId}/results`, {
      headers: { 'Accept': 'application/json' },
    })
    if (!res.ok) return null
    return await res.json() as ResultsResponse
  } catch (error) {
    log.error(`FastAPI results fetch error for ${runId}`, { error: error instanceof Error ? error.message : String(error) })
    return null
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params

  // Validate runId format
  if (!isValidUUID(runId)) {
    return NextResponse.json({ error: 'Invalid runId format' }, { status: 400 })
  }

  try {
    // Blob mode: fetch results from blob storage via manifest
    if (IS_BLOB_MODE) {
      const blobResults = await getResultsFromBlob(runId)
      if (blobResults) {
        return NextResponse.json(blobResults)
      }
      // Fall through to local mode as fallback
      log.debug(`Blob mode returned no results for ${runId}, falling back to local`)
    }

    const outputDir = join(OUTPUT_DIR, runId)

    // Get manifest for doc info
    const manifest = await getManifest(outputDir)

    // Try to find integration JSON file (there may be multiple)
    let integrationData: Record<string, unknown> | null = null
    let integrationFileName = ''

    try {
      const integrationDir = join(outputDir, 'document_integration')
      const files = await readdir(integrationDir)
      const jsonFiles = files.filter(f => f.endsWith('.json'))
      if (jsonFiles.length > 0) {
        // Use the first JSON file found
        const integrationPath = join(integrationDir, jsonFiles[0])
        const content = await readFile(integrationPath, 'utf-8')
        integrationData = JSON.parse(content)
        integrationFileName = jsonFiles[0].replace('.json', '')
      }
    } catch {
      // No integration directory or files
    }

    // Build response
    const response: ResultsResponse = {
      run_id: runId,
      doc_id: manifest?.doc_id || runId,
      doc_name: manifest?.doc_name || integrationFileName || 'unknown',
      status: 'completed',
      figures: [],
      tables: [],
    }

    // Process integration data into figures
    if (integrationData && integrationData.products) {
      const products = integrationData.products as Array<{
        figure_sha8?: string
        table_type?: string
        entity_type?: string
        reference?: string
        description_window?: string
        description_glazing?: string
      }>

      for (const product of products) {
        const sha8 = product.figure_sha8 || ''
        if (sha8) {
          // Add as figure — try to find crop file on disk for proper URL
          const cropImagePath = await findCropImage(outputDir, sha8)
          response.figures.push({
            sha: sha8,
            class_name: product.entity_type || 'unknown',
            image_path: cropImagePath || `/api/files/${runId}/visual_detector/detections/001/crops/unknown/001/${sha8}.png`,
          })
        }
        if (product.table_type && product.table_type !== 'unknown') {
          // This product has table data
          response.tables.push({
            sha: product.table_type,
            markdown: product.description_window || product.description_glazing || '',
          })
        }
      }
    }

    // If no integration data, try loading legacy pipeline_results.json
    if (!integrationData) {
      try {
        const resultsPath = join(outputDir, 'pipeline_results.json')
        const resultsContent = await readFile(resultsPath, 'utf-8')
        const results = JSON.parse(resultsContent)

        // Process unified_figures into figures array
        if (results.unified_figures) {
          for (const figure of results.unified_figures) {
            const sha = figure.sha || figure.sha8
            response.figures.push({
              sha,
              class_name: figure.class_name,
              image_path: figure.image_url || figure.image_path || `/api/files/${runId}/visual_detector/detections/${figure.page_id || '001'}/crops/unknown/${figure.page_id || '001'}/${sha}.png`,
              page_id: figure.page_id,
              bbox: figure.bbox,
            })
          }
        }

        // Process tables
        if (results.tables) {
          for (const table of results.tables) {
            response.tables.push({
              sha: table.sha || table.sha8,
              markdown: table.markdown || table.normalized_markdown || '',
              page: table.page,
            })
          }
        }
      } catch {
        // No legacy pipeline_results.json either - that's okay, we'll return empty results
      }
    }

    // Get markdown if exists
    const markdownPath = join(outputDir, 'document.md')
    try {
      response.markdown = await readFile(markdownPath, 'utf-8')
    } catch {
      // No markdown
    }

    return NextResponse.json(response)
  } catch (error) {
    log.error('Error getting results', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to get results' }, { status: 500 })
  }
}
