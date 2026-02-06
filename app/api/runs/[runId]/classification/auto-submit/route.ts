import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { getFastApiUrl } from '@/lib/api-config'

const log = createLogger('api/classification/auto-submit')

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
    // Proxy to FastAPI — it handles read-from-Redis + write-back in one step
    const res = await fetch(`${getFastApiUrl()}/api/jobs/${runId}/classification/auto-submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!res.ok) {
      if (res.status === 404) {
        return NextResponse.json({ error: 'Classification not found' }, { status: 404 })
      }
      const body = await res.text()
      log.error('FastAPI auto-submit error', { status: res.status, body })
      return NextResponse.json({ error: 'Failed to auto-submit' }, { status: res.status })
    }

    const data = await res.json()
    return NextResponse.json({
      run_id: runId,
      status: data.status || 'completed',
      message: data.message || 'Auto-submitted classifications',
      classified_count: data.classified_count || 0,
    })
  } catch (error) {
    log.error('Auto-submit error', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to auto-submit' }, { status: 500 })
  }
}
