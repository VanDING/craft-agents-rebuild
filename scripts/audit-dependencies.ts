#!/usr/bin/env bun
/**
 * Dependency audit gate.
 *
 * `bun audit` against the public npm registry, compared against a checked-in
 * baseline. New critical/high advisories fail; known advisories stay visible
 * in the report. Dedupe/upgrade work should shrink the baseline, not expand it.
 *
 * Usage:
 *   bun run audit:dependencies
 *   bun run audit:dependencies --update
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const BASELINE = join(import.meta.dir, 'dependency-audit-baseline.json');
const REGISTRY = process.env.CRAFT_AUDIT_REGISTRY ?? 'https://registry.npmjs.org';
const SEVERITY_RANK = { low: 1, moderate: 2, high: 3, critical: 4 } as const;
type Severity = keyof typeof SEVERITY_RANK;

interface Baseline {
  $comment?: string;
  generatedAt?: string;
  allowed: Record<string, Severity>;
}

function parseFindings(output: string): Map<string, Severity> {
  const findings = new Map<string, Severity>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(
      /\b(critical|high|moderate|low):\s+.*?-\s+https:\/\/github\.com\/advisories\/(GHSA-[\w-]+)/,
    );
    if (!match) continue;
    const severity = match[1] as Severity;
    const id = match[2]!;
    const existing = findings.get(id);
    if (!existing || SEVERITY_RANK[severity] > SEVERITY_RANK[existing]) {
      findings.set(id, severity);
    }
  }
  return findings;
}

const update = process.argv.includes('--update');
const inputArg = process.argv.find((arg) => arg.startsWith('--input='));
const inputPath = inputArg ? inputArg.slice('--input='.length) : null;

let output: string;
if (inputPath) {
  // Offline/restricted environments: parse a previously captured `bun audit` output.
  output = readFileSync(inputPath, 'utf8');
} else {
  const proc = Bun.spawnSync({
    cmd: ['bun', 'audit', '--registry', REGISTRY],
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  output = `${proc.stdout?.toString() ?? ''}\n${proc.stderr?.toString() ?? ''}`;
}
const findings = parseFindings(output);

if (findings.size === 0) {
  console.error('Dependency audit produced no parseable findings. Output:');
  console.error(output.trim() || '(empty)');
  process.exit(1);
}

const sorted = [...findings.entries()].sort(([a], [b]) => a.localeCompare(b));

if (update) {
  const baseline: Baseline = {
    $comment:
      'Known dependency advisories. New critical/high findings fail CI; refresh with `bun run audit:dependencies --update`.',
    generatedAt: new Date().toISOString().slice(0, 10),
    allowed: Object.fromEntries(sorted),
  };
  writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`Baseline updated with ${sorted.length} advisories.`);
  process.exit(0);
}

const baseline: Baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const allowed = baseline.allowed ?? {};
const failures: string[] = [];
const newFindings: string[] = [];

for (const [id, severity] of sorted) {
  const known = allowed[id];
  if (!known) {
    newFindings.push(`${severity.toUpperCase()} ${id}`);
    if (SEVERITY_RANK[severity] >= SEVERITY_RANK.high) failures.push(id);
    continue;
  }
  if (SEVERITY_RANK[severity] > SEVERITY_RANK[known]) {
    failures.push(id);
    console.error(`Severity increased for ${id}: ${known} → ${severity}`);
  }
}

if (newFindings.length > 0) {
  console.error(`New advisories (${newFindings.length}):`);
  for (const finding of newFindings) console.error(`  - ${finding}`);
}
if (failures.length > 0) {
  console.error(`\nDependency audit failed: ${failures.length} new/escalated high-severity advisory(ies).`);
  console.error('Update dependencies or record an explicit accepted-risk decision, then refresh the baseline.');
  process.exit(1);
}

const bySeverity = sorted.reduce<Record<string, number>>((acc, [, severity]) => {
  acc[severity] = (acc[severity] ?? 0) + 1;
  return acc;
}, {});
console.log(
  `Dependency audit OK with ${sorted.length} known advisories (${Object.entries(bySeverity)
    .map(([severity, count]) => `${count} ${severity}`)
    .join(', ')}); no new high/critical findings.`,
);
