'use client'

import { useState, useEffect } from "react"
import { getFastApiUrl } from '@/lib/api-config'

export default function SettingsPage() {
  const [apiUrl, setApiUrl] = useState("http://localhost:8000")
  const [pollInterval, setPollInterval] = useState(2000)
  const [saved, setSaved] = useState(false)

  // Load settings from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("pipeline_settings")
      if (stored) {
        const parsed = JSON.parse(stored)
        if (parsed.apiUrl) setApiUrl(parsed.apiUrl)
        if (parsed.pollInterval) setPollInterval(parsed.pollInterval)
      } else {
        // Use default from api-config
        setApiUrl(getFastApiUrl())
      }
    } catch (e) {
      // ignore
    }
  }, [])

  const handleSave = () => {
    // Save settings to localStorage or environment
    localStorage.setItem("pipeline_settings", JSON.stringify({ apiUrl, pollInterval }))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500">Configure pipeline behavior</p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            FastAPI URL
          </label>
          <input
            type="text"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="http://localhost:8000"
          />
          <p className="text-sm text-gray-500 mt-1">
            Direct URL to FastAPI backend (Jobs API, runs, config). Default: http://localhost:8000
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Poll Interval (ms)
          </label>
          <input
            type="number"
            value={pollInterval}
            onChange={(e) => setPollInterval(Number(e.target.value))}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            min={500}
            max={10000}
            step={100}
          />
          <p className="text-sm text-gray-500 mt-1">
            How often to poll for status updates (500-10000ms)
          </p>
        </div>

        <div className="pt-4 border-t border-gray-200">
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Save Settings
          </button>
          {saved && (
            <span className="ml-3 text-green-600">Settings saved!</span>
          )}
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">System Status</h2>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="space-y-3">
            <StatusItem label="Redis" status="connected" />
            <StatusItem label="Celery Worker" status="running" />
            <StatusItem label="API Server" status="running" />
          </div>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">About</h2>
        <div className="text-gray-500 text-sm">
          <p>Gilje Pipeline v0.1.0</p>
          <p className="mt-1">Document processing pipeline for architectural figure extraction</p>
          <p className="mt-1">Backend: Celery + Redis | Frontend: Next.js</p>
        </div>
      </div>
    </div>
  )
}

function StatusItem({ label, status }: { label: string; status: string }) {
  const isRunning = status === "connected" || status === "running"

  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-700">{label}</span>
      <span className={`px-3 py-1 text-xs font-medium rounded-full ${isRunning ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
        }`}>
        {status}
      </span>
    </div>
  )
}
