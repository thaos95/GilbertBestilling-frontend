import { NextRequest, NextResponse } from 'next/server'
import { mkdir, copyFile, writeFile, readdir, stat } from 'fs/promises'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import { v4 as uuidv4 } from 'uuid'
import { spawn } from 'child_process'
import { promisify } from 'util'
import { createLogger } from '@/lib/logger'

const log = createLogger('api/pipeline/run')

const sleep = promisify(setTimeout)

const INPUT_DIR = process.env.INPUT_DIR || 'input'
const OUTPUT_DIR = process.env.OUTPUT_DIR || 'output_frontend'

interface RunResponse {
  run_id: string
  task_id: string
  status: string
  message: string
}

async function spawnCeleryTask(runId: string, docId: string, docPath: string): Promise<void> {
  // Find the dispatch script - it's in the workers directory at project root
  const projectRoot = resolve(process.cwd(), '..')
  const dispatchScript = join(projectRoot, 'workers', 'dispatch_task.py')

  if (!existsSync(dispatchScript)) {
    throw new Error(`Dispatch script not found: ${dispatchScript}`)
  }

  // Use the venv Python from uv - try common locations
  const possiblePythons = [
    join(projectRoot, '.venv', 'bin', 'python'),
    join(projectRoot, '.venv', 'Scripts', 'python.exe'),  // Windows
    '/home/lars/Giljepipeline/.venv/bin/python',
    process.env.VIRTUAL_ENV ? join(process.env.VIRTUAL_ENV, 'bin', 'python') : null,
  ].filter(Boolean) as string[]

  let pythonCmd: string | null = null
  for (const p of possiblePythons) {
    if (existsSync(p)) {
      pythonCmd = p
      break
    }
  }

  if (!pythonCmd) {
    // Fallback - try python3
    pythonCmd = 'python3'
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(pythonCmd, [dispatchScript, runId, docId, docPath], {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONPATH: projectRoot },
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
      log.debug(`dispatch: ${data.toString().trim()}`)
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
      log.error(`dispatch error: ${data.toString().trim()}`)
    })

    proc.on('close', (code) => {
      if (code === 0) {
        const taskId = stdout.trim()
        log.info(`Task dispatched successfully: ${taskId}`)
        resolve()
      } else {
        reject(new Error(`Dispatch failed with code ${code}: ${stderr}`))
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn dispatch script: ${err.message}`))
    })
  })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { filename } = body

    const inputDir = join(process.cwd(), INPUT_DIR)
    const outputDir = join(process.cwd(), OUTPUT_DIR)

    // Determine input file
    let inputPath: string
    if (filename) {
      inputPath = join(inputDir, filename)
      if (!existsSync(inputPath)) {
        return NextResponse.json({ error: `File not found: ${filename}` }, { status: 404 })
      }
    } else {
      // Get most recent file
      if (!existsSync(inputDir)) {
        return NextResponse.json({ error: 'No files in input directory' }, { status: 400 })
      }

      const files = await readdir(inputDir)
      const fileList = []

      for (const name of files) {
        const filePath = join(inputDir, name)
        const fileStat = await stat(filePath)
        if (fileStat.isFile()) {
          fileList.push({ name, mtime: fileStat.mtime })
        }
      }

      if (fileList.length === 0) {
        return NextResponse.json({ error: 'No files in input directory' }, { status: 400 })
      }

      // Sort by modification time, get most recent
      fileList.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
      inputPath = join(inputDir, fileList[0].name)
    }

    // Generate UUID run_id
    const runId = uuidv4()
    const docId = inputPath.split('/').pop()?.replace(/\.[^/.]+$/, '') || runId

    // Create output_frontend directory structure
    const runDir = join(outputDir, runId)
    await mkdir(runDir, { recursive: true })

    // Copy source file to frontend output directory
    const inputName = inputPath.split('/').pop() || 'unknown'
    const outputSourcePath = join(runDir, inputName)
    await copyFile(inputPath, outputSourcePath)

    // Create manifest.json with metadata
    const manifest = {
      run_id: runId,
      doc_id: docId,
      original_filename: inputName,
      source_path: outputSourcePath,
      started_at: new Date().toISOString(),
      frontend_output_dir: runDir,
    }

    const manifestPath = join(runDir, 'manifest.json')
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2))

    // Spawn Celery task
    await spawnCeleryTask(runId, docId, outputSourcePath)

    const response: RunResponse = {
      run_id: runId,
      task_id: runId,
      status: 'started',
      message: 'Pipeline started',
    }

    return NextResponse.json(response)
  } catch (error) {
    log.error('Pipeline start error', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to start pipeline' }, { status: 500 })
  }
}
