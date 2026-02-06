'use client'

import { useEffect, useState, use, useRef } from "react"
import { useRouter } from "next/navigation"
import { useJobStatus, type JobStatus } from "@/hooks/useJobStatus"
import { api, isBlobMode, fetchBlobManifest, type BlobManifest } from "@/fastapi/api"
import Link from "next/link"
import { CsvTableView } from "@/components/CsvTableView"
import { PivotedCsvView } from "@/components/PivotedCsvView"
import { createLogger } from '@/lib/logger'

const log = createLogger('ResultsPage')

interface RunResults {
  run_id: string
  doc_id: string
  doc_name: string
  status: string
  figures?: Array<{
    sha: string
    class_name: string
    image_path?: string
  }>
  tables?: Array<{
    sha: string
    markdown: string
    page?: number
  }>
  markdown?: string
}

// Terminal states for v4 Jobs API (HARD CUTOVER)
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled', 'classification_complete']

export default function ResultsPage({ params }: { params: Promise<{ runId: string }> }) {
  const router = useRouter()
  const resolvedParams = use(params)
  const runId = resolvedParams.runId

  // v4 HARD CUTOVER: Use ONLY the Jobs API for status polling
  // The Jobs API now falls back to filesystem for completed jobs with expired Redis data
  const { job, error: jobError, isLoading: jobLoading } = useJobStatus(runId)

  // Build status object from v4 job
  const status = job
    ? {
      run_id: job.id,
      status: job.status,
      message: job.message,
      progress: { percent_overall: job.progress_percent, current_phase: job.current_stage || '', message: job.message }
    }
    : null
  const isTerminal = TERMINAL_STATUSES.includes(job?.status || '')

  const [results, setResults] = useState<RunResults | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<"figures" | "tables" | "csv" | "pivoted" | "json">("figures")
  const resultsFetched = useRef(false)
  // Store the manifest for blob mode (used by CSV/image components)
  const [manifest, setManifest] = useState<BlobManifest | null>(null)

  // Derive stable status string to avoid object-reference churn in useEffect deps
  const jobStatus = job?.status || ''
  const manifestUrl = job?.manifest_url || null

  useEffect(() => {
    // Only fetch results once when job reaches a terminal completed state
    if (resultsFetched.current) return

    const isCompleted = isTerminal && (jobStatus === "completed" || jobStatus === ("classification_complete" as string))
    if (!isCompleted) {
      setLoading(false)
      return
    }

    resultsFetched.current = true

    async function fetchResults() {
      try {
        // In blob mode, pass manifest_url so api.getResults fetches from blob
        const data = await api.getResults(runId, manifestUrl)
        setResults(data as RunResults)

        // Also load manifest for CSV/image components in blob mode
        if (isBlobMode() && manifestUrl) {
          try {
            const m = await fetchBlobManifest(manifestUrl)
            setManifest(m)
          } catch (err) {
            log.warn('Failed to load manifest for components', { error: err instanceof Error ? err.message : String(err) })
          }
        }
      } catch (err) {
        log.error('Failed to fetch results', { error: err instanceof Error ? err.message : String(err) })
        // Allow retry on error
        resultsFetched.current = false
      } finally {
        setLoading(false)
      }
    }

    fetchResults()
  }, [isTerminal, jobStatus, runId, manifestUrl])

  // Show loading while running
  if (!isTerminal) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="text-center">
          <div className="text-4xl mb-4">🔄</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Pipeline Still Running</h2>
          <p className="text-gray-500 mb-4">{status?.message || "Processing..."}</p>

          {status?.progress && (
            <div className="w-64 mx-auto">
              <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                <div
                  className="bg-blue-600 h-2 rounded-full"
                  style={{ width: `${status.progress.percent_overall}%` }}
                />
              </div>
              <p className="text-sm text-gray-500">
                {status.progress.current_phase}: {status.progress.message}
              </p>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Show failed state
  if (status?.status === "failed") {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="text-center">
          <div className="text-4xl mb-4">❌</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Pipeline Failed</h2>
          <p className="text-gray-500 mb-4">{status.message}</p>
          <Link
            href="/dashboard"
            className="inline-block px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  // Show results
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <Link href="/dashboard" className="hover:text-gray-700">Dashboard</Link>
            <span>›</span>
            <Link href="/runs" className="hover:text-gray-700">Runs</Link>
            <span>›</span>
            <span className="text-gray-900">{runId.slice(0, 8)}...</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Results</h1>
          <p className="text-gray-500">{results?.doc_name || "Pipeline completed"}</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/dashboard"
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            New Upload
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-2xl font-bold text-gray-900">{results?.figures?.length || 0}</div>
          <div className="text-sm text-gray-500">Figures</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-2xl font-bold text-gray-900">{results?.tables?.length || 0}</div>
          <div className="text-sm text-gray-500">Tables</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-2xl font-bold text-green-600">Completed</div>
          <div className="text-sm text-gray-500">Status</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-2xl font-bold text-gray-900">{runId.slice(0, 8)}</div>
          <div className="text-sm text-gray-500">Run ID</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-4">
          <button
            onClick={() => setActiveTab("figures")}
            className={`px-4 py-2 border-b-2 text-sm font-medium ${activeTab === "figures"
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
          >
            Figures ({results?.figures?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab("tables")}
            className={`px-4 py-2 border-b-2 text-sm font-medium ${activeTab === "tables"
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
          >
            Tables ({results?.tables?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab("csv")}
            className={`px-4 py-2 border-b-2 text-sm font-medium ${activeTab === "csv"
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
          >
            CSV Data
          </button>
          <button
            onClick={() => setActiveTab("pivoted")}
            className={`px-4 py-2 border-b-2 text-sm font-medium ${activeTab === "pivoted"
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
          >
            Pivoted View
          </button>
          <button
            onClick={() => setActiveTab("json")}
            className={`px-4 py-2 border-b-2 text-sm font-medium ${activeTab === "json"
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
          >
            JSON
          </button>
        </nav>
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading results...</div>
      ) : (
        <>
          {activeTab === "figures" && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {results?.figures?.map((fig) => (
                <div
                  key={fig.sha}
                  className="bg-white rounded-lg border border-gray-200 overflow-hidden"
                >
                  {fig.image_path ? (
                    <img
                      src={fig.image_path}
                      alt={fig.class_name}
                      className="w-full h-48 object-contain bg-gray-50"
                    />
                  ) : (
                    <div className="w-full h-48 bg-gray-100 flex items-center justify-center text-gray-400">
                      No image
                    </div>
                  )}
                  <div className="p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900 capitalize">
                        {fig.class_name}
                      </span>
                      <span className="text-xs text-gray-500 font-mono">
                        {fig.sha.slice(0, 6)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
              {(!results?.figures?.length) && (
                <div className="col-span-full text-center py-12 text-gray-500">
                  No figures found
                </div>
              )}
            </div>
          )}

          {activeTab === "tables" && (
            <div className="space-y-4">
              {results?.tables?.map((table) => (
                <div
                  key={table.sha}
                  className="bg-white rounded-lg border border-gray-200 p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-500">Page {table.page || "?"}</span>
                    <span className="text-xs text-gray-400 font-mono">
                      {table.sha.slice(0, 6)}
                    </span>
                  </div>
                  <pre className="text-xs bg-gray-50 p-3 rounded overflow-x-auto">
                    {table.markdown}
                  </pre>
                </div>
              ))}
              {(!results?.tables?.length) && (
                <div className="text-center py-12 text-gray-500">
                  No tables found
                </div>
              )}
            </div>
          )}

          {activeTab === "csv" && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <CsvTableView runId={runId} manifestUrl={manifestUrl} manifest={manifest} />
            </div>
          )}

          {activeTab === "pivoted" && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <PivotedCsvView runId={runId} manifestUrl={manifestUrl} manifest={manifest} />
            </div>
          )}

          {activeTab === "json" && (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <pre className="text-sm text-gray-700 p-4 overflow-auto max-h-[600px]">
                {JSON.stringify(results, null, 2)}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  )
}
