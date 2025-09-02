#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { startServer } from './server';

const program = new Command();

program
  .name('free-tunnel-server')
  .description('Reverse tunnel server (HTTP entry + WebSocket control)')
  .option('-H, --http-port <port>', 'HTTP listening port', process.env.PORT_HTTP || '8080')
  .option('-W, --ws-port <port>', 'WebSocket listening port', process.env.PORT_WS || '8081')
  .option('-t, --auth-token <token>', 'Auth token required for clients', process.env.AUTH_TOKEN)
  .option('-a, --allowed <list>', 'Comma-separated list of allowed subdomains', process.env.ALLOWED_SUBDOMAINS)
  .option('--replace-existing', 'Replace existing client for same subdomain', (process.env.REPLACE_EXISTING || '').toLowerCase() === 'true')
  .action((opts) => {
    const httpPort = parseInt(String(opts.httpPort), 10);
    const wsPort = parseInt(String(opts.wsPort), 10);
    const allowedSubdomains = (opts.allowed ? String(opts.allowed) : '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    startServer({
      httpPort,
      wsPort,
      authToken: opts.authToken,
      allowedSubdomains,
      replaceExisting: Boolean(opts.replaceExisting),
    });

    console.log(`[cli] Server started: HTTP :${httpPort}, WS :${wsPort}`);
  });

program.parse();
