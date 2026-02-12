// middleware.ts - Authentication and authorization middleware
import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Static file extensions that should bypass auth
 */
const STATIC_FILE_EXTENSIONS = [
    'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'avif',
    'css', 'js', 'map', 'txt', 'xml', 'json', 'webmanifest',
    'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp4', 'mp3', 'wav',
    'pdf', 'zip', 'gz'
];

/**
 * Check if email is in admin allowlist
 */
function isAdminEmail(email) {
    if (!email) return false;
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase());
    return adminEmails.includes(email.toLowerCase());
}

/**
 * Check if path is a static file
 */
function isStaticFile(pathname) {
    // Check for file extension
    const lastSegment = pathname.split('/').pop() || '';
    if (lastSegment.includes('.')) {
        const ext = lastSegment.split('.').pop()?.toLowerCase();
        if (ext && STATIC_FILE_EXTENSIONS.includes(ext)) {
            return true;
        }
    }
    return false;
}

export async function middleware(req) {
    const { pathname } = req.nextUrl;
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

    // 1. Always allow Next.js internals
    if (pathname.startsWith('/_next')) {
        return NextResponse.next();
    }

    // 2. Always allow NextAuth endpoints
    if (pathname.startsWith('/api/auth')) {
        return NextResponse.next();
    }

    // 3. Always allow login page
    if (pathname === '/login' || pathname.startsWith('/login')) {
        return NextResponse.next();
    }

    // 4. Allow static files in /public
    if (isStaticFile(pathname)) {
        return NextResponse.next();
    }

    // 5. Handle API routes - return 401 JSON instead of redirect
    if (pathname.startsWith('/api/')) {
        if (!token) {
            return NextResponse.json(
                { error: 'Unauthorized', message: 'Authentication required' },
                { status: 401 }
            );
        }

    }

    // 7. Handle all other protected page routes
    if (!token) {
        const url = req.nextUrl.clone();
        url.pathname = '/login';
        url.searchParams.set('callbackUrl', pathname);
        return NextResponse.redirect(url);
    }

    return NextResponse.next();
}

// Configure which paths the middleware runs on
export const config = {
    matcher: [
        /*
         * Match all request paths except:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * Note: We handle additional static file checks in the middleware itself
         */
        '/((?!_next/static|_next/image|favicon.ico).*)',
    ],
};