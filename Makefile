PORT ?= 8090

.PHONY: help build build-remote build-landing serve test test-unit site-test-unit comments-test-unit test-build \
	deploy redeploy clean comments-dev comments-db-create comments-db-migrate comments-db-migrate-local \
	comments-secrets deploy-comments comments-pending

help:
	@echo "make build          - assemble the whole site into dist/ (uses ../<game> checkouts when present)"
	@echo "make build-remote   - same, but always from fresh GitHub clones (what CI does)"
	@echo "make build-landing  - landing page only (fast)"
	@echo "make serve          - build, then serve dist/ at http://localhost:$(PORT)"
	@echo "make test           - unit tests, then a full build and checks on dist/"
	@echo "make test-unit      - unit tests only"
	@echo "make deploy         - push main; GitHub Actions builds and publishes"
	@echo "make redeploy       - rebuild and publish now without a push (e.g. right after a game changed)"
	@echo ""
	@echo "Guestbook (comments/, a Cloudflare Worker):"
	@echo "make comments-test-unit  - unit tests for the guestbook"
	@echo "make comments-dev        - run the guestbook locally at http://localhost:8787"
	@echo "make deploy-comments     - publish the guestbook Worker"
	@echo "make comments-pending    - list comments still waiting for review"

build:
	@node scripts/build.mjs

build-remote:
	@GAMES_SOURCE=remote node scripts/build.mjs

build-landing:
	@node scripts/build.mjs --landing-only

serve: build
	@echo "naomiyohomie.com preview - http://localhost:$(PORT)"
	@python3 -m http.server $(PORT) --directory dist

test: test-unit test-build

test-unit: site-test-unit comments-test-unit

site-test-unit:
	@node --test test/unit/*.test.mjs

comments-test-unit:
	@node --test comments/test/*.test.mjs

# Checks the assembled site, so it needs a full build first.
test-build: build
	@node --test test/build/*.test.mjs

deploy:
	@git push origin HEAD:main
	@echo "Pushed. GitHub Actions will build and publish - check the Actions tab."

redeploy:
	@gh workflow run deploy.yml
	@echo "Triggered. Watch it with: gh run watch"

# ---------- guestbook (comments/) ----------

WRANGLER = cd comments && npx wrangler

comments-dev: comments-db-migrate-local
	@test -f comments/.dev.vars || cp comments/.dev.vars.example comments/.dev.vars
	@$(WRANGLER) dev --port 8787

comments-db-migrate-local:
	@$(WRANGLER) d1 migrations apply naomiyohomie-comments --local

# One time: creates the database. Copy the printed database_id into comments/wrangler.toml.
comments-db-create:
	@$(WRANGLER) d1 create naomiyohomie-comments

comments-db-migrate:
	@$(WRANGLER) d1 migrations apply naomiyohomie-comments --remote

# One time (or to rotate): prompts for each secret.
comments-secrets:
	@echo "MOD_SECRET: paste a long random string, e.g. from: openssl rand -base64 48"
	@$(WRANGLER) secret put MOD_SECRET
	@echo "MOD_EMAIL: the address that gets the review emails"
	@$(WRANGLER) secret put MOD_EMAIL
	@echo "TURNSTILE_SECRET: the secret key of the Turnstile widget"
	@$(WRANGLER) secret put TURNSTILE_SECRET

deploy-comments: comments-test-unit comments-db-migrate
	@$(WRANGLER) deploy

# In case a review email went missing.
comments-pending:
	@$(WRANGLER) d1 execute naomiyohomie-comments --remote \
		--command "SELECT id, name, substr(message, 1, 60) AS message, datetime(created_at, 'unixepoch') AS at FROM comments WHERE status = 'pending' ORDER BY created_at"

clean:
	rm -rf dist .cache
