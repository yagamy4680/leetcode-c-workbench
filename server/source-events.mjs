import fs from 'node:fs';
import path from 'node:path';
import { hash, solutionFile } from './workspace.mjs';

// Watch directories so editor saves that replace an inode remain observable.
export function createSourceEvents() {
  const channels = new Map();
  function subscribe(id, variant, res) {
    const file = solutionFile(id, variant);
    const key = `${id}/${variant}`;
    let channel = channels.get(key);
    if (!channel) {
      const current = () => {
        try { return hash(fs.readFileSync(solutionFile(id, variant))); }
        catch (error) { if (error.code === 'ENOENT' || error.status === 404 || error.status === 400) return null; throw error; }
      };
      channel = { clients: new Set(), hash: current() };
      channel.send = client => {
        if (!client.write(`data: ${JSON.stringify({ hash: channel.hash })}\n\n`)) client.end();
      };
      const check = () => {
        try {
          const next = current();
          if (next === channel.hash) return;
          channel.hash = next;
          for (const client of channel.clients) channel.send(client);
        } catch (error) { console.error('Source watcher:', error.message); }
      };
      const changed = () => {
        clearTimeout(channel.debounce);
        channel.debounce = setTimeout(check, 60);
      };
      try {
        channel.watcher = fs.watch(path.dirname(file), (event, filename) => {
          if (!filename || String(filename) === path.basename(file)) changed();
        });
        channel.watcher.on('error', () => { channel.watcher.close(); });
        channel.watcher.unref();
      } catch { /* The polling fallback also covers unavailable filesystem watchers. */ }
      channel.poll = setInterval(check, 1000);
      channel.poll.unref();
      channel.heartbeat = setInterval(() => {
        for (const client of channel.clients) if (!client.write(': heartbeat\n\n')) client.end();
      }, 15000);
      channel.heartbeat.unref();
      channel.stop = () => {
        channel.watcher?.close(); clearTimeout(channel.debounce);
        clearInterval(channel.poll); clearInterval(channel.heartbeat);
        if (channels.get(key) === channel) channels.delete(key);
      };
      channels.set(key, channel);
    }
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    res.setTimeout(0);
    res.flushHeaders();
    channel.clients.add(res);
    channel.send(res); // Reconcile on connection and reconnection; no replay gap.
    res.once('close', () => { channel.clients.delete(res); if (!channel.clients.size) channel.stop(); });
  }
  return { subscribe, close() {
    for (const channel of [...channels.values()]) {
      for (const client of channel.clients) client.end();
      channel.stop();
    }
  } };
}
