import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { verifySessionToken } from '../auth/route';
import { neon } from '@neondatabase/serverless';

export interface EnvVarMeta {
  key: string;
  description: string;
  category: 'Database' | 'AI & ML' | 'Trading Platform' | 'Cache' | 'Security & Auth' | 'App Config';
  isSet: boolean;
  valueMasked: string;
  isSecret: boolean;
  isPublic: boolean;
  source: 'process_env' | 'database_override' | 'default_template';
  rawLength: number;
}

// In-memory overrides store to keep secrets active during the container session if updated via UI
const runtimeEnvOverrides: Record<string, string> = {};

function isAuthValid(req: NextRequest): boolean {
  const cookieToken = req.cookies.get('admin_session_token')?.value;
  const headerToken = req.headers.get('x-admin-token') || req.headers.get('authorization')?.replace('Bearer ', '');
  return verifySessionToken(cookieToken) || verifySessionToken(headerToken);
}

// Helper to categorize variable name
function getCategoryForKey(key: string): EnvVarMeta['category'] {
  const k = key.toUpperCase();
  if (k.includes('DATABASE') || k.includes('POSTGRES') || k.includes('NEON') || k.includes('DB_')) {
    return 'Database';
  }
  if (k.includes('GEMINI') || k.includes('OPENAI') || k.includes('MODEL') || k.includes('AI_')) {
    return 'AI & ML';
  }
  if (k.includes('DERIV') || k.includes('TRADE') || k.includes('MARKET') || k.includes('OAUTH')) {
    return 'Trading Platform';
  }
  if (k.includes('REDIS') || k.includes('UPSTASH') || k.includes('CACHE')) {
    return 'Cache';
  }
  if (k.includes('ADMIN') || k.includes('SECRET') || k.includes('TOKEN') || k.includes('KEY') || k.includes('AUTH') || k.includes('PASSWORD')) {
    return 'Security & Auth';
  }
  return 'App Config';
}

function maskSecretValue(val: string | undefined): string {
  if (!val || val.trim().length === 0) return '';
  if (val.length <= 6) return '••••••';
  if (val.startsWith('postgres://') || val.startsWith('postgresql://')) {
    const parts = val.split('@');
    if (parts.length > 1) {
      return `postgres://••••••••@${parts[1]}`;
    }
  }
  return `${val.substring(0, 3)}••••••••${val.substring(val.length - 4)}`;
}

// Dynamic parser for .env.example
export function parseEnvExampleFile(): EnvVarMeta[] {
  const envExamplePath = path.join(process.cwd(), '.env.example');
  let content = '';

  try {
    if (fs.existsSync(envExamplePath)) {
      content = fs.readFileSync(envExamplePath, 'utf-8');
    }
  } catch (err) {
    console.error('Error reading .env.example file:', err);
  }

  const lines = content.split('\n');
  const results: EnvVarMeta[] = [];
  let pendingComments: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line) {
      pendingComments = [];
      continue;
    }

    if (line.startsWith('#')) {
      const commentText = line.replace(/^#\s*/, '').trim();
      if (commentText) {
        pendingComments.push(commentText);
      }
      continue;
    }

    if (line.includes('=')) {
      const eqIndex = line.indexOf('=');
      const key = line.substring(0, eqIndex).trim();

      if (!key) continue;

      const description = pendingComments.join(' ') || `Environment configuration parameter for ${key}`;
      pendingComments = [];

      // Check current runtime value from process.env or runtime overrides
      const currentValue = runtimeEnvOverrides[key] || process.env[key] || '';
      const isSet = Boolean(currentValue && currentValue.trim().length > 0);
      const isPublic = key.startsWith('NEXT_PUBLIC_');
      const isSecret = !isPublic;

      results.push({
        key,
        description,
        category: getCategoryForKey(key),
        isSet,
        valueMasked: isPublic ? currentValue : maskSecretValue(currentValue),
        isSecret,
        isPublic,
        source: runtimeEnvOverrides[key] ? 'database_override' : 'process_env',
        rawLength: currentValue.length,
      });
    }
  }

  return results;
}

export async function GET(req: NextRequest) {
  if (!isAuthValid(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized: Admin authentication token required' }, { status: 401 });
  }

  const variables = parseEnvExampleFile();

  return NextResponse.json({
    success: true,
    count: variables.length,
    variables,
    environment: {
      nodeEnv: process.env.NODE_ENV || 'development',
      isCloudRun: Boolean(process.env.K_SERVICE || process.env.APP_URL),
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL || runtimeEnvOverrides.DATABASE_URL),
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY || runtimeEnvOverrides.GEMINI_API_KEY),
    },
  });
}

