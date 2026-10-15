/**
 * Runs the AI-layer evaluation suite under plain Node (no build, no network, no keys):
 *
 *   npm run ai:eval
 *
 * Real router/adapters against a local fake provider; see src/lib/ai/eval/index.ts.
 */
import { src } from "./soie-node-hooks.mjs";

const { runEval } = await import(src("lib/ai/eval/index.ts"));
const report = await runEval();

console.log(`AI layer evaluation: ${report.passed}/${report.total} passed, ${report.failed} failed (${report.ms} ms)`);
for (const g of report.byGroup) console.log(`  ${g.group.padEnd(22)} ${g.passed}/${g.total}`);
for (const r of report.results.filter((x) => !x.passed)) {
  console.log(`\nFAIL ${r.id}: ${r.title}`);
  for (const f of r.failures) console.log(`    ${f}`);
}
process.exit(report.failed === 0 ? 0 : 1);
