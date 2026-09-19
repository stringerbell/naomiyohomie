# naomiyohomie.com

The home for Naomi's games and art. This repo holds the landing page and the build that
gathers each game from its own repo into one site:

| URL | Comes from |
|---|---|
| `/` | `landing/` in this repo |
| `/zoo-problems/` | [stringerbell/zoo-problems](https://github.com/stringerbell/zoo-problems) |
| `/limited-gravity/` | [stringerbell/limited-gravity](https://github.com/stringerbell/limited-gravity) |
| `/koala-nightmares/` | [stringerbell/koala-nightmares](https://github.com/stringerbell/koala-nightmares) |
| `/dog-salon/` | [stringerbell/dog-salon](https://github.com/stringerbell/dog-salon) |

The games stay in their own repos and are not modified. Game repos must be public (CI
clones them without credentials).

## Everyday commands

```
make serve          # build everything, preview at http://localhost:8090
make build-landing  # landing page only (fast, keeps games already in dist/)
make test           # unit tests + full build + checks on dist/
make deploy         # push main; GitHub Actions builds and publishes
make redeploy       # rebuild and publish now, without a push
```

`make build` uses the sibling checkout `../<slug>` when it exists, so you can preview a
game's uncommitted work inside the site. `make build-remote` (and CI) always use fresh
clones of each game's default branch.

## Adding a game

1. Add an entry to `games.json`. The `slug` is the URL path.
   - Static game (no build step): leave out `build` and `out`. The whole repo is published
     except dotfiles, `*.md`, tests, `package.json`, `Makefile`, `node_modules`.
   - Built game: set `build` (the command) and `out` (the folder it produces).
     The game must work from a sub-path: use relative asset URLs (Vite: `base: './'`),
     or a base that equals `/<slug>/`.
2. Add poster art at `landing/art/<slug>.svg` (600x360).
3. `make test`, then `make deploy`.

## How publishing works

`.github/workflows/deploy.yml` runs the tests, builds from fresh clones, and publishes
`dist/` to GitHub Pages. It runs on:

- a push to `main` here,
- `make redeploy` (manual trigger),
- hourly, but only publishing if a game repo has new commits (`scripts/changed.mjs`
  compares them with `versions.json` on the live site),
- a `game-updated` repository dispatch (optional, below).

### Optional: instant rebuild when a game changes

Without this, a game update goes live within the hour (or right away with `make redeploy`).
To make it immediate, create a fine-grained token with "Contents: read and write" on this
repo only, save it in the game repo as the secret `UMBRELLA_DISPATCH_TOKEN`, and add this
step to the end of the game's workflow:

```yaml
- run: gh api repos/stringerbell/naomiyohomie/dispatches -f event_type=game-updated
  env:
    GH_TOKEN: ${{ secrets.UMBRELLA_DISPATCH_TOKEN }}
```

## Guestbook

Visitors can leave a message on the landing page. **Nothing a visitor writes is shown until
a grown-up approves it.** The site is static, so the guestbook is a small Cloudflare Worker
in `comments/` with a D1 database, served at `comments.naomiyohomie.com`.

How a message travels:

1. The form asks for a nickname and a message. No email, no account, no links allowed.
2. Bots are stopped by Cloudflare Turnstile, a hidden trap field, an Origin check, and
   rate limits (3 per visitor per hour, 30 per hour overall so a flood cannot bury your inbox).
3. The message is saved as `pending` and a review email goes to the moderator. It flags
   things worth a second look (email addresses, phone numbers, chat apps, ages).
4. The link in the email opens a review page. Opening it changes nothing (mail scanners
   open links); you press **Approve** or **Reject** there, and can type Naomi's reply.
5. Only `approved` messages are ever returned to the website. The same link keeps working
   for 180 days, to add or edit a reply, or to take a message back off the site.

What is stored: nickname, message, reply, timestamps, and a one-way hash of the visitor's
IP that changes daily (rate limiting only). No cookies, no tracking.

```
make comments-test-unit   # the moderation rules, link signing, and the whole HTTP flow
make comments-dev         # run it locally on :8787 (then `make serve` in another terminal)
make deploy-comments      # tests, database migrations, then publish the Worker
make comments-pending     # list messages still waiting, in case an email went missing
```

Locally, the landing page talks to `localhost:8787` with Turnstile's public test key, and
review emails are written to a file that `wrangler dev` prints the path of.

### One-time guestbook setup

1. Cloudflare dashboard -> naomiyohomie.com -> **Email** -> Email Routing: enable it, and add
   the moderator address as a verified destination address (click the link it emails you).
2. Cloudflare dashboard -> **Turnstile** -> Add widget for `naomiyohomie.com` (Managed mode).
   Keep the site key and the secret key.
3. `make comments-db-create`, and paste the printed `database_id` into `comments/wrangler.toml`.
4. `make comments-secrets` (asks for `MOD_SECRET`, `MOD_EMAIL`, `TURNSTILE_SECRET`).
   Changing `MOD_SECRET` later cancels every review link already sent.
5. `make deploy-comments`.
6. Put the Turnstile **site key** in `data-sitekey` on the guestbook section of
   `landing/index.html`, then `make deploy`. Until that is filled in, the guestbook
   section stays hidden, so the site can go live before the guestbook is ready.

## One-time site setup

1. Repo Settings -> Pages -> Source: **GitHub Actions**; custom domain `naomiyohomie.com`;
   once the certificate is issued, tick **Enforce HTTPS**.
   (Pages on a private repo needs a paid GitHub plan; the published site is public either way.)
2. DNS at Cloudflare, all set to **DNS only** (grey cloud) so GitHub can issue the certificate:

   | Type | Name | Value |
   |---|---|---|
   | A | `@` | `185.199.108.153` |
   | A | `@` | `185.199.109.153` |
   | A | `@` | `185.199.110.153` |
   | A | `@` | `185.199.111.153` |
   | AAAA | `@` | `2606:50c0:8000::153` |
   | AAAA | `@` | `2606:50c0:8001::153` |
   | AAAA | `@` | `2606:50c0:8002::153` |
   | AAAA | `@` | `2606:50c0:8003::153` |
   | CNAME | `www` | `stringerbell.github.io` |

3. Recommended: verify the domain under your GitHub account (Settings -> Pages -> Add a
   domain) so nobody else can claim it on Pages.