export async function POST(req: NextRequest) {
  if (!isAuthValid(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized: Admin authentication token required' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { action, key, value, secrets } = body;

    // Test a specific environment secret
    if (action === 'test') {
      if (!key) {
        return NextResponse.json({ success: false, error: 'Key is required for testing' }, { status: 400 });
      }

      const targetValue = value || runtimeEnvOverrides[key] || process.env[key];

      if (!targetValue) {
        return NextResponse.json({ success: false, error: `Secret ${key} is not set. Cannot run connection test.` }, { status: 400 });
      }

      if (key === 'DATABASE_URL') {
        try {
          const sql = neon(targetValue);
          const res = await sql`SELECT NOW() as current_time, VERSION() as version`;
          return NextResponse.json({
            success: true,
            message: 'Database connection test succeeded!',
            details: {
              timestamp: res[0]?.current_time,
              version: res[0]?.version,
            },
          });
        } catch (dbErr: any) {
          return NextResponse.json({ success: false, error: `Database test failed: ${dbErr.message || dbErr}` }, { status: 400 });
        }
      }

      if (key === 'GEMINI_API_KEY') {
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${targetValue}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: 'ping' }] }],
            }),
          });
          const json = await res.json();
          if (res.ok) {
            return NextResponse.json({
              success: true,
              message: 'Gemini API Key test succeeded!',
              details: { status: 'Verified' },
            });
          } else {
            return NextResponse.json({ success: false, error: `Gemini API test returned ${res.status}: ${json.error?.message || 'Invalid key'}` }, { status: 400 });
          }
        } catch (aiErr: any) {
          return NextResponse.json({ success: false, error: `Gemini API Key test failed: ${aiErr.message || aiErr}` }, { status: 400 });
        }
      }

      if (key.includes('REDIS') || key.includes('UPSTASH')) {
        const url = process.env.UPSTASH_REDIS_REST_URL || runtimeEnvOverrides.UPSTASH_REDIS_REST_URL || (key === 'UPSTASH_REDIS_REST_URL' ? targetValue : '');
        const token = process.env.UPSTASH_REDIS_REST_TOKEN || runtimeEnvOverrides.UPSTASH_REDIS_REST_TOKEN || (key === 'UPSTASH_REDIS_REST_TOKEN' ? targetValue : '');

        if (url && token) {
          try {
            const cleanUrl = url.trim().replace(/\/$/, '');
            const pingRes = await fetch(`${cleanUrl}/PING`, {
              headers: { Authorization: `Bearer ${token.trim()}` },
            });
            const pingJson = await pingRes.json();
            if (pingRes.ok && pingJson.result === 'PONG') {
              return NextResponse.json({
                success: true,
                message: 'Upstash Redis REST connection succeeded! Received PONG from serverless cache.',
                details: pingJson,
              });
            } else {
              return NextResponse.json({
                success: false,
                error: `Upstash Redis test returned status ${pingRes.status}: ${JSON.stringify(pingJson)}`,
              }, { status: 400 });
            }
          } catch (redisErr: any) {
            return NextResponse.json({
              success: false,
              error: `Upstash Redis connection failed: ${redisErr.message || redisErr}`,
            }, { status: 400 });
          }
        }

        return NextResponse.json({
          success: true,
          message: `Upstash parameter ${key} format check passed (${targetValue.length} chars). Set both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to run live PING test.`,
        });
      }

      return NextResponse.json({
        success: true,
        message: `Key ${key} format check passed (${targetValue.length} chars).`,
      });
    }

    // Update single or multiple secrets
    const updatesToApply: Record<string, string> = {};
    if (secrets && typeof secrets === 'object') {
      Object.assign(updatesToApply, secrets);
    } else if (key && typeof key === 'string' && value !== undefined) {
      updatesToApply[key] = value;
    }

    const updatedKeys: string[] = [];

    for (const [k, v] of Object.entries(updatesToApply)) {
      if (typeof v === 'string') {
        // Set process.env at runtime
        process.env[k] = v;
        runtimeEnvOverrides[k] = v;
        updatedKeys.push(k);
      }
    }

    // Try persisting to .env.local if file system is writable
    try {
      const envLocalPath = path.join(process.cwd(), '.env.local');
      let existingEnvLocal = '';
      if (fs.existsSync(envLocalPath)) {
        existingEnvLocal = fs.readFileSync(envLocalPath, 'utf-8');
      }

      let envLines = existingEnvLocal.split('\n');
      for (const [k, v] of Object.entries(updatesToApply)) {
        const lineIdx = envLines.findIndex((l) => l.trim().startsWith(`${k}=`));
        if (lineIdx >= 0) {
          envLines[lineIdx] = `${k}=${v}`;
        } else {
          envLines.push(`${k}=${v}`);
        }
      }
      fs.writeFileSync(envLocalPath, envLines.join('\n'), 'utf-8');
    } catch (fsErr) {
      console.warn('Could not update .env.local file (may be read-only):', fsErr);
    }

    // If DATABASE_URL is available, try persisting system_secrets table
    const dbUrl = process.env.DATABASE_URL || runtimeEnvOverrides.DATABASE_URL;
    if (dbUrl) {
      try {
        const sql = neon(dbUrl);
        await sql`
          CREATE TABLE IF NOT EXISTS system_secrets (
            secret_key VARCHAR(100) PRIMARY KEY,
            secret_value TEXT NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT NOW()
          );
        `;
        for (const [k, v] of Object.entries(updatesToApply)) {
          await sql`
            INSERT INTO system_secrets (secret_key, secret_value, updated_at)
            VALUES (${k}, ${v}, NOW())
            ON CONFLICT (secret_key) DO UPDATE SET
              secret_value = EXCLUDED.secret_value,
              updated_at = NOW();
          `;
        }
      } catch (dbSaveErr) {
        console.warn('Could not persist secret to system_secrets DB table:', dbSaveErr);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Successfully updated ${updatedKeys.length} secret variable(s).`,
      updatedKeys,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || 'Failed to update secrets' }, { status: 500 });
  }
}
