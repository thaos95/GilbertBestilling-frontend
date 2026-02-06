import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { getFastApiUrl } from '@/lib/api-config'

const log = createLogger('api/classification/redis')

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
    const res = await fetch(`${getFastApiUrl()}/api/jobs/${runId}/classification`, {
      headers: { 'Accept': 'application/json' },
    })

    if (!res.ok) {
      if (res.status === 404) {
        return NextResponse.json({ error: 'Classification not found' }, { status: 404 })
      }
      const body = await res.text()
      log.error('FastAPI classification error', { status: res.status, body })
      return NextResponse.json({ error: 'Failed to get classification' }, { status: res.status })
    }

    const classification = await res.json()
    return NextResponse.json(classification)
  } catch (error) {
    log.error('Error getting classification', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to get classification' }, { status: 500 })
  }
}
