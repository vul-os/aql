# syntax=docker/dockerfile:1
#
# Aql hub — one static Go binary, one SQLite file.
#
# Build (from repo root):   docker build -f hub/Dockerfile -t aql-hub .
#   The context is the REPOSITORY ROOT and the trailing `.` is load-bearing;
#   A context of `hub/` alone is the three-day outage described at COPY jcs/.
# Run:                      docker run -d -p 8080:8080 -v lintel-data:/data \
#                             ghcr.io/vul-os/aql-hub:latest
#
# Configuration (flags-over-env, see cmd/hub/main.go):
#   AQL_DATA_DIR     data directory (SQLite db, signing keys)  default /data (set below)
#   AQL_LISTEN       listen address                            default :8080 (set below)
#   AQL_PUBLIC_URL   external base URL (webhooks, links)       default ""
#   ADMIN_CLAIM_TOKEN   one-shot admin claim token                default "" (claiming disabled)
#   AQL_BEHIND_PROXY permit AQL_LISTEN's non-loopback bind  set below, see note
#
# The final image is distroless (no shell, no curl/wget). The HEALTHCHECK is a
# tiny stdlib-only Go probe compiled here in the builder stage — it lives in
# this Dockerfile, not in the hub source tree — that GETs /health on the
# AQL_LISTEN port and exits non-zero unless it answers 200.
#
# TLS note: this binary serves plain HTTP — there is no built-in TLS/ACME (see
# cmd/hub/main.go's doc comment). By default it refuses to bind anything
# but a loopback address, precisely so an operator can't accidentally publish
# cleartext admin/login/signing endpoints. AQL_LISTEN=:8080 below IS a
# non-loopback (wildcard) bind — that is what lets `docker run -p` publish the
# port at all, since the container's own loopback interface isn't reachable
# from outside it. So this image sets AQL_BEHIND_PROXY=1 to declare that
# intent explicitly: it is on YOU, the operator, to put a real TLS-terminating
# reverse proxy in front of the published port (or restrict the -p mapping to
# 127.0.0.1 on the host and put the proxy there) — this env var does not add
# TLS, it only tells the hub you have handled TLS elsewhere.
#
# Data note: /data is baked owned by nonroot (uid 65532). Named volumes inherit
# that ownership; if you bind-mount a host directory instead, chown it to 65532.

FROM golang:1.25-alpine AS build

# BUILD CONTEXT IS THE REPOSITORY ROOT, not hub/.
#
# hub/go.mod carries `replace github.com/vul-os/aql/jcs => ../jcs`, so the
# sibling module has to be inside the context. It was not: the workflow built
# with `context: hub`, and `go mod download` failed with
#
#	reading /jcs/go.mod: open /jcs/go.mod: no such file or directory
#
# for three days, from the commit that added the replace. The image is what the
# release notes point people at, so it was advertised and unbuildable — nothing
# else in CI builds it, which is why nothing said so.
WORKDIR /src

# Cache module downloads separately from source changes. Both modules' manifests
# are needed before download, because the replace is resolved at that point.
COPY hub/go.mod hub/go.sum ./hub/
COPY jcs/go.mod ./jcs/
WORKDIR /src/hub
RUN go mod download

WORKDIR /src
COPY jcs/ ./jcs/
COPY hub/ ./hub/
WORKDIR /src/hub

ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath \
      -ldflags "-s -w -X main.Version=${VERSION}" \
      -o /out/aql-hub ./cmd/hub

# Health probe: stdlib-only, kept out of the gateway module on purpose.
RUN mkdir -p /probe && cat > /probe/main.go <<'EOF'
package main

import (
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

func main() {
	addr := os.Getenv("AQL_LISTEN")
	if addr == "" {
		addr = ":8080"
	}
	if strings.HasPrefix(addr, ":") {
		addr = "127.0.0.1" + addr
	}
	client := &http.Client{Timeout: 4 * time.Second}
	resp, err := client.Get("http://" + addr + "/health")
	if err != nil {
		fmt.Fprintln(os.Stderr, "healthprobe:", err)
		os.Exit(1)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, "healthprobe: status", resp.Status)
		os.Exit(1)
	}
}
EOF
RUN cd /probe && go mod init healthprobe >/dev/null \
 && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/healthprobe .

# Pre-create /data with the runtime uid so the volume is writable by nonroot.
RUN mkdir -p /out/data && chown 65532:65532 /out/data

FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=build /out/aql-hub /aql-hub
COPY --from=build /out/healthprobe /healthprobe
COPY --from=build --chown=65532:65532 /out/data /data

ENV AQL_DATA_DIR=/data \
    AQL_LISTEN=:8080 \
    AQL_BEHIND_PROXY=1

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/healthprobe"]

USER nonroot
ENTRYPOINT ["/aql-hub"]
