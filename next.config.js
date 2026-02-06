/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * ARCHITECTURE (v4):
   * 
   * Frontend components make DIRECT calls to FastAPI (http://localhost:8000)
   * using the centralized lib/api-config.ts. No proxy/rewrites needed.
   * 
   * Next.js API routes handle ONLY local file operations:
   * - POST /api/local-upload - Upload files (stores to output_frontend/)
   * - GET /api/files/* - Serve files (from output_frontend/)
   * - GET /api/health - Health check
   * 
   * All other API calls (jobs, runs, config) go directly to FastAPI.
   */
}

module.exports = nextConfig
