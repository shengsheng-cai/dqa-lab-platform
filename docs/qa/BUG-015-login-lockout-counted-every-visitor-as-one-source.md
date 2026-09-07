# BUG-015 — The deployed login lockout counted every visitor as one source

English · [繁體中文](BUG-015-login-lockout-counted-every-visitor-as-one-source.zh-TW.md)

| Field | Value |
|---|---|
| **Bug ID** | BUG-015 |
| **Status** | Fixed |
| **Severity** | Medium |
| **Priority** | High |
| **Component** | Login failure lockout — the container start command in `Dockerfile`, and the three places in `auth.py` that key the counter on the client address |
| **Environment** | The deployed Hugging Face Space, where a platform proxy sits in front of the container. Local development and the E2E harness connect to Uvicorn directly and were never affected |
| **Found by** | Whole-project scan, 2026-09-07 |
| **Reporter** | Sheng-Sheng Tsai |
| **Fix commit** | `63ecb1c3b31d0f661926c008959fe3b85d3b7947` (start command and the test that pins it); the lockout endpoint tests landed alongside it in `062d2a223f2aa349f0b02079083761065df5e408` |
| **Recording order** | The evidence below was gathered on 2026-09-07, before the fix. The report itself was written alongside the fix, not ahead of it — Git history cannot prove the order of an uncommitted draft, so this is recorded as concurrent rather than claimed as a pre-fix record |

## Summary

Five failed authentication attempts from one source address lock that source out
for ten minutes. On the deployed Space every request arrives through a platform
proxy, and the container was started without telling Uvicorn to trust it, so
`request.client.host` resolved to the proxy's own internal address for every
visitor alike. One counter therefore stood for everybody.

Five failures from anyone — a scanner probing `/api/` paths with no credentials
is enough, and a public Space attracts those — returned 429 to every visitor for
the next ten minutes. That included visitors already holding a valid guest
token, because the block is checked before credentials are validated, and it
included the login endpoint itself, which checks the same block before it looks
at a password.

Nothing in the application misbehaved. The threshold, the counting, and the
block window all worked exactly as designed. The defect is that the key they
counted on identified nobody.

## Affected paths

| Path | Wrong behaviour |
|---|---|
| `Dockerfile` — container start command | Ran `uvicorn app.main:app` with no `--forwarded-allow-ips`, so Uvicorn fell back to trusting `127.0.0.1` only and ignored `X-Forwarded-For` entirely |
| `backend/app/auth.py` — `login`, `demo_login`, `auth_middleware` | Each reads `request.client.host` as the lockout key; behind an untrusted proxy that value is one constant shared by everyone |
| `.github/workflows/test.yml` | Builds no image, so no automated check ever executed the start command it would have found this in |

## Preconditions

- A deployment with a reverse proxy in front of the container. The Hugging Face
  Space is one; local runs and the E2E harness are not, which is why the defect
  is invisible in development.
- Uvicorn started without `--forwarded-allow-ips` and without the
  `FORWARDED_ALLOW_IPS` environment variable, which is what the container did.
- Any source able to accumulate five authentication failures. No account is
  needed: `auth_middleware` counts requests to `/api/*` that carry no credential
  at all, which is what an unauthenticated scan looks like.

## Steps to reproduce on the pre-fix revision

1. Check out a revision before the fix commit.
2. Start the backend the way the container did, with no proxy trust configured:
   `uvicorn app.main:app --host 0.0.0.0 --port 7860`.
3. Send five failed logins that each present a different `X-Forwarded-For`
   address, as five separate visitors behind a proxy would.
4. Send a sixth request from a further, previously unseen address.

## Expected result

Each address accumulates its own failures. The sixth visitor, who has failed
nothing, is answered on the merits of its own request: `401` for a wrong
password, or a successful login for a correct one. A lockout reaches only the
address that earned it.

## Actual result

The sixth visitor receives `429` with `錯誤次數過多，封鎖 10 分鐘`, having done
nothing, and so does every other visitor for the following ten minutes. Any
request to `/api/*` is refused before its credential is examined, so a guest
already working in the application is cut off mid-session, and the login page
cannot be used to recover.

## Evidence

- **The address the container actually saw.** A probe request sent to the Space
  on 2026-09-07 appears in the container log with a source address in `10.0.0.0/8`
  — the platform's proxy, not the caller.
- **Why that address was used.** In the pinned Uvicorn (0.51.0),
  `Config.__init__` resolves `forwarded_allow_ips=None` to
  `os.environ.get("FORWARDED_ALLOW_IPS", "127.0.0.1")`, and
  `ProxyHeadersMiddleware` rewrites the client only when the connecting host is
  in that trusted set. The proxy is not `127.0.0.1`, so `X-Forwarded-For` was
  read by nothing.
- **The consequence, run against that same pinned Uvicorn.** Feeding
  `ProxyHeadersMiddleware` a request from proxy address `10.1.2.3`:

  | Trust setting | `X-Forwarded-For` | Address the application sees |
  |---|---|---|
  | `127.0.0.1` (pre-fix default) | `203.0.113.9` | `10.1.2.3` |
  | `127.0.0.1` (pre-fix default) | `198.51.100.4` | `10.1.2.3` |
  | `10.0.0.0/8` (the fix) | `203.0.113.9` | `203.0.113.9` |
  | `10.0.0.0/8` (the fix) | `198.51.100.4` | `198.51.100.4` |
  | `10.0.0.0/8` (the fix) | `1.1.1.1, 203.0.113.9` | `203.0.113.9` |
  | `*` (the value the deleted config carried) | `1.1.1.1, 203.0.113.9` | `1.1.1.1` |

  Two different visitors collapse onto one address before the fix and stay
  distinct after it. The last two rows are the reason the fix is not a restore:
  see Root cause.
