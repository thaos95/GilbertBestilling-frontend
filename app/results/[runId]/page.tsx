'use client'

import { useEffect, useState, useRef, useCallback, useMemo } from "react"
import { useJobStatus, type JobPublic } from "@/hooks/useJobStatus"
import { usePipelineStage } from "@/hooks/usePipelineStage"
import { useCsvData } from "@/hooks/useCsvData"
import { PipelineStageIndicator, JsonPendingState } from "@/components/pipeline"
import { CsvTableView } from "@/components/CsvTableView"
import { FigureCsvIntegrityBadge } from "@/components/FigureCsvIntegrityBadge"
import { calculatePageIntegrity, type PageIntegrity } from "@/utils/figureCsvIntegrity"
import {
  api,
  type PipelineStatus,
  type PipelineResults,
  isBlobMode,
  fetchBlobManifest,
  type BlobManifest,
} from "@/fastapi/api"
import { createLogger } from "@/lib/logger"
import Link from "next/link"
import { use } from "react"

const log = createLogger('Results')

// Terminal states where polling should stop
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled']

// Convert v4 JobPublic to PipelineStatus for usePipelineStage hook
function jobToPipelineStatus(job: JobPublic | null): PipelineStatus | null {
  if (!job) return null
  return {
    run_id: job.id,
    status: job.status as PipelineStatus['status'],
    message: job.message,
    progress: {
      percent_overall: job.progress_percent,
      current_phase: job.current_stage,
      message: job.message,
    },
  }
}

// Prefetch figure images using browser cache
function prefetchFigureImages(
  figures: PipelineResults["figures"],
  prefetched: Set<string>,
  batchSize = 24
) {
  if (!figures?.length || typeof window === "undefined") return

  let index = 0
  const idleCallback = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback

  const processBatch = () => {
    const end = Math.min(index + batchSize, figures.length)
    for (; index < end; index += 1) {
      const fig = figures[index]
      if (!fig?.image_path || prefetched.has(fig.image_path)) continue
      const img = new Image()
      img.src = fig.image_path
      prefetched.add(fig.image_path)
    }
    if (index < figures.length) {
      setTimeout(processBatch, 0)
    }
  }

  if (idleCallback) {
    idleCallback(processBatch)
  } else {
    setTimeout(processBatch, 0)
  }
}

