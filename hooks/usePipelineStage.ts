import { useMemo } from 'react'
import { type PipelineStatus } from '@/fastapi/api'

// Pipeline stages in order (as defined in pipeline_task.py: detection → intake → classification → enrichment → integration)
const PIPELINE_STAGES = [
  { key: 'detection', label: 'Detection', order: 1 },
  { key: 'intake', label: 'Intake', order: 2 },
  { key: 'classification', label: 'Classification', order: 3 },
  { key: 'enrichment', label: 'Enrichment', order: 4 },
  { key: 'integration', label: 'Integration', order: 5 },
  { key: 'complete', label: 'Complete', order: 6 },
] as const

export type PipelineStage = typeof PIPELINE_STAGES[number]['key']

// Map PipelineStatus to PipelineStage
const STATUS_TO_STAGE: Record<string, PipelineStage> = {
  'pending': 'detection',
  'running': 'detection',
  'classification_pending': 'classification',
  'classification_complete': 'enrichment',
  'completed': 'complete',
  'failed': 'detection',
  'cancelled': 'detection',
}

// User-friendly messages for each stage
const STAGE_MESSAGES: Record<PipelineStage, string> = {
  detection: 'Detecting figures, tables, and visual elements in your document',
  intake: 'Processing document content and extracting structured data',
  classification: 'Classifying elements by type and reviewing classifications',
  enrichment: 'Enriching content with additional metadata and context',
  integration: 'Building the final document integration JSON',
  complete: 'All processing complete. Results are ready.',
}

interface UsePipelineStageReturn {
  currentStage: PipelineStage
  stageLabel: string
  stageProgress: number // 0-100 percentage
  isJsonReady: boolean
  stageMessage: string
  completedStages: PipelineStage[]
  upcomingStages: PipelineStage[]
  isComplete: boolean
}

export function usePipelineStage(status: PipelineStatus | null): UsePipelineStageReturn {
  return useMemo(() => {
    if (!status) {
      return {
        currentStage: 'detection' as PipelineStage,
        stageLabel: 'Queued',
        stageProgress: 0,
        isJsonReady: false,
        stageMessage: 'Document is queued for processing',
        completedStages: [],
        upcomingStages: PIPELINE_STAGES.map(s => s.key),
        isComplete: false,
      }
    }

    const currentStage = STATUS_TO_STAGE[status.status] || 'detection'
    const currentOrder = PIPELINE_STAGES.find(s => s.key === currentStage)?.order || 1
    const stageLabel = PIPELINE_STAGES.find(s => s.key === currentStage)?.label || 'Unknown'
    const stageMessage = STAGE_MESSAGES[currentStage] || 'Processing...'

    // Progress: 0-100, calculated based on gaps between stages (5 gaps for 6 stages)
    // This ensures the line reaches the "Complete" circle at 100%
    const stageProgress = Math.round(((currentOrder - 1) / (PIPELINE_STAGES.length - 1)) * 100)

    // JSON is only ready when pipeline is complete
    const isJsonReady = status.status === 'completed'

    const completedStages = PIPELINE_STAGES
      .filter(s => s.order < currentOrder)
      .map(s => s.key)

    const upcomingStages = PIPELINE_STAGES
      .filter(s => s.order > currentOrder)
      .map(s => s.key)

    return {
      currentStage,
      stageLabel,
      stageProgress,
      isJsonReady,
      stageMessage,
      completedStages,
      upcomingStages,
      isComplete: status.status === 'completed',
    }
  }, [status])
}
