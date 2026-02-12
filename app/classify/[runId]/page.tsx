'use client'

import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { use } from "react"
import { api as apiConfig } from '@/lib/api-config'
import { createLogger } from '@/lib/logger'

const log = createLogger('Classify')

/** Class option labels — Norwegian UI */
const CLASS_OPTIONS = [
  { label: "Vindu", value: "window" },
  { label: "Ytterdør", value: "door" },
] as const

const CLASS_LABEL_MAP: Record<string, string> = {
  window: "Vindu",
  door: "Ytterdør",
  unknown: "Ukjent",
  reject: "Avvist",
}

interface Crop {
  sha: string
  image_path: string
  image_url?: string
  class_name: string
  confidence: number
  page_id?: string
  metadata?: {
    ai_sam_class?: string
    csv_table_type?: string
    csv_row_class?: string
    class_override_source?: string
    crop_relpath?: string
  }
}

interface ClassificationRequest {
  run_id: string
  doc_id: string
  doc_name: string
  crops: Crop[]
  status: string
  created_at: string
  completed_at?: string
}

export default function ClassifyPage({ params }: { params: Promise<{ runId: string }> }) {
  const router = useRouter()
  const resolvedParams = use(params)
  const runId = resolvedParams.runId

  const [request, setRequest] = useState<ClassificationRequest | null>(null)
  const [loading, setLoading] = useState(true)
  const [imagesLoading, setImagesLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [crops, setCrops] = useState<Crop[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [classifications, setClassifications] = useState<Record<string, string>>({})
  const [reviewedCrops, setReviewedCrops] = useState<Set<string>>(new Set())

  // Batch image preloading counter
  const loadedCountRef = useRef(0)
  const [loadedCountDisplay, setLoadedCountDisplay] = useState(0)

  // Fetch classification request via v4 Jobs API (direct FastAPI call)
  useEffect(() => {
    const fetchClassification = async () => {
      try {
        const res = await fetch(apiConfig.jobs.classification.get(runId), {
          headers: {
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
          },
        })

        if (!res.ok) {
          if (res.status === 404) {
            setError("Classification request not found — pipeline may still be processing")
          } else {
            setError(`Failed to load classification: ${res.status}`)
          }
          setLoading(false)
          return
        }

        const data = await res.json()
        setRequest(data)

        // Enrich crops with image_url via v4 Jobs API image endpoint
        const enrichedCrops = (data.crops || []).map((c: Crop) => {
          if (c.image_url) {
            return { ...c, image_url: c.image_url.replaceAll('\\', '/') }
          }
          // Use the v4 image endpoint: /api/jobs/{id}/images/{sha}
          return {
            ...c,
            image_url: apiConfig.jobs.images(runId, c.sha),
          }
        })
        setCrops(enrichedCrops)

        // Initialize classifications with current values
        const initial: Record<string, string> = {}
        enrichedCrops.forEach((c: Crop) => {
          initial[c.sha] = c.class_name
        })
        setClassifications(initial)

        // Batch preload all images via browser cache (instant navigation)
        batchPreloadImages(enrichedCrops)
      } catch (err) {
        log.error('Fetch classification error', { error: err instanceof Error ? err.message : String(err) })
        setError(err instanceof Error ? err.message : "Failed to load classification")
      } finally {
        setLoading(false)
      }
    }

    /** Preload all crop images via Image() constructor (browser HTTP cache) */
    const batchPreloadImages = (cropList: Crop[]) => {
      if (cropList.length === 0) {
        setImagesLoading(false)
        return
      }
      setImagesLoading(true)
      loadedCountRef.current = 0
      setLoadedCountDisplay(0)

      for (const crop of cropList) {
        const url = crop.image_url
        if (!url) {
          loadedCountRef.current += 1
          continue
        }
        const img = new Image()
        img.onload = img.onerror = () => {
          loadedCountRef.current += 1
          // Throttle display updates
          if (loadedCountRef.current % 5 === 0 || loadedCountRef.current === cropList.length) {
            setLoadedCountDisplay(loadedCountRef.current)
          }
          if (loadedCountRef.current >= cropList.length) {
            setImagesLoading(false)
            log.info(`Preloaded ${loadedCountRef.current}/${cropList.length} images`)
          }
        }
        img.src = url
      }
    }

    fetchClassification()
  }, [runId])

  // Current image URL from enriched crop data (browser-cached after preload)
  const currentImage = crops[currentIndex]?.image_url || null

  const handleClassification = (sha: string, className: string) => {
    setClassifications((prev) => ({ ...prev, [sha]: className }))
  }

  const handleSubmit = async () => {
    const classificationsList = Object.entries(classifications).map(([sha, class_name]) => ({
      sha,
      class_name,
    }))

    log.info(`Sending ${classificationsList.length} classifications for run ${runId}`)

    setSubmitting(true)
    try {
      // v4: Direct FastAPI call via api-config
      const res = await fetch(apiConfig.jobs.classification.submit(runId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_id: runId, classifications: classificationsList }),
      })

      log.debug(`Submit response: ${res.status}`)

      if (!res.ok) {
        const errorText = await res.text()
        log.error('Submit error', { status: res.status, errorText })
        throw new Error(`Failed to submit: ${res.status} - ${errorText}`)
      }

      router.push(`/results/${runId}`)
    } catch (err) {
      log.error('Submit error', { error: err instanceof Error ? err.message : String(err) })
      setError(err instanceof Error ? err.message : "Failed to submit classification")
    } finally {
      setSubmitting(false)
    }
  }

  const handleAutoSubmit = async () => {
    setSubmitting(true)
    try {
      // v4: Direct FastAPI call via api-config
      const res = await fetch(apiConfig.jobs.classification.autoSubmit(runId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })

      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(`Failed to auto-submit: ${res.status} - ${errorText}`)
      }

      router.push(`/results/${runId}`)
    } catch (err) {
      log.error('Auto-submit error', { error: err instanceof Error ? err.message : String(err) })
      setError(err instanceof Error ? err.message : "Failed to auto-submit")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400 mb-4"></div>
        <p className="text-gray-500">Loading classification...</p>
      </div>
    )
  }

  if (error && !request) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="text-red-500 mb-4">Error: {error}</div>
        <Link href="/runs" className="text-blue-600 hover:text-blue-700">
          ← Back to Runs
        </Link>
      </div>
    )
  }

  // Auto-mark current crop as reviewed when on last item
  const atLastCrop = currentIndex === crops.length - 1
  const effectiveReviewedCount = atLastCrop ? crops.length : reviewedCrops.size
  const progress = crops.length > 0 ? Math.round((effectiveReviewedCount / crops.length) * 100) : 0
  const currentCrop = crops[currentIndex]

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <Link href="/runs" className="text-sm text-gray-500 hover:text-gray-700">
          ← Back to Runs
        </Link>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Classification</h1>
        <p className="text-gray-500">Review and confirm figure classifications</p>
      </div>

      {/* Progress */}
      <div className="mb-6">
        <div className="flex justify-between text-sm mb-2">
          <span className={atLastCrop ? "text-emerald-700 font-medium" : "text-gray-600"}>
            {atLastCrop ? "Complete!" : "Reviewed"}
          </span>
          <span className={atLastCrop ? "text-emerald-700 font-medium" : "text-gray-600"}>
            {atLastCrop ? `${crops.length} / ${crops.length}` : `${effectiveReviewedCount} / ${crops.length}`}
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all duration-300 ${atLastCrop ? "bg-emerald-500" : "bg-gray-800"}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Classification UI */}
      {currentCrop && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="grid grid-cols-2 gap-6 p-6">
            {/* Image */}
            <div className="aspect-square bg-gray-100 rounded-lg flex items-center justify-center">
              {imagesLoading ? (
                <div className="flex flex-col items-center justify-center text-gray-400">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400 mb-2"></div>
                  <span className="text-sm">Loading images... {loadedCountDisplay}/{crops.length}</span>
                </div>
              ) : !currentImage ? (
                <div className="flex flex-col items-center justify-center text-red-400">
                  <span className="text-2xl mb-2">⚠️</span>
                  <span className="text-sm">Image not loaded</span>
                </div>
              ) : (
                <img
                  src={currentImage}
                  alt={`Crop ${currentCrop.sha.slice(0, 8)}`}
                  className="max-w-full max-h-full object-contain"
                />
              )}
            </div>

            {/* Controls */}
            <div className="flex flex-col justify-center space-y-4">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Current Classification</p>
                <p className="text-lg font-medium text-gray-900 capitalize">
                  {CLASS_LABEL_MAP[currentCrop.class_name] || currentCrop.class_name}
                </p>
                {/* Metadata: AI prediction */}
                {currentCrop.metadata?.ai_sam_class && (
                  <p className="text-sm text-gray-500 mt-1">
                    AI predicted: {currentCrop.metadata.ai_sam_class}
                  </p>
                )}
                {/* Metadata: CSV/Table suggestion */}
                {(currentCrop.metadata?.csv_row_class || currentCrop.metadata?.csv_table_type) && (
                  <p className="text-sm text-amber-600 mt-1">
                    Table suggested: {currentCrop.metadata.csv_row_class || currentCrop.metadata.csv_table_type}
                  </p>
                )}
                {/* Metadata: override source */}
                {currentCrop.metadata?.class_override_source && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    Source: {currentCrop.metadata.class_override_source}
                  </p>
                )}
              </div>

              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Confirm or Change</p>
                <div className="space-y-2">
                  {CLASS_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => handleClassification(currentCrop.sha, option.value)}
                      className={`w-full px-4 py-3 rounded-lg border-2 text-left font-medium transition-colors ${
                        classifications[currentCrop.sha] === option.value
                          ? "border-gray-800 bg-gray-50 text-gray-900"
                          : "border-gray-200 hover:border-gray-300 text-gray-700"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                  {/* Reject button */}
                  <button
                    onClick={() => handleClassification(currentCrop.sha, "reject")}
                    className={`w-full px-4 py-3 rounded-lg border-2 text-left font-medium transition-colors ${
                      classifications[currentCrop.sha] === "reject"
                        ? "border-red-500 bg-red-50 text-red-700"
                        : "border-gray-200 hover:border-red-300 text-gray-700"
                    }`}
                  >
                    Reject
                  </button>
                </div>
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  onClick={() => {
                    setCurrentIndex((i) => Math.max(0, i - 1))
                  }}
                  disabled={currentIndex === 0}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  onClick={() => {
                    if (currentCrop) {
                      setReviewedCrops(prev => new Set(prev).add(currentCrop.sha))
                    }
                    setCurrentIndex((i) => Math.min(crops.length - 1, i + 1))
                  }}
                  disabled={currentIndex === crops.length - 1}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-6 flex justify-between">
        <button
          onClick={handleAutoSubmit}
          disabled={submitting}
          className="px-4 py-2 text-gray-600 hover:text-gray-900"
        >
          Use All Predictions
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="px-6 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
        >
          {submitting ? "Submitting..." : "Submit All"}
        </button>
      </div>
    </div>
  )
}