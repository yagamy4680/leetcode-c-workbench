# LeetCode C Workbench

A C practice workbench running on a single Mac. The local editor, CLI, and web interface share solutions and tests. ASan and UBSan are enabled by default, with complete compiler diagnostics, `printf` output, and sanitizer logs. Test locally before submitting manually to LeetCode.

## Mac installation

Requires Node.js 20.19 or later, Python 3.9 or later, Git, and a C compiler supporting ASan and UBSan. Node.js 22 and 24 LTS are supported.

```bash
xcode-select --install
git clone https://github.com/yagamy4680/leetcode-c-workbench.git
cd leetcode-c-workbench
npm ci
cp .env.example .env
# Edit .env: set WB_DATA_DIR outside the checkout, such as ~/leetcode-workspace.
npm run setup
./wb.sh doctor
npm start
```

Open `http://127.0.0.1:3089`. Setup generates credentials for empty Basic Auth settings and saves them in **`.env`** without printing or committing them. Setup preserves existing problems and solutions. Restart the server after changing `.env`; the CLI reads it on each invocation.

The starter problems are **94, 1480, 783, and 589**. Each `solution-master.c` contains TODOs; failing tests are expected until you implement a solution. Minimum Distance Between BST Nodes is problem **783**; the equivalent problem 530 has a different function name.

Before listening, the server prints the workspace and SQLite paths and checks the four required tables. An empty database is initialized automatically, and missing examples are seeded without replacing existing solutions. A nonempty database with missing tables stops startup with instructions to check the path and run `npm run setup`; it is never reset automatically.

For `P2021: main.Problem does not exist`, stop the server, run `npm run setup`, and restart. Confirm that setup and startup print the same SQLite path. The default is `$WB_DATA_DIR/workbench.db`. A custom SQLite `DATABASE_URL` is normalized to the same absolute path for setup and runtime. Relative database URLs resolve against `prisma/`; relative `WB_DATA_DIR` paths resolve against the application checkout, regardless of the working directory.

## Local workflow

Problems live in `$WB_DATA_DIR/problems/<id>/`. Edit `solution-master.c` with your preferred editor or the web interface.

```bash
./run-test.sh 94
./run-test.sh 1480
./run-test.sh 589 non-recursive
./run-test.sh 589 non-recursive --case example1
./run-test.sh 589 non-recursive --watch
./run-test.sh 1480 --mode perf
./wb.sh doctor --refresh
./wb.sh snapshot 1480 master
```

Names such as `master` and `non-recursive` identify solution files, not Git branches. Use **New variant** in the web interface or copy a solution to `solution-<name>.c` in the problem directory.

You can also use `make run PROBLEM=589 SOLUTION=non-recursive MODE=debug`. Run `make help` for other entry points.

While the web server is running, changes to the selected `solution-*.c` file are pushed to the browser through an authenticated SSE connection. The server watches the containing directory to handle atomic editor saves and checks once per second as a fallback. A clean editor updates automatically, retaining its selection and scroll position. Unsaved browser edits are preserved with a disk-change warning; copy them before choosing **Reload from disk**. Updates arriving during saving, loading, testing, or snapshot preparation are deferred. Reconnection checks the current disk hash again.

CLI tests require neither the Node.js server nor SQLite. The server imports completed CLI runs when running or restarting; run IDs prevent duplicate records.

Exit codes: `0` for all tests passing, `1` for compilation or test failure, `2` for configuration or framework errors, and `130` for user interruption.

## Testing and debugging

Debug mode uses GNU11, `-O1 -g`, warnings, ASan, UBSan, and frame pointers. Performance mode uses `-O2` with sanitizers disabled. Set `CC` to select a compiler; otherwise, the runner prefers `clang`, then `cc`. `CC` must be an executable path, without additional flags.

`doctor` compiles and runs probes to verify sanitizer capabilities. LeakSanitizer is tested with a known leak; an unchecked capability is never reported as working. If Apple Clang cannot run the leak probe on your Mac, you can install upstream LLVM, set `CC` to its absolute `clang` path, and run `doctor --refresh`. ASan, UBSan, and leak detection are reported separately.

Each test case runs in a separate C process with a timeout, process-group cleanup, and bounded logs. A crashing case does not prevent later cases from running. The runner compiles once and reuses the binary across cases. Changes to code, headers, helpers, compiler, or flags trigger rebuilding; changing only tests does not.

```json
[
  {
    "id": "example1",
    "input": { "nums": [1, 2, 3, 4] },
    "expected": [1, 3, 6, 10],
    "timeoutMs": 2000,
    "compare": "exact"
  }
]
```

Comparison modes are `exact`, `unordered` (outermost arrays only, preserving duplicates), and `float` (with configurable tolerance). Each `input` must match the fields expected by the problem driver.

Before compiling, the CLI prints the complete compiler command, including executable, flags, source files, forced headers, and output path. Paths containing spaces are quoted. Commands appear in bold cyan on a terminal and plain text when redirected or piped. Use `FORCE_COLOR=1` to force color or `NO_COLOR=1` to disable it. JSON events contain no ANSI sequences, and web **Live output** also shows the command. Cache hits do not print a command that was not executed.

All web `solution-*.c` editors use dark C syntax highlighting for keywords, comments, strings, numbers, and functions. Editing and copying use a native textarea, with line numbers, horizontal and vertical scrolling, and error-line navigation. Prism and its C grammar are served locally without a CDN.

Answers are written to a separate JSON file; stdout and stderr remain available as logs, so you can debug with `printf()`. Output is unbuffered by default. Results distinguish compilation failure, wrong answer, memory error, memory leak, undefined behavior, runtime error, driver error, timeout, and output limit.

