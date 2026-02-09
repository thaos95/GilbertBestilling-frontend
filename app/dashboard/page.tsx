'use client'

import { useState, useEffect, useCallback, useRef } from "react"
import Link from "next/link"
import { upload } from '@vercel/blob/client'
import { createJob, type JobPublic } from '../../hooks/useJobStatus'
import { getFastApiUrl, api } from '@/lib/api-config'
import { createLogger } from '@/lib/logger'

const log = createLogger('Dashboard')

interface Run {
  run_id: string
  doc_id: string
  doc_name?: string
  status?: string
  pipeline_status?: string
  message?: string
  progress?: number
  pipeline_progress?: {
    percent_overall?: number
    current_phase?: string | null
    message?: string
  } | null
}

interface StagedFile {
  id: string
  file: File
  preview?: string
}

// Check if we should use v4 Blob upload or legacy FormData
// v4 is used when NEXT_PUBLIC_STORAGE_MODE=blob (explicit config)
function useV4BlobUpload(): boolean {
  if (typeof window === 'undefined') return false

  // Explicit storage mode env var (preferred for v4)
  const storageMode = process.env.NEXT_PUBLIC_STORAGE_MODE
  if (storageMode === 'blob') return true
  if (storageMode === 'local') return false

  // Legacy env var for backward compatibility
  if (process.env.NEXT_PUBLIC_USE_BLOB === 'true') return true

  // Default to local mode (explicit > heuristic)
  return false
}

