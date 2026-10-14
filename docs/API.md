# REST API

All endpoints require HTTP Basic Auth, including static files. Use HTTPS at `leetcode.myab.cc`; direct localhost access is for the Mac itself. Use the same credentials as the browser. Do not put credentials into public import bundles or Git commits.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Authenticated health check |
| GET | `/api/doctor` | Compiler and sanitizer probe; `?refresh=1` repeats it |
| GET | `/api/problems` | Filtered problems, accepted status, normalized tags, solutions, latest run |
| GET | `/api/tags` | Active topic tags and problem counts |
| PATCH | `/api/problems/:id` | Set manual problem-level `{accepted: true/false}` |
| POST | `/api/problems` | New problem import or explicitly confirmed replacement |
| GET | `/api/problems/:id` | Metadata, markdown, tests/hash, recent history |
| GET | `/api/problems/:id/solutions/:name` | Code and hash |
| GET | `/api/problems/:id/solutions/:name/events` | SSE current hash and disk-change notifications |
| PUT | `/api/problems/:id/solutions/:name` | Save `{code, expectedHash}` |
| POST | `/api/problems/:id/solutions` | Clone `{name, from}`; from defaults to master |
| POST | `/api/problems/:id/tests` | Append `{test, expectedHash}` without replacing prior cases |
| PUT | `/api/problems/:id/tests` | Save `{tests, expectedHash}` |
| POST | `/api/problems/:id/run` | NDJSON event stream |
| GET | `/api/runs/:runId` | Complete run report |
| GET | `/api/runs/:runId/source` | Exact tested solution source |
| GET | `/api/runs/:runId/logs` | Compiler log, or `?case=name&stream=stdout` |
| POST | `/api/problems/:id/submissions` | Prepare `{solution, sourceHash}` snapshot |
| GET | `/api/submissions/:id/code` | Source read from immutable Git commit |
| PATCH | `/api/submissions/:id` | Record `{result, memo}`; pending/success/fail |

Source and test updates without expectedHash return 428; stale hashes return 409. Import filenames are basenames ending in `.c` or `.h`; path traversal and symlinks are rejected. JSON request limit is 12 MiB; individual source limit is 1 MiB. Browser cross-site mutation requests are blocked.

## Problem bundle

See [problem-bundle.md](problem-bundle.md) for field rules, [problem.schema.json](problem.schema.json) for JSON Schema, and `node scripts/validate-problem.mjs problem.json` for offline validation. Server imports use the same schema and semantic validator.

ChatGPT should obtain the actual C snippet/signature, create the driver and helpers, then submit one complete bundle. The workbench does not guess signatures or automatically solve the problem. The browser Import problem accepts the same JSON as POST.

```json
{
  "manifest": {
    "id": 1480,
    "title": "Running Sum of 1d Array",
    "slug": "running-sum-of-1d-array",
    "difficulty": "Easy",
    "topics": ["Array", "Prefix Sum"],
    "url": "https://leetcode.com/problems/running-sum-of-1d-array/description/",
    "signature": "int* runningSum(int* nums, int numsSize, int* returnSize);",
    "sources": ["main.c"],
    "headers": []
  },
  "description": "# 1480. Running Sum of 1d Array\n...",
  "files": {
    "solution.h": "/* Exact prototype, standard headers and problem types. */",
    "main.c": "/* Read argv[1] as JSON, write result JSON to argv[2]. */",
    "solution-master.c": "/* C starter implementation. */"
  },
  "tests": [
    { "id": "example1", "input": { "nums": [1,2,3,4] }, "expected": [1,3,6,10] }
  ]
}
```

On import, `solution-master.c` receives the default debug preamble unless its `WB_DEBUG_PREAMBLE` marker is already present. This becomes part of the solution and submission source. Existing problem IDs require explicit overwrite confirmation. Local helper files can make a bundle self-contained; updating shared runtime helpers requires updating the application first.

The above file contents are explanatory placeholders, not compilable C. Create a runnable bundle from a shipped example:

```bash
python3 scripts/export-bundle.py examples/1480 > /tmp/problem-1480.json
```

Additional framework `.c` files belong in manifest.sources; additional local `.h` files belong in manifest.headers. Shared runtime helpers are versioned in the application GitHub repo. A helper update and app pull must precede an import which requires that helper.

## Replacing an existing problem

The initial POST returns 409 with `code: "problem_exists"`, the existing problem `id`, and an `expectedHash` covering its directory contents. After user confirmation, repeat the complete bundle with two request-only fields:

```json
{
  "overwrite": true,
  "expectedHash": "hash-from-the-conflict-response",
  "manifest": {},
  "description": "...",
  "files": {},
  "tests": []
}
```

These are schematic placeholders, not a valid bundle. Missing confirmation hash returns 428. Changed or removed problem contents return 409 with `code: "problem_changed"`; obtain a fresh conflict and confirm again. Active web runs block replacement; finish CLI runs first. The browser ignores confirmation fields in uploaded JSON and always asks the user when the server reports a duplicate.

