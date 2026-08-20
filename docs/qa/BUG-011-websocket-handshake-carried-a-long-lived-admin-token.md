# BUG-011 — The device WebSocket handshake carried a long-lived admin token in its URL

English · [繁體中文](BUG-011-websocket-handshake-carried-a-long-lived-admin-token.zh-TW.md)

| Field | Value |
|---|---|
| **Bug ID** | BUG-011 |
| **Status** | Fixed |
| **Severity** | Medium |
| **Priority** | Medium |
| **Component** | WebSocket authentication — device feed handshake (`ws.py`, `auth.py`, `client/src/useDeviceWebSocket.js`) |
| **Environment** | Any deployment running Uvicorn with its access log enabled, which includes the container start command in `Dockerfile` |
| **Found by** | Codex whole-project review, 2026-08-19 |
| **Reporter** | Sheng-Sheng Tsai |
| **Fix commit** | `03291360f88ffd82f96a13cbc4ff8f8aba8717b5`. As with BUG-010, this report was written *after* the fix — noted here rather than left implicit |

## Summary

The browser opened the device feed as `/ws/devices?token=<token>`, where the
token was the same bearer credential the REST API uses: an administrator's
8-hour session token, or a guest token, or the demo master key.

A query string is part of the request line, and Uvicorn's access log records the
request line verbatim. The credential that authorises every administrative write
in this system was therefore copied into ordinary application logs on every
handshake, and stayed valid there for the rest of its lifetime.

Nothing misbehaved. The feed connected, the device cards updated, no error was
raised. The defect is not what the code did but where the credential travelled.

## Affected paths

| Path | Wrong behaviour |
|---|---|
| `client/src/useDeviceWebSocket.js` — `getToken`, `connect` | Read the session token out of `localStorage` and appended it as `?token=` to the WebSocket URL, on the first connect and on every reconnect |
| `backend/app/ws.py` — `_authenticate` | Accepted the credential from `ws.query_params`, which made the URL the only place a browser client could put it |
| `Dockerfile` — container start command | Starts `uvicorn app.main:app` without `--no-access-log`, so the deployment writes a log line for every handshake |

## Preconditions

- A deployment whose Uvicorn access log is enabled. This is the default, and the
  container command does not turn it off.
- Any authenticated session opening the device feed. An administrator is the
  case that matters: the same token also authorises every write endpoint.
- Someone able to read the log stream — a platform log console, container
  stdout, or any log shipper downstream of it.

## Steps to reproduce on the pre-fix revision

1. Check out a revision before the fix commit.
2. Start the backend the way the container does, with the access log left
   enabled: `uvicorn app.main:app --host 0.0.0.0 --port 7860`.
3. Log in as an administrator in the browser; the control centre opens the
   device feed on mount.
4. Read the handshake line the server writes to stdout.

## Expected result

The handshake line names the endpoint and nothing else:

```
127.0.0.1:54321 - "WebSocket /ws/devices" [accepted]
```

The credential travels somewhere the log does not record, and nothing in the log
can be replayed against the API.

## Actual result

The line carries the credential:

```
127.0.0.1:54321 - "WebSocket /ws/devices?token=<64 hex characters>" [accepted]
```

Copying that token out of the log and sending it as an `X-User-Token` header
authenticates as that administrator until the token expires — up to eight hours
(`TOKEN_TTL` in `auth.py`) — across every write endpoint, not only the read-only
feed the token was borrowed for.

The line above is the format Uvicorn emits, established from its logging code
rather than captured from a running deployment; see Evidence.

## Evidence

- Pre-fix client: `git show 63e84b7:client/src/useDeviceWebSocket.js` —
  `` const url = `${WS_BASE}/ws/devices${token ? `?token=${encodeURIComponent(token)}` : ""}` ``,
  with `getToken` returning `user_token` or `demo_password` from `localStorage`.
- Pre-fix server: [`ws.py`](../../backend/app/ws.py) `_authenticate`, reached
  from `ws.query_params.get("token", "")`.
- What Uvicorn logs: both WebSocket implementations shipped with the pinned
  Uvicorn — `protocols/websockets/websockets_impl.py` and
  `websockets_sansio_impl.py` — log `'%s - "WebSocket %s" [accepted]'` with
  `get_path_with_query_string(scope)`, and that helper appends the query string
  whenever one is present. Request headers appear in no access-log line.
- Credential authority: `TOKEN_TTL = 8 * 60 * 60` in
  [`auth.py`](../../backend/app/auth.py); the same token is what
  `auth_middleware` accepts for administrative writes.
