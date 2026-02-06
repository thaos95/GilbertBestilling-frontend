/**
 * Hook for polling job status from the v4 Jobs API.
 * 
 * This hook polls GET /api/jobs/{id} every few seconds until
 * the job reaches a terminal state (completed, failed, cancelled).
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createLogger } from '@/lib/logger';

const log = createLogger('useJobStatus');

// Job status enum matching the backend
export type JobStatus =
  | 'pending'
  | 'downloading'
  | 'running'
  | 'classification_pending'
  | 'uploading'
  | 'completed'
  | 'failed'
  | 'cancellation_requested'
  | 'cancelled';

// Public job data returned by API
export interface JobPublic {
  id: string;
  status: JobStatus;
  doc_name: string;
  current_stage: string | null;
  progress_percent: number;
  message: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  manifest_url: string | null;
  error_message: string | null;
}

// Terminal states where we stop polling
const TERMINAL_STATUSES: JobStatus[] = ['completed', 'failed', 'cancelled'];

// Import centralized API config
import { getFastApiUrl, api } from '@/lib/api-config';

interface UseJobStatusOptions {
  /** Polling interval in ms (default: 5000) */
  pollInterval?: number;
  /** Whether to start polling immediately (default: true) */
  enabled?: boolean;
}

interface UseJobStatusResult {
  job: JobPublic | null;
  error: string | null;
  isLoading: boolean;
  isPolling: boolean;
  /** Manually refetch job status */
  refetch: () => Promise<void>;
  /** Cancel the job */
  cancel: () => Promise<boolean>;
}

export function useJobStatus(
  jobId: string | null,
  options: UseJobStatusOptions = {}
): UseJobStatusResult {
  const { pollInterval = 5000, enabled = true } = options;

  const [job, setJob] = useState<JobPublic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPolling, setIsPolling] = useState(false);

  // Use refs to track terminal state without causing re-renders
  const isTerminalRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchJob = useCallback(async () => {
    if (!jobId) return;
    // Skip if already terminal
    if (isTerminalRef.current) {
      log.debug('Skipping fetch - already terminal');
      return;
    }

    setIsLoading(true);
    setError(null);

    log.debug(`Fetching job status for: ${jobId}`);

    try {
      // Use centralized API config - direct call to FastAPI
      const url = api.jobs.get(jobId);
      log.debug(`Requesting: ${url}`);

      const response = await fetch(url);

      log.debug(`Response status: ${response.status}`);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Job not found');
        }
        throw new Error(`Failed to fetch job: ${response.statusText}`);
      }

      const data: JobPublic = await response.json();
      log.debug('Job data received', { status: data.status, progress: data.progress_percent });
      setJob(data);

      // Check if we should stop polling - update ref immediately
      if (TERMINAL_STATUSES.includes(data.status)) {
        log.info(`Terminal status reached: ${data.status} - stopping polling`);
        isTerminalRef.current = true;
        setIsPolling(false);
        // Clear interval immediately
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    } catch (err) {
      log.error(`Fetch error: ${err instanceof Error ? err.message : 'Unknown'}`);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [jobId]);

  const cancelJob = useCallback(async (): Promise<boolean> => {
    if (!jobId) return false;

    try {
      // Use centralized API config - direct call to FastAPI
      const response = await fetch(api.jobs.cancel(jobId), {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(`Failed to cancel job: ${response.statusText}`);
      }

      // Refetch to get updated status
      await fetchJob();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel');
      return false;
    }
  }, [jobId, fetchJob]);

  // Start polling when jobId is set and enabled
  useEffect(() => {
    if (!jobId || !enabled) {
      setIsPolling(false);
      return;
    }

    // Reset terminal state for new job
    isTerminalRef.current = false;

    // Initial fetch
    fetchJob();
    setIsPolling(true);

    // Set up polling interval
    intervalRef.current = setInterval(() => {
      // Check ref (not stale closure) for terminal state
      if (isTerminalRef.current) {
        log.debug('Interval: terminal detected, clearing');
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        setIsPolling(false);
        return;
      }

      fetchJob();
    }, pollInterval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setIsPolling(false);
    };
  }, [jobId, enabled, pollInterval, fetchJob]); // Removed job?.status to prevent re-creating interval

  return {
    job,
    error,
    isLoading,
    isPolling,
    refetch: fetchJob,
    cancel: cancelJob,
  };
}

/**
 * Create a new job from a blob URL.
 */
export async function createJob(
  inputUrl: string,
  docName: string,
  jobId?: string,
  configOverrides?: Record<string, unknown>
): Promise<JobPublic> {
  // Use centralized API config - direct call to FastAPI
  const url = api.jobs.create();

  log.info('Creating job', { url, jobId, docName });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      job_id: jobId,
      input_url: inputUrl,
      doc_name: docName,
      config_overrides: configOverrides,
    }),
  });

  log.debug(`CreateJob response status: ${response.status}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    log.error('CreateJob error', { error: JSON.stringify(error) });
    throw new Error(error.detail || error.error || 'Failed to create job');
  }

  const job = await response.json();
  log.info('Job created', { id: job.id, status: job.status });
  return job;
}
