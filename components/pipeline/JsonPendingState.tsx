'use client'

import React from 'react'

// Simple SVG icons
function ClockIcon({ className, size = 24 }: { className?: string; size?: number }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function RefreshIcon({ className, size = 16 }: { className?: string; size?: number }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  )
}

interface JsonPendingStateProps {
  currentStage: string
  stageMessage: string
  onRefresh?: () => void
  className?: string
}

export function JsonPendingState({
  currentStage,
  stageMessage,
  onRefresh,
  className = '',
}: JsonPendingStateProps) {
  return (
    <div className={`bg-slate-100 rounded-md border border-slate-200 p-8 ${className}`}>
      <div className="flex flex-col items-center text-center">
        {/* Icon container - design system: accent-subtle bg, blue-500 icon */}
        <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center mb-4">
          <ClockIcon className="text-blue-500" />
        </div>

        {/* Title - slate-900, 16px, semibold */}
        <h3 className="text-base font-semibold text-slate-900 mb-1">
          JSON Document Pending
        </h3>

        {/* Stage message - slate-600, 14px */}
        <p className="text-sm text-slate-600 mb-4 max-w-md">
          {stageMessage}
        </p>

        {/* Stage badge - white surface, border, monospace stage */}
        <div className="bg-white rounded border border-slate-200 px-3 py-1.5 mb-4">
          <span className="text-xs text-slate-500">Current stage: </span>
          <span className="text-xs font-medium text-blue-700 capitalize font-mono">
            {currentStage}
          </span>
        </div>

        {/* Mini progress bar */}
        <div className="w-full max-w-[240px] mb-4">
          <div className="h-1 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-400 ease-out"
              style={{ width: '67%' }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-[11px] text-slate-400">Classification</span>
            <span className="text-[11px] text-slate-400">Integration</span>
          </div>
        </div>

        {/* Refresh button - design system: white bg, slate border, hover slate-100 */}
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors duration-150"
          >
            <RefreshIcon />
            Refresh
          </button>
        )}
      </div>
    </div>
  )
}