export default function DashboardPage() {
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([])
  const [processing, setProcessing] = useState(false)
  const [processingCount, setProcessingCount] = useState(0)
  const [recentRuns, setRecentRuns] = useState<Run[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Polling state for v4 jobs
  const [isPolling, setIsPolling] = useState(false)
  const [v4JobIds, setV4JobIds] = useState<string[]>([])
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Terminal states where polling should stop for a job
  const isTerminalStatus = (status: string | undefined) => {
    return ['completed', 'failed', 'cancelled', 'classification_complete'].includes(status || '')
  }

  // Fetch initial jobs from v4 Jobs API and auto-poll any active ones
  useEffect(() => {
    fetch(api.jobs.list(10))
      .then(r => r.ok ? r.json() : [])
      .then((jobs: JobPublic[]) => {
        const runs = jobs.map(job => ({
          run_id: job.id,
          doc_id: job.doc_name || job.id,
          doc_name: job.doc_name,
          status: job.status,
          pipeline_status: job.status,
          progress: job.progress_percent,
          message: job.message,
          created_at: job.created_at,
        }))
        setRecentRuns(runs.slice(0, 5))

        // Auto-poll any jobs that are still active
        const activeJobIds = jobs
          .filter(job => !isTerminalStatus(job.status))
          .map(job => job.id)
        if (activeJobIds.length > 0) {
          log.debug(`Auto-polling ${activeJobIds.length} active jobs on load`)
          setV4JobIds(prev => [...new Set([...prev, ...activeJobIds])])
          setIsPolling(true)
        }
      })
      .catch(() => { })
  }, [])

  // v4 Jobs Polling - polls /api/jobs/{id} for each active job
  useEffect(() => {
    if (!isPolling || v4JobIds.length === 0) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
      return
    }

    const pollJobs = async () => {
      let allTerminal = true

      for (const jobId of v4JobIds) {
        try {
          // Use centralized API config - direct call to FastAPI
          const response = await fetch(api.jobs.get(jobId), {
            cache: 'no-store',
          })

          if (!response.ok) continue

          const job: JobPublic = await response.json()

          // Update recentRuns with job status
          setRecentRuns(prev => prev.map(run =>
            run.run_id === jobId
              ? {
                ...run,
                doc_id: job.doc_name || run.doc_id,
                doc_name: job.doc_name || run.doc_name,
                status: job.status,
                pipeline_status: job.status,
                progress: job.progress_percent,
                message: job.message,
              }
              : run
          ))

          // Check if any job is still active
          if (!isTerminalStatus(job.status)) {
            allTerminal = false
          }
        } catch (err) {
          log.error(`Polling error for job ${jobId}`, { error: err instanceof Error ? err.message : String(err) })
          allTerminal = false // Keep polling on error
        }
      }

      // Stop polling when all jobs are terminal
      if (allTerminal && v4JobIds.length > 0) {
        log.debug('All jobs terminal, stopping polling')
        setIsPolling(false)
      }
    }

    // Initial poll
    pollJobs()

    // Set up interval (5 seconds - reduced from 1s to minimize request volume)
    pollingRef.current = setInterval(pollJobs, 5000)

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [isPolling, v4JobIds])

  // Add files to staging
  const addFiles = useCallback((files: FileList | null) => {
    if (!files) return
    const newFiles = Array.from(files)
      .filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
      .map(f => ({
        id: `${f.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file: f,
      }))
    setStagedFiles(prev => [...prev, ...newFiles])
  }, [])

  // Remove file from staging
  const removeFile = (id: string) => {
    setStagedFiles(prev => prev.filter(f => f.id !== id))
  }

  // v4 job tracking
  const [v4Jobs, setV4Jobs] = useState<JobPublic[]>([])
  const isV4 = useV4BlobUpload()

  // Process files using v4 Blob upload flow
  const processFilesV4 = async () => {
    if (stagedFiles.length === 0) return

    log.info('Starting v4 Blob upload flow')
    setProcessing(true)
    setProcessingCount(0)
    setError(null)

    const newJobIds: string[] = []

    try {
      for (const { file } of stagedFiles) {
        // Generate job ID for path organization
        const jobId = crypto.randomUUID()
        log.debug(`Processing file: ${file.name}`, { jobId })
        const blob = await upload(
          `uploads/${jobId}/input.pdf`,
          file,
          {
            access: 'public',
            handleUploadUrl: '/api/blob/upload',
          }
        )
        log.debug('Blob upload complete', { url: blob.url })

        // blob.url is the full URL with random suffix
        // NEVER construct URL from pathname

        // Step 2: Create job via FastAPI
        log.debug('Creating job via FastAPI...')
        const job = await createJob(blob.url, file.name, jobId)
        log.info('Job created', { id: job.id, status: job.status })

        // Track job ID for polling
        newJobIds.push(job.id)

        // Add to jobs list
        setV4Jobs(prev => [job, ...prev].slice(0, 5))
        setRecentRuns(prev => [{
          run_id: job.id,
          doc_id: job.doc_name || file.name,
          doc_name: job.doc_name || file.name,
          status: job.status,
          pipeline_status: job.status,
          progress: job.progress_percent,
        }, ...prev].slice(0, 5))
        setProcessingCount(c => c + 1)
      }
      setStagedFiles([])
      log.info('All files processed successfully')

      // Start polling for the new jobs
      if (newJobIds.length > 0) {
        log.debug(`Starting polling for jobs: ${newJobIds.join(', ')}`)
        setV4JobIds(prev => [...new Set([...prev, ...newJobIds])])
        setIsPolling(true)
      }
    } catch (err) {
      log.error('Upload error', { error: err instanceof Error ? err.message : String(err) })
      setError(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setProcessing(false)
    }
  }

  // Process files using legacy FormData upload (local dev) -> NOW USES v4 Jobs API
  const processFilesLegacy = async () => {
    if (stagedFiles.length === 0) return

    log.info('Starting local v4 upload flow (local storage mode)')
    setProcessing(true)
    setProcessingCount(0)
    setError(null)

    const newJobIds: string[] = []

    try {
      for (const { file } of stagedFiles) {
        // Generate job ID for path organization
        const jobId = crypto.randomUUID()
        log.debug(`Processing file: ${file.name}`, { jobId })

        // Step 1: Upload file locally via /api/local-upload
        log.debug('Uploading file locally...')
        const formData = new FormData()
        formData.append('file', file)
        formData.append('jobId', jobId)

        const uploadRes = await fetch('/api/local-upload', {
          method: 'POST',
          body: formData,
        })

        if (!uploadRes.ok) {
          const error = await uploadRes.json().catch(() => ({ error: 'Upload failed' }))
          throw new Error(error.error || `Upload failed: ${uploadRes.statusText}`)
        }

        const uploadData = await uploadRes.json()
        log.debug('Local upload response', { url: uploadData.url, pathname: uploadData.pathname })

        // Step 2: Create job via FastAPI v4 Jobs API
        log.debug('Creating job via FastAPI v4 Jobs API...')
        const job = await createJob(uploadData.url, file.name, jobId)
        log.info('Job created', { id: job.id, status: job.status })

        // Track job ID for polling
        newJobIds.push(job.id)

        // Add to jobs list
        setV4Jobs(prev => [job, ...prev].slice(0, 5))
        setRecentRuns(prev => [{
          run_id: job.id,
          doc_id: job.doc_name || file.name,
          doc_name: job.doc_name || file.name,
          status: job.status,
          pipeline_status: job.status,
          progress: job.progress_percent,
        }, ...prev].slice(0, 5))
        setProcessingCount(c => c + 1)
      }
      setStagedFiles([])
      log.info('All files processed successfully')

      // Start polling for the new jobs
      if (newJobIds.length > 0) {
        log.debug(`Starting polling for jobs: ${newJobIds.join(', ')}`)
        setV4JobIds(prev => [...new Set([...prev, ...newJobIds])])
        setIsPolling(true)
      }
    } catch (err) {
      log.error('Upload error', { error: err instanceof Error ? err.message : String(err) })
      setError(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setProcessing(false)
    }
  }

  // Choose upload flow based on environment
  const processFiles = isV4 ? processFilesV4 : processFilesLegacy

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-1">Pipeline</h1>
        <h2 className="text-2xl font-semibold text-gray-900 tracking-tight">Document Processing</h2>
      </div>

      {/* Drop Zone */}
      <div className="mb-6">
        <div
          className={`relative border border-gray-200 rounded-md p-8 transition-all ${dragActive ? "border-gray-400 bg-gray-50" : "hover:border-gray-300"
            }`}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragActive(false)
            addFiles(e.dataTransfer.files)
          }}
        >
          <div className="flex items-center gap-6">
            <div className="flex items-center justify-center w-12 h-12 rounded-md bg-gray-100 text-gray-500">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">Drop documents here</p>
              <p className="text-sm text-gray-500 mt-0.5">PDF files up to 50MB</p>
            </div>
          </div>
        </div>
      </div>

      {/* Staged Files */}
      {stagedFiles.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-900">Staged Files</h3>
            <span className="text-xs text-gray-500">{stagedFiles.length} file{stagedFiles.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="border border-gray-200 rounded-md divide-y divide-gray-100">
            {stagedFiles.map(({ id, file }) => (
              <div key={id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <div className="min-w-0">
                    <p className="text-sm text-gray-900 truncate">{file.name}</p>
                    <p className="text-xs text-gray-500 font-mono">{formatBytes(file.size)}</p>
                  </div>
                </div>
                <button
                  onClick={() => removeFile(id)}
                  className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                  title="Remove file"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between">
            <button
              onClick={() => setStagedFiles([])}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              Clear all
            </button>
            <button
              onClick={processFiles}
              disabled={processing}
              className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-md hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {processing ? (
                <>
                  <svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Processing {processingCount}/{stagedFiles.length}
                </>
              ) : (
                `Process ${stagedFiles.length} file${stagedFiles.length !== 1 ? 's' : ''}`
              )}
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-6 flex items-center gap-2 text-sm text-red-600">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          {error}
        </div>
      )}

      {/* Browse Button (when no files staged) */}
      {stagedFiles.length === 0 && (
        <div className="mb-8 flex items-center gap-3">
          <label className="cursor-pointer">
            <input
              type="file"
              accept=".pdf"
              multiple
              className="sr-only"
              onChange={(e) => addFiles(e.target.files)}
            />
            <span className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">
              Browse Files
            </span>
          </label>
          <button
            onClick={() => {
              const input = document.querySelector('input[type="file"]') as HTMLInputElement
              if (input) input.click()
            }}
            className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-md hover:bg-gray-800 transition-colors"
          >
            Select Files
          </button>
        </div>
      )}

      {/* Recent Runs */}
      {recentRuns.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-900">Recent Runs</h3>
            <Link href="/runs" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
              View all →
            </Link>
          </div>

          <div className="border border-gray-200 rounded-md overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-2">Document</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-2">Run</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-2">Status</th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-2">Progress</th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-2">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recentRuns.map((run) => (
                  <tr key={run.run_id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2.5">
                      <span className="text-sm text-gray-900 truncate max-w-[200px] block" title={run.doc_name || run.doc_id || run.run_id}>
                        {run.doc_name || run.doc_id || "-"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link href={`/results/${run.run_id}`} className="text-sm font-mono text-gray-500 hover:text-blue-600 transition-colors">
                        {run.run_id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={run.pipeline_status || run.status || 'pending'} />
                    </td>
                    <td className="px-4 py-2.5">
                      {(() => {
                        // Get progress percent from pipeline_progress or direct progress
                        const percent = run.pipeline_progress?.percent_overall ?? run.progress ?? 0
                        return (
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gray-800 rounded-full transition-all"
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500 tabular-nums">{percent}%</span>
                          </div>
                        )
                      })()}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {(() => {
                        const status = run.pipeline_status || run.status

                        // Classification pending - show Classify button
                        if (status === "classification_pending") {
                          return (
                            <Link
                              href={`/classify/${run.run_id}`}
                              className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded hover:bg-amber-100 transition-colors"
                            >
                              Classify
                            </Link>
                          )
                        }

                        // Completed or classification complete - show View
                        if (status === "completed" || status === "classification_complete") {
                          return (
                            <Link
                              href={`/results/${run.run_id}`}
                              className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
                            >
                              View
                            </Link>
                          )
                        }

                        // Running or pending - show nothing (progress bar handles it)
                        if (status === "running" || status === "pending") {
                          return null
                        }

                        // Failed or other - show View anyway
                        return (
                          <Link
                            href={`/results/${run.run_id}`}
                            className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
                          >
                            View
                          </Link>
                        )
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status?: string }) {
  const configs: Record<string, { bg: string; text: string; label: string; pulsing?: boolean }> = {
    pending: { bg: "bg-gray-100", text: "text-gray-600", label: "Pending" },
    running: { bg: "bg-blue-50", text: "text-blue-700", label: "Running", pulsing: true },
    classification_pending: { bg: "bg-amber-50", text: "text-amber-700", label: "Classification needed" },
    classification_complete: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Classification done" },
    completed: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Completed" },
    failed: { bg: "bg-red-50", text: "text-red-700", label: "Failed" },
    cancelled: { bg: "bg-gray-100", text: "text-gray-600", label: "Cancelled" },
    unknown: { bg: "bg-gray-100", text: "text-gray-600", label: "Unknown" },
  }

  const config = configs[status || 'unknown'] || configs.unknown

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${config.bg} ${config.text}`}>
      {config.pulsing && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500"></span>
        </span>
      )}
      {config.label}
    </span>
  )
}
