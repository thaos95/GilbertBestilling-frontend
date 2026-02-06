'use client'

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { use } from "react"
import { createLogger } from '@/lib/logger'

const log = createLogger('Classify')

interface Crop {
  sha: string
  image_path: string
  image_url?: string
  class_name: string
  confidence: number
  page_id?: string
  metadata?: {
    crop_relpath?: string
  }
}

interface Run {
  run_id: string
  pipeline_status?: string
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
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [crops, setCrops] = useState<Crop[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [classifications, setClassifications] = useState<Record<string, string>>({})
  const [reviewedCrops, setReviewedCrops] = useState<Set<string>>(new Set())

  // Fetch classification request
  useEffect(() => {
    const fetchClassification = async () => {
      try {
        const res = await fetch(`/api/runs/${runId}/classification/redis`, {
          headers: {
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
          },
        })
        if (!res.ok) {
          // Fallback: check runs list for status
          const statusRes = await fetch(`/api/runs`)
          if (statusRes.ok) {
            const runs = await statusRes.json()
            const run = runs.find((r: Run) => r.run_id === runId)
            if (run) {
              setError(`Classification request not found. Run status: ${run.pipeline_status || 'unknown'}`)
            } else {
              setError("Classification request not found")
            }
          } else {
            setError("Classification request not found")
          }
          return
        }
        const data = await res.json()
        setRequest(data)

        // Enrich crops with image_url if not already present (fallback for legacy data)
        // Also normalize any backslashes in existing image_url (Windows paths)
        const enrichedCrops = (data.crops || []).map((c: Crop) => {
          if (c.image_url) {
            return { ...c, image_url: c.image_url.replaceAll('\\', '/') }
          }
          if (c.page_id && c.metadata?.crop_relpath) {
            const relpath = c.metadata.crop_relpath.replaceAll('\\', '/')
            return {
              ...c,
              image_url: `/api/files/${runId}/visual_detector/detections/${c.page_id}/${relpath}`,
            }
          }
          return c
        })
        setCrops(enrichedCrops)

        // Initialize classifications with current values
        const initial: Record<string, string> = {}
        enrichedCrops.forEach((c: Crop) => {
          initial[c.sha] = c.class_name
        })
        setClassifications(initial)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load classification")
      } finally {
        setLoading(false)
      }
    }

    fetchClassification()
  }, [runId])

  // Get current image URL directly from crop data (served via /api/files/)
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
      const res = await fetch(`/api/runs/${runId}/classification/submit`, {
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

      // Redirect to results
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
      const res = await fetch(`/api/runs/${runId}/classification/auto-submit`, {
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
            className={`h-2 rounded-full transition-all duration-300 ${atLastCrop ? "bg-emerald-500" : "bg-gray-800"
              }`}
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
              {!currentImage ? (
                <div className="flex flex-col items-center justify-center text-red-400">
                  <span className="text-2xl mb-2">⚠️</span>
                  <span className="text-sm">Image not available</span>
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
                <p className="text-lg font-medium text-gray-900 capitalize">{currentCrop.class_name}</p>
                <p className="text-sm text-gray-500 mt-1">
                  Confidence: {Math.round(currentCrop.confidence * 100)}%
                </p>
              </div>

              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Confirm or Change</p>
                <div className="space-y-2">
                  {["window", "door", "unknown"].map((className) => (
                    <button
                      key={className}
                      onClick={() => handleClassification(currentCrop.sha, className)}
                      className={`w-full px-4 py-3 rounded-lg border-2 text-left font-medium transition-colors ${classifications[currentCrop.sha] === className
                        ? "border-gray-800 bg-gray-50 text-gray-900"
                        : "border-gray-200 hover:border-gray-300 text-gray-700"
                        }`}
                    >
                      {className.charAt(0).toUpperCase() + className.slice(1)}
                    </button>
                  ))}
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
                    // Mark current crop as reviewed
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