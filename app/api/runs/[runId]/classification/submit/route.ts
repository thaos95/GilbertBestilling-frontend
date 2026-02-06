import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { getFastApiUrl } from '@/lib/api-config'

const log = createLogger('api/classification/submit')

// UUID v4 validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isValidUUID(str: string): boolean {
  return UUID_REGEX.test(str)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params

  // Validate runId format
  if (!isValidUUID(runId)) {
    return NextResponse.json({ error: 'Invalid runId format' }, { status: 400 })
  }

  try {
    const body = await request.json()
    const { classifications } = body

    if (!classifications || !Array.isArray(classifications)) {
      return NextResponse.json({ error: 'Invalid classifications' }, { status: 400 })
    }

    // Proxy to FastAPI — it owns all Redis/job state
    const res = await fetch(`${getFastApiUrl()}/api/jobs/${runId}/classification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classifications }),
    })

    if (!res.ok) {
      const errorBody = await res.text()
      log.error('FastAPI submit error', { status: res.status, body: errorBody })
      return NextResponse.json({ error: 'Failed to submit classification' }, { status: res.status })
    }

    const data = await res.json()
    return NextResponse.json({
      run_id: runId,
      status: data.status || 'completed',
      message: data.message || 'Classification submitted',
      classified_count: classifications.length,
    })
  } catch (error) {
    log.error('Classification submit error', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to submit classification' }, { status: 500 })
  }
}
