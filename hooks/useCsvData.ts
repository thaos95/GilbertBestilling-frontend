'use client'

import { useState, useEffect, useCallback } from 'react'
import { api, ApiRequestError } from '@/fastapi/api'
import { createLogger } from '@/lib/logger'

const log = createLogger('csvData')

export interface CsvRow {
  [key: string]: string
}

export interface CsvData {
  headers: string[]
  rows: CsvRow[]
  metadata: {
    rowCount: number
    columnCount: number
  }
}

// Per-table CSV data structure
export interface TableCsvData {
  headers: string[]
  rows: CsvRow[]
  metadata: {
    rowCount: number
    columnCount: number
  }
}

interface UseCsvDataResult {
  data: CsvData | null
  tableData: Record<string, CsvData> | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useCsvData(runId: string, manifestUrl?: string | null): UseCsvDataResult {
  const [data, setData] = useState<CsvData | null>(null)
  const [tableData, setTableData] = useState<Record<string, CsvData> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchCsv = useCallback(async () => {
    if (!runId) return

    setLoading(true)
    setError(null)

    try {
      // Server handles blob/local resolution
      const csvData = await api.getRunCsv(runId)

      // Check if new per-table format or legacy combined format
      if ('tables' in csvData && csvData.tables) {
        // New format: { tables: { table_name: { headers, rows, metadata } } }
        setTableData(csvData.tables as Record<string, CsvData>)
        setData(null)
      } else {
        // Legacy format: { headers, rows, metadata }
        setTableData(null)
        setData(csvData as CsvData)
      }
    } catch (err) {
      if (err instanceof ApiRequestError) {
        // 404 means CSV not ready yet - this is OK, not an error
        if (err.message.includes('404') || err.detail?.includes('not found')) {
          setData(null)
          setTableData(null)
          setError(null)
        } else {
          setError(err.detail || err.message)
          setData(null)
          setTableData(null)
        }
      } else {
        const message = err instanceof Error ? err.message : 'Unknown error'
        setError(message)
        setData(null)
        setTableData(null)
      }
    } finally {
      setLoading(false)
    }
  }, [runId, manifestUrl])

  useEffect(() => {
    if (!runId) return
    fetchCsv()
  }, [runId, fetchCsv])

  return { data, tableData, loading, error, refetch: fetchCsv }
}

/**
 * Transpose a CSV table - rows become columns and columns become rows.
 * Original: entity-row format → Attribute-row format
 *
 * Input format (entity-row):
 *   headers: ["ID", "Slagretning", ...]
 *   rows: [{ID: "YDB-03", Slagretning: "H (1)", ...}, ...]
 *
 * Output format (attribute-row):
 *   headers: ["Attribute", "YDB-03", "YDB-04", ...]
 *   rows: [
 *     {Attribute: "ID", "YDB-03": "YDB-03", "YDB-04": "YDB-04", ...},
 *     {Attribute: "Slagretning", "YDB-03": "H (1)", "YDB-04": "H (1)", ...},
 *   ]
 */
export function transposeCsvData(data: CsvData): CsvData {
  if (data.rows.length === 0) return data

  log.debug('[transposeCsvData] Input', {
    headers: data.headers.join(','),
    rowCount: data.rows.length,
    columnCount: data.headers.length,
  })

  // Entity IDs become column headers (after "Attribute")
  const entityIds = data.rows.map(row => row[data.headers[0]] || '')

  // Filter out page-related columns for page-agnostic display
  const excludedColumns = ['source_page', 'page_number', 'page']
  const filteredHeaders = data.headers.filter(h => !excludedColumns.includes(h.toLowerCase()))

  // Create rows: skip first header ("ID") since it's already in column headers
  // Start from index 1 (second header), but only include filtered headers
  const newRows: CsvRow[] = filteredHeaders.slice(1).map((header) => {
    const newRow: CsvRow = { '': header }
    data.rows.forEach((row, rowIndex) => {
      const entityId = entityIds[rowIndex]
      newRow[entityId] = row[header] || ''
    })
    return newRow
  })

  const result = {
    headers: ['', ...entityIds],
    rows: newRows,
    metadata: {
      rowCount: newRows.length,
      columnCount: entityIds.length + 1,
    }
  }

  log.debug('[transposeCsvData] Output', {
    headers: result.headers.join(','),
    rowCount: result.metadata.rowCount,
    columnCount: result.metadata.columnCount,
  })

  return result
}
