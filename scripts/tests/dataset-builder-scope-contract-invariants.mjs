import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const route = read('app/api/admin/dataset-batches/route.ts');
const store = read('lib/auto-dataset-job-store.ts');
const atomic = read('lib/auto-dataset-job-store-atomic.ts');
const builder = read('lib/training-dataset-builder-duration-v2.ts');

const assertions = [
  [route.includes("createAutoDatasetJobAtomic"), 'batch route must use the atomic AUTO job scope writer'],
  [!route.includes('requestedRangeId('), 'batch route must not generate synthetic requested range IDs'],
  [route.includes('rangeId: matches[0]?.id ?? null'), 'unmatched discovery must persist a nullable real range reference'],
  [route.includes("status: message.startsWith('AUTO_DATASET_SCOPE_CONFLICT:') ? 'conflict' : 'failed'"), 'scope conflicts must be surfaced distinctly from infrastructure failures'],
  [route.includes('status: hasConflict ? 409 : 422'), 'all-conflict submissions must return an explicit conflict status'],
  [atomic.includes('WITH inserted_job AS'), 'AUTO parent/job-item persistence must be one SQL statement'],
  [atomic.includes('ON CONFLICT DO NOTHING'), 'concurrent AUTO reservations must be deterministic'],
  [atomic.includes('CROSS JOIN UNNEST('), 'all selected horizons must be persisted in the same atomic scope write'],
  [!atomic.includes("SET status = 'failed'"), 'atomic scope writer must not silently supersede an active scope'],
  [store.includes('duration_range_id VARCHAR(160)'), 'job-item range reference must remain represented at the persistence boundary'],
  [builder.includes('durationToSeconds'), 'dataset construction must derive target horizon from duration value/unit'],
  [builder.includes('durationUnit === \'t\' ? anchorIndex + durationValue :'), 'tick/time target construction must remain duration-scope driven'],
];

const failures = assertions.filter(([ok]) => !ok).map(([, message]) => message);
if (failures.length) {
  console.error('Dataset builder scope contract invariant failures:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Dataset builder scope contract invariants passed (${assertions.length} checks).`);