export default function ResultsPage({ params }: { params: Promise<{ runId: string }> }) {
  const resolvedParams = use(params)
  const runId = resolvedParams.runId

  // v4: Poll job status via Jobs API
  const { job, isPolling } = useJobStatus(runId)
  const pipelineStatus = jobToPipelineStatus(job)
  const isTerminal = job ? TERMINAL_STATUSES.includes(job.status) : false

  // Manifest for blob mode
  const manifestUrl = job?.manifest_url || null
  const [manifest, setManifest] = useState<BlobManifest | null>(null)

  // CSV data (supports blob mode via manifestUrl)
  const { tableData: csvTableData, refetch: refetchCsv } = useCsvData(runId, manifestUrl)

  // Results state
  const [results, setResults] = useState<PipelineResults | null>(null)
  const [documentJson, setDocumentJson] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [jsonLoading, setJsonLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<"pages" | "figures" | "tables" | "json">("pages")
  const prefetchedImagesRef = useRef<Set<string>>(new Set())

  // JSON product viewer state
  const [activeProductIndex, setActiveProductIndex] = useState<number | null>(null)
  const [showRawJson, setShowRawJson] = useState(false)
  const productsContainerRef = useRef<HTMLDivElement | null>(null)
  const productRefs = useRef<Array<HTMLDivElement | null>>([])

  // Page integrity
  const pageIntegrity = calculatePageIntegrity(results?.figures || [], csvTableData)
  const integrityByPage = pageIntegrity.reduce((acc, pi) => {
    acc[pi.pageNumber] = pi
    return acc
  }, {} as Record<number, PageIntegrity>)

  // Map figure sha8 -> figure data
  const figureBySha8 = useMemo(() => {
    const map = new Map<string, NonNullable<PipelineResults["figures"]>[number]>()
    for (const fig of results?.figures || []) {
      if (!fig?.sha) continue
      map.set(fig.sha.slice(0, 8).toLowerCase(), fig)
    }
    return map
  }, [results?.figures])

  // Map sha8 -> product ID from CSV data and JSON products
  const figureIdBySha8 = useMemo(() => {
    const map = new Map<string, string>()
    const addRows = (rows: Record<string, string>[]) => {
      for (const row of rows) {
        const keys = Object.keys(row)
        const idKey = keys.find((k) =>
          ["id", "reference", "ref", "produkt", "produktkode", "produktnavn"].includes(k.toLowerCase())
        )
        const shaKey = keys.find((k) =>
          ["figure_sha8", "sha8"].includes(k.toLowerCase())
        )
        const id = idKey ? (row[idKey] || "").trim() : ""
        let sha8 = shaKey ? (row[shaKey] || "").trim().toLowerCase() : ""
        if (!sha8) {
          for (const value of Object.values(row)) {
            if (typeof value !== "string") continue
            const match = value.match(/figure:([0-9a-fA-F]{8})/)
            if (match?.[1]) {
              sha8 = match[1].toLowerCase()
              break
            }
          }
        }
        if (!sha8 || !id) continue
        if (!map.has(sha8)) map.set(sha8, id)
      }
    }

    if (csvTableData) {
      for (const table of Object.values(csvTableData)) {
        addRows(table.rows)
      }
    }

    const typedJson = documentJson as Record<string, unknown> | null
    const products = typedJson && Array.isArray(typedJson.products)
      ? (typedJson.products as Record<string, unknown>[])
      : []
    for (const product of products) {
      const sha8 = String(product.figure_sha8 || "").trim().toLowerCase()
      const reference = String(product.reference || "").trim()
      if (!sha8 || !reference) continue
      if (!map.has(sha8)) map.set(sha8, reference)
    }

    return map
  }, [csvTableData, documentJson])

  // Pipeline stage hook
  const {
    currentStage,
    stageLabel,
    stageProgress,
    isJsonReady,
    stageMessage,
  } = usePipelineStage(pipelineStatus)

  // Fetch manifest for blob mode
  useEffect(() => {
    if (!manifestUrl || !isBlobMode()) return
    fetchBlobManifest(manifestUrl)
      .then(setManifest)
      .catch(err => log.error('Failed to fetch manifest', { error: err instanceof Error ? err.message : String(err) }))
  }, [manifestUrl])

  useEffect(() => {
    if (!runId) return
    if (!results && !isTerminal) {
      setLoading(false)
    }
  }, [runId, results, isTerminal])

  // Fetch results from v4 Jobs API
  const fetchResults = useCallback(async () => {
    if (!runId) return
    if (!results) setLoading(true)
    try {
      log.debug(`Fetching results for ${runId}`)
      const data = await api.getResults(runId)
      setResults(data)
    } catch (err) {
      log.warn("Results not ready yet", { error: err instanceof Error ? err.message : String(err) })
    } finally {
      setLoading(false)
    }
  }, [runId, results, manifestUrl])

  // Fetch document integration JSON
  const documentFetchedRef = useRef(false)
  const lastJsonFetchRef = useRef(0)
  const fetchDocumentJson = useCallback(async () => {
    if (!runId) return
    if (jsonLoading) return
    const now = Date.now()
    if (now - lastJsonFetchRef.current < 3000) return
    lastJsonFetchRef.current = now
    setJsonLoading(true)
    try {
      const data = await api.getDocumentJson(runId)
      if (data) {
        setDocumentJson(data)
      } else {
        documentFetchedRef.current = false
      }
    } catch (err) {
      log.error("Failed to fetch document JSON", { error: err instanceof Error ? err.message : String(err) })
      documentFetchedRef.current = false
    } finally {
      setJsonLoading(false)
    }
  }, [runId, jsonLoading, manifestUrl])

  // Fetch results when job status changes (polling-driven)
  const lastResultsFetchRef = useRef(0)
  const csvRefetchedOnCompleteRef = useRef(false)
  useEffect(() => {
    if (!runId || !job) return

    const now = Date.now()
    const canFetch = now - lastResultsFetchRef.current > 2000

    if (canFetch && ((!results && !loading) || job.status === 'completed')) {
      lastResultsFetchRef.current = now
      fetchResults()
    }

    // Re-fetch CSV data when job completes (may have failed earlier with 404)
    if (job.status === 'completed' && !csvTableData && !csvRefetchedOnCompleteRef.current) {
      csvRefetchedOnCompleteRef.current = true
      refetchCsv()
    }

    if (job.status === 'completed' && (activeTab === 'json' || (documentJson && '_pending' in documentJson))) {
      documentFetchedRef.current = false
      fetchDocumentJson()
    }
  }, [runId, job?.status, job?.progress_percent]) // eslint-disable-line react-hooks/exhaustive-deps

  // Prefetch figure images
  useEffect(() => {
    prefetchFigureImages(results?.figures, prefetchedImagesRef.current)
  }, [results?.figures])

  // Fetch document JSON when JSON tab selected
  useEffect(() => {
    if (activeTab === "json" && !documentJson && !documentFetchedRef.current) {
      documentFetchedRef.current = true
      fetchDocumentJson()
    }
  }, [activeTab, documentJson, fetchDocumentJson])

  useEffect(() => {
    if (!documentJson) return
    const products = Array.isArray((documentJson as Record<string, unknown>)?.products)
      ? ((documentJson as Record<string, unknown>).products as Record<string, unknown>[])
      : []
    productRefs.current = new Array(products.length).fill(null)
  }, [documentJson])

  // IntersectionObserver for product scroll tracking
  useEffect(() => {
    if (activeTab !== "json" || !documentJson) return
    const root = productsContainerRef.current
    if (!root) return

    let rafId: number | null = null
    const pickActive = () => {
      rafId = null
      const rootRect = root.getBoundingClientRect()
      const stickinessPx = 120
      if (activeProductIndex !== null && activeProductIndex >= 0) {
        const currentEl = productRefs.current[activeProductIndex]
        if (currentEl) {
          const currentRect = currentEl.getBoundingClientRect()
          const currentOffset = Math.abs(currentRect.top - rootRect.top)
          if (currentOffset <= stickinessPx) return
        }
      }
      let best: { index: number; offset: number } | null = null
      for (const el of productRefs.current) {
        if (!el) continue
        const idx = el.dataset.index
        if (idx === undefined || idx === null) continue
        const parsed = Number(idx)
        if (Number.isNaN(parsed)) continue
        const rect = el.getBoundingClientRect()
        const offset = Math.abs(rect.top - rootRect.top)
        if (!best || offset < best.offset) best = { index: parsed, offset }
      }
      if (best && best.index !== activeProductIndex) setActiveProductIndex(best.index)
    }

    const onScroll = () => {
      if (rafId !== null) return
      rafId = window.requestAnimationFrame(pickActive)
    }
    root.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    onScroll()

    return () => {
      root.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
      if (rafId !== null) window.cancelAnimationFrame(rafId)
    }
  }, [activeTab, documentJson, activeProductIndex])

  // Retry JSON fetch while pending
  useEffect(() => {
    if (activeTab !== "json") return
    if (!documentJson || !("_pending" in documentJson)) return
    if (jsonLoading) return
    const timeout = setTimeout(() => {
      documentFetchedRef.current = false
      fetchDocumentJson()
    }, 3000)
    return () => clearTimeout(timeout)
  }, [activeTab, documentJson, jsonLoading, fetchDocumentJson])

  // Failed state
  if (job?.status === "failed") {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="text-center">
          <div className="text-4xl mb-4">❌</div>
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Pipeline Failed</h2>
          <p className="text-slate-500 mb-4">{job.error_message || job.message}</p>
          <Link
            href="/dashboard"
            className="inline-block px-4 py-2 bg-slate-100 text-slate-700 rounded-md hover:bg-slate-200"
          >
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
            <Link href="/dashboard" className="hover:text-slate-700">Dashboard</Link>
            <span>›</span>
            <Link href="/runs" className="hover:text-slate-700">Runs</Link>
            <span>›</span>
            <span className="text-slate-900">{runId.slice(0, 8)}...</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Results</h1>
          <p className="text-slate-500">{results?.doc_name || job?.doc_name || "Pipeline completed"}</p>
        </div>
        <div className="flex gap-2">
          {isPolling && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded border border-blue-200">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500"></span>
              </span>
              Processing
            </span>
          )}
          <Link
            href="/dashboard"
            className="px-4 py-2 bg-slate-100 text-slate-700 rounded-md hover:bg-slate-200"
          >
            New Upload
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-md border border-slate-200 p-4">
          <div className="text-2xl font-bold text-slate-900 tabular-nums">
            {(results?.figures || []).filter(fig => fig.class_name !== "reject").length || 0}
          </div>
          <div className="text-xs font-medium text-slate-500 mt-1">Figures</div>
        </div>
        <div className="bg-white rounded-md border border-slate-200 p-4">
          <div className="text-2xl font-bold text-slate-900 tabular-nums">
            {csvTableData ? Object.keys(csvTableData).length : 0}
          </div>
          <div className="text-xs font-medium text-slate-500 mt-1">Tables</div>
        </div>
        <div className="bg-white rounded-md border border-slate-200 p-4">
          <div className="text-2xl font-bold text-blue-700">{stageLabel}</div>
          <div className="text-xs font-medium text-slate-500 mt-1">Pipeline Stage</div>
        </div>
        <div className="bg-white rounded-md border border-slate-200 p-4">
          <div className="text-2xl font-bold text-slate-900 font-mono">{runId.slice(0, 8)}</div>
          <div className="text-xs font-medium text-slate-500 mt-1">Run ID</div>
        </div>
      </div>

      {/* Pipeline Stage Indicator */}
      <div className="bg-white rounded-md border border-slate-200 p-4">
        <PipelineStageIndicator
          currentStage={currentStage}
          stageLabel={stageLabel}
          stageProgress={stageProgress}
          size="md"
          showLabels={true}
        />
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="flex gap-1">
          <button
            onClick={() => setActiveTab("pages")}
            className={`px-4 py-2 border-b-2 text-xs font-medium transition-colors duration-150 ${activeTab === "pages"
              ? "border-blue-500 text-blue-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
          >
            Pages ({results?.pages?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab("figures")}
            className={`px-4 py-2 border-b-2 text-xs font-medium transition-colors duration-150 ${activeTab === "figures"
              ? "border-blue-500 text-blue-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
          >
            Figures ({(results?.figures || []).filter(fig => fig.class_name !== "reject").length || 0})
          </button>
          <button
            onClick={() => setActiveTab("tables")}
            className={`px-4 py-2 border-b-2 text-xs font-medium transition-colors duration-150 ${activeTab === "tables"
              ? "border-blue-500 text-blue-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
          >
            Tables ({csvTableData ? Object.keys(csvTableData).length : 0})
          </button>
          <button
            onClick={() => setActiveTab("json")}
            className={`px-4 py-2 border-b-2 text-xs font-medium transition-colors duration-150 ${activeTab === "json"
              ? "border-blue-500 text-blue-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
          >
            {isJsonReady ? 'JSON' : (
              <span className="inline-flex items-center gap-1.5">
                JSON
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" title="Pending" />
              </span>
            )}
          </button>
        </nav>
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-center py-12 text-slate-500">Loading results...</div>
      ) : !results ? (
        <div className="text-center py-12 text-slate-500">
          Results not ready yet. This page will update automatically.
        </div>
      ) : (
        <>
          {/* Pages Tab */}
          {activeTab === "pages" && (
            <div className="space-y-6">
              {results?.pages?.map((page) => (
                <div
                  key={page.page_id}
                  className="bg-white rounded-md border border-slate-200 overflow-hidden"
                >
                  <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-900">
                      Page {page.page_number}
                    </span>
                    <span className="text-xs text-slate-500 font-mono">
                      {page.page_id}
                    </span>
                  </div>
                  <div className="bg-slate-100 p-4">
                    <img
                      src={page.image_path}
                      alt={`Page ${page.page_number}`}
                      className="w-full h-auto rounded shadow-sm"
                    />
                  </div>
                </div>
              ))}
              {(!results?.pages?.length) && (
                <div className="text-center py-12 text-slate-500">
                  No pages found
                </div>
              )}
            </div>
          )}

          {/* Figures Tab - grouped by page with integrity badges */}
          {activeTab === "figures" && (
            <div className="space-y-6">
              {(() => {
                const allFigures = results?.figures || []
                const rejectedFigs = allFigures.filter(fig => fig.class_name === "reject")
                const regularFigs = allFigures.filter(fig => fig.class_name !== "reject")

                const figuresByPage = regularFigs.reduce((acc, fig) => {
                  const pageNum = parseInt(fig.page_id || '1', 10)
                  if (!acc[pageNum]) acc[pageNum] = []
                  acc[pageNum].push(fig)
                  return acc
                }, {} as Record<number, typeof regularFigs>)

                const pageNumbers = Object.keys(figuresByPage).map(Number).sort((a, b) => a - b)
                const hasContent = pageNumbers.length > 0 || rejectedFigs.length > 0

                if (!hasContent) {
                  return (
                    <div className="text-center py-12 text-slate-500">
                      No figures found
                    </div>
                  )
                }

                return (
                  <>
                    {pageNumbers.map((pageNum) => (
                      <div key={pageNum}>
                        <div className="flex items-center gap-3 mb-3">
                          <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                            Page {pageNum}
                          </span>
                          {integrityByPage[pageNum] && (
                            <FigureCsvIntegrityBadge pageIntegrity={integrityByPage[pageNum]} />
                          )}
                          <div className="h-px bg-slate-200 flex-1" />
                          <span className="text-xs text-slate-400 tabular-nums">
                            {figuresByPage[pageNum]?.length || 0} figures
                          </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                          {figuresByPage[pageNum]?.map((fig) => (
                            <div
                              key={fig.sha}
                              className="bg-white rounded-md border border-slate-200 overflow-hidden group"
                            >
                              <div className="aspect-square bg-slate-50 flex items-center justify-center p-2">
                                {fig.image_path ? (
                                  <img
                                    src={fig.image_path}
                                    alt={fig.class_name}
                                    className="max-w-full max-h-full object-contain"
                                  />
                                ) : (
                                  <span className="text-slate-300 text-xs">No image</span>
                                )}
                              </div>
                              <div className="px-3 py-2 border-t border-slate-100 bg-slate-50/50">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-medium text-slate-700 capitalize truncate">
                                    {fig.class_name}
                                  </span>
                                  <span className="text-[10px] text-slate-400 font-mono flex-shrink-0">
                                    {fig.sha.slice(0, 8)}
                                  </span>
                                </div>
                                {figureIdBySha8.get(fig.sha.slice(0, 8).toLowerCase()) && (
                                  <div className="mt-1 text-[11px] text-slate-600 font-mono truncate">
                                    {figureIdBySha8.get(fig.sha.slice(0, 8).toLowerCase())}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}

                    {rejectedFigs.length > 0 && (
                      <div>
                        <div className="flex items-center gap-3 mb-3">
                          <span className="text-xs font-medium text-red-500 uppercase tracking-wide">
                            Rejected
                          </span>
                          <div className="h-px bg-slate-200 flex-1" />
                          <span className="text-xs text-slate-400 tabular-nums">
                            {rejectedFigs.length} rejected
                          </span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                          {rejectedFigs.map((fig) => (
                            <div
                              key={fig.sha}
                              className="bg-white rounded-md border border-red-200 overflow-hidden opacity-60"
                            >
                              <div className="aspect-square bg-slate-50 flex items-center justify-center p-2">
                                {fig.image_path ? (
                                  <img
                                    src={fig.image_path}
                                    alt="Rejected"
                                    className="max-w-full max-h-full object-contain"
                                  />
                                ) : (
                                  <span className="text-slate-300 text-xs">No image</span>
                                )}
                              </div>
                              <div className="px-3 py-2 border-t border-red-100 bg-red-50/50">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-medium text-red-700">Rejected</span>
                                  <span className="text-[10px] text-slate-400 font-mono flex-shrink-0">
                                    {fig.sha.slice(0, 8)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          )}

          {/* Tables Tab — CsvTableView (matches origin/main) */}
          <div className={activeTab === "tables" ? "block" : "hidden"}>
            <div className="w-screen relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw]">
              <div className="mx-auto w-full max-w-[1600px] px-6">
                <CsvTableView
                  runId={runId}
                  pageIntegrityByPage={integrityByPage}
                  manifestUrl={manifestUrl}
                  manifest={manifest}
                />
              </div>
            </div>
          </div>

          {/* JSON Tab - Product viewer with figure crop sidebar */}
          {activeTab === "json" && (
            <div className="bg-white rounded-md border border-slate-200 overflow-hidden">
              {jsonLoading ? (
                <div className="text-sm text-slate-500 p-4">Loading document integration JSON...</div>
              ) : documentJson && '_pending' in documentJson ? (
                <JsonPendingState
                  currentStage={currentStage}
                  stageMessage={stageMessage}
                  onRefresh={() => {
                    documentFetchedRef.current = false
                    setDocumentJson(null)
                  }}
                />
              ) : documentJson ? (
                (() => {
                  const typedJson = documentJson as Record<string, unknown>
                  const products = Array.isArray(typedJson.products)
                    ? (typedJson.products as Record<string, unknown>[])
                    : []
                  const { products: _omitProducts, ...rest } = typedJson

                  const extractSha8 = (product: Record<string, unknown>): string => {
                    const direct = (product.figure_sha8 || product.sha8 || product.input_sha || "") as string
                    if (direct) return String(direct).slice(0, 8).toLowerCase()
                    for (const value of Object.values(product)) {
                      if (typeof value !== "string") continue
                      const match = value.match(/figure:([0-9a-fA-F]{8})/)
                      if (match?.[1]) return match[1].toLowerCase()
                    }
                    return ""
                  }

                  const fallbackIndex = products.length ? 0 : null
                  const currentProductIndex = activeProductIndex ?? fallbackIndex
                  const activeProduct = currentProductIndex !== null ? products[currentProductIndex] : undefined
                  const currentSha8 = activeProduct ? extractSha8(activeProduct) : null
                  const activeFigure = currentSha8 ? figureBySha8.get(currentSha8) : undefined

                  return (
                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-0">
                      <div className="border-r border-slate-200">
                        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                          <span className="text-xs font-medium text-slate-600">Document JSON</span>
                          <button
                            type="button"
                            onClick={() => setShowRawJson((prev) => !prev)}
                            className="text-[11px] font-medium text-slate-600 px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-100"
                          >
                            {showRawJson ? "Hide raw" : "Show raw"}
                          </button>
                        </div>
                        <div className="p-4 space-y-4">
                          {showRawJson && (
                            <>
                              <pre className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-md p-3 overflow-auto max-h-[260px]">
                                {JSON.stringify(typedJson, null, 2)}
                              </pre>
                              <pre className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-md p-3 overflow-auto max-h-[240px]">
                                {JSON.stringify(rest, null, 2)}
                              </pre>
                            </>
                          )}

                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Products</span>
                              <span className="text-[11px] text-slate-400 tabular-nums">{products.length} items</span>
                            </div>
                            <div
                              ref={productsContainerRef}
                              className="space-y-3 pr-2 max-h-[560px] overflow-auto"
                            >
                              {products.map((product, idx) => {
                                const sha8 = extractSha8(product)
                                return (
                                  <div
                                    key={`${sha8 || "product"}-${idx}`}
                                    ref={(el) => { productRefs.current[idx] = el }}
                                    data-sha8={sha8}
                                    data-index={idx}
                                    onMouseEnter={() => setActiveProductIndex(idx)}
                                    className={`border rounded-md p-3 bg-white ${idx === currentProductIndex
                                      ? "border-blue-300 shadow-sm"
                                      : "border-slate-200"
                                      }`}
                                  >
                                    <div className="flex items-center justify-between mb-2">
                                      <span className="text-xs font-medium text-slate-600">
                                        {String(product.reference || product.component || "Product")}
                                      </span>
                                      <span className="text-[11px] text-slate-400 font-mono">
                                        {sha8 || "no-sha8"}
                                      </span>
                                    </div>
                                    <pre className="text-[11px] text-slate-700 bg-slate-50 border border-slate-200 rounded-md p-3 overflow-auto">
                                      {JSON.stringify(product, null, 2)}
                                    </pre>
                                  </div>
                                )
                              })}
                              {!products.length && (
                                <div className="text-sm text-slate-500">No products found</div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Figure Crop sidebar */}
                      <div className="bg-white">
                        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 text-xs font-medium text-slate-600">
                          Figure Crop
                        </div>
                        <div className="p-4 sticky top-4">
                          <div className="border border-slate-200 rounded-md bg-slate-50 p-3">
                            {activeFigure?.image_path ? (
                              <img
                                src={activeFigure.image_path}
                                alt={currentSha8 || "figure"}
                                className="w-full h-auto rounded-md bg-white"
                              />
                            ) : (
                              <div className="aspect-square flex items-center justify-center text-xs text-slate-400">
                                No crop image
                              </div>
                            )}
                          </div>
                          <div className="mt-3 text-xs text-slate-500">
                            <div className="flex items-center justify-between">
                              <span>Reference</span>
                              <span className="text-slate-700 truncate max-w-[160px]">
                                {activeProduct?.reference ? String(activeProduct.reference) : "—"}
                              </span>
                            </div>
                            <div className="flex items-center justify-between mt-1">
                              <span>SHA8</span>
                              <span className="font-mono text-slate-700">{currentSha8 || "—"}</span>
                            </div>
                            <div className="flex items-center justify-between mt-1">
                              <span>Class</span>
                              <span className="text-slate-700">{activeFigure?.class_name || "—"}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })()
              ) : (
                <div className="text-sm text-slate-500 p-4">
                  <pre className="text-sm text-slate-700 overflow-auto max-h-[600px]">
                    {JSON.stringify(results, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
