PORT ?= 8090

.PHONY: help build build-remote build-landing serve test test-unit test-build deploy redeploy clean

help:
	@echo "make build          - assemble the whole site into dist/ (uses ../<game> checkouts when present)"
	@echo "make build-remote   - same, but always from fresh GitHub clones (what CI does)"
	@echo "make build-landing  - landing page only (fast)"
	@echo "make serve          - build, then serve dist/ at http://localhost:$(PORT)"
	@echo "make test           - unit tests, then a full build and checks on dist/"
	@echo "make test-unit      - unit tests only"
	@echo "make deploy         - push main; GitHub Actions builds and publishes"
	@echo "make redeploy       - rebuild and publish now without a push (e.g. right after a game changed)"

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

test-unit:
	@node --test test/unit/*.test.mjs

# Checks the assembled site, so it needs a full build first.
test-build: build
	@node --test test/build/*.test.mjs

deploy:
	@git push origin HEAD:main
	@echo "Pushed. GitHub Actions will build and publish - check the Actions tab."

redeploy:
	@gh workflow run deploy.yml
	@echo "Triggered. Watch it with: gh run watch"

clean:
	rm -rf dist .cache
