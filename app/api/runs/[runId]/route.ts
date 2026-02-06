import { NextRequest, NextResponse } from 'next/server'
import { rm } from 'fs/promises'
import { join } from 'path'
import { createLogger } from '@/lib/logger'
import { getFastApiUrl } from '@/lib/api-config'

const log = createLogger('api/runs/[runId]')

const OUTPUT_DIR = process.env.OUTPUT_DIR || 'output_frontend'

// UUID v4 validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isValidUUID(str: string): boolean {
  return UUID_REGEX.test(str)
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
    // Proxy to FastAPI — it owns all Redis/job state
    const res = await fetch(`${getFastApiUrl()}/api/jobs/${runId}`, {
      headers: { 'Accept': 'application/json' },
    })

    if (!res.ok) {
      if (res.status === 404) {
        return NextResponse.json({ error: 'Run not found' }, { status: 404 })
      }
      const body = await res.text()
      log.error('FastAPI status error', { status: res.status, body })
      return NextResponse.json({ error: 'Failed to get status' }, { status: res.status })
    }

    const job = await res.json()

    return NextResponse.json({
      run_id: runId,
      status: job.status || 'unknown',
      message: job.message || '',
      ...(job.progress ? { progress: job.progress } : {}),
    })
  } catch (error) {
    log.error('Error getting run status', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to get status' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params

  // Validate runId format
  if (!isValidUUID(runId)) {
    return NextResponse.json({ error: 'Invalid runId format' }, { status: 400 })
  }

  try {
    const outputDir = join(process.cwd(), OUTPUT_DIR, runId)

    try {
      await rm(outputDir, { recursive: true, force: true })
      return NextResponse.json({ message: 'Run deleted' })
    } catch {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }
  } catch (error) {
    log.error('Error deleting run', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
  }
}
