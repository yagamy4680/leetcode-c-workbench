---
name: fetch-similar-leetcode-problems
description: Given a LeetCode problem URL, collect its direct official Similar Questions, author a separate validated C workbench problem JSON for each, and deliver a batch-importable ZIP. Use for requests to fetch all similar problems, build a practice collection, or package multiple LeetCode problems for bulk import.
---

# Fetch similar LeetCode problems

Read [the single-problem skill](../fetch-leetcode-problem/SKILL.md),
[the bundle contract](../../docs/problem-bundle.md), and
[the collection contract](../../docs/problem-collections.md).
Resolve the repository root as `../..` from this skill directory.

## Collect the official target list

Run the public-source helper from the repository root:

```bash
python3 scripts/fetch-leetcode-question.py \
  https://leetcode.com/problems/<seed-slug>/ \
  --collection --output-dir <private-staging>/sources
```

Use the official `similarQuestions` list; do not substitute search results,
topic matches, or invented recommendations. Follow only the seed's direct list.
Exclude the seed itself by default; pass `--include-seed` only when requested.
Deduplicate by canonical slug and verified numeric frontend ID. Resolve metadata
for other related links only to populate each bundle's Similar Questions;
do not recursively expand the bundle collection.

Inspect `collection-source.json`, `seed-question.json` (the original official
target list), and the raw `question-*.json` records. Entries marked `duplicate`
share a verified numeric ID with `duplicateOf`; author that ID only once. The helper
fetches public official HTML, C snippets, topics, and resolved references; its
outputs are source evidence, NOT importable workbench files. Exit 1 can indicate
partial source failures: read the report and continue available targets rather
than treating an incomplete batch as complete.

## Author each independent problem

For every `ready-to-author` target, apply the single-problem skill completely:

- Verify ID, exact C signature and structures from its own official snippet.
- Preserve official image URLs beside their examples as Markdown images.
- Supply a problem-specific driver, ownership contract, headers/helpers, compiling
  TODO solution, official examples, and relevant additional boundary tests.
- Copy `workbenchSimilarQuestions` to `manifest.similarQuestions`. Do not infer
  IDs that were not returned; omit unknown numeric IDs while retaining verified
  title, slug, canonical URL, and difficulty. Preserve the premium flag when known.
- Export to `bundles/problem-<id>.json`. Include every required local helper;
  document shared-runtime prerequisites and publish essential runtime changes
  only within the user's authorized scope.
- Validate each file with `node scripts/validate-problem.mjs`. Compile and test
  its framework in a temporary workspace, using test-only reference solutions.
  Never deliver a reference algorithm in the starter unless explicitly asked.

Do not generate placeholder bundles for blocked or unsupported targets. A premium
problem whose description or C starter cannot be obtained is unavailable for
complete authoring. Record its canonical slug and reason; do not bypass access
controls, ask for passwords, borrow another solution, or invent a starter.
Use an official description/snippet supplied by the user if available.

## Record completeness and package

Create `bundles/_collection.json` alongside the authored bundles:

```json
{
  "seedUrl": "https://leetcode.com/problems/<seed-slug>/",
  "scope": "direct-similar-questions",
  "includesSeed": false,
  "included": [94, 144],
  "unavailable": [{"slug": "blocked-question", "reason": "Official C starter unavailable"}],
  "complete": false
}
```

The IDs above are illustrative. Set `complete` from the actual target list:
every target must have a validated, tested bundle to claim completeness. List
source-resolution warnings separately if relevant. Do not include raw source
records, credentials, solved reference files, or unrelated files in the ZIP.

```bash
python3 scripts/package-problems.py <private-staging>/bundles similar-questions.zip
node scripts/validate-problem-zip.mjs --json similar-questions.zip
```

The packager validates every JSON and the completed archive before replacing
the output file. Each member remains an independent problem bundle. If the
collection exceeds the documented archive limits, split it into numbered ZIPs
without dropping questions and explain why. If no target can be authored,
return the source failure report rather than a misleading empty import ZIP.

## Deliver and optionally import

Deliver a downloadable ZIP and state the seed URL, direct-only scope, included
IDs, unavailable targets, format/compile/test results, sanitizer limitations,
and runtime prerequisites. Distinguish files generated from files imported.
Use the current file-delivery workflow so the download remains available.

Point to **Import problem → Batch import a ZIP → Preview ZIP**. Preview validates
the whole archive without writes. Existing IDs default to Skip. Replacing them
requires an explicit choice and confirmation; prior files are backed up and
accepted marks/history remain. Show recorded unavailable questions from the
collection report. Explain per-problem outcomes if an import partly fails.
Do not auto-confirm overwrites or perform live imports unless authorized.
