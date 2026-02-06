import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { createLogger } from '@/lib/logger'

const log = createLogger('api/upload')

const INPUT_DIR = process.env.INPUT_DIR || 'input'

// UUID v4 validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// Sanitize filename to prevent path traversal
function sanitizeFilename(filename: string): string {
  // Get only the basename to prevent path traversal
  const basename = filename.split('/').pop()?.split('\\').pop() || filename
  // Replace any non-alphanumeric chars (except ._- ) with underscore
  return basename.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const inputDir = join(process.cwd(), INPUT_DIR)

    // Create input directory if it doesn't exist
    if (!existsSync(inputDir)) {
      await mkdir(inputDir, { recursive: true })
    }

    // Sanitize filename to prevent path traversal attacks
    const safeName = sanitizeFilename(file.name)
    const filePath = join(inputDir, safeName)
    const bytes = await file.arrayBuffer()

    const fileBuffer = new Uint8Array(bytes)
    await writeFile(filePath, fileBuffer)

    return NextResponse.json({
      filename: safeName,
      file_path: filePath,
      size_bytes: fileBuffer.length,
    })
  } catch (error) {
    log.error('Upload error', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const inputDir = join(process.cwd(), INPUT_DIR)

    if (!existsSync(inputDir)) {
      return NextResponse.json([])
    }

    const { readdir, stat } = await import('fs/promises')
    const files = await readdir(inputDir)

    const fileList = []
    for (const name of files) {
      const filePath = join(inputDir, name)
      const fileStat = await stat(filePath)
      if (fileStat.isFile()) {
        fileList.push({
          name,
          size_bytes: fileStat.size,
          modified: fileStat.mtime.toISOString(),
        })
      }
    }

    return NextResponse.json(fileList)
  } catch (error) {
    log.error('List files error', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to list files' }, { status: 500 })
  }
}
