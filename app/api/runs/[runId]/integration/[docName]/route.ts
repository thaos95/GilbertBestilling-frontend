import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { createLogger } from '@/lib/logger'

const log = createLogger('api/integration')

const OUTPUT_DIR = process.env.OUTPUT_DIR || 'output_frontend'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; docName: string }> }
) {
  const { runId, docName } = await params

  try {
    const outputDir = join(process.cwd(), OUTPUT_DIR, runId)

    // Try building_elements.json first, then integration.json
    const possiblePaths = [
      join(outputDir, 'building_elements.json'),
      join(outputDir, `${docName}_elements.json`),
      join(outputDir, 'integration.json'),
    ]

    let content: string | null = null
    for (const path of possiblePaths) {
      try {
        content = await readFile(path, 'utf-8')
        break
      } catch {
        continue
      }
    }

    if (!content) {
      return NextResponse.json({ error: 'Integration data not found' }, { status: 404 })
    }

    return NextResponse.json(JSON.parse(content))
  } catch (error) {
    log.error('Error getting integration data', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to get integration data' }, { status: 500 })
  }
}
