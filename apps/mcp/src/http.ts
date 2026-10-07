import { createServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadEnv } from '@codereview/shared';
import { ApiClient } from './api-client.js';
import { buildServer } from './server.js';

loadEnv();
const apiUrl = process.env.CODEREVIEW_API_URL ?? 'http://localhost:4000';
const port = Number(process.env.PORT ?? process.env.MCP_PORT ?? 4100);

/**
 * Streamable HTTP transport at /mcp, stateless: every request gets its own server, authenticated
 * with the caller's own API key (`Authorization: Bearer crk_...`), which is passed on to the Core API.
 */
createServer(async (req, res) => {
  const json = (status: number, message: string) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
  };
  if (!req.url?.startsWith('/mcp')) return json(404, 'Not found');
  if (req.method !== 'POST') return json(405, 'Method not allowed');
  const key = req.headers.authorization?.replace(/^Bearer /, '');
  if (!key) return json(401, 'Missing Authorization: Bearer <api key>');

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));

    const server = buildServer(new ApiClient(apiUrl, key));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    console.error('mcp request failed:', (err as Error).message);
    if (!res.headersSent) json(400, 'Bad request');
  }
}).listen(port, () => console.error(`codereview MCP server ready (http) on http://localhost:${port}/mcp -> ${apiUrl}`));
