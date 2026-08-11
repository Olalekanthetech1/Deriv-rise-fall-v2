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

function isRouteOrAdmin(relative) {
  return /^app\/(api\/.*|admin\/.*)\.(ts|tsx)$/.test(relative);
}

// Legacy model registration is no longer an approved production API. Any
// caller outside the compatibility definition is a hard build failure.
for (const file of files) {
  const relative = relativePath(file);
  if (relative === guardFile || relative === dbCompatibilityFile) continue;
  const content = fs.readFileSync(file, 'utf8');
  if (/\bregisterModelInDb\b/.test(content)) {
    violations.push(`${relative} -> legacy model-registration API`);
  }
}

for (const file of files) {
  const relative = relativePath(file);
  const content = fs.readFileSync(file, 'utf8');

  // The xgboost-daemon module is the canonical Node -> Python runtime bridge;
  // server-side reads such as ping, diagnostics and backtest are legitimate.
  // What is forbidden is bypassing the durable training queue by invoking the
  // training actions directly from an application route.
  if (isRouteOrAdmin(relative)) {
    if (/xgboostDaemon\.sendCommand\(\s*['"](?:train|train_partitioned)['"]/.test(content)) {
      violations.push(`${relative} -> direct native training command bypasses durable ML queue`);
    }
    if (/from\s+['"][^'"]*ml-training-worker[^'"]*['"]/.test(content)) {
      violations.push(`${relative} -> direct ml-training-worker import in app layer`);
    }
  }

  // Browser/client code may not cross into the server-only runtime bridge.
  if (/\.(tsx|jsx)$/.test(relative) && /^components\//.test(relative) && /['"]use client['"]/.test(content)) {
    if (/from\s+['"][^'"]*xgboost-daemon[^'"]*['"]/.test(content) || /from\s+['"][^'"]*ml-training-worker[^'"]*['"]/.test(content)) {
      violations.push(`${relative} -> client component imports server-only ML runtime boundary`);
    }
  }
}

if (violations.length) {
  throw new Error(`[Gate 6 Legacy Boundary] violations detected:\n${violations.join('\n')}`);
}

console.log('[Gate 6 Legacy Boundary] passed: canonical ML runtime bridge is allowed server-side; legacy registration and direct training queue bypasses are blocked.');
