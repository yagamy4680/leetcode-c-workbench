# REST API

All endpoints require HTTP Basic Auth, including static files. Use HTTPS at `leetcode.myab.cc`; direct localhost access is for the Mac itself. Use the same credentials as the browser. Do not put credentials into public import bundles or Git commits.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Authenticated health check |
| GET | `/api/doctor` | Compiler and sanitizer probe; `?refresh=1` repeats it |
| GET | `/api/problems` | Indexed problems, solutions, latest run |
| POST | `/api/problems` | Atomic new problem import; existing ID returns 409 |
| GET | `/api/problems/:id` | Metadata, markdown, tests/hash, recent history |
| GET | `/api/problems/:id/solutions/:name` | Code and hash |
| GET | `/api/problems/:id/solutions/:name/events` | SSE current hash and disk-change notifications |
| PUT | `/api/problems/:id/solutions/:name` | Save `{code, expectedHash}` |
| POST | `/api/problems/:id/solutions` | Clone `{name, from}`; from defaults to master |
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

On import, `solution-master.c` receives the default debug preamble unless its `WB_DEBUG_PREAMBLE` marker is already present. This becomes part of the solution and submission source. Existing problem IDs are never overwritten. Local helper files can make a bundle self-contained; updating shared runtime helpers requires updating the application first.

The above file contents are explanatory placeholders, not compilable C. Create a runnable bundle from a shipped example:

```bash
python3 scripts/export-bundle.py examples/1480 > /tmp/problem-1480.json
```

Additional framework `.c` files belong in manifest.sources; additional local `.h` files belong in manifest.headers. Shared runtime helpers are versioned in the application GitHub repo. A helper update and app pull must precede an import which requires that helper.

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
