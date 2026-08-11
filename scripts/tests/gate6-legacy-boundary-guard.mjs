import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourceRoots = ['app', 'components', 'lib', 'scripts'];
const extensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.py']);

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (extensions.has(path.extname(entry.name))) files.push(full);
  }
  return files;
}

const files = sourceRoots.flatMap((relativeRoot) => walk(path.join(root, relativeRoot)));
const violations = [];
const guardFile = 'scripts/tests/gate6-legacy-boundary-guard.mjs';
const dbCompatibilityFile = 'lib/db.ts';

function relativePath(file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

function isAppLayer(relative) {
  return /^(app|components)\//.test(relative);
}

function isRouteOrAdmin(relative) {
  return /^app\/(api\/.*|admin\/.*)\.(ts|tsx)$/.test(relative);
}

// Legacy model registration is a compatibility boundary only. It must not be
// reachable from application/runtime code. Keep the definition isolated until
// the compatibility export is removed completely; callers fail the build.
const legacyRegistrationPatterns = [
  /\bregisterModelInDb\b/,
];

for (const file of files) {
  const relative = relativePath(file);
  if (relative === guardFile || relative === dbCompatibilityFile) continue;

  const content = fs.readFileSync(file, 'utf8');
  for (const pattern of legacyRegistrationPatterns) {
    if (pattern.test(content)) {
      violations.push(`${relative} -> legacy model-registration API (${pattern.source})`);
    }
  }
}

// Training execution must remain behind the dedicated queue/worker boundary.
// Reject imports/references that would let UI, API, or admin code execute the
// worker/retired daemon directly. The worker itself and shared server modules
// are intentionally outside this app-layer rule.
for (const file of files) {
  const relative = relativePath(file);
  const content = fs.readFileSync(file, 'utf8');
  if (!isRouteOrAdmin(relative)) continue;

  if (/from\s+['"][^'"]*xgboost-daemon[^'"]*['"]/.test(content)) {
    violations.push(`${relative} -> direct xgboost-daemon import in app layer`);
  }
  if (/from\s+['"][^'"]*ml-training-worker[^'"]*['"]/.test(content)) {
    violations.push(`${relative} -> direct ml-training-worker import in app layer`);
  }
}

// Prevent browser/client components from importing known server-only training
// boundaries through aliases or relative paths. This closes the common bypass
// where an API route check passes but a Client Component reaches the worker via
// a shared module.
for (const file of files) {
  const relative = relativePath(file);
  const content = fs.readFileSync(file, 'utf8');
  if (!/\.(tsx|jsx)$/.test(relative) || !isAppLayer(relative)) continue;

  if (/['"]use client['"]/.test(content)) {
    if (/from\s+['"][^'"]*(?:ml-training-worker|xgboost-daemon)[^'"]*['"]/.test(content)) {
      violations.push(`${relative} -> client component imports server-only training boundary`);
    }
  }
}

if (violations.length) {
  throw new Error(`[Gate 6 Legacy Boundary] violations detected:\n${violations.join('\n')}`);
}

console.log('[Gate 6 Legacy Boundary] passed: no production callers depend on the legacy model-registration compatibility API or bypass the dedicated worker boundary.');
