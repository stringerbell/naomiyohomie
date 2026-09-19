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

## One-time setup

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
