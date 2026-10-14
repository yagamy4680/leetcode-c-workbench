# Similar questions and ZIP collections

## Related-question metadata

Add optional `manifest.similarQuestions` to any problem bundle:

```json
{
  "similarQuestions": [
    {
      "id": 144,
      "frontendId": "144",
      "title": "Binary Tree Preorder Traversal",
      "slug": "binary-tree-preorder-traversal",
      "url": "https://leetcode.com/problems/binary-tree-preorder-traversal/",
      "difficulty": "Easy",
      "isPaidOnly": false
    }
  ]
}
```

This fragment belongs inside `manifest`. Title, slug, canonical URL, and
Easy/Medium/Hard difficulty are required per entry. Numeric `id`, official
`frontendId`, and `isPaidOnly` are optional; omit identifiers that could not be
verified. At most 100 unique slugs are allowed. URL and slug must agree. Omit the
field for older/unknown data; use an empty array when the official list is empty.
The existing validator and server import enforce the same rules. Metadata stays
in `manifest.json` and is returned in the detail API, with no database reset.
The Description tab shows links; a premium flag describes the official listing,
not an entitlement to fetch restricted content.

## Collect and author a ZIP

Follow [the collection skill](../skills/fetch-similar-leetcode-problems/SKILL.md).
The source helper uses public official GraphQL requests and accepts a canonical
URL or slug:

```bash
python3 scripts/fetch-leetcode-question.py \
  https://leetcode.com/problems/binary-tree-preorder-traversal/ \
  --collection --output-dir /tmp/collection/sources
```

It writes official question source records, `seed-question.json` preserving
the seed's original target list, and `collection-source.json`. Targets with the
same verified numeric ID are marked `duplicate` with `duplicateOf`, so source
files cannot silently overwrite each other and only one bundle is authored.
The collection includes direct Similar Questions only; the seed is excluded
unless `--include-seed` is given. Metadata resolution may inspect additional
related links without adding their problems to the target collection. The
helper does not synthesize drivers, solutions, tests, or claim that raw official
JSON is an importable workbench bundle. Exit 1 reports unavailable targets or
partial source failures. Continue available targets with the skill and preserve
an explicit completeness report. Normal single-question fetching uses the same
helper without `--collection`.

Author and validate one `problem-<id>.json` for every available target, then:

```bash
python3 scripts/package-problems.py /tmp/collection/bundles /tmp/similar-questions.zip
npm run validate:zip -- /tmp/similar-questions.zip
```

A ZIP may contain flat `problem-94.json` names or safe nested directories with
`problem.json` / `problem-94.json`. A numeric filename must match manifest.id.
Each file is a complete independent bundle, not a shared array of manifests.
The optional `_collection.json` report records `seedUrl`, `scope`,
`includesSeed`, `included`, `unavailable: [{slug, reason}]`, and `complete`.
The import preview displays unavailable entries. The report is never imported
as a problem. macOS `.DS_Store` and `__MACOSX` metadata are ignored. Other
unexpected files, duplicate paths/IDs, absolute/traversal paths, symlinks,
encrypted entries, invalid JSON, and invalid bundles are rejected.

Limits are 100 bundles, 300 archive entries, 32 MiB compressed, 64 MiB expanded,
and 12 MiB per JSON. Existing per-source and preamble limits still apply. The
reader inspects entries without extracting archive paths. Validation does not
compile C or verify remote image availability; authoring must test each driver.
Use multiple numbered ZIPs when a complete collection exceeds these limits.

## Batch import API and UI

Open **Import problem → Batch import a ZIP**, choose a file, and click
**Preview ZIP**. Every bundle is validated before any writes. New IDs default
to Import; existing IDs default to Skip. Select Overwrite only for intended
replacements, then **Import selected**. The confirmation names replacement of
all solution variants. The current editor and unsaved text remain open; disk
updates use the existing conflict notification behavior.

`POST /api/imports/preview` accepts raw `application/zip` or
`application/octet-stream`, with normal Basic Auth and origin protections.
It returns `{token, expiresAt, collectionReport, problems:[{id,title,difficulty,
path,existing}]}`. Previews live in memory for ten minutes; at most three are
retained and old previews may be evicted. Restarting the service expires them.
The ZIP cannot supply trusted overwrite consent or confirmation hashes.

`POST /api/imports/commit` accepts JSON:

```json
{
  "token": "token-returned-by-preview",
  "items": [{"id": 94, "action": "overwrite"}, {"id": 144, "action": "import"}],
  "confirmedOverwrite": true
}
```

Provide exactly one import/skip/overwrite action for each preview item.
Existing IDs require skip or overwrite; new IDs require import or skip.
Missing overwrite confirmation returns 428. Changed disk contents or active
web runs reject the preflight with 409 before batch writes. Expired or consumed
tokens return 410. Finish CLI runs before replacing their problem files.

After preflight, selected problems import sequentially. A preview is consumed
once; do not retry its commit automatically. Each item uses the existing
atomic import and backup behavior, and checks its hash again when replacing.
Accepted marks, run records, and submission snapshots are preserved. The
response is `{results:[{id,status,...}]}`, where status is imported, skipped,
or failed. Imported replacements include `backupPath`; an indexing failure
sets `indexPending` so a later refresh can retry. Later filesystem errors or
external edits may produce partial outcomes: successfully imported items stay
imported, and every item has a result. The batch is not a cross-problem database
transaction. On a lost response, preview again to inspect the workspace rather
than assuming nothing was written.
