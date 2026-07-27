GO ?= go
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo 0.1.0-dev)
LDFLAGS := -s -w -X main.Version=$(VERSION)

.PHONY: build build-portal portal run test vet fmt check clean

build:
	CGO_ENABLED=0 $(GO) build -ldflags '$(LDFLAGS)' -o bin/aql-hub ./cmd/hub

# portal: copy the built React SPA into the embed dir, then build with the
# portal tag so the binary serves it (see internal/portal/portal.go).
portal:
	cd .. && npm run build && rm -rf hub/internal/portal/dist && cp -r dist hub/internal/portal/dist

build-portal:
	CGO_ENABLED=0 $(GO) build -tags portal -ldflags '$(LDFLAGS)' -o bin/aql-hub ./cmd/hub

run: build
	./bin/aql-hub -data ./data

test:
	$(GO) test ./...

vet:
	$(GO) vet ./...

fmt:
	gofmt -l -w .

check: vet test
	@test -z "$$(gofmt -l .)" || (echo 'gofmt needed:' && gofmt -l . && exit 1)

clean:
	rm -rf bin
