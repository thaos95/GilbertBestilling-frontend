/**
 * Figure/CSV Data Integrity Utility
 *
 * Compares figure count vs CSV entity count per page to detect data mismatches.
 * Pure function - no side effects, easy to test.
 */

import type { CsvData } from '@/hooks/useCsvData'

/**
 * Possible integrity status values
 */
export type IntegrityStatus =
  | 'matched'       // figureCount === csvCount > 0
  | 'csv_missing'   // figureCount > csvCount (figures not in CSV)
  | 'figures_extra' // figureCount < csvCount (CSV has extra entities)
  | 'csv_pending'   // CSV not available yet
  | 'no_figures'    // No figures and no CSV entities on page

/**
 * Figure data shape from API - matches existing RunResults interface
 */
export interface FigureData {
  sha: string
  class_name: string
  image_path?: string
  page_id?: string
}

/**
 * Integrity result for a single page
 */
export interface PageIntegrity {
  pageNumber: number
  figureCount: number
  csvEntityCount: number
  status: IntegrityStatus
}

/**
 * Calculate integrity status by comparing figures to CSV entities per page.
 *
 * @param figures - Array of figures from API results
 * @param csvTables - Record of table name -> CSV data (from useCsvData), or null
 * @returns Array of PageIntegrity sorted by page number
 *
 * Logic:
 * 1. Count figures per page (page_id field, fallback to page 1)
 * 2. Count CSV entities per page (rows with figure_sha8, grouped by source_page)
 * 3. Compare counts to determine status
 * 4. Return sorted array of results
 */
export function calculatePageIntegrity(
  figures: FigureData[],
  csvTables: Record<string, CsvData> | null
): PageIntegrity[] {
  // Step 1: Count figures per page (exclude rejected)
  const figuresByPage = figures.reduce((acc, fig) => {
    if (fig.class_name === "reject") return acc
    const pageNum = parseInt(fig.page_id || '1', 10)
    acc[pageNum] = (acc[pageNum] || 0) + 1
    return acc
  }, {} as Record<number, number>)

  // Step 2: Count CSV entities per page
  const csvByPage: Record<number, number> = {}

  if (csvTables) {
    for (const table of Object.values(csvTables)) {
      // Find column indices (case-insensitive)
      const sourcePageIdx = table.headers.findIndex(
        h => h.toLowerCase() === 'source_page'
      )
      const figureSha8Idx = table.headers.findIndex(
        h => h.toLowerCase() === 'figure_sha8'
      )

      // Skip table if required columns missing
      if (sourcePageIdx === -1 || figureSha8Idx === -1) continue

      // Count entities
      for (const row of table.rows) {
        // Only count rows that have a figure_sha8 value
        const figureSha8 = row[table.headers[figureSha8Idx]]
        if (!figureSha8 || !figureSha8.trim()) continue

        const pageNum = parseInt(row[table.headers[sourcePageIdx]] || '1', 10)
        csvByPage[pageNum] = (csvByPage[pageNum] || 0) + 1
      }
    }
  }

  // Step 3: Get all pages with data
  const allPages = new Set<number>([
    ...Object.keys(figuresByPage).map(Number),
    ...Object.keys(csvByPage).map(Number),
  ])

  // Step 4: Determine status for each page
  const results: PageIntegrity[] = []

  for (const pageNum of allPages) {
    const figureCount = figuresByPage[pageNum] || 0
    const csvCount = csvByPage[pageNum] || 0
    let status: IntegrityStatus

    if (!csvTables) {
      // CSV not available yet
      status = figureCount > 0 ? 'csv_pending' : 'no_figures'
    } else if (figureCount === 0 && csvCount === 0) {
      status = 'no_figures'
    } else if (figureCount === 0) {
      status = 'no_figures'
    } else if (csvCount === 0) {
      status = 'csv_pending'
    } else if (figureCount === csvCount) {
      status = 'matched'
    } else if (figureCount > csvCount) {
      status = 'csv_missing'
    } else {
      status = 'figures_extra'
    }

    results.push({
      pageNumber: pageNum,
      figureCount,
      csvEntityCount: csvCount,
      status,
    })
  }

  // Step 5: Sort by page number
  return results.sort((a, b) => a.pageNumber - b.pageNumber)
}
