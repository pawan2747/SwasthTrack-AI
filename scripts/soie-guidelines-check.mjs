/**
 * Re-fetches every page in Ask's curated guideline list (src/services/soie/guidelines.ts) and checks that the
 * phrases each item says it rests on are still on the page. Run it before a release and whenever a publisher
 * reorganises its site (WHO and NHLBI both moved pages while the list was written):
 *
 *   node scripts/soie-guidelines-check.mjs            # every item
 *   node scripts/soie-guidelines-check.mjs who-       # items whose id starts with "who-"
 *
 * It needs a network and is NOT part of any test suite (the eval is offline on purpose). Exit code 1 when a
 * page cannot be read or a phrase has drifted; an item with no phrases (a landing page) is only fetched.
 */
import { src } from "./soie-node-hooks.mjs";

const { GUIDELINES, GUIDELINES_CHECKED } = await import(src("services/soie/guidelines.ts"));
const only = process.argv[2] ?? "";

function toText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&ndash;|&#8211;|&#x2013;/g, "–")
    .replace(/&#39;|&rsquo;|&#8217;/g, "'")
    .replace(/&[a-z]+;/gi, " ");
}
const norm = (s) =>
  s
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

let bad = 0;
console.log(`Guideline list read ${GUIDELINES_CHECKED}; checking ${GUIDELINES.filter((g) => g.id.startsWith(only)).length} items\n`);
for (const g of GUIDELINES) {
  if (!g.id.startsWith(only)) continue;
  try {
    const res = await fetch(g.url, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (compatible; SwasthTrackGuidelineCheck/1.0)", accept: "text/html" }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      bad++;
      console.log(`FAIL ${g.id}: HTTP ${res.status} for ${g.url}`);
      continue;
    }
    const page = norm(toText(await res.text()));
    const missing = g.evidence.filter((p) => !page.includes(norm(p)));
    if (missing.length) {
      bad++;
      console.log(`DRIFT ${g.id}: ${missing.length} of ${g.evidence.length} phrases not found\n      ${missing.map((m) => JSON.stringify(m)).join("\n      ")}`);
    } else console.log(`ok    ${g.id} (${g.evidence.length} phrases${g.evidence.length === 0 ? "; fetched only" : ""})`);
  } catch (err) {
    bad++;
    console.log(`FAIL ${g.id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
console.log(bad === 0 ? "\nAll items match their pages." : `\n${bad} item(s) need attention.`);
process.exit(bad === 0 ? 0 : 1);
