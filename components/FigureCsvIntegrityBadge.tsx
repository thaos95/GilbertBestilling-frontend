'use client'

import React from 'react'
import type { PageIntegrity } from '@/utils/figureCsvIntegrity'

// Simple SVG icons - consistent with codebase pattern
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

function DashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

interface FigureCsvIntegrityBadgeProps {
  pageIntegrity: PageIntegrity
  className?: string
}

// Status configuration - OCP: easy to add new statuses
const STATUS_CONFIG: Record<PageIntegrity['status'], {
  bg: string
  border: string
  text: string
  icon: React.ElementType
  label: string
}> = {
  matched: {
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-700',
    icon: CheckIcon,
    label: 'Matched',
  },
  csv_missing: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    icon: AlertIcon,
    label: 'CSV missing',
  },
  figures_extra: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    icon: AlertIcon,
    label: 'Extra in CSV',
  },
  csv_pending: {
    bg: 'bg-slate-50',
    border: 'border-slate-200',
    text: 'text-slate-500',
    icon: DashIcon,
    label: 'CSV pending',
  },
  no_figures: {
    bg: 'bg-slate-50',
    border: 'border-slate-200',
    text: 'text-slate-500',
    icon: DashIcon,
    label: 'No figures',
  },
}

export function FigureCsvIntegrityBadge({
  pageIntegrity,
  className = '',
}: FigureCsvIntegrityBadgeProps) {
  const config = STATUS_CONFIG[pageIntegrity.status]
  const Icon = config.icon

  return (
    <span
      className={`
        inline-flex items-center gap-1.5
        px-2 py-0.5 rounded border text-xs font-medium tabular-nums
        ${config.bg} ${config.border} ${config.text}
        ${className}
      `}
      title={`${pageIntegrity.figureCount} figures, ${pageIntegrity.csvEntityCount} CSV entities`}
    >
      <Icon className="flex-shrink-0" />
      <span>{pageIntegrity.figureCount}/{pageIntegrity.csvEntityCount}</span>
    </span>
  )
}
