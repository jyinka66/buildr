#!/bin/sh
set -eu

# Render does not expose a host Docker socket. In hosted deployments, connect
# to a dedicated Docker host using mutual TLS credentials stored as secret envs.
# Local Docker Compose keeps using the mounted /var/run/docker.sock.
if [ -n "${DOCKER_HOST:-}" ] && [ -n "${DOCKER_CA_PEM:-}" ] && [ -n "${DOCKER_CLIENT_CERT_PEM:-}" ] && [ -n "${DOCKER_CLIENT_KEY_PEM:-}" ]; then
  export DOCKER_CERT_PATH="${DOCKER_CERT_PATH:-/tmp/buildr-docker-certs}"
  mkdir -p "$DOCKER_CERT_PATH"
  chmod 700 "$DOCKER_CERT_PATH"
  printf '%s' "$DOCKER_CA_PEM" > "$DOCKER_CERT_PATH/ca.pem"
  printf '%s' "$DOCKER_CLIENT_CERT_PEM" > "$DOCKER_CERT_PATH/cert.pem"
  printf '%s' "$DOCKER_CLIENT_KEY_PEM" > "$DOCKER_CERT_PATH/key.pem"
  chmod 600 "$DOCKER_CERT_PATH/ca.pem" "$DOCKER_CERT_PATH/cert.pem" "$DOCKER_CERT_PATH/key.pem"
  export DOCKER_TLS_VERIFY=1
  unset DOCKER_CA_PEM DOCKER_CLIENT_CERT_PEM DOCKER_CLIENT_KEY_PEM
fi

exec "$@"
