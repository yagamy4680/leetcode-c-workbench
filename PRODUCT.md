# LeetCode C Workbench

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
User-selected Node.js, Bootstrap, Tailwind CSS, Prisma and SQLite; Python, C and Bash for native compilation and tests. No SPA framework.

## Users
A C programmer working on LeetCode problems on a Mac, using a local editor and CLI alongside a browser.

## Product Purpose
Shorten the edit, compile, test and debug loop; expose compiler diagnostics and runtime logs before manual submission to LeetCode.

## Operating Context
Web service and CLI run on the same Mac and share a workspace. The planned HTTPS hostname is leetcode.myab.cc. ChatGPT can import problem bundles through authenticated REST APIs. LeetCode submissions are manual.

## Capabilities and Constraints
Multiple named solutions per problem, typed JSON test cases, sanitizers, immutable run inputs, compile caching, local Git submission snapshots, success/fail and memo recording. Source and tests are files; SQLite holds metadata. The public application repository excludes credentials and personal workspace data.

## Product Principles
- Native tests work even when the web service is stopped.
- The tested version and submitted version are identifiable.
- Debug output never corrupts the answer channel.
- Show unsupported memory checks honestly.
- Preserve local edits and existing problem data.

## Evidence on Hand
User-approved design and three example problem URLs: 1480, 783, and 589. The earlier design's 530 label was corrected from the actual URL; 530 is an equivalent problem with a different function name.
