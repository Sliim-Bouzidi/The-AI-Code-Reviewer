#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ApiClient } from './api-client.js';
import { buildServer } from './server.js';

// stdout is the protocol channel in stdio mode: log to stderr only.
const apiUrl = process.env.CODEREVIEW_API_URL ?? 'http://localhost:4000';
const apiKey = process.env.CODEREVIEW_API_KEY;
if (!apiKey) {
  console.error('CODEREVIEW_API_KEY is not set. Create a key in the dashboard (or POST /api/keys).');
  process.exit(1);
}

await buildServer(new ApiClient(apiUrl, apiKey)).connect(new StdioServerTransport());
console.error(`codereview MCP server ready (stdio) -> ${apiUrl}`);
