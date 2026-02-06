/**
 * Storage abstraction for v4 architecture.
 * 
 * Supports both:
 * - Local filesystem storage (when NEXT_PUBLIC_USE_BLOB=false)
 * - Vercel Blob storage (when NEXT_PUBLIC_USE_BLOB=true)
 * 
 * In v4 mode, images are stored in Vercel Blob and URLs are stored
 * in the job's Redis state. This module fetches images via HTTP
 * from those URLs rather than reading from local filesystem.
 */

import { readFile, readdir } from 'fs/promises'
import { join, resolve } from 'path'
import { createHash } from 'crypto'
import { createLogger } from '@/lib/logger'

const log = createLogger('storage')

// Resolve OUTPUT_DIR relative to PROJECT_ROOT (parent of cwd, since Next.js runs from frontend/)
const PROJECT_ROOT = resolve(process.cwd(), '..')
const OUTPUT_DIR = process.env.OUTPUT_DIR
  ? resolve(PROJECT_ROOT, process.env.OUTPUT_DIR)
  : resolve(PROJECT_ROOT, 'output_frontend')
const USE_BLOB = process.env.NEXT_PUBLIC_USE_BLOB === 'true'

export interface ImageResult {
  buffer: Buffer
  mimeType: string
  etag: string
  lastModified: Date
}

export interface StorageAdapter {
  getImage(runId: string, sha: string): Promise<ImageResult | null>
  getFile(runId: string, filename: string): Promise<Buffer | null>
  listFiles(runId: string, pattern?: string): Promise<string[]>
}

/**
 * Local filesystem storage adapter.
 */
class LocalStorage implements StorageAdapter {
  private outputDir: string

  constructor(outputDir: string = OUTPUT_DIR) {
    this.outputDir = outputDir
  }

  async getImage(runId: string, sha: string): Promise<ImageResult | null> {
    try {
      // Look for image file matching SHA prefix
      const runDir = join(this.outputDir, runId)
      const files = await this.findFilesRecursive(runDir)

      // Find image file matching SHA (with various extensions)
      const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp']
      const matchingFile = files.find(f => {
        const basename = f.split('/').pop() || ''
        return basename.startsWith(sha) && imageExtensions.some(ext => basename.endsWith(ext))
      })

      if (!matchingFile) {
        // Also check crops directory
        const cropsDir = join(runDir, 'crops')
        try {
          const cropFiles = await readdir(cropsDir)
          const cropMatch = cropFiles.find(f => f.startsWith(sha))
          if (cropMatch) {
            return this.readImageFile(join(cropsDir, cropMatch))
          }
        } catch {
          // crops directory doesn't exist
        }
        return null
      }

      return this.readImageFile(matchingFile)
    } catch (error) {
      log.error(`getImage error for ${runId}/${sha}`, { error: error instanceof Error ? error.message : String(error) })
      return null
    }
  }

  private async readImageFile(filePath: string): Promise<ImageResult> {
    const buffer = await readFile(filePath)
    const ext = filePath.split('.').pop()?.toLowerCase() || 'png'

    const mimeTypes: Record<string, string> = {
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'webp': 'image/webp',
    }

    return {
      buffer,
      mimeType: mimeTypes[ext] || 'image/png',
      etag: createHash('md5').update(new Uint8Array(buffer)).digest('hex'),
      lastModified: new Date(),
    }
  }

  async getFile(runId: string, filename: string): Promise<Buffer | null> {
    try {
      const filePath = join(this.outputDir, runId, filename)
      return await readFile(filePath)
    } catch {
      return null
    }
  }

  async listFiles(runId: string, pattern?: string): Promise<string[]> {
    const runDir = join(this.outputDir, runId)
    const files = await this.findFilesRecursive(runDir)

    if (pattern) {
      const regex = new RegExp(pattern)
      return files.filter(f => regex.test(f))
    }

    return files
  }

  private async findFilesRecursive(dir: string, files: string[] = []): Promise<string[]> {
    try {
      const entries = await readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          await this.findFilesRecursive(fullPath, files)
        } else {
          files.push(fullPath)
        }
      }
    } catch {
      // Directory doesn't exist or isn't readable
    }

    return files
  }
}

/**
 * Vercel Blob storage adapter.
 * Fetches images via HTTP from blob URLs stored in job state.
 */
class BlobStorage implements StorageAdapter {
  async getImage(runId: string, sha: string): Promise<ImageResult | null> {
    try {
      // In blob mode, images are fetched directly from blob URLs
      // The URL should be in the job manifest or classification data
      // For now, this is a placeholder - will be implemented in Phase 6
      log.warn(`Blob mode image fetch not fully implemented for ${runId}/${sha}`)
      return null
    } catch (error) {
      log.error(`Blob getImage error for ${runId}/${sha}`, { error: error instanceof Error ? error.message : String(error) })
      return null
    }
  }

  async getFile(runId: string, filename: string): Promise<Buffer | null> {
    // Similar to getImage - need to look up blob URL from manifest
    log.warn(`Blob mode file fetch not fully implemented for ${runId}/${filename}`)
    return null
  }

  async listFiles(runId: string, pattern?: string): Promise<string[]> {
    // In blob mode, files are listed in the manifest
    log.warn(`Blob mode listFiles not fully implemented for ${runId}`)
    return []
  }
}

// Export storage adapter based on configuration
export const storage: StorageAdapter = USE_BLOB ? new BlobStorage() : new LocalStorage()
