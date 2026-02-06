import { NextRequest, NextResponse } from 'next/server'
import { storage } from '@/services/storage'
import { createLogger } from '@/lib/logger'

const log = createLogger('api/crop/image')

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; sha: string }> }
) {
  const { runId, sha } = await params

  try {
    const image = await storage.getImage(runId, sha)

    if (!image) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 })
    }

    // Return image directly with proper caching
    return new NextResponse(Uint8Array.from(image.buffer), {
      status: 200,
      headers: {
        'Content-Type': image.mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable', // Cache for 1 year (SHA-based filenames are immutable)
        'ETag': image.etag,
        'Last-Modified': image.lastModified.toUTCString(),
        'Content-Length': image.buffer.length.toString(),
      },
    })
  } catch (error) {
    log.error('Error getting crop image', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to get image' }, { status: 500 })
  }
}
