# @smlee/free-tunnel-server

WebSocket-based reverse-tunnel broker. Accepts client connections and forwards HTTP traffic from `/t/:subdomain/*` to the connected client. Free ngrok alternative and free tunnel server for exposing services with subdomain routing.

- CLI name: `free-tunnel-server`
- HTTP listens on `--http-port` (default 8080)
- WebSocket listens on `--ws-port` (default 8081)
- Simple token auth via `--auth-token`
- Optional `--allowed` comma list to restrict subdomains

> This server works hand-in-hand with the client package `@smlee/free-tunnel`.
> See the client README at `../app/README.md` and the npm package:
> https://www.npmjs.com/package/@smlee/free-tunnel

## Quick start (global install)

Install globally and run the server. Running with no flags uses sensible defaults.

```
npm i -g @smlee/free-tunnel-server
# simplest: runs with defaults
free-tunnel-server

# or specify ports/token explicitly
free-tunnel-server --http-port 8080 --ws-port 8081 --auth-token <STRONG_TOKEN>
```

Note: If you omit `--auth-token`, the server will generate a random token at startup and print it to the console as:

```
[server] Generated auth token: <token>
```
Copy that value and use it in your client `--token`.

### Defaults

- HTTP port: `8080`
- WebSocket port: `8081`
- Auth: if `--auth-token` omitted, a secure token is generated and required
- Allowed subdomains: all allowed (use `--allowed` to restrict)
- HTTP entrypoint: `/t/:subdomain/*`

Place the server behind a reverse-proxy.

Clean root (no /t/<subdomain>) with Nginx — single host `tunnel.example.com` mapping `/` → `/t/tunnel/*`.

This makes your public base URL exactly `https://tunnel.example.com/` while the server still uses path-based routing internally. No server code changes are required; it's purely an Nginx rewrite/proxy setup:

```nginx
server {
  listen 443 ssl http2;
  server_name tunnel.example.com;

  # TLS config ...
  # ssl_certificate     /etc/letsencrypt/live/tunnel.example.com/fullchain.pem;
  # ssl_certificate_key /etc/letsencrypt/live/tunnel.example.com/privkey.pem;

  # WebSocket control for the client
  location = /ws {
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_pass http://127.0.0.1:8081;
    proxy_read_timeout 75s; # > 30s heartbeat
  }

  # Clean root → path-based tunnel /t/tunnel/*
  location / {
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 60s;
    proxy_send_timeout 60s;
    proxy_pass http://127.0.0.1:8080/t/tunnel/; # trailing slash rewrites / → /t/tunnel/
  }
}
```

