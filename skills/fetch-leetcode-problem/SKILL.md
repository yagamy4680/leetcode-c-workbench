---
name: fetch-leetcode-problem
description: Retrieve an official LeetCode problem and produce a validated problem.json bundle for this repository's C workbench. Use when asked to fetch, refetch, prepare, or import a LeetCode problem, including its description images, exact C signature, local driver, TODO solution, and test cases.
---

# Fetch a LeetCode problem

Produce a complete C workbench bundle, not a solved algorithm. Keep documentation,
problem descriptions, and code comments in English. Follow an explicit request
for a completed solution only when the user asks for one.

## Load the local contract

Resolve the repository root relative to this file: `../..`.
Read [the bundle format](../../docs/problem-bundle.md),
[the schema](../../docs/problem.schema.json), and
[the API contract](../../docs/API.md). Inspect current `runtime/` helpers,
`templates/solution-preamble.c`, and the closest example driver. Treat the
shared validator in `server/problem-bundle.mjs` as the import rules authority.

## Retrieve official evidence

1. Open the user-supplied problem URL on `leetcode.com`; record the canonical
   problem ID, title, slug, difficulty, topics, description, examples,
   constraints, and follow-up. Do not infer the ID from a similar problem.
2. Retrieve official metadata including `similarQuestions`. The reusable helper
   `python3 scripts/fetch-leetcode-question.py <url> --output-dir <staging>/sources`
   supplies raw official evidence and normalized `workbenchSimilarQuestions`.
   Copy those references to `manifest.similarQuestions`; resolve frontend IDs
   when possible and omit unknown IDs rather than guessing. Retain verified
   titles, slugs, canonical HTTPS URLs, difficulties, and premium flags.
3. Retrieve the official C starter snippet, including the function signature
   and platform-provided structures. Use the rendered code selector or the
   public official GraphQL `question(titleSlug: ...)` fields `codeSnippets`,
   `content`, and metadata when available. Prefer `langSlug: "c"`. Do not use
   third-party solutions as the signature authority. If the C snippet is
   unavailable, identify the gap and request the snippet rather than invent it.
4. Inspect the original description HTML and its image `src` attributes, or
   follow the image links exposed by retrieval. Retain every important example
   image or diagram next to its associated example as Markdown:

   ```markdown
   ![Example 1 binary tree](https://assets.leetcode.com/uploads/2024/08/29/screenshot-2024-08-29-202743.png)
   ```

   Use the observed original HTTPS URL and descriptive alt text. Do not guess
   filenames or replace a diagram with a prose-only summary. Verify that the
   image link resolves where tool access permits. Report unavailable assets.
   Do not embed cookies, passwords, or authenticated URLs. Retain readable
   examples, code, formulas, constraints, and the original problem link; use
   concise English paraphrases while preserving the technical requirements.
5. Keep official examples separate from additional locally designed tests.
   Check expected values manually or with a test-only reference implementation.
   Do not claim hidden-test coverage or native Mac verification without evidence.

## Build a self-contained framework

Create `manifest.json`, `description.md`, `solution.h`, `main.c`,
`solution-master.c`, and `tests.json` in an authoring directory, normally
`examples/<id>/` when the user requests repository changes.

- Preserve the exact official C function signature. Put platform structure
  definitions and local standard includes in `solution.h` or local headers.
- Keep the solution as a compiling TODO starter. Return an appropriate empty
  or sentinel result and suppress unused-argument warnings where necessary.
  Keep JSON parsing, `main()`, and workbench helpers out of the solution.
- Read input JSON from `argv[1]` and write the serialized answer to `argv[2]`.
  Reserve stdout/stderr for logs; never use stdout as the answer channel.
- Document ownership of inputs and outputs. Free driver-owned nodes and returned
  heap allocations according to the actual problem contract; support aliasing
  only where the contract permits it. Handle empty inputs and malformed driver
  inputs without masking sanitizer failures.
- Reuse existing runtime types only when they match the official snippet.
  Attach new data structures and JSON adapters as problem-local `.c`/`.h` files
  so import works without an application update. Add every compiled helper to
  `manifest.sources` and every exported local header to `manifest.headers`.
  Keep filenames flat; `main.c` must be a source and `solution-*.c` must not.
  The runner compiles listed local sources, the selected solution, and `wb.c`;
  merely placing a new `.c` in `runtime/` does not compile it automatically.
- If a shared runtime or runner change is essential, complete and validate that
  change, publish it when authorized, and state that the Mac must update before
  import. Do not silently depend on an unpublished helper.
- Let import prepend the current `templates/solution-preamble.c` to master.
  Do not invent another DBG implementation. Keep the template marker when
  carrying an existing preamble so it is not duplicated. Explain that existing
  prefixed bundles retain their embedded prefix rather than receiving a refresh.
- Include official examples and relevant empty, minimal, duplicate, negative,
  skewed, and maximum-size cases within the official constraints. Select exact,
  unordered, or float comparison according to the problem's actual semantics.

## Export and validate

From the repository root:

```bash
python3 scripts/export-bundle.py examples/<id> > bundles/problem-<id>.json
node scripts/validate-problem.mjs bundles/problem-<id>.json
```

Use `--json` for machine-readable diagnostics. Fix every reported error and
rerun validation. Do not store overwrite consent fields in the artifact.
Open the final JSON again; verify its `description` contains the observed
Markdown image links and that helper contents are included in `files`.

Treat successful schema validation as a format check, not proof of correct C.
Compile and execute the driver in an isolated temporary workspace. Use a
reference solution only in temporary tests or test fixtures, leaving the
published starter incomplete. Check normal cases, memory ownership, empty
results, and timeout behavior as relevant. Record a TODO starter's expected
wrong-answer result separately from a compile or driver failure. Report
unavailable sanitizer capabilities explicitly.

## Deliver or import

- Save a fresh, identifiable JSON filename or provide a GitHub link pinned to
  the published commit, especially after refetching an existing problem.
  Link the actual verified artifact; do not claim images were included without
  checking its final `description` field.
- Import to a live workbench only when the user authorizes it and a supported
  authenticated tool is available. Never ask for passwords in chat, read `.env`
  credentials into tool output, or put credentials in URLs or command arguments.
  When access is blocked, deliver the validated bundle and state that live
  import has not happened.
- For an existing ID, follow the UI/server confirmation workflow. Explain that
  overwrite replaces description, tests, framework, and all solution variants;
  the previous directory is backed up while run/submission history remains.
  Never put `overwrite: true` into a generated download to bypass confirmation.
  Use only a fresh server-provided `expectedHash` after explicit consent.
- State what was fetched, images retained, validation and native test results,
  runtime prerequisites, and whether the live import actually completed.

For a ZIP of the seed's direct Similar Questions, follow
[fetch-similar-leetcode-problems](../fetch-similar-leetcode-problems/SKILL.md)
instead of recursively fetching every related link.
