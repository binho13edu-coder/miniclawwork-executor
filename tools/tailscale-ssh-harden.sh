#!/usr/bin/env bash
# ==============================================================================
# README
# ==============================================================================
# - This script assumes Tailscale is installed and running on the system.
# - Run this script manually with sudo, never via cron or bot.
# - WARNING: There is a risk of lockout if Tailscale is not active or if 
#   the connection is dropped. Ensure Tailscale is stable before running.
# ==============================================================================

set -e

CONFIG_FILE="/etc/ssh/sshd_config"
BACKUP_FILE="${CONFIG_FILE}.bak.$(date +%s)"

log() {
    echo "[INFO] $1"
}

error() {
    echo "[ERROR] $1" >&2
    exit 1
}

if [[ $EUID -ne 0 ]]; then
    error "This script must be run as root (use sudo)."
fi

log "Looking for tailscale0 IP address..."
TS_IP=$(ip -4 addr show tailscale0 2>/dev/null | awk '/inet / {print $2}' | cut -d/ -f1 | head -n 1)

if [[ -z "$TS_IP" ]]; then
    error "Could not determine tailscale0 IP. Is Tailscale running?"
fi

log "Found tailscale0 IP: $TS_IP"

log "Backing up $CONFIG_FILE to $BACKUP_FILE..."
cp -p "$CONFIG_FILE" "$BACKUP_FILE"

update_directive() {
    local key="$1"
    local val="$2"
    
    if grep -q -i -E "^#?[[:space:]]*${key}[[:space:]]+" "$CONFIG_FILE"; then
        sed -i -E "s/^#?[[:space:]]*${key}[[:space:]]+.*$/${key} ${val}/i" "$CONFIG_FILE"
    else
        echo "${key} ${val}" >> "$CONFIG_FILE"
    fi
    log "Configured ${key} ${val}"
}

update_directive "ListenAddress" "$TS_IP"
update_directive "PermitRootLogin" "no"
update_directive "PasswordAuthentication" "no"
update_directive "PubkeyAuthentication" "yes"

log "Validating new sshd configuration (sshd -t)..."
if ! sshd -t; then
    log "Validation failed! Restoring from backup..."
    cp -p "$BACKUP_FILE" "$CONFIG_FILE"
    error "sshd configuration validation failed. Original configuration restored."
fi

log "Validation successful. Restarting sshd..."
if systemctl restart sshd; then
    log "sshd restarted successfully."
else
    error "Failed to restart sshd."
fi

log "Tailscale SSH hardening completed."
