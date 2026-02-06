'use client'

import { useState, useMemo } from 'react'
import { useCsvData } from '@/hooks/useCsvData'
import { api, type BlobManifest, isBlobMode, findCropBlobUrl } from '@/fastapi/api'

const FIGURE_PATTERN = /figure:([0-9a-f]{8})/i

interface Page {
  page_id: string
  page_number: number
  image_path: string
}

interface PivotedCsvViewProps {
  runId: string
  pages?: Page[]  // Optional - will show placeholder if not provided
  manifestUrl?: string | null
  manifest?: BlobManifest | null
}

interface TableCellProps {
  value: string
  runId: string
  columnName: string
  manifest?: BlobManifest | null
}

function TableCell({ value, runId, columnName, manifest }: TableCellProps) {
  // Check figure_sha8 column first
  if (columnName === 'figure_sha8' && value) {
    let imagePath: string
    if (isBlobMode() && manifest) {
      const blobUrl = findCropBlobUrl(manifest, value)
      imagePath = blobUrl || api.getCropImageUrl(runId, value)
    } else {
      imagePath = api.getCropImageUrl(runId, value)
    }
    return (
      <img
        src={imagePath}
        alt={`Crop ${value}`}
        className="w-12 h-12 object-contain bg-slate-100 rounded border border-slate-200"
        loading="lazy"
      />
    )
  }

  // Check for inline figure:XXXXXX pattern
  const match = value.match(FIGURE_PATTERN)
  if (match) {
    const sha8 = match[1]
    let imagePath: string
    if (isBlobMode() && manifest) {
      const blobUrl = findCropBlobUrl(manifest, sha8)
      imagePath = blobUrl || api.getCropImageUrl(runId, sha8)
    } else {
      imagePath = api.getCropImageUrl(runId, sha8)
    }
    return (
      <img
        src={imagePath}
        alt={`Crop ${sha8}`}
        className="w-12 h-12 object-contain bg-slate-100 rounded border border-slate-200"
        loading="lazy"
      />
    )
  }

  return <span className="text-sm text-slate-700">{value}</span>
}

// Build image path for page
function buildPageImageUrl(imagePath: string): string {
  return imagePath
}

export function PivotedCsvView({ runId, pages, manifestUrl, manifest }: PivotedCsvViewProps) {
  const { data, loading, error } = useCsvData(runId, manifestUrl)
  const [selectedPage, setSelectedPage] = useState<number>(1)
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null)

  // Group CSV rows by page number
  const rowsByPage = useMemo(() => {
    if (!data) return {}
    const grouped: Record<number, number[]> = {}
    const pageCol = data.headers.find(h => h.toLowerCase().includes('page'))
    if (pageCol) {
      data.rows.forEach((row, index) => {
        const pageNum = parseInt(row[pageCol] || '0')
        if (pageNum > 0) {
          if (!grouped[pageNum]) grouped[pageNum] = []
          grouped[pageNum].push(index)
        }
      })
    }
    return grouped
  }, [data])

  // Get rows for selected page
  const selectedPageRows = useMemo(() => {
    if (!data) return []
    return rowsByPage[selectedPage] || []
  }, [data, rowsByPage, selectedPage])

  // Transpose a row for display (headers become first column)
  const transposeRow = (rowIndex: number) => {
    if (!data) return []
    const row = data.rows[rowIndex]
    return data.headers.map(header => ({
      header,
      value: row[header] || ''
    }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-slate-500">Loading CSV data...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-red-500">Error: {error}</div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-slate-500">
          CSV not available yet - pipeline may still be processing
        </div>
      </div>
    )
  }

  // Get current page image
  const currentPageData = pages?.find(p => p.page_number === selectedPage)
  const pageImageUrl = currentPageData ? buildPageImageUrl(currentPageData.image_path) : null

  // If no pages provided, show simplified view without page thumbnails
  const showPageThumbnails = pages && pages.length > 0

  return (
    <div className="flex gap-4 h-[calc(100vh-300px)]">
      {/* Left sidebar - Page selector (only if pages provided) */}
      {showPageThumbnails && (
        <div className="w-48 flex-shrink-0 bg-white rounded-lg border border-slate-200 overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-slate-200 bg-slate-50">
            <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Pages</h3>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {pages?.map((page) => {
              const hasData = rowsByPage[page.page_number]?.length > 0
              return (
                <button
                  key={page.page_id}
                  onClick={() => {
                    setSelectedPage(page.page_number)
                    setSelectedRowIndex(null)
                  }}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${selectedPage === page.page_number
                      ? 'bg-blue-50 text-blue-700 border border-blue-200'
                      : hasData
                        ? 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                        : 'bg-slate-50 text-slate-400 border border-slate-100'
                    }`}
                >
                  <span className="font-medium">Pg {page.page_number}</span>
                  {hasData && (
                    <span className="ml-auto text-xs bg-slate-100 px-1 rounded">
                      {rowsByPage[page.page_number].length}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Middle - Page preview (only if pages provided) */}
      {showPageThumbnails && (
        <div className="w-64 flex-shrink-0 bg-white rounded-lg border border-slate-200 overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Page {selectedPage}</h3>
            {currentPageData && (
              <span className="text-[10px] text-slate-400 font-mono">
                {currentPageData.page_id.slice(0, 6)}
              </span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto bg-slate-100 p-2">
            {pageImageUrl ? (
              <img
                src={pageImageUrl}
                alt={`Page ${selectedPage}`}
                className="w-full h-auto rounded border border-slate-200 shadow-sm"
              />
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-slate-400">
                No image
              </div>
            )}
          </div>
        </div>
      )}

      {/* Right - Pivoted CSV data */}
      <div className="flex-1 bg-white rounded-lg border border-slate-200 overflow-hidden flex flex-col">
        <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
            Extracted Data - Page {selectedPage}
          </h3>
          <span className="text-xs text-slate-500">
            {selectedPageRows.length} row{selectedPageRows.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex-1 overflow-auto">
          {selectedPageRows.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-slate-400">
              No CSV data for this page
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {selectedPageRows.map((rowIndex, idx) => {
                const transposed = transposeRow(rowIndex)
                const isSelected = selectedRowIndex === rowIndex
                return (
                  <div
                    key={rowIndex}
                    className={`cursor-pointer transition-colors ${isSelected
                        ? 'bg-blue-50'
                        : idx % 2 === 0
                          ? 'bg-white hover:bg-slate-50'
                          : 'bg-slate-50 hover:bg-slate-100'
                      }`}
                    onClick={() => setSelectedRowIndex(isSelected ? null : rowIndex)}
                  >
                    <div className="px-4 py-1.5 flex items-center gap-2">
                      <span className="text-xs font-mono text-slate-400">#{idx + 1}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${isSelected
                          ? 'bg-blue-200 text-blue-800'
                          : 'bg-slate-200 text-slate-600'
                        }`}>
                        Row {rowIndex}
                      </span>
                      {isSelected && <span className="text-xs text-blue-600 ml-auto">Selected</span>}
                    </div>
                    {/* Pivoted table - headers in first column, values in second */}
                    <div className="px-4 pb-3">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        {transposed.slice(0, 8).map(({ header, value }) => (
                          <div key={header} className="flex gap-2">
                            <span className="font-medium text-slate-600 min-w-[80px]">{header}:</span>
                            <span className="text-slate-900 break-all">
                              <TableCell value={value} runId={runId} columnName={header} manifest={manifest} />
                            </span>
                          </div>
                        ))}
                        {transposed.length > 8 && (
                          <div className="col-span-2 text-xs text-slate-400 italic">
                            +{transposed.length - 8} more columns
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
