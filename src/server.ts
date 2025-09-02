/*
 TypeScript reverse tunnel server
 - WebSocket accepts clients registering a subdomain with AUTH token
 - HTTP forwards /t/:subdomain/* to client via WS request/response frames
*/
import http from 'http';
import crypto from 'crypto';
import { promises as dns } from 'dns';
import express, { Request, Response } from 'express';
import WebSocket, { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';

export interface TunnelRequestMsg {
  id: string;
  type: 'request';
  method: string;
  path: string;
  headers?: Record<string, string | string[] | undefined>;
  bodyBase64?: string;
}

export interface TunnelResponseMsg {
  id: string;
  type: 'response';
  status?: number;
  headers?: Record<string, string | number | string[] | undefined>;
  bodyBase64?: string;
}

export interface ServerConfig {
  httpPort: number;
  wsPort: number;
  authToken?: string;
  allowedSubdomains?: string[];
  replaceExisting?: boolean;
  publicHost?: string;
}

type ClientEntry = { ws: WebSocket & { isAlive?: boolean }; updatedAt: number };

function sanitizeHeaders(h: Record<string, any> = {}): Record<string, any> {
  const res: Record<string, any> = {};
  for (const [k, v] of Object.entries(h)) {
    const lower = k.toLowerCase();
    if (
      [
        'connection',
        'keep-alive',
        'proxy-authenticate',
        'proxy-authorization',
        'te',
        'trailer',
        'transfer-encoding',
        'upgrade',
        'host',
      ].includes(lower)
    )
      continue;
    res[k] = v as any;
  }
  return res;
}

export function startServer(cfg: ServerConfig) {
  const { httpPort, wsPort, authToken, allowedSubdomains = [], publicHost } = cfg;
  const clients = new Map<string, ClientEntry>();
  const isAllowed = (s: string) => allowedSubdomains.length === 0 || allowedSubdomains.includes(s);
  const effectiveToken = authToken ?? crypto.randomBytes(16).toString('hex');
  const tokenWasGenerated = !authToken;

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.all('/t/:subdomain/*', (req: Request, res: Response) => {
    const subdomain = req.params.subdomain;
    const entry = clients.get(subdomain);
    if (!entry || entry.ws.readyState !== WebSocket.OPEN) {
      if (entry) clients.delete(subdomain);
      return res.status(502).json({ error: `No client connected for ${subdomain}` });
    }

    const id = uuidv4();
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      const bodyBuf = Buffer.concat(chunks);
      const payload: TunnelRequestMsg = {
        id,
        type: 'request',
        method: req.method,
        path: (req.params as any)[0] ? '/' + (req.params as any)[0] : '/',
        headers: sanitizeHeaders(req.headers as any),
        bodyBase64: bodyBuf.length ? bodyBuf.toString('base64') : undefined,
      };

      const onMessage = (message: WebSocket.RawData) => {
        try {
          const data = JSON.parse(message.toString()) as TunnelResponseMsg;
          if (data && data.id === id && data.type === 'response') {
            entry.ws.off('message', onMessage);
            clearTimeout(timer);

            res.status(data.status ?? 200);
            const headers = data.headers || {};
            for (const [k, v] of Object.entries(headers)) {
              if (typeof v !== 'undefined') res.setHeader(k, v as any);
            }
            const body = data.bodyBase64 ? Buffer.from(data.bodyBase64, 'base64') : Buffer.alloc(0);
            return res.end(body);
          }
        } catch {
          // ignore
        }
      };

      const timer = setTimeout(() => {
        entry.ws.off('message', onMessage);
        res.status(504).json({ error: 'Upstream timeout' });
      }, 30000);

      entry.ws.on('message', onMessage);

      try {
        entry.ws.send(JSON.stringify(payload));
      } catch {
        entry.ws.off('message', onMessage);
        clearTimeout(timer);
        return res.status(502).json({ error: 'Failed to send to client' });
      }
    });
  });

  app.get('/', (_req, res) => {
    res.json({ ok: true, message: 'Tunnel server is running', httpPath: '/t/:subdomain/*', wsPort });
  });

  // Availability check for subdomains
  app.get('/availability/:subdomain', (req: Request, res: Response) => {
    const sub = req.params.subdomain;
    const available = !clients.has(sub);
    res.json({ subdomain: sub, available });
  });

  const httpServer = http.createServer(app);
  httpServer.listen(httpPort, () => {
    console.log(`[server] HTTP listening on :${httpPort}`);
    if (tokenWasGenerated) {
      console.log(`[server] Generated auth token: ${effectiveToken}`);
    } else {
      console.log(`[server] Auth token configured`);
    }

    // Startup guidance
    if (publicHost) {
      const apex = publicHost;
      const exampleSub = 'myapp';
      const exampleHost = `${exampleSub}.${apex}`;
      const wsUrl = `wss://${exampleHost}/ws`;
      console.log(`[server] Guidance (replace "${exampleSub}" with YOUR subdomain and configure DNS A/AAAA/CNAME):`);
      console.log(`  free-tunnel ${exampleHost} localhost:3000 --token ${effectiveToken}`);
      console.log(`[server] The client will prefer secure (wss/https) if available, and fall back to ws/http.`);
      // Best-effort DNS check for guidance
      dns.lookup(exampleHost).catch(() => {
        console.warn(`[server] Warning: Could not resolve "${exampleHost}". Ensure DNS exists and your reverse proxy maps:`);
        console.warn(`  - WebSocket:   /ws              -> ws://<server-host>:${wsPort}`);
        console.warn(`  - HTTP tunnel: /t/<subdomain>/* -> http://<server-host>:${httpPort}`);
      });
    } else {
      console.log(`[server] Tip: pass --public-host example.com to print copy/paste guidance for your subdomain (e.g., myapp.example.com).`);
    }
  });

  const wss = new WebSocketServer({ port: wsPort });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/', `ws://${req.headers.host}`);
    const subdomain = url.searchParams.get('subdomain') || '';
    const token = url.searchParams.get('token') || '';

    if (!subdomain || !isAllowed(subdomain)) {
      ws.close(1008, 'Invalid or not allowed subdomain');
      return;
    }
    if (effectiveToken && token !== effectiveToken) {
      ws.close(1008, 'Auth failed');
      return;
    }

    // Enforce uniqueness (optionally replace existing if configured)
    const existing = clients.get(subdomain);
    if (existing) {
      if (cfg.replaceExisting) {
        try { existing.ws.close(1012, 'Replaced by new connection'); } catch {}
      } else {
        ws.close(1008, 'Subdomain already in use');
        return;
      }
    }
    clients.set(subdomain, { ws: ws as any, updatedAt: Date.now() });
    console.log(`[server] Client registered subdomain="${subdomain}" from ${req.socket.remoteAddress}`);

    ws.on('close', () => {
      const cur = clients.get(subdomain);
      if (cur?.ws === ws) {
        clients.delete(subdomain);
        console.log(`[server] Client for ${subdomain} disconnected`);
      }
    });

    ws.on('error', (err) => {
      console.warn(`[server] WS error for ${subdomain}:`, (err as any)?.message);
    });

    // Heartbeat
    (ws as any).isAlive = true;
    ws.on('pong', () => { (ws as any).isAlive = true; });
  });

  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const w = ws as WebSocket & { isAlive?: boolean };
      if (w.isAlive === false) return w.terminate();
      w.isAlive = false;
      try { w.ping(); } catch {}
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));

  return { httpServer, wss };
}
