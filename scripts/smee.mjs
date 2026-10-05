// Webhook tunnel sidecar. Uses SMEE_URL if set, otherwise creates a fresh smee.io channel once and
// remembers it in /data/smee-url (shared volume), so the API can show it and the GitHub App can use it.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const FILE = '/data/smee-url';
const target = process.env.SMEE_TARGET ?? 'http://api:4000/webhooks/github';

async function channelUrl() {
  if (process.env.SMEE_URL) return process.env.SMEE_URL;
  if (existsSync(FILE)) return readFileSync(FILE, 'utf8').trim();
  const res = await fetch('https://smee.io/new', { redirect: 'manual' });
  const url = res.headers.get('location');
  if (!url) throw new Error(`smee.io did not return a channel (HTTP ${res.status})`);
  return url;
}

const url = await channelUrl();
mkdirSync('/data', { recursive: true });
writeFileSync(FILE, url);
console.log(`[smee] ${url} -> ${target}`);

const child = spawn('smee', ['--url', url, '--target', target], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