Every run preserves a source copy and hash. Web **Tested source** shows the version actually tested. Error-line buttons navigate the editor when its version matches the tested source. You can also use LLDB directly:

```bash
# Read buildHash from runs/<run-id>/result.json; case paths are also preserved.
ASAN_OPTIONS=detect_leaks=0 lldb -- \
  "$WB_DATA_DIR/builds/<buildHash>/program" \
  "$WB_DATA_DIR/runs/<run-id>/cases/<case-id>/input.json" \
  "$WB_DATA_DIR/runs/<run-id>/cases/<case-id>/debug-result.json"
```

Here, `WB_DATA_DIR` must be a shell variable containing the actual workspace path; `.env` does not automatically export terminal variables. Disabling leak detection for the debugger does not change the original test record.

## Framework and ownership

New REST/web imports and newly seeded example problems prepend [templates/solution-preamble.c](templates/solution-preamble.c) to `solution-master.c`. Existing workspace solutions are preserved. The prefix stays in submission snapshots and copied LeetCode code. Debug mode defines `DEBUG`, enabling `DBG()` output on stderr with file, line, and function; performance mode and ordinary LeetCode compilation leave it disabled. The disabled macro does not evaluate arguments. Both `DBG("message\n")` and `DBG("value=%d\n", value)` are supported using the GNU11 variadic-macro extension. Cloned variants inherit the prefix from their source.

Each problem includes at least `manifest.json`, `description.md`, `solution.h`, `main.c`, `solution-master.c`, and `tests.json`.

Python orchestrates runs. A thin C driver parses JSON, calls the solution, serializes the answer, and cleans up. Shared helpers support integers, integer arrays, binary trees, N-ary trees, and linked lists. Each problem chooses its own `struct Node` definition; it is not a universal type. Other structures require additional problem drivers or helpers.

Solution files retain the LeetCode signature and contain no `main()`, JSON parsing, or workbench helper dependencies. The local framework supplies standard headers and structure definitions. Copy only the solution for submission; any custom algorithm helpers needed by the solution belong in that file.

Each driver defines ownership explicitly. Problem 1480 accepts either a newly allocated result or the original input array without double-freeing it. Drivers own the input nodes for 94, 783, and 589; drivers free the newly allocated output arrays for 94 and 589. List and tree allocation registries release original input nodes even if links are changed. Problems whose solutions free input nodes or return new nodes need a matching cleanup contract and driver.

## Submission

Web **Prepare submission snapshot** fixes a Git commit before showing code to copy. After manually submitting to LeetCode, record pending, success, or fail with an optional memo. Later edits do not change earlier records; reopening a submission retrieves its code from the original commit.

Local test association requires identical **solution, framework, helpers, metadata, and tests**. The same code with changed tests is marked untested. SQLite stores metadata, run summaries, submission outcomes, and commit references, rather than editable code blobs.

`./wb.sh snapshot` creates a local Git snapshot while the web server is stopped and prints JSON containing the code and commit. CLI snapshots archive Git files; snapshots created through the web or REST API also create SQLite submission records.

## Data and the public repository

```text
Application checkout: server/, runner/, runtime/, examples/, web/
External workspace:  problems/, runs/, builds/, snapshots/, workbench.db
```

Personal solutions and credentials stay outside the application repository. The snapshot Git repository has no remote by default. Application updates preserve existing personal problem directories. Back up the entire workspace, including SQLite and the snapshot Git repository; stopping the service simplifies backups.

This is a single-user workbench for running C code you trust. The native runner uses the current macOS user's permissions. All web pages and API endpoints require Basic Auth. Use an HTTPS reverse proxy for public access; Node.js listens on loopback by default.

## REST API and deployment

See [docs/API.md](docs/API.md) for endpoints and the import format, and [deploy/Caddyfile.example](deploy/Caddyfile.example) for a Mac reverse proxy example. Configure DNS, Caddy, and a Mac startup service to use `https://leetcode.myab.cc`. This repository does not modify existing Caddy configuration.

To import problem 94 into an existing deployment without restarting it, load [bundles/problem-94.json](bundles/problem-94.json) in **Import problem**. You can also regenerate the bundle:

```bash
python3 scripts/export-bundle.py examples/94 > /tmp/problem-94.json
```

Sign in to your workbench, open **Import problem**, and paste the JSON bundle. Importing an existing ID is rejected to preserve its files. Alternatively, `npm run setup` seeds missing examples after updating the checkout.

Keep `WB_USER` and `WB_PASSWORD` in your local ignored `.env`, protected with `chmod 600 .env`. Never paste passwords into chat or include them in URLs, command arguments, bundles, or Git commits. For API access from your Mac, `curl --user "$WB_USER"` prompts privately for the password; do not append it to the argument. Browser credential collection requires a supported secure authentication flow; this application's HTTP Basic Auth is not an HTML login form.

## Development and verification

```bash
npm ci
npm test
npm audit
npm run build:css
```

Tests use temporary workspaces without changing personal data. Coverage includes the four example drivers, variants, compilation caching, immutable run sources, separate stdout logs, ownership, compiler and sanitizer errors, timeouts, Git snapshots, Basic Auth, source conflicts, REST imports, web streaming, submissions, and offline CLI run imports.

Leak tests run only when the host probe succeeds; unsupported or restricted environments explicitly skip them. The native runner and API have been integration-tested on Linux. Native Mac compiler behavior, LLDB, and browser layout still require validation on your Mac. Passing local tests does not cover all LeetCode hidden tests.
