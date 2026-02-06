'use client'

import React from 'react'
import { usePipelineStage } from '@/hooks/usePipelineStage'
import { type PipelineStatus } from '@/fastapi/api'

// Simple SVG icons to avoid external dependencies
function CheckIcon({ className, size = 20 }: { className?: string; size?: number }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function CircleIcon({ className, size = 20 }: { className?: string; size?: number }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
    </svg>
  )
}

interface PipelineStageIndicatorProps {
  /** Pipeline status object - if provided, stage is derived from this */
  status?: PipelineStatus | null
  /** Override current stage (derived from status if not provided) */
  currentStage?: string
  /** Override stage label */
  stageLabel?: string
  /** Override progress percentage */
  stageProgress?: number
  size?: 'sm' | 'md' | 'lg'
  showLabels?: boolean
  className?: string
}

const STAGE_CONFIG = [
  { key: 'detection' as const, label: 'Detection' },
  { key: 'intake' as const, label: 'Intake' },
  { key: 'classification' as const, label: 'Classification' },
  { key: 'enrichment' as const, label: 'Enrichment' },
  { key: 'integration' as const, label: 'Integration' },
  { key: 'complete' as const, label: 'Complete' },
]

interface StageIndicatorNodeProps {
  stage: typeof STAGE_CONFIG[number]
  status: 'completed' | 'current' | 'upcoming'
  showLabel: boolean
  size: 'sm' | 'md' | 'lg'
}

function StageIndicatorNode({ stage, status, showLabel, size }: StageIndicatorNodeProps) {
  const sizeClasses = {
    sm: { icon: 14, container: 'h-6 w-6', text: 'text-[11px]' },
    md: { icon: 16, container: 'h-7 w-7', text: 'text-xs' },
    lg: { icon: 18, container: 'h-8 w-8', text: 'text-sm' },
  }

  // Design system: slate palette, borders-only depth, emerald for success, blue accent
  const colors = {
    completed: 'bg-emerald-500 text-white',
    current: 'bg-blue-500 text-white border-[3px] border-blue-200 animate-pulse',
    upcoming: 'bg-slate-100 text-slate-400 border border-slate-200',
  }

  const Icon = status === 'completed' ? CheckIcon : CircleIcon

  return (
    <div className="flex flex-col items-center">
      <div
        className={`
          ${sizeClasses[size].container} rounded-full flex items-center justify-center
          ${colors[status]}
          transition-all duration-200 ease-out
          ${status === 'current' ? 'shadow-[0_0_0_4px_rgba(59,130,246,0.2)]' : ''}
        `}
      >
        <Icon size={sizeClasses[size].icon} />
      </div>
      {showLabel && (
        <span className={`${sizeClasses[size].text} text-slate-600 mt-2 whitespace-nowrap font-medium`}>
          {stage.label}
        </span>
      )}
    </div>
  )
}

export function PipelineStageIndicator({
  status,
  currentStage,
  stageLabel,
  stageProgress = 0,
  size = 'md',
  showLabels = true,
  className = '',
}: PipelineStageIndicatorProps) {
  // Derive stage values from status using the hook
  const { currentStage: derivedStage, stageLabel: derivedLabel, stageProgress: derivedProgress } = usePipelineStage(status || null)

  // Use provided values, fall back to derived values from status
  const actualStage = currentStage || derivedStage
  const actualLabel = stageLabel || derivedLabel
  const actualProgress = stageProgress || derivedProgress

  const currentIndex = STAGE_CONFIG.findIndex(s => s.key === actualStage)

  return (
    <div className={`w-full ${className}`}>
      {/* Stage nodes with connecting line */}
      <div className="relative">
        {/* Progress line track */}
        <div className="absolute top-3.5 left-0 right-0 h-[2px] bg-slate-200" />

        {/* Progress line fill */}
        <div
          className="absolute top-3.5 left-0 h-[2px] bg-blue-500 transition-all duration-400 ease-out"
          style={{ width: `${actualProgress}%` }}
        />

        {/* Stage nodes */}
        <div className="relative flex justify-between items-start">
          {STAGE_CONFIG.map((stage, index) => {
            let nodeStatus: 'completed' | 'current' | 'upcoming' = 'upcoming'
            if (index < currentIndex) nodeStatus = 'completed'
            else if (index === currentIndex) {
              // "Complete" stage is special - it means done, not in-progress
              nodeStatus = actualStage === 'complete' ? 'completed' : 'current'
            }

            return (
              <StageIndicatorNode
                key={stage.key}
                stage={stage}
                status={nodeStatus}
                showLabel={showLabels}
                size={size}
              />
            )
          })}
        </div>
      </div>

      {/* Current stage status text */}
      {showLabels && actualLabel && (
        <div className="text-center mt-4">
          <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
            {actualLabel}
          </span>
        </div>
      )}
    </div>
  )
}
