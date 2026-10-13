# Mac deployment

The application and CLI must use the same checkout, `.env` and external workspace.

1. Complete the root README's setup and `./wb.sh doctor`.
2. Start Node.js with `npm start`, or use your existing process manager with the checkout as its working directory. Use the absolute executable path for Node.js and for PYTHON/CC when a service has a different PATH from your terminal.
3. Add `Caddyfile.example` to your existing Caddy configuration. DNS and incoming HTTPS traffic must reach this Mac. The example does not replace the current Caddyfile.
4. Verify HTTPS login, open a starter problem, edit a solution and run a single test.
5. Stop Node.js temporarily and confirm `./run-test.sh` still works. Restart it and check the CLI run appears in History.

Node.js defaults to 127.0.0.1:3089. Basic Auth credentials stay in the ignored `.env`. Public repository updates only replace application code; they leave the external workspace intact.

For upgrades: pull application changes, run `npm ci`, run `npm run setup`, then restart Node.js. Setup adds missing example directories only; it never overwrites an existing example solution. Back up the workspace before schema changes.