Then, on the client machine expose your local app (example local target http://localhost:3000):

```
npm i -g @smlee/free-tunnel
free-tunnel --server-ws-url wss://tunnel.example.com/ws \
  --subdomain tunnel \
  --token <STRONG_TOKEN> \
  --to http://localhost:3000
```

Visit: `https://tunnel.example.com/`

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

## Reverse proxy examples

Below are minimal examples for placing the server behind a reverse proxy. Adjust backend ports to match how you start the server (`--http-port` and `--ws-port`).

### Nginx

Prereqs: `nginx` with `http`, `proxy`, and `stream` modules (default on most distros).

- Single host mapped to one subdomain (e.g., public host `tunnel.example.com` → internal `/t/tunnel/*`).

```nginx
# HTTP users → /t/tunnel/* on the HTTP backend (replace 8080)
server {
  listen 80;
  server_name tunnel.example.com;

  client_max_body_size 10m;

  # Optional external health endpoints
  location = /_health { proxy_pass http://127.0.0.1:8080/; }
  location ^~ /_availability/ { proxy_pass http://127.0.0.1:8080/availability/; }

  # WebSocket control endpoint (client connects here)
  location /ws {
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_pass http://127.0.0.1:8081;  # WS backend port
    proxy_read_timeout 75s;             # > 30s heartbeat in server
  }

  # All other HTTP traffic → tunnel HTTP entry at /t/tunnel/*
  location / {
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_pass http://127.0.0.1:8080/t/tunnel/;  # note the trailing slash for path rewrite
    proxy_read_timeout 60s;
    proxy_send_timeout 60s;
  }
}
```

- Wildcard subdomains (e.g., `app1.example.com`, `app2.example.com`), mapping host → `/t/<host-label>/*`:

```nginx
map $host $sub {
  default "";
  ~^(?<label>[^.]+)\.example\.com$ $label;
}

server {
  listen 80;
  server_name *.example.com;

  # WS endpoint shared for all subdomains
  location /ws {
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_pass http://127.0.0.1:8081;
  }

  # HTTP: rewrite to /t/<sub>/*
  location / {
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_pass http://127.0.0.1:8080/t/$sub/;
  }
}
```

Notes:
- The server’s WS layer only cares about the `?subdomain=<name>&token=<tok>` query; it doesn’t require a specific path. We use `/ws` in Nginx for clarity.
- Ensure your client connects to `ws(s)://<host>/ws?subdomain=<name>&token=<tok>` and that `<name>` matches the HTTP rewrite target.

### Apache httpd

Prereqs: enable modules: `proxy`, `proxy_http`, `proxy_wstunnel`, `headers`.

- Single host mapped to one subdomain (`tunnel.example.com` → `/t/tunnel/*`):

```apache
<VirtualHost *:80>
  ServerName tunnel.example.com

  # WebSocket control
  ProxyPass        "/ws"  "ws://127.0.0.1:8081/"
  ProxyPassReverse "/ws"  "ws://127.0.0.1:8081/"

  # HTTP users → /t/tunnel/*
  ProxyPass        "/"    "http://127.0.0.1:8080/t/tunnel/"
  ProxyPassReverse "/"    "http://127.0.0.1:8080/t/tunnel/"

  RequestHeader set X-Forwarded-Proto expr=%{REQUEST_SCHEME}
  RequestHeader set X-Forwarded-For "%{REMOTE_ADDR}s"
</VirtualHost>
```

- Wildcard subdomains (requires `mod_rewrite` to capture the first label):

```apache
<VirtualHost *:80>
  ServerName example.com
  ServerAlias *.example.com

  RewriteEngine On
  # Extract first host label as SUB
  RewriteCond %{HTTP_HOST} ^([^.]+)\.example\.com$ [NC]
  RewriteRule ^/(.*)$ http://127.0.0.1:8080/t/%1/$1 [P,L]

  # WebSocket control shared for all subs
  ProxyPass        "/ws"  "ws://127.0.0.1:8081/"
  ProxyPassReverse "/ws"  "ws://127.0.0.1:8081/"

  ProxyPassReverse "/"    "http://127.0.0.1:8080/"
</VirtualHost>
```

### Free TLS with Let’s Encrypt (Certbot)

Choose one authenticator (Nginx or Apache). These commands set up HTTPS and automatic renewal.

- Nginx:
```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d tunnel.example.com            # single host
sudo certbot --nginx -d example.com -d "*.example.com" --agree-tos --manual-public-ip-logging-ok --register-unsafely-without-email --no-eff-email --dns-<provider> # wildcard with DNS plugin
```

- Apache:
```bash
sudo apt-get install -y certbot python3-certbot-apache
sudo certbot --apache -d tunnel.example.com
```

- Webroot (works with either server if you prefer manual control):
```bash
sudo apt-get install -y certbot
sudo certbot certonly --webroot -w /var/www/html -d tunnel.example.com
# Then reference the issued certs in your server/vhost config
#   ssl_certificate     /etc/letsencrypt/live/t1.example.com/fullchain.pem;
#   ssl_certificate_key /etc/letsencrypt/live/t1.example.com/privkey.pem;
```

Renewal runs via cron/systemd timers installed by Certbot. Test with:
```bash
sudo certbot renew --dry-run
```

## License

This package is provided under the PolyForm Noncommercial 1.0.0 license. You may use it for non‑commercial purposes. For commercial licensing, contact the author.

See `LICENSE` in this directory for the full text.
