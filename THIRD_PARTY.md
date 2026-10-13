# Third-party code

`runtime/vendor/jsmn.h` and `runtime/vendor/LICENSE-jsmn` come from [zserge/jsmn](https://github.com/zserge/jsmn), distributed under the MIT license. The vendored bytes are fixed by this repository's commit; native tests need no network downloads.

Bootstrap, Tailwind CSS, Express, Prisma, Prism, marked, DOMPurify and dotenv are installed through the committed npm lockfile. Their licenses remain in node_modules. Browser assets are served locally, without CDN dependencies.

Initial problem descriptions are short paraphrases with links to the original LeetCode pages. The example test values follow those pages. Reference implementations in tests are fixtures used to verify the harness; editable starter solutions contain TODOs.
