import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

interface FailedAttempt {
  count: number;
  firstAttemptAt: number;
  lockoutUntil?: number;
}

const failedAttemptsMap = new Map<string, FailedAttempt>();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function cleanupAttempts() {
  const now = Date.now();
  for (const [ip, attempt] of failedAttemptsMap.entries()) {
    if (attempt.lockoutUntil && attempt.lockoutUntil < now) {
      failedAttemptsMap.delete(ip);
    } else if (now - attempt.firstAttemptAt > LOCKOUT_MS) {
      failedAttemptsMap.delete(ip);
    }
  }
}

function getConfiguredSecret(): string | null {
  const secret = process.env.ADMIN_SECRET_KEY?.trim();
  return secret ? secret : null;
}

function generateSessionToken(timestamp: number, secret: string): string {
  const hash = crypto.createHmac('sha256', secret).update(`admin_session_${timestamp}`).digest('hex');
  return `${timestamp}.${hash}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  const secret = getConfiguredSecret();
  if (!secret || !token) return false;

  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const timestamp = Number(parts[0]);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return false;

  const now = Date.now();
  if (timestamp > now || now - timestamp > SESSION_TTL_MS) return false;

  const expectedToken = generateSessionToken(timestamp, secret);
  const provided = Buffer.from(token);
  const expected = Buffer.from(expectedToken);
  if (provided.length !== expected.length) return false;

  return crypto.timingSafeEqual(provided, expected);
}

function getRequestIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown';
}

export async function GET(req: NextRequest) {
  const isConfigured = Boolean(getConfiguredSecret());
  const cookieToken = req.cookies.get('admin_session_token')?.value;
  const headerToken = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const isAuthenticated = verifySessionToken(cookieToken) || verifySessionToken(headerToken);

  return NextResponse.json({
    isAuthenticated,
    configured: isConfigured,
    serverTime: new Date().toISOString(),
  });
}

export async function POST(req: NextRequest) {
  cleanupAttempts();

  const configuredSecret = getConfiguredSecret();
  if (!configuredSecret) {
    return NextResponse.json(
      { success: false, error: 'Admin authentication is not configured. Set ADMIN_SECRET_KEY in the deployment environment.' },
      { status: 503 }
    );
  }

  const ip = getRequestIp(req);
  const now = Date.now();
  const attempt = failedAttemptsMap.get(ip) || { count: 0, firstAttemptAt: now };

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

    const provided = Buffer.from(key);
    const expected = Buffer.from(configuredSecret);
    const isMatch = provided.length === expected.length && crypto.timingSafeEqual(provided, expected);

    if (!isMatch) {
      attempt.count += 1;
      if (attempt.count >= MAX_FAILED_ATTEMPTS) {
        attempt.lockoutUntil = now + LOCKOUT_MS;
      }
      failedAttemptsMap.set(ip, attempt);

      return NextResponse.json(
        {
          success: false,
          error: 'Invalid admin authorization passkey.',
          attemptsRemaining: Math.max(0, MAX_FAILED_ATTEMPTS - attempt.count),
          isLockedOut: attempt.count >= MAX_FAILED_ATTEMPTS,
        },
        { status: 401 }
      );
    }

    failedAttemptsMap.delete(ip);

    const timestamp = Date.now();
    const token = generateSessionToken(timestamp, configuredSecret);
    const response = NextResponse.json({
      success: true,
      message: 'Admin authorization granted successfully.',
      expiresAt: timestamp + SESSION_TTL_MS,
    });

    response.cookies.set('admin_session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });

    return response;
  } catch {
    return NextResponse.json({ success: false, error: 'Malformed request.' }, { status: 400 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({
    success: true,
    message: 'Admin logged out successfully.',
  });

  response.cookies.set('admin_session_token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });

  return response;
}
