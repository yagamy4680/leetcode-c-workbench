# Problem bundle format

A `problem.json` is a portable JSON object accepted by `POST /api/problems` and
**Import problem**. Its filename does not determine the problem ID. Use
[problem.schema.json](problem.schema.json) for JSON Schema draft-07 structure,
[API.md](API.md) for authentication and overwrite semantics, and
[the fetching skill](../skills/fetch-leetcode-problem/SKILL.md) for authoring.
A complete runnable example is [problem-94.json](../bundles/problem-94.json).

## Validate a downloaded bundle

Run `npm ci` after updating the checkout, then:

```bash
node scripts/validate-problem.mjs bundles/problem-94.json
npm run validate:problem -- bundles/problem-94.json
node scripts/validate-problem.mjs --json bundles/problem-94.json
python3 scripts/export-bundle.py examples/94 | node scripts/validate-problem.mjs -
```

The validator runs offline, does not read credentials or `.env`, does not write
to a workspace, and uses the same validation module as server imports. It
reports JSON Pointer paths and exits with 0 for a valid bundle, 1 for invalid
JSON or data, and 2 for usage, file, or configuration errors. `--json` emits
`{"valid":true,"errors":[]}` or structured errors. `--request` permits the
request-only overwrite confirmation fields; omit them from downloadable files.

## Fields

| Field | Requirement | Meaning |
|---|---|---|
| `manifest` | Required object | Problem metadata and compilation inputs |
| `description` | Required Markdown string | Description, examples, official image links, constraints, ownership |
| `files` | Required object | Flat `.c`/`.h` filenames mapped to complete source text |
| `tests` | Required array, 1–10000 entries | Inputs and expected JSON results |
| `overwrite`, `expectedHash` | Request-only | Explicit replacement consent; see API.md |

Manifest fields `id`, `title`, `slug`, `difficulty`, `topics`, and `url` are
required. `id` is an integer from 1 through 999999; `title` contains non-whitespace
text; `difficulty` is Easy, Medium, or Hard; `topics` is an array of strings.
`slug` and `url` are strings. Authors should use the canonical LeetCode slug and
HTTPS problem URL, although the importer does not validate URL ownership.
`signature` is optional for compatibility, but authored bundles must include the
verified C signature. `sources` defaults to `["main.c"]`; it must include main.c
and only framework `.c` names, excluding names beginning with `solution-`.
`headers` defaults to `[]`. Every listed source/header must appear in `files`.
Use explicit lists when adding local helpers.

`files` requires `main.c`, `solution.h`, and `solution-master.c`. It can contain
at most 64 entries. Names match `^[A-Za-z0-9_-]+\.(c|h)$`; paths, dots in the
stem, and directory traversal are rejected. Each value is a string, at most
1 MiB in UTF-8. Master must also fit after the default debug preamble is added.
The maximum JSON request size is 12 MiB, including JSON escaping and whitespace.
The CLI checks the actual supplied bytes; server imports also check serialized
size while Express enforces the raw HTTP body limit.

Each test requires `id`, `input`, and `expected`. IDs match
`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$` and are unique. Input and expected values can
be any JSON value; the driver defines their problem-specific shape. Optional
`timeoutMs` is an integer from 10 to 60000 (runner default: 2000). Optional
`compare` is exact, unordered, or float (default: exact). Optional `tolerance`
is a finite nonnegative number. Do not use null or empty strings in place of
optional fields; omit them to request defaults.

The schema permits additional metadata/test/top-level fields for compatibility;
unknown fields do not gain runtime behavior. `files` keys remain constrained.
Validation does not coerce values, insert defaults, or alter source text.

## Images and local helpers

Put official illustrations directly in the Markdown string:

```markdown
![Example 1 binary tree](https://assets.leetcode.com/uploads/2024/08/29/screenshot-2024-08-29-202743.png)
```

In the JSON file, Markdown newlines are escaped as `\n`. Images are external
references, not embedded image blobs or a separate top-level `images` array.
Keep original observed HTTPS URLs next to their examples. The browser renders
and sanitizes Markdown, permits HTTPS images, and scales them to the panel.
Schema validation cannot determine whether the original problem had an image,
whether its URL still resolves, or whether a C signature matches LeetCode.

Attach problem-specific structures/adapters as `wb_yyy.c` and `wb_yyy.h` in
`files`, listing them in `sources` and `headers`. These compile from the problem
directory and need no application update. Shared-runtime dependencies require
a compatible application version; adding a shared `.c` file alone does not
change the runner's compilation command.

## Validation layers

The JSON Schema checks types, required fields, patterns, enums, and count/range
limits. The shared validator additionally checks file references, duplicate
case IDs, UTF-8 source size, the master-plus-preamble limit, and bundle size.
Server imports call it before staging, duplicate detection, or overwriting, so
invalid bundles never replace existing problem files. Test edits use the same
test rules. This intentionally rejects formerly tolerated malformed optional
values such as `sources: null` or `compare: ""`; valid existing bundles keep the
same defaults.

Passing validation does not compile C, verify algorithms or driver ownership,
fetch remote images, authenticate, check duplicate workspace IDs, detect active
runs, or authorize replacement. Test the C framework separately and retain the
server's confirmation/hash checks for existing IDs. Imports prepend the current
DBG template only when master lacks its `WB_DEBUG_PREAMBLE` marker; carrying an
existing preamble preserves that embedded version.
