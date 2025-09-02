# @smlee/free-tunnel-server

WebSocket-based reverse-tunnel broker. Accepts client connections and forwards HTTP traffic from `/t/:subdomain/*` to the connected client.

- CLI name: `free-tunnel-server`
- HTTP listens on `--http-port` (default 8080)
- WebSocket listens on `--ws-port` (default 8081)
- Simple token auth via `--auth-token`
- Optional `--allowed` comma list to restrict subdomains

## Install & Run (local)

```
npm install
npm run build
# Provide your own token or let the server generate one
npm start -- --http-port 8080 --ws-port 8081 --auth-token change-me-strong-token
# or just
# npm start -- --http-port 8080 --ws-port 8081
# (the server will print a Generated auth token on startup)
```

Test:
```
curl -i http://localhost:8080/t/myapp/
```

## CLI Options

```
free-tunnel-server --help

Options:
  -H, --http-port <port>   HTTP listening port (default: 8080)
  -W, --ws-port <port>     WebSocket listening port (default: 8081)
  -t, --auth-token <tok>   Auth token required for clients
  -a, --allowed <list>     Comma-separated allowed subdomains
  --replace-existing       Replace existing client if the same subdomain reconnects
  -h, --help               display help for command
```

Environment:

- `PORT_HTTP`, `PORT_WS`, `AUTH_TOKEN`, `ALLOWED_SUBDOMAINS`
- `REPLACE_EXISTING=true` to enable takeover behavior

## Subdomain availability

- Check if a name is free before connecting:

```
GET /availability/:subdomain

Response: { "subdomain": "myapp", "available": true }
```

Default policy: first connection wins; others are rejected. If `--replace-existing` is enabled, new connections take over the subdomain.

## Authentication token

- If `--auth-token` (or `AUTH_TOKEN`) is not provided, the server will generate a random token at startup and log it as:

```
[server] Generated auth token: <token>
```

- Clients must pass this token via the `token` query (CLI flag `-t, --token`).

## Deployment (DigitalOcean sketch)

- Build and run behind Nginx or expose ports directly.
- Example Nginx snippet:
```
location /t/ { proxy_pass http://127.0.0.1:8080; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }
location /ws { proxy_pass http://127.0.0.1:8081; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }
```

## License

This package is provided under the PolyForm Noncommercial 1.0.0 license. You may use it for non‑commercial purposes. For commercial licensing, contact the author.

See `LICENSE` in this directory for the full text.
