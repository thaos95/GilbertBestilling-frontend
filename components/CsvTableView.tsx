'use client'

import { useCsvData, CsvData } from '@/hooks/useCsvData'
import { useMemo } from 'react'
import { api, type BlobManifest, isBlobMode, findCropBlobUrl } from '@/fastapi/api'
import { transposeCsvData } from '@/hooks/useCsvData'
import { FigureCsvIntegrityBadge } from '@/components/FigureCsvIntegrityBadge'
import type { PageIntegrity } from '@/utils/figureCsvIntegrity'

const FIGURE_PATTERN = /figure:([0-9a-f]{8})/i

interface CsvTableViewProps {
  runId: string
  pageIntegrityByPage?: Record<number, PageIntegrity>
  manifestUrl?: string | null
  manifest?: BlobManifest | null
}

// Build image path - uses blob manifest in blob mode, legacy API otherwise
function buildImagePath(runId: string, sha8: string, manifest?: BlobManifest | null): string {
  if (isBlobMode() && manifest) {
    const blobUrl = findCropBlobUrl(manifest, sha8)
    if (blobUrl) return blobUrl
  }
  return api.getCropImageUrl(runId, sha8)
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
    const imagePath = buildImagePath(runId, value, manifest)
    return (
      <img
        src={imagePath}
        alt={`Crop ${value}`}
        className="w-16 h-16 object-contain bg-slate-100 rounded"
        loading="lazy"
      />
    )
  }

  // Check for inline figure:XXXXXX pattern
  const match = value.match(FIGURE_PATTERN)
  if (match) {
    const sha8 = match[1]
    const imagePath = buildImagePath(runId, sha8, manifest)
    return (
      <img
        src={imagePath}
        alt={`Crop ${sha8}`}
        className="w-100 h-100 object-contain bg-slate-100 rounded"
        loading="lazy"
      />
    )
  }

  return <span className="text-sm text-slate-700">{value}</span>
}

function TableContent({ data, runId, manifest }: { data: CsvData; runId: string; manifest?: BlobManifest | null }) {
  if (data.rows.length === 0) {
    return null
  }

  return (
    <div>
      <table className="w-full border-collapse">
        <thead className="bg-slate-50 sticky top-0 z-10">
          <tr>
            {data.headers.map((header) => (
              <th
                key={header}
                className="px-4 py-3 text-left text-xs font-semibold tracking-wider text-slate-600 border-b border-slate-200"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {data.rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className={rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50'}
            >
              {data.headers.map((header) => (
                <td
                  key={`${rowIndex}-${header}`}
                  className="px-4 py-3 max-w-xs"
                >
                  <TableCell
                    value={row[header] || ''}
                    runId={runId}
                    columnName={header}
                    manifest={manifest}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function getPageNumbersFromTable(table: CsvData): number[] {
  const sourcePageHeader = table.headers.find(h => h.toLowerCase() === 'source_page')
  const figureSha8Header = table.headers.find(h => h.toLowerCase() === 'figure_sha8')
  if (!sourcePageHeader || !figureSha8Header) return []

  const pageSet = new Set<number>()
  for (const row of table.rows) {
    const figureSha8 = row[figureSha8Header]
    if (!figureSha8 || !figureSha8.trim()) continue
    const pageValue = row[sourcePageHeader] || '1'
    const pageNum = parseInt(pageValue, 10)
    if (!Number.isNaN(pageNum)) pageSet.add(pageNum)
  }

  return Array.from(pageSet).sort((a, b) => a - b)
}

export function CsvTableView({ runId, pageIntegrityByPage, manifestUrl, manifest }: CsvTableViewProps) {
  const { tableData, data, loading, error } = useCsvData(runId, manifestUrl)

  // Handle per-table format (new API)
  const displayTables = useMemo(() => {
    if (tableData) {
      // New format: each table already has its own headers/rows
      const result: Record<string, CsvData> = {}
      Object.entries(tableData).forEach(([tableName, table]) => {
        result[tableName] = transposeCsvData(table)
      })
      return result
    }
    return null
  }, [tableData])

  const tablePages = useMemo(() => {
    if (!tableData) return null
    const result: Record<string, number[]> = {}
    Object.entries(tableData).forEach(([tableName, table]) => {
      result[tableName] = getPageNumbersFromTable(table)
    })
    return result
  }, [tableData])

  const legacyPages = useMemo(() => {
    if (!data) return []
    return getPageNumbersFromTable(data)
  }, [data])

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

  // Check for per-table format
  if (displayTables && Object.keys(displayTables).length > 0) {
    const sortedTables = Object.keys(displayTables).sort()
    return (
      <div className="space-y-8">
        {sortedTables.map((tableName) => {
          const table = displayTables[tableName]
          const pages = tablePages?.[tableName] || []
          return (
            <div key={tableName}>
              {/* Clear section separator with label */}
              <div className="flex items-center gap-4 mb-3">
                <h3 className="text-sm font-medium text-slate-700">
                  {tableName}
                </h3>
                {pageIntegrityByPage && pages.length > 0 && (
                  <div className="flex flex-wrap items-center gap-3">
                    {pages.map((pageNum) => {
                      const integrity = pageIntegrityByPage[pageNum]
                      if (!integrity) return null
                      return (
                        <div key={pageNum} className="flex items-center gap-2">
                          <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                            Page {pageNum}
                          </span>
                          <FigureCsvIntegrityBadge pageIntegrity={integrity} />
                        </div>
                      )
                    })}
                  </div>
                )}
                <div className="h-px bg-slate-200 flex-1" />
                <span className="text-xs text-slate-400 tabular-nums">
                  {table.metadata.rowCount} rows
                </span>
              </div>
              <div className="bg-white rounded-lg border border-slate-200">
                <TableContent data={table} runId={runId} manifest={manifest} />
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  // Fallback to legacy single-table format
  if (!data) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-slate-500">
          CSV not available yet - pipeline may still be processing
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200">
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
        <h3 className="text-sm font-medium text-slate-700">
          CSV Table ({data.metadata.rowCount} rows, {data.metadata.columnCount} columns)
        </h3>
      </div>
      {pageIntegrityByPage && legacyPages.length > 0 && (
        <div className="px-4 py-2 border-b border-slate-200 bg-slate-50">
          <div className="flex flex-wrap items-center gap-3">
            {legacyPages.map((pageNum) => {
              const integrity = pageIntegrityByPage[pageNum]
              if (!integrity) return null
              return (
                <div key={pageNum} className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                    Page {pageNum}
                  </span>
                  <FigureCsvIntegrityBadge pageIntegrity={integrity} />
                </div>
              )
            })}
          </div>
        </div>
      )}
      <TableContent data={data} runId={runId} manifest={manifest} />
    </div>
  )
}
