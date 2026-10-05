#!/usr/bin/env node
// Runs every case in evals/ through the running API and reports recall and precision.
//   pnpm eval            all cases
//   pnpm eval off-by-one just the cases whose folder name contains the argument
// A finding counts as a hit when it is in the same file and its lines are within 2 lines of an expected range.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
const API = (process.env.CODEREVIEW_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const KEY = process.env.CODEREVIEW_API_KEY;
const filter = process.argv[2];
const TOLERANCE = 2;
const SEVERITY = ['info', 'low', 'medium', 'high', 'critical'];

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(KEY ? { authorization: `Bearer ${KEY}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => {
    console.error(`Cannot reach the API at ${API}. Is the stack running?`);
    process.exit(1);
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const overlaps = (finding, [from, to]) => {
  const start = finding.lineStart;
  const end = finding.lineEnd ?? finding.lineStart;
  return start <= to + TOLERANCE && end >= from - TOLERANCE;
};

async function runCase(dir) {
  const base = resolve(root, 'evals', dir);
  const diff = readFileSync(resolve(base, 'change.patch'), 'utf8');
  const spec = JSON.parse(readFileSync(resolve(base, 'expected.json'), 'utf8'));
  const { reviewId } = await api('POST', '/api/reviews/diff', { diff });
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const { status, error } = await api('GET', `/api/reviews/${reviewId}/status`);
    if (status === 'failed') throw new Error(`review failed: ${error}`);
    if (status === 'completed') break;
  }
  const review = await api('GET', `/api/reviews/${reviewId}`);
  const found = review.findings;
  const hitExpected = spec.expected.filter((e) => found.some((f) => f.filePath === e.file && overlaps(f, e.lines)));
  const hitFindings = found.filter((f) => spec.expected.some((e) => f.filePath === e.file && overlaps(f, e.lines)));
  // on a clean change, anything above the allowed severity is a false positive
  const limit = SEVERITY.indexOf(spec.max_severity_ok ?? 'info');
  const falseAlarms = spec.expected.length === 0 ? found.filter((f) => SEVERITY.indexOf(f.severity) > limit).length : 0;
  return {
    case: dir,
    expected: spec.expected.length,
    caught: hitExpected.length,
    findings: found.length,
    onTarget: hitFindings.length,
    falseAlarms,
    missed: spec.expected.filter((e) => !hitExpected.includes(e)).map((e) => e.issue.slice(0, 60)),
    model: review.model,
  };
}

const dirs = readdirSync(resolve(root, 'evals'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(resolve(root, 'evals', d.name, 'change.patch')))
  .map((d) => d.name)
  .filter((n) => !filter || n.includes(filter));

const results = [];
for (const dir of dirs) {
  process.stdout.write(`running ${dir} ... `);
  try {
    const r = await runCase(dir);
    results.push(r);
    console.log(`${r.caught}/${r.expected} caught, ${r.findings} finding(s)${r.falseAlarms ? `, ${r.falseAlarms} false alarm(s)` : ''}`);
  } catch (err) {
    console.log(`error: ${err.message}`);
  }
}

const expected = results.reduce((n, r) => n + r.expected, 0);
const caught = results.reduce((n, r) => n + r.caught, 0);
const findings = results.reduce((n, r) => n + r.findings, 0);
const onTarget = results.reduce((n, r) => n + r.onTarget, 0);
const falseAlarms = results.reduce((n, r) => n + r.falseAlarms, 0);
console.table(results.map(({ missed, ...r }) => r));
for (const r of results.filter((x) => x.missed.length)) console.log(`missed in ${r.case}: ${r.missed.join('; ')}`);
const pct = (a, b) => (b === 0 ? 'n/a' : `${Math.round((a / b) * 100)}%`);
console.log(`\nRecall    ${pct(caught, expected)}  (${caught}/${expected} planted issues found)`);
console.log(`Precision ${pct(onTarget, findings)}  (${onTarget}/${findings} findings hit a planted issue; extra findings may still be valid)`);
console.log(`False alarms on clean code: ${falseAlarms}`);
