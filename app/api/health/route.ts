import { NextResponse } from 'next/server'

/**
 * Health check endpoint for service readiness verification.
 * Used by E2E tests to ensure Next.js is ready to serve requests.
 */
export async function GET() {
    return NextResponse.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
    })
}
