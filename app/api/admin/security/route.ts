import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { verifySessionToken } from '../auth/route';

function authorized(req: NextRequest) {
  const cookie = req.cookies.get('admin_session_token')?.value;
  const header = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return verifySessionToken(cookie) || verifySessionToken(header);
}

function configured(name: string) {
  return Boolean(process.env[name]?.trim());
}

function secretRisk(name: string) {
  return /SECRET|TOKEN|PASSWORD|PRIVATE|API_KEY|DATABASE_URL/i.test(name) && !name.startsWith('NEXT_PUBLIC_');
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });

  const envKeys = Object.keys(process.env).filter((key) => key && !key.startsWith('npm_') && !key.startsWith('NODE_'));
  const sensitiveKeys = envKeys.filter(secretRisk);
  const publicKeys = envKeys.filter((key) => key.startsWith('NEXT_PUBLIC_'));
  const adminConfigured = configured('ADMIN_SECRET_KEY');
  const dbConfigured = configured('DATABASE_URL');
  const derivConfigured = configured('NEXT_PUBLIC_DERIV_APP_ID');
  const redisConfigured = configured('UPSTASH_REDIS_REST_URL') && configured('UPSTASH_REDIS_REST_TOKEN');
  const mlConfigured = configured('PYTHON_ML_SERVICE_URL') || configured('PYTHON_BIN');

  const checks = [
    { id: 'admin-secret', label: 'Admin authentication secret', configured: adminConfigured, severity: 'critical' },
    { id: 'database', label: 'Database credential', configured: dbConfigured, severity: 'critical' },
    { id: 'deriv-app', label: 'Deriv application identity', configured: derivConfigured, severity: 'high' },
    { id: 'redis', label: 'Redis cache credentials', configured: redisConfigured, severity: 'medium' },
    { id: 'ml-runtime', label: 'ML runtime configuration', configured: mlConfigured, severity: 'high' },
  ];

  const secureCookiePolicy = process.env.NODE_ENV === 'production';
  const exposedSecretNames = publicKeys.filter(secretRisk);
  const score = checks.filter((check) => check.configured).length / checks.length * 100;

  return NextResponse.json({
    success: true,
    dataSource: 'runtime-environment',
    generatedAt: new Date().toISOString(),
    environment: process.env.NODE_ENV || null,
    checks,
    posture: {
      configurationCoveragePercent: Math.round(score),
      secureCookiePolicy,
      secretVariablesDiscovered: sensitiveKeys.length,
      publicVariablesDiscovered: publicKeys.length,
      publicSecretRiskCount: exposedSecretNames.length,
      requestIdSupport: true,
      constantTimeAdminComparison: true,
      sessionTokenAlgorithm: 'HMAC-SHA256',
    },
    integrity: {
      valuesAreNotReturned: true,
      configuredDoesNotMeanHealthy: true,
      source: 'process.env',
      fingerprint: crypto.createHash('sha256').update(envKeys.sort().join('\n')).digest('hex').slice(0, 16),
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
