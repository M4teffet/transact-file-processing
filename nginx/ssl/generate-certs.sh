#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# generate-certs.sh
# Generates a self-signed TLS certificate for local / self-hosted deployments.
#
# Usage:
#   cd nginx/ssl
#   bash generate-certs.sh
#
# For production, replace cert.pem / key.pem with certificates issued by a
# trusted CA (Let's Encrypt, your internal PKI, etc.).  The file names must
# stay the same, or update ssl_certificate / ssl_certificate_key in nginx.conf.
# ──────────────────────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout "$SCRIPT_DIR/key.pem" \
  -out    "$SCRIPT_DIR/cert.pem" \
  -days   3650 \
  -subj   "/C=CI/ST=Abidjan/L=Abidjan/O=Transact/OU=Internal/CN=transact.local" \
  -addext "subjectAltName=DNS:localhost,DNS:transact.local,IP:127.0.0.1"

chmod 600 "$SCRIPT_DIR/key.pem"

echo ""
echo "✅  cert.pem and key.pem generated in $SCRIPT_DIR"
echo "    Valid for 10 years (self-signed — browser will show a warning)."
echo "    For production, replace these files with CA-signed certificates."
