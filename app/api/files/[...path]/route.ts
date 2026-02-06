import { NextRequest, NextResponse } from 'next/server'
import { readFile, stat } from 'fs/promises'
import { join, extname } from 'path'
import { loggers } from '@/lib/v4-logger'
import { resolve } from 'path'

// Use parent directory (project root) since Next.js runs from frontend/
const PROJECT_ROOT = resolve(process.cwd(), '..')
// Always resolve OUTPUT_DIR relative to PROJECT_ROOT (not cwd)
const OUTPUT_DIR = process.env.OUTPUT_DIR
    ? resolve(PROJECT_ROOT, process.env.OUTPUT_DIR)
    : resolve(PROJECT_ROOT, 'output_frontend')
const logger = loggers.files

// MIME type mapping
const MIME_TYPES: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.md': 'text/markdown',
    '.txt': 'text/plain',
}

/**
 * Serve files from output_frontend directory.
 * 
 * This endpoint enables serving images, CSVs, and other pipeline output files
 * for local development (when not using Vercel Blob storage).
 * 
 * URL format: /api/files/{run_id}/{relative_path}
 * Example: /api/files/abc-123/images/page_001.png
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const startTime = Date.now()

    try {
        const { path: pathSegments } = await params

        // Extract job_id from first path segment for logging
        const jobId = pathSegments?.[0] || 'unknown'

        if (!pathSegments || pathSegments.length === 0) {
            logger.warn('No path specified')
            return NextResponse.json({ error: 'No path specified' }, { status: 400 })
        }

        // URL-decode each segment (Next.js may or may not decode automatically)
        const decodedSegments = pathSegments.map(seg => {
            try {
                return decodeURIComponent(seg)
            } catch {
                return seg // Already decoded or invalid
            }
        })

        const fullPath = decodedSegments.join('/')
        logger.debug(`File request: ${fullPath}`, { job_id: jobId })

        // Security: prevent path traversal
        if (fullPath.includes('..') || fullPath.startsWith('/')) {
            logger.warn('Path traversal attempt blocked', { job_id: jobId })
            return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
        }

        // Build absolute path to file (OUTPUT_DIR is already absolute)
        const filePath = join(OUTPUT_DIR, ...decodedSegments)
        logger.debug(`Resolved file path: ${filePath}`, { job_id: jobId })

        // Check file exists and is a file (not directory)
        try {
            const fileStat = await stat(filePath)
            if (!fileStat.isFile()) {
                logger.warn(`Not a file: ${fullPath}`, { job_id: jobId })
                return NextResponse.json({ error: 'Not a file' }, { status: 400 })
            }
        } catch (statError) {
            logger.warn(`File not found: ${fullPath} at path: ${filePath}`, { job_id: jobId })
            return NextResponse.json({ detail: 'Not Found' }, { status: 404 })
        }

        // Read file content
        const content = await readFile(filePath)

        // Determine MIME type
        const ext = extname(filePath).toLowerCase()
        const mimeType = MIME_TYPES[ext] || 'application/octet-stream'

        const durationMs = Date.now() - startTime
        logger.info(`Served: ${fullPath} (${content.length} bytes, ${durationMs}ms)`, {
            job_id: jobId,
            duration_ms: durationMs
        })

        // Return file with appropriate headers
        return new NextResponse(new Uint8Array(content), {
            status: 200,
            headers: {
                'Content-Type': mimeType,
                'Content-Length': content.length.toString(),
                // Cache for 1 hour in dev, longer in prod
                'Cache-Control': process.env.NODE_ENV === 'production'
                    ? 'public, max-age=86400'
                    : 'public, max-age=3600',
            },
        })
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown'
        logger.error(`Error serving file: ${errorMessage}`)
        return NextResponse.json(
            { error: 'Failed to serve file' },
            { status: 500 }
        )
    }
}