- **What the lockout does with that key.** `MAX_ATTEMPTS = 5` and
  `BLOCK_SECONDS = 600` in [`auth.py`](../../backend/app/auth.py); the block is
  checked at the top of `auth_middleware`, before either credential branch, and
  at the top of `login` before the password is verified.
- **Not captured:** a screenshot of a locked-out visitor. This is not a
  rendering defect — the screen correctly displays the message the server sent.
  The evidence that matters is which address the counter was keyed on.

## Root cause

The trust setting was lost in a platform migration, and nothing was left that
could notice.

`backend/railway.toml` carried
`--proxy-headers --forwarded-allow-ips='*'` in its start command. Commit
`13b4b76` (2026-04-16) removed Railway and deleted that file wholesale. Commit
`861248e` (2026-04-24) added the Hugging Face `Dockerfile`, whose start command
was written fresh and never carried the setting. Between those two commits the
deployment target changed, and the only place this decision had ever been
recorded went with the old one.

Nothing failed in between because nothing looks. CI runs the test suites but
never builds the image, so the start command has no automated reader at all;
locally there is no proxy, so `request.client.host` is already correct and the
defect cannot appear.

There is a second layer worth stating plainly, because it is why this is not
simply a matter of restoring what was deleted: **the setting that was lost was
itself wrong.** With `*`, Uvicorn takes the leftmost `X-Forwarded-For` entry,
and the leftmost entry is whatever the caller wrote there — so a lockout keyed
on it can be evaded, and aimed, by anyone who sends a header. Restoring the old
line verbatim would have replaced a counter that identifies nobody with one an
attacker chooses. The fix names the network the proxy actually occupies instead.

Underneath both is the same shape as the code: which address identifies a caller
is a decision this system never named anywhere. It is an attribute read inline
in three places, so there was no single place for it to be right or wrong in,
and no obvious place to test.

## Impact

- Every visitor to the deployed Space is refused for ten minutes once any five
  authentication failures accumulate, from any source, including automated scans
  that never intended to log in.
- The refusal reaches authenticated sessions, not just new logins. The block is
  evaluated before the credential, so a guest already using the application
  starts receiving 429 on every request, and the login page cannot be used to
  get back in.
- There is no visible cause. The message says too many failed attempts, which is
  true of the counter and false of the person reading it.
- The exposure is bounded and self-healing: the counter lives in memory, so the
  window expires after ten minutes and a Space restart clears it outright.
- Severity is rated Medium because this baseline is a portfolio demo whose worst
  outcome is a ten-minute outage. Priority is rated High because it was live, it
  needed one line to fix, and the ten minutes it costs are most likely to land
  exactly when the link has just been handed to someone.

## Resolution

The container now names the network its proxy occupies:

```
uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860} --forwarded-allow-ips=10.0.0.0/8
```

`--proxy-headers` is deliberately not added alongside it: in the pinned Uvicorn
that option already defaults to on, and pairing the two invites the reading that
the pair is what matters, when only the trust list was ever missing.

Two choices are deliberate:

- **The fix belongs to the deployment, not the application.** Which network the
  proxy sits in is knowledge the deployment target owns, and it has already
  varied once — Railway used one value, this Space needs another. Adding
  `ProxyHeadersMiddleware` in `main.py` would move the same constant into shared
  application code, and configuring it by environment variable would move it
  somewhere no test in this repository can see, which is the failure mode that
  produced this defect in the first place.
- **A network, not `*`.** The trusted value must be narrow enough to exclude the
  public internet. `*` and `0.0.0.0/0` both make Uvicorn read the caller-supplied
  end of the header, which is worse than leaving the setting out: a shared
  counter refuses everyone equally, while an attacker-chosen counter can be
  aimed at one visitor and evaded by the attacker.

The three inline reads of `request.client.host` in `auth.py` are untouched. They
are correct once the trust list is set, and giving them a shared accessor is a
change to authentication code that this fix does not need.

## Verification

```bash
cd backend && ../venv/bin/python -m pytest tests/test_deploy_config.py tests/test_login_rate_limit.py
```

`tests/test_deploy_config.py` reads the start command out of the `Dockerfile`
and checks what the trust value would actually do, rather than how it is
spelled: a public address must not fall inside it, and the proxy's network must.
That distinction is the point — a string comparison would accept `0.0.0.0/0`,
which behaves exactly like the `*` this fix rejects. It also fails if the value
disappears, if `--no-proxy-headers` is added, or if the server is swapped for one
that takes the same flag without accepting network notation.

`tests/test_login_rate_limit.py` pins the behaviour the key feeds: five failures
produce a block, a correct password is still refused while the block lasts, a
successful login clears the count, and — the blast radius this report is about —
a guest holding a valid token is shut out by a block someone else triggered.
Both assertions were mutation-checked: with the failure counter's increment
removed the first two fail, and with the trust value widened to `0.0.0.0/0` the
deployment test fails.

Not covered, and confirmed by probing the deployed Space instead: that the
platform's proxy really does sit inside `10.0.0.0/8` — if it moved, these tests
stay green while production returns to one shared counter — and that the proxy
appends to `X-Forwarded-For` rather than passing a caller's header through
untouched, which is what makes the forged-header row in the evidence table hold
in practice.
