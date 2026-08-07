import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limiter';

export async function middleware(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? '127.0.0.1';
  
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const isAdminRoute = request.nextUrl.pathname.startsWith('/api/admin/');
    const isMlRoute = request.nextUrl.pathname.startsWith('/api/ml/');
    const isWsRoute = request.nextUrl.pathname.startsWith('/api/db/ticks');
    
    let routeType: 'ml' | 'ws' | 'api' = 'api';
    if (isMlRoute) routeType = 'ml';
    else if (isWsRoute) routeType = 'ws';
    
    // Dedicated namespace for admin actions and force retrain triggers to avoid rate limit collisions
    const keyPrefix = isAdminRoute ? 'admin_' : '';
    const { success, limit, remaining, reset } = await checkRateLimit(
      `${keyPrefix}${ip}_${routeType}`, 
      routeType
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
          }
        }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};

