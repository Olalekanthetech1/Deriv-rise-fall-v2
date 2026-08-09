import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limiter';

export async function proxy(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? 'unknown';

  if (request.nextUrl.pathname.startsWith('/api/')) {
    const pathname = request.nextUrl.pathname;
    const isAdminRoute = pathname.startsWith('/api/admin/');
    const isAuthRoute = pathname === '/api/admin/auth';
    const isMlRoute = pathname.startsWith('/api/ml/');
    const isWsRoute = pathname.startsWith('/api/db/ticks');

    let routeType: 'ml' | 'auth' | 'ws' | 'api' = 'api';
    if (isAuthRoute) routeType = 'auth';
    else if (isMlRoute) routeType = 'ml';
    else if (isWsRoute) routeType = 'ws';

    // Keep authentication traffic isolated from normal admin/API throughput.
    const keyPrefix = isAdminRoute ? 'admin_' : '';
    const { success, limit, remaining, reset } = await checkRateLimit(
      `${keyPrefix}${ip}_${routeType}`,
      routeType,
    );

    if (!success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again in a few seconds.' },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': limit.toString(),
            'X-RateLimit-Remaining': remaining.toString(),
            'X-RateLimit-Reset': reset.toString(),
            'Cache-Control': 'no-store',
          },
        },
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
