'use client'

import { useState, useEffect, useRef, useCallback } from "react"
import Link from "next/link"
import { api } from '@/lib/api-config'
import { createLogger } from '@/lib/logger'

const log = createLogger('RunsPage')

/**
 * v4 Job interface matching JobPublic from the API.
 */
interface Job {
  id: string
  status: string
  doc_name: string
  current_stage: string | null
  progress_percent: number
  message: string
  created_at: string
  started_at: string | null
  completed_at: string | null
  manifest_url: string | null
  error_message: string | null
}

// Terminal states where polling should stop
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled']

export default function RunsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Use ref to track polling state and prevent duplicates
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isMountedRef = useRef(true)

  const fetchJobs = useCallback(async () => {
    if (!isMountedRef.current) return

    try {
      // v4: Use centralized API config - direct call to FastAPI
      const res = await fetch(api.jobs.list(50))
      if (res.ok && isMountedRef.current) {
        const data: Job[] = await res.json()
        setJobs(data)
      }
    } catch (err) {
      log.error('Failed to fetch jobs', { error: err instanceof Error ? err.message : String(err) })
    } finally {
      if (isMountedRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  // Check if all jobs are in terminal states (no polling needed)
  const allJobsTerminal = useCallback((jobList: Job[]): boolean => {
    if (jobList.length === 0) return true
    return jobList.every(job => TERMINAL_STATUSES.includes(job.status))
  }, [])

  // Start or stop polling based on job states
  const updatePolling = useCallback((jobList: Job[]) => {
    // Clear any existing interval first
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }

    // Only poll if there are non-terminal jobs
    if (!allJobsTerminal(jobList) && isMountedRef.current) {
      log.debug('Starting polling - non-terminal jobs exist')
      pollingRef.current = setInterval(fetchJobs, 5000)
    } else {
      log.debug('Polling stopped - all jobs terminal or none')
    }
  }, [allJobsTerminal, fetchJobs])

  // Initial fetch and polling setup
  useEffect(() => {
    isMountedRef.current = true

    const init = async () => {
      await fetchJobs()
    }
    init()

    // Cleanup on unmount
    return () => {
      isMountedRef.current = false
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [fetchJobs])

  // Update polling whenever jobs change
  useEffect(() => {
    updatePolling(jobs)
  }, [jobs, updatePolling])

  const handleRefresh = () => {
    setRefreshing(true)
    fetchJobs()
  }

  const formatDate = (iso?: string | null) => {
    if (!iso) return "-"
    const d = new Date(iso)
    return d.toLocaleDateString("no-NO", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const getStatusConfig = (status?: string) => {
    const configs: Record<string, { bg: string; text: string; label: string }> = {
      pending: { bg: "bg-gray-100", text: "text-gray-600", label: "Pending" },
      downloading: { bg: "bg-blue-50", text: "text-blue-700", label: "Downloading" },
      running: { bg: "bg-blue-50", text: "text-blue-700", label: "Running" },
      classification_pending: { bg: "bg-amber-50", text: "text-amber-700", label: "Classification needed" },
      classification_complete: { bg: "bg-emerald-50", text: "text-emerald-600", label: "Classification done" },
      uploading: { bg: "bg-blue-50", text: "text-blue-700", label: "Uploading" },
      completed: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Completed" },
      failed: { bg: "bg-red-50", text: "text-red-700", label: "Failed" },
      cancellation_requested: { bg: "bg-gray-100", text: "text-gray-600", label: "Cancelling" },
      cancelled: { bg: "bg-gray-100", text: "text-gray-600", label: "Cancelled" },
      unknown: { bg: "bg-gray-100", text: "text-gray-600", label: "Unknown" },
    }
    return configs[status || 'unknown'] || configs.unknown
  }

  const getActionButton = (job: Job) => {
    const status = job.status

    // Classification pending - show Classify button
    if (status === "classification_pending") {
      return (
        <Link
          href={`/classify/${job.id}`}
          className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded hover:bg-amber-100 transition-colors"
        >
          Classify
        </Link>
      )
    }

    // Completed or classification_complete - show View button
    if (status === "completed" || status === "classification_complete") {
      return (
        <Link
          href={`/results/${job.id}`}
          className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100 transition-colors"
        >
          View
        </Link>
      )
    }

    // Failed - show error indicator
    if (status === "failed") {
      return (
        <span className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded" title={job.error_message || "Unknown error"}>
          Failed
        </span>
      )
    }

    // Running/pending states - show progress
    if (status === "pending" || status === "running" || status === "downloading" || status === "uploading") {
      return (
        <div className="flex items-center gap-2">
          <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-gray-800 rounded-full transition-all"
              style={{ width: `${job.progress_percent}%` }}
            />
          </div>
          <span className="text-xs text-gray-500 tabular-nums">{job.progress_percent}%</span>
        </div>
      )
    }

    // Cancelled - just show status
    return null
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pipeline Runs</h1>
          <p className="text-gray-500 mt-1">Track document processing and classification</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          <svg className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Jobs Table */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading jobs...</div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-12 text-gray-500 border border-gray-200 rounded-lg">
          <p>No jobs found.</p>
          <Link href="/dashboard" className="mt-2 inline-block text-blue-600 hover:text-blue-700">
            Upload a document →
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">Document</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">Job ID</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">Status</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">Stage</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">Created</th>
                <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {jobs.map((job) => {
                const statusConfig = getStatusConfig(job.status)
                return (
                  <tr key={job.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-900 truncate max-w-[200px] block" title={job.doc_name}>
                        {job.doc_name || "-"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-mono text-gray-500">{job.id.slice(0, 8)}...</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded ${statusConfig.bg} ${statusConfig.text}`}>
                        {statusConfig.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-500">{job.current_stage || "-"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-500">{formatDate(job.created_at)}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {getActionButton(job)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
