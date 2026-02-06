import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { getFastApiUrl } from '@/lib/api-config'

const log = createLogger('api/pipeline/cancel')

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
    // Proxy to FastAPI — it owns all Redis/job state
    const res = await fetch(`${getFastApiUrl()}/api/jobs/${runId}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!res.ok) {
      const body = await res.text()
      log.error('FastAPI cancel error', { status: res.status, body })
      return NextResponse.json({ error: 'Failed to cancel' }, { status: res.status })
    }

    const data = await res.json()
    return NextResponse.json({
      run_id: runId,
      status: data.status || 'cancelled',
      message: data.message || 'Pipeline cancelled',
    })
  } catch (error) {
    log.error('Cancel error', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to cancel' }, { status: 500 })
  }
}
