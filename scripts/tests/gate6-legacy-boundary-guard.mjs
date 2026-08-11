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

// `registerModelInDb` was historically exported from lib/db.ts. The canonical
// model-registration implementations now live in the duration-aware registry
// boundary. Until the compatibility export is proven unused and removed, this
// guard prevents any new production caller from depending on it again.
for (const file of files) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  if (relative === 'lib/db.ts' || relative === 'scripts/tests/gate6-legacy-boundary-guard.mjs') continue;
  const content = fs.readFileSync(file, 'utf8');
  if (/\bregisterModelInDb\b/.test(content)) {
    violations.push(`${relative} -> registerModelInDb compatibility API`);
  }
}

// Training execution must remain behind the dedicated queue/worker boundary.
// Reject obvious attempts to reintroduce native training directly into route/UI
// code via the retired daemon API.
for (const file of files) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  const content = fs.readFileSync(file, 'utf8');
  if (/^app\/(api\/.*|admin\/.*)\.(ts|tsx)$/.test(relative)) {
    if (/from\s+['"][^'"]*xgboost-daemon[^'"]*['"]/.test(content)) {
      violations.push(`${relative} -> direct xgboost-daemon import in app layer`);
    }
    if (/from\s+['"][^'"]*ml-training-worker[^'"]*['"]/.test(content)) {
      violations.push(`${relative} -> direct ml-training-worker import in app layer`);
    }
  }
}

if (violations.length) {
  throw new Error(`[Gate 6 Legacy Boundary] violations detected:\n${violations.join('\n')}`);
}

console.log('[Gate 6 Legacy Boundary] passed: no production callers depend on the legacy model-registration compatibility API or bypass the dedicated worker boundary.');
