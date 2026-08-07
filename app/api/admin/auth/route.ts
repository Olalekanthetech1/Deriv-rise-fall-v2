import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// In-memory brute-force protection store
interface FailedAttempt {
  count: number;
  firstAttemptAt: number;
  lockoutUntil?: number;
}

const failedAttemptsMap = new Map<string, FailedAttempt>();

// Helper to clean up old entries periodically
function cleanupAttempts() {
  const now = Date.now();
  for (const [ip, attempt] of failedAttemptsMap.entries()) {
    if (attempt.lockoutUntil && attempt.lockoutUntil < now) {
      failedAttemptsMap.delete(ip);
    } else if (now - attempt.firstAttemptAt > 15 * 60 * 1000) {
      failedAttemptsMap.delete(ip);
    }
  }
}

// Secret signing token helper
function getSecretSigner(): string {
  return process.env.ADMIN_SECRET_KEY || 'admin_rise_fall_2026';
}

function generateSessionToken(timestamp: number): string {
  const secret = getSecretSigner();
  const hash = crypto.createHmac('sha256', secret).update(`admin_session_${timestamp}`).digest('hex');
  return `${timestamp}.${hash}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const timestamp = parseInt(parts[0], 10);
  if (isNaN(timestamp)) return false;

  // Expire session after 24 hours
  const now = Date.now();
  if (now - timestamp > 24 * 60 * 60 * 1000) return false;

  const expectedToken = generateSessionToken(timestamp);
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken));
}

export async function GET(req: NextRequest) {
  const cookieToken = req.cookies.get('admin_session_token')?.value;
  const headerToken = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace('Bearer ', '');

  const isValid = verifySessionToken(cookieToken) || verifySessionToken(headerToken);

  return NextResponse.json({
    isAuthenticated: isValid,
    serverTime: new Date().toISOString(),
  });
}

export async function POST(req: NextRequest) {
  cleanupAttempts();

  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '127.0.0.1';
  const now = Date.now();
  const attempt = failedAttemptsMap.get(ip) || { count: 0, firstAttemptAt: now };

  // Check if locked out
  if (attempt.lockoutUntil && attempt.lockoutUntil > now) {
    const remainingSeconds = Math.ceil((attempt.lockoutUntil - now) / 1000);
    return NextResponse.json(
      {
        success: false,
        error: `Too many failed attempts. Admin access locked for ${remainingSeconds} seconds.`,
        lockoutRemainingSeconds: remainingSeconds,
      },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const { key } = body;

    if (!key || typeof key !== 'string') {
      return NextResponse.json({ success: false, error: 'Admin passkey is required.' }, { status: 400 });
    }

    const currentAdminKey = process.env.ADMIN_SECRET_KEY || 'admin_rise_fall_2026';

    // Timing-safe string comparison
    const keyBuffer = Buffer.from(key);
    const expectedBuffer = Buffer.from(currentAdminKey);

    let isMatch = false;
    if (keyBuffer.length === expectedBuffer.length) {
      isMatch = crypto.timingSafeEqual(keyBuffer, expectedBuffer);
    }

    if (!isMatch) {
      attempt.count += 1;
      if (attempt.count >= 5) {
        attempt.lockoutUntil = now + 15 * 60 * 1000; // 15 minutes lockout
      }
      failedAttemptsMap.set(ip, attempt);

      const attemptsRemaining = Math.max(0, 5 - attempt.count);
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid admin authorization passkey.',
          attemptsRemaining,
          isLockedOut: attempt.count >= 5,
        },
        { status: 401 }
      );
    }

    // Clear failed attempts on success
    failedAttemptsMap.delete(ip);

    const timestamp = Date.now();
    const token = generateSessionToken(timestamp);

    const response = NextResponse.json({
      success: true,
      token,
      message: 'Admin authorization granted successfully.',
      expiresAt: timestamp + 24 * 60 * 60 * 1000,
    });

    // Set secure HTTP-only cookie
    response.cookies.set('admin_session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 86400, // 24 hours
    });

    return response;
  } catch (err: any) {
    return NextResponse.json({ success: false, error: 'Malformed request.' }, { status: 400 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({
    success: true,
    message: 'Admin logged out successfully.',
  });

  response.cookies.delete('admin_session_token');
  return response;
}
