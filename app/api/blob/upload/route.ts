/**
 * Vercel Blob upload route handler for v4 architecture.
 * 
 * This route handles the server-side token exchange for client-side blob uploads.
 * The client uses @vercel/blob/client to upload directly to Vercel Blob storage,
 * and this route provides the necessary authentication.
 * 
 * CRITICAL RULES:
 * - addRandomSuffix: true is MANDATORY for security
 * - Never return BLOB_READ_WRITE_TOKEN to the client
 * - Only allow PDF uploads (application/pdf)
 * - Max file size: 50MB
 */

import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';

const log = createLogger('api/blob/upload');

export async function POST(request: NextRequest) {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // Validate the upload before generating token
        // pathname is the requested path (e.g., "uploads/{jobId}/input.pdf")

        return {
          // MANDATORY: addRandomSuffix must be true for security
          // Vercel will add a random string to make URLs unguessable
          addRandomSuffix: true,

          // Only allow PDF files
          allowedContentTypes: ['application/pdf'],

          // Max file size: 50MB
          maximumSizeInBytes: 50 * 1024 * 1024,

          // Optional: Add metadata
          tokenPayload: JSON.stringify({
            uploadedAt: new Date().toISOString(),
          }),
        };
      },
      onUploadCompleted: async ({ blob }) => {
        // Called after successful upload
        // blob.url contains the full URL with random suffix
        // blob.pathname contains the actual path (differs from requested due to random suffix)
        log.info('Blob upload completed', {
          url: blob.url,
          pathname: blob.pathname,
        });

        // Note: We don't need to do anything here - the client
        // will receive blob.url and use it to create the job
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    log.error('Blob upload error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: 'Upload failed' },
      { status: 500 }
    );
  }
}