Validation and staging finish before replacement. The previous directory is renamed into `$WB_DATA_DIR/import-backups/`, then the staged directory is installed. A failed installation restores the previous directory. Success returns 200 with `{id, overwritten: true, backupPath}`; fresh imports return 201 with `{id, overwritten: false}`. `backupPath` is relative to the workspace. Replacement installs exactly the bundle's files, removing old variants from the active problem and SQLite solution index. Original variants remain in the backup. Run records, captured sources, and submission snapshots are retained. Backups have no automatic expiration.

## Description images

When preparing bundles, retain important diagrams and example illustrations as Markdown images with their original official HTTPS asset URLs and descriptive alt text. Put each image next to its corresponding example. For example:

```markdown
![Example 1 binary tree](https://assets.leetcode.com/uploads/2024/08/29/screenshot-2024-08-29-202743.png)
```

The description renderer already supports Markdown images and sanitizes HTML. CSP permits HTTPS images, and images fit the description panel width. These are external references; viewing them requires access to the asset host. Do not invent asset URLs or embed authentication credentials.

For authenticated curl, prefer a private netrc file instead of putting the password into shell history. For example, with credentials already configured in `~/.netrc-workbench` (mode 600):

```bash
curl --netrc-file ~/.netrc-workbench \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/problem-1480.json \
  https://leetcode.myab.cc/api/problems
```

## Run stream

Request: `{ "solution": "master", "mode": "debug", "case": "example1", "sourceHash": "..." }`. Omit case for all cases. mode can be debug or perf. sourceHash protects against local edits before the runner captures its source.

Each output line is a JSON event: `start`, `command` (argv and shell-quoted text, without ANSI), `log` (stream/case/text), `message`, `case`, `done` (run report), or `error`. A test failure still uses a successful HTTP response; inspect done.run.status. Connection loss does not cancel the native job; recover the report from History after completion.

Each case's default timeout is 2000 ms, adjustable from 10–60000 ms. Each process's logs are capped at 2 MiB; the live browser view retains the last 250000 characters, while stored logs can be selected separately.

## Snapshot semantics

Preparing a submission returns the exact code, sourceHash, commitSha, optional matching runId, and testStatus. It does not submit to LeetCode. A matched run uses a digest of the complete captured context, not just the solution file. Success/fail and memo are user-entered LeetCode outcomes; local tests retain their own status.

## Source change events

`GET /api/problems/:id/solutions/:name/events` requires the same Basic Auth as other endpoints. It returns `text/event-stream`, immediately sending `data: {"hash":"..."}` and sending the current content hash on subsequent changes. A null hash means the file is missing or no longer a safe regular workspace file. Heartbeat comments keep idle streams alive. Reconnects receive the current hash; clients fetch the source from the normal solution endpoint rather than treating an event as source content.

Only solutions with active subscribers are watched. Directory watchers handle atomic replacement saves; a one-second polling fallback covers missed events. Disconnecting the last subscriber releases its watcher and timers. Proxies must stream responses rather than buffer them. Caddy's supplied reverse proxy configuration supports SSE.

## Append a LeetCode testcase

`POST /api/problems/:id/tests` accepts one `{test, expectedHash}`. The test has
`id`, `input`, `expected`, and optional comparison/timeout settings. The server
reads existing tests, validates the combined list, and atomically saves it only
if the current file hash matches. It returns 201 with `{hash}`. Duplicate IDs
or invalid cases return 400, a missing hash returns 428, and stale hashes return
409 without replacing any existing case. This uses the same test rules as bulk
PUT updates and problem imports. The browser's **Tests → Add case** form sends
only the new case, infers container/value types from saved examples, and keeps
pasted data on errors. Input inference is guidance, not a problem-specific C
input schema or a correctness check.

## Problem search, accepted status, and tags

`GET /api/problems` accepts optional `q`, `accepted`, and repeated `tags` query
parameters. `q` matches title text or an exact numeric ID. `accepted` must be
`true` or `false`; omitting it includes both. Tag names are trimmed, case-sensitive
canonical names; every selected tag must match (AND). Unknown tags match no
problems. Search and accepted filters combine with the tag filters.

```text
/api/problems?q=tree&accepted=false&tags=Tree&tags=Depth-First%20Search
```

Search strings are limited to 200 characters. Up to 100 nonempty tag names of
128 characters each can be provided. Invalid query types/values return 400.
List and detail responses contain `accepted` and a flat `tags: [{id, name}]`
array. The legacy serialized `topics` field is retained. `GET /api/tags` returns
`[{id, name, count}]`, sorted by name, for tags linked to at least one indexed
problem; counts are global rather than limited by the active search.

`PATCH /api/problems/:id` requires `{accepted: boolean}` and returns `{id,
accepted}`. It uses the normal Basic Auth and cross-origin write protections.
This is user-owned SQLite metadata: indexing and overwrite imports preserve it.
Local run outcomes and submission outcomes do not automatically set it. Repeated
manual changes use the last successful update. Clearing the mark does not delete
history. Problem imports cannot assign accepted status from bundle metadata.

The explicit `Tag`/`ProblemTag` tables enforce unique topic names and unique
problem/tag pairs. `ProblemTag(tagId, problemId)` and `Problem(accepted, id)`
indexes support filtering. On startup, recognized legacy workbench databases
receive an additive, transactional upgrade and topic backfill. Personal sources
and histories are not rewritten; unrelated or incomplete schemas still fail
startup rather than being reset.
