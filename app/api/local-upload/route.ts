import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { loggers } from '@/lib/v4-logger'
import { resolve } from 'path'

// Use parent directory (project root) since Next.js runs from frontend/
const PROJECT_ROOT = resolve(process.cwd(), '..')
// Always resolve OUTPUT_DIR relative to PROJECT_ROOT (not cwd)
const OUTPUT_DIR = process.env.OUTPUT_DIR
    ? resolve(PROJECT_ROOT, process.env.OUTPUT_DIR)
    : resolve(PROJECT_ROOT, 'output_frontend')
const logger = loggers.localUpload

/**
 * Local file upload endpoint for v4 architecture in local storage mode.
 * 
 * This enables using the v4 Jobs API without Vercel Blob storage.
 * Files are stored locally and served via /api/files/[...path].
 * 
 * POST /api/local-upload
 * Body: FormData with 'file' and 'jobId' fields
 * 
 * Returns: { url: string, pathname: string }
 */
export async function POST(request: NextRequest) {
    const startTime = Date.now()

    try {
        const formData = await request.formData()
        const file = formData.get('file') as File | null
        const jobId = formData.get('jobId') as string | null

        logger.section('LOCAL UPLOAD REQUEST', { job_id: jobId || 'unknown' })

        if (!file) {
            logger.error('No file provided', { job_id: jobId || 'unknown' })
            return NextResponse.json({ error: 'No file provided' }, { status: 400 })
        }

        if (!jobId) {
            logger.error('No jobId provided')
            return NextResponse.json({ error: 'No jobId provided' }, { status: 400 })
        }

        logger.info(`File: ${file.name}, size: ${file.size} bytes`, { job_id: jobId })

        // Security: validate jobId format (UUID)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        if (!uuidRegex.test(jobId)) {
            logger.error('Invalid jobId format', { job_id: jobId })
            return NextResponse.json({ error: 'Invalid jobId format' }, { status: 400 })
        }

        // Create job directory (OUTPUT_DIR is already absolute path to project root)
        const jobDir = join(OUTPUT_DIR, jobId)
        await mkdir(jobDir, { recursive: true })
        logger.debug(`Job directory created: ${jobDir}`, { job_id: jobId })

        // Use a simple, URL-safe filename to avoid encoding issues
        // Store original name in a metadata file if needed later
        const safeFilename = 'input.pdf'
        const filePath = join(jobDir, safeFilename)

        const bytes = await file.arrayBuffer()
        await writeFile(filePath, new Uint8Array(bytes))
        logger.info(`File written: ${filePath} (${bytes.byteLength} bytes)`, { job_id: jobId })

        // Store original filename in metadata
        const metadataPath = join(jobDir, 'metadata.json')
        await writeFile(metadataPath, JSON.stringify({
            originalFilename: file.name,
            uploadedAt: new Date().toISOString(),
        }, null, 2))

        // Build URL that worker can fetch via HTTP
        // Use the origin from the request, or default to localhost
        const host = request.headers.get('host') || 'localhost:3000'
        const protocol = request.headers.get('x-forwarded-proto') || 'http'
        // URL is simple now: /api/files/{jobId}/input.pdf
        const url = `${protocol}://${host}/api/files/${jobId}/${safeFilename}`

        const durationMs = Date.now() - startTime
        logger.section('UPLOAD COMPLETE', { job_id: jobId, duration_ms: durationMs })
        logger.info(`URL for worker: ${url}`, { job_id: jobId, url })

        return NextResponse.json({
            url,
            pathname: `${jobId}/${safeFilename}`,
            originalFilename: file.name,
        })
    } catch (error) {
        logger.error(`Upload error: ${error instanceof Error ? error.message : 'Unknown'}`, {
            error: error instanceof Error ? error.message : 'Unknown',
        })
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Upload failed' },
            { status: 500 }
        )
    }
}