- Not captured: a log line from a live deployment. The finding rests on the two
  code paths above — the client that wrote the token into the URL, and the
  logger that writes URLs down.

## Root cause

The browser WebSocket API cannot set request headers on a handshake. A client
controls the URL and the `Sec-WebSocket-Protocol` list, and nothing else. The
URL is the obvious remaining place to put a credential, so that is where it
went — the same shortcut that made query-string API keys common enough to have
their own advisory literature.

Underneath that, the session bearer was reused for a second transport instead of
being exchanged for a credential suited to it. A token designed for headers,
where it is not logged, was moved into a request line, where it is — without the
lifetime or the single use that a logged credential would need.

The cost stayed invisible locally. The E2E backend runs with `--no-access-log`,
and a local development log is discarded when the process ends, so the leak only
becomes real where logs are retained — which is exactly the deployed
environment.

## Impact

- An 8-hour administrative bearer token is written into application logs at
  every handshake, and the client reconnects with backoff after any drop, so a
  flaky network multiplies the copies rather than avoiding them.
- Anyone with log access can act as that administrator until the token expires:
  confirming schedules, starting tests, editing fixture stock, managing users.
- There is no user-visible symptom. Nothing fails, so nothing prompts anyone to
  look.
- The exposure is bounded: the token expires within eight hours, and logging out
  revokes it immediately.
- Severity is rated Medium here because this baseline is a simulated portfolio
  demo with a private log stream. The same defect in a real laboratory would be
  rated on the authority of the credential rather than on the sensitivity of the
  data, and would be treated as High.

## Resolution

The browser no longer sends its session token to the WebSocket at all. It
exchanges it, over the already-authenticated REST API, for a ticket that is only
good for one handshake:

- `POST /api/auth/ws-ticket` mints a 256-bit random ticket with a 30-second
  lifetime. Minting requires the same authentication as any other API call —
  the path is deliberately not in `SKIP_PATHS`.
- The client offers the ticket as a `Sec-WebSocket-Protocol` entry, which
  Uvicorn passes to the application but never writes to the access log. The
  server echoes the accepted subprotocol back, as RFC 6455 requires.
- `consume_ws_ticket` pops the ticket under a lock *before* it checks expiry, so
  an expired ticket, a replayed ticket, and two connections racing on the same
  ticket all burn it. Exactly one connection can ever win.

Two choices are deliberate:

- **A subprotocol rather than a same-origin cookie.** A cookie would also keep
  the credential out of the URL, but it brings CSRF handling and cross-site
  cookie policy along with it, for protection a single-use 30-second ticket
  already provides.
- **The ticket is anonymous.** The old handshake carried no identity either — it
  returned a boolean, and the feed broadcasts the same device list to
  administrators and guests alike. Attaching a user to the ticket would invent
  an authorisation distinction this endpoint has never had, and would change who
  may connect. Guests still connect, and so does a local run with no
  `DEMO_PASSWORD` set.

One residual dependency comes with the change: the deployment's reverse proxy
must forward `Sec-WebSocket-Protocol`. If it were stripped, the handshake fails
closed with code 4001 and every device card stays OFFLINE — a visible failure on
the first page load rather than a silent one, because the device feed has no
polling fallback behind it. Should that ever happen, moving the ticket into the
query string remains acceptable: a 30-second single-use ticket in a log is not
worth replaying, which is what made the original token dangerous.

## Verification

```bash
cd backend && ../venv/bin/python -m pytest tests/test_ws_auth.py
make test-e2e ARGS="specs/ws-auth.spec.js"
```

`tests/test_ws_auth.py` pins the authentication boundary: the ticket endpoint
returns 401 without a credential, a valid ticket is accepted and the subprotocol
echoed back, the same ticket is refused the second time, an expired ticket is
refused, a `?token=` URL is refused outright, and eight threads consuming one
ticket produce exactly one winner.

`tests/e2e/specs/ws-auth.spec.js` covers what the backend suite cannot: it opens
a real Chromium session, asserts the device socket's URL contains neither the
session token nor any query string, and asserts frames actually arrive — so a
handshake the browser rejects fails the test instead of degrading into a blank
screen. The assertion was mutation-checked: with the server's ticket prefix
deliberately altered the spec fails, and it passes again once restored.

Not covered: whether the Hugging Face reverse proxy forwards the subprotocol
header. The E2E connects straight to Uvicorn with nothing in between, so this
one is confirmed by opening the deployed Space and seeing live device cards.
