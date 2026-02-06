import { NextResponse } from 'next/server'
import { readdir, stat, readFile } from 'fs/promises'
import { join } from 'path'
import { createLogger } from '@/lib/logger'

const log = createLogger('api/runs')

const OUTPUT_DIR = process.env.OUTPUT_DIR || 'output_frontend'

export async function GET() {
  try {
    const runs = []
    const outputDir = join(process.cwd(), OUTPUT_DIR)

    // Check if directory exists
    try {
      const dirs = await readdir(outputDir)

      for (const runId of dirs) {
        const runPath = join(outputDir, runId)
        const manifestPath = join(runPath, 'manifest.json')

        try {
          const fileStat = await stat(manifestPath)
          const manifestContent = await readFile(manifestPath, 'utf-8')
          const manifest = JSON.parse(manifestContent)

          runs.push({
            run_id: runId,
            doc_id: manifest.doc_id || runId,
            original_filename: manifest.original_filename || 'unknown',
            source_path: manifest.source_path || '',
            started_at: manifest.started_at || new Date().toISOString(),
            frontend_output_dir: manifest.frontend_output_dir || runPath,
            pipeline_status: manifest.pipeline_status || 'unknown',
          })
        } catch {
          // Skip if manifest doesn't exist
        }
      }
    } catch {
      // output_frontend doesn't exist yet
    }

    // Sort by started_at descending
    runs.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())

    return NextResponse.json(runs)
  } catch (error) {
    log.error('Error listing runs', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to list runs' }, { status: 500 })
  }
}
