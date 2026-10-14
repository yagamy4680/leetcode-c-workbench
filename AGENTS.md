# Repository agent guidance

Write README text, documentation, descriptions, skill instructions, and code comments in English.

For fetching, refetching, or preparing LeetCode problems and workbench JSON bundles, read and follow `skills/fetch-leetcode-problem/SKILL.md`. Use `docs/problem.schema.json` and `scripts/validate-problem.mjs`; keep the CLI and server import validation aligned through `server/problem-bundle.mjs`.

For a collection of a seed problem's direct Similar Questions and a ZIP of independent bundles, follow `skills/fetch-similar-leetcode-problems/SKILL.md`. Store related-question metadata in `manifest.similarQuestions`, validate each bundle, and validate the completed archive.

Preserve important official problem images as Markdown image references. Keep solutions as TODO starters unless a completed solution is explicitly requested. Keep personal workspaces and credentials outside this repository.
