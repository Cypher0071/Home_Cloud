#!/usr/bin/env bash
# ==============================================================================
# Home Cloud — Bare-Metal & Standalone Host Setup Script
# ==============================================================================
set -euo pipefail

# --- CLI Flag Parsing & Configuration Defaults ---
DRY_RUN="${DRY_RUN:-false}"
NON_INTERACTIVE="${NON_INTERACTIVE:-false}"
SKIP_CLOUDFLARED="${SKIP_CLOUDFLARED:-false}"
CF_DOMAIN_INPUT="${CF_DOMAIN:-${CLOUDFLARE_DOMAIN:-}}"
TUNNEL_NAME_INPUT="${TUNNEL_NAME:-home-cloud}"
ADMIN_PASS_INPUT="${HOME_CLOUD_PASSWORD:-}"
TARGET_DIR="${HOME_CLOUD_DIR:-}"
BRANCH="${HOME_CLOUD_BRANCH:-v1.0.1}"

show_help() {
    printf '%s\n' \
        'Home Cloud — Production Host & Systemd Installer' \
        '' \
        'Usage:' \
        '  ./setup.sh [OPTIONS]' \
        '' \
        '  curl -fsSL https://raw.githubusercontent.com/Cypher0071/Home_Cloud/v1.0.1/setup.sh -o setup.sh' \
        '  bash setup.sh [OPTIONS]' \
        '' \
        'Options:' \
        '  -h, --help                    Show this help message and exit' \
        '  -d, --domain <domain>         Cloudflare root domain for tunnel (e.g. example.com)' \
        '  -p, --password <password>     Dashboard admin password, at least 8 characters (auto-generated into agent/.env if omitted; never printed)' \
        '  --tunnel <name>               Cloudflare tunnel name (default: home-cloud)' \
        '  --dir <path>                  Installation target directory (default: current repo or $HOME/home-cloud)' \
        '  --service-user <user>         Non-root account for the systemd unit when running as root' \
        '  --branch <branch>             Git ref to install (default: v1.0.1)' \
        '  -y, --yes, --non-interactive  Non-interactive mode (auto-accept defaults, no prompts)' \
        '  --skip-cloudflared            Skip cloudflared download, installation, and tunnel configuration' \
        '  --dry-run, --check-only       Verify prerequisites, flags, and configuration without modifying system' \
        '' \
        'Environment Variables:' \
        '  HOME_CLOUD_PASSWORD           Admin dashboard password (at least 8 characters; not printed)' \
        '  CF_DOMAIN                     Cloudflare root domain' \
        '  TUNNEL_NAME                   Cloudflare tunnel name' \
        '  HOME_CLOUD_DIR                Installation directory' \
        '  HOME_CLOUD_BRANCH             Git ref to install (default: v1.0.1)' \
        '  HOME_CLOUD_SERVICE_USER       Non-root account for the systemd unit when the installer is root' \
        '  NON_INTERACTIVE=true          Run non-interactively' \
        '  SKIP_CLOUDFLARED=true         Skip cloudflared' \
        '  DRY_RUN=true                  Simulate setup without modifying system' \
        '' \
        'Documentation: https://github.com/Cypher0071/home_cloud'
}

while [ $# -gt 0 ]; do
    case "$1" in
        -h|--help)
            show_help
            exit 0
            ;;
        -d|--domain)
            if [ -z "${2:-}" ] || [[ "${2:-}" == -* ]]; then
                echo "❌ Error: $1 requires a domain argument." >&2
                exit 1
            fi
            CF_DOMAIN_INPUT="$2"
            shift 2
            ;;
        --domain=*)
            CF_DOMAIN_INPUT="${1#*=}"
            shift
            ;;
        -d=*)
            CF_DOMAIN_INPUT="${1#*=}"
            shift
            ;;
        -p|--password)
            if [ -z "${2:-}" ]; then
                echo "❌ Error: $1 requires a password argument." >&2
                exit 1
            fi
            ADMIN_PASS_INPUT="$2"
            shift 2
            ;;
        --password=*)
            ADMIN_PASS_INPUT="${1#*=}"
            shift
            ;;
        -p=*)
            ADMIN_PASS_INPUT="${1#*=}"
            shift
            ;;
        --tunnel)
            if [ -z "${2:-}" ] || [[ "${2:-}" == -* ]]; then
                echo "❌ Error: --tunnel requires a tunnel name argument." >&2
                exit 1
            fi
            TUNNEL_NAME_INPUT="$2"
            shift 2
            ;;
        --tunnel=*)
            TUNNEL_NAME_INPUT="${1#*=}"
            shift
            ;;
        --dir)
            if [ -z "${2:-}" ] || [[ "${2:-}" == -* ]]; then
                echo "❌ Error: --dir requires a path argument." >&2
                exit 1
            fi
            TARGET_DIR="$2"
            shift 2
            ;;
        --dir=*)
            TARGET_DIR="${1#*=}"
            shift
            ;;
        --service-user)
            if [ -z "${2:-}" ] || [[ "${2:-}" == -* ]]; then
                echo "❌ Error: --service-user requires a username argument." >&2
                exit 1
            fi
            HOME_CLOUD_SERVICE_USER="$2"
            shift 2
            ;;
        --service-user=*)
            HOME_CLOUD_SERVICE_USER="${1#*=}"
            shift
            ;;
        --branch)
            if [ -z "${2:-}" ] || [[ "${2:-}" == -* ]]; then
                echo "❌ Error: --branch requires a branch name argument." >&2
                exit 1
            fi
            BRANCH="$2"
            shift 2
            ;;
        --branch=*)
            BRANCH="${1#*=}"
            shift
            ;;
        -y|--yes|--non-interactive)
            NON_INTERACTIVE=true
            shift
            ;;
        --skip-cloudflared)
            SKIP_CLOUDFLARED=true
            shift
            ;;
        --dry-run|--check-only)
            DRY_RUN=true
            shift
            ;;
        *)
            echo "❌ Error: Unknown option '$1'. Run with --help for usage information." >&2
            exit 1
            ;;
    esac
done

if [ -n "$ADMIN_PASS_INPUT" ]; then
    if [[ "$ADMIN_PASS_INPUT" == *$'\r'* || "$ADMIN_PASS_INPUT" == *$'\n'* ]]; then
        echo "❌ Error: password must not contain CR or LF." >&2
        exit 1
    fi
    if [ "${#ADMIN_PASS_INPUT}" -lt 8 ]; then
        echo "❌ Error: --password must be at least 8 characters." >&2
        exit 1
    fi
fi

if [ -n "$TARGET_DIR" ]; then
    case "$TARGET_DIR" in
        *$'\r'*|*$'\n'*|*'|'*|*'&'*)
            echo "❌ Error: --dir must not contain control characters, newlines, '''|''', or '''&'''." >&2
            exit 1
            ;;
    esac
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$PWD}")" 2>/dev/null && pwd || pwd)"
SYSTEMD_DIR="${HOME_CLOUD_SYSTEMD_DIR:-/etc/systemd/system}"
TARGET_SERVICE="$SYSTEMD_DIR/home-cloud.service"

echo "========================================================"
echo "  Home Cloud — Production Host & Systemd Installer      "
echo "========================================================"
if [ "$DRY_RUN" = true ]; then
    echo "🔍 RUNNING IN DRY-RUN / CHECK-ONLY MODE (NO CHANGES WILL BE MADE)"
fi

# 0. Wait for apt / dpkg locks on fresh boot (e.g. unattended-upgrades)
wait_for_apt_lock() {
    if [ "${DRY_RUN:-false}" = "true" ]; then
        return 0
    fi
    local timeout=300
    local elapsed=0
    while run_privileged fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || \
          run_privileged fuser /var/lib/apt/lists/lock >/dev/null 2>&1 || \
          run_privileged fuser /var/lib/dpkg/lock >/dev/null 2>&1; do
        if [ "$elapsed" -eq 0 ]; then
            echo "⏳ System package manager is busy (unattended-upgrades / apt-daily). Waiting for locks to release..."
        fi
        sleep 2
        elapsed=$((elapsed + 2))
        if [ "$elapsed" -ge "$timeout" ]; then
            echo "❌ Timed out waiting for system package manager lock." >&2
            exit 1
        fi
    done
}

# 1. Resolve Execution Context & Actual User (handles sudo ./setup.sh and sudo curl cleanly)
if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
    CURRENT_USER="$SUDO_USER"
    CURRENT_GROUP="$(id -gn "$SUDO_USER" 2>/dev/null || echo "$SUDO_USER")"
    CURRENT_HOME="$(getent passwd "$SUDO_USER" 2>/dev/null | cut -d: -f6 || true)"
    if [ -z "$CURRENT_HOME" ]; then
        CURRENT_HOME="/home/$CURRENT_USER"
    fi
else
    CURRENT_USER="$(id -un)"
    CURRENT_GROUP="$(id -gn 2>/dev/null || echo "$CURRENT_USER")"
    CURRENT_HOME="${HOME:-/home/$CURRENT_USER}"
fi

# Never render a systemd unit with User=root. A direct root shell (empty
# SUDO_USER) must set HOME_CLOUD_SERVICE_USER to a non-root account.
apply_service_user_policy() {
    if [ "${CURRENT_USER:-}" != "root" ]; then
        return 0
    fi
    if [ -n "${HOME_CLOUD_SERVICE_USER:-}" ] && [ "$HOME_CLOUD_SERVICE_USER" != "root" ]; then
        if ! id -u "$HOME_CLOUD_SERVICE_USER" >/dev/null 2>&1; then
            echo "❌ HOME_CLOUD_SERVICE_USER='$HOME_CLOUD_SERVICE_USER' is not a local account." >&2
            exit 1
        fi
        CURRENT_USER="$HOME_CLOUD_SERVICE_USER"
        CURRENT_GROUP="$(id -gn "$HOME_CLOUD_SERVICE_USER" 2>/dev/null || echo "$HOME_CLOUD_SERVICE_USER")"
        CURRENT_HOME="$(getent passwd "$HOME_CLOUD_SERVICE_USER" 2>/dev/null | cut -d: -f6 || true)"
        if [ -z "$CURRENT_HOME" ]; then
            CURRENT_HOME="/home/$CURRENT_USER"
        fi
        echo "✔ Service user:       $CURRENT_USER (HOME_CLOUD_SERVICE_USER)"
        return 0
    fi
    echo "❌ Refusing to render a systemd unit with User=root." >&2
    if [ -z "${SUDO_USER:-}" ]; then
        echo "   CURRENT_USER is root and SUDO_USER is empty." >&2
    fi
    echo "   Set HOME_CLOUD_SERVICE_USER to a non-root account and re-run setup.sh." >&2
    if [ "${DRY_RUN:-false}" = true ]; then
        echo "[DRY-RUN] A root shell would refuse to install the service as User=root. Set HOME_CLOUD_SERVICE_USER to a non-root account." >&2
    fi
    exit 1
}

apply_service_user_policy

run_as_current_user() {
    if [ "$EUID" -eq 0 ] && [ "$CURRENT_USER" != "root" ]; then
        sudo -u "$CURRENT_USER" -H "$@"
    else
        "$@"
    fi
}

run_privileged() {
    if [ "$EUID" -eq 0 ]; then
        "$@"
    else
        if ! command -v sudo >/dev/null 2>&1; then
            echo "❌ Error: sudo is required for system configuration tasks." >&2
            exit 1
        fi
        sudo "$@"
    fi
}

# Interactive input reader that handles curl piped input via /dev/tty safely
read_input() {
    local prompt="$1"
    local var_name="$2"
    local is_secret="${3:-false}"
    if [ "${NON_INTERACTIVE:-false}" = "true" ]; then
        return 1
    fi
    # Support mock test harnesses (like verify_setup_tunnel.mjs) where input is piped on stdin
    if [ "${SETUP_FORCE_INTERACTIVE:-false}" = "true" ]; then
        if [ "$is_secret" = true ]; then
            read -rsp "$prompt" "$var_name" || return 1
            echo "" >&2
        else
            read -rp "$prompt" "$var_name" || return 1
        fi
        return 0
    fi
    # If running interactively with a TTY on stdin
    if [ -t 0 ]; then
        if [ "$is_secret" = true ]; then
            read -rsp "$prompt" "$var_name" || return 1
            echo "" >&2
        else
            read -rp "$prompt" "$var_name" || return 1
        fi
        return 0
    fi
    # If stdin is not a terminal, read from the controlling terminal when one is attached.
    if { [ -t 1 ] || [ -t 2 ]; } && [ -e /dev/tty ] && ( : < /dev/tty ) 2>/dev/null; then
        if [ "$is_secret" = true ]; then
            read -rsp "$prompt" "$var_name" < /dev/tty || return 1
            echo "" >&2
        else
            read -rp "$prompt" "$var_name" < /dev/tty || return 1
        fi
        return 0
    fi
    return 1
}

# ==============================================================================
# Transaction, journal, and atomic-write helpers
# ==============================================================================
# >>> HOME CLOUD TRANSACTION HELPERS >>>
# setup.sh is a long, multi-phase installer. A SIGINT/SIGTERM trap can clean up
# the current process, but SIGKILL and power loss cannot. The journal records
# enough intent that the next run can recognise and reconcile a stale attempt
# without deleting pre-existing user state. Nothing here ever records secrets.
SETUP_ATTEMPT_ID="$(date +%s 2>/dev/null || echo 0)-$$-$RANDOM"
SETUP_STATE_BASE="${HOME_CLOUD_STATE_DIR:-${XDG_STATE_HOME:-$CURRENT_HOME/.local/state}/home-cloud}"
SETUP_STATE_DIR="$SETUP_STATE_BASE/setup"
SETUP_LOCK_FILE="$SETUP_STATE_BASE/setup.lock"
SETUP_STATE_KEY=""
SETUP_JOURNAL_FILE=""
declare -A SETUP_JOURNAL=()
SETUP_TXN_ACTIVE=false
SETUP_TXN_COMPLETE=false
SETUP_LOCK_HELD=false
SETUP_LOCK_DIR=""
SETUP_PHASE="init"
SETUP_TEMP_FILES=()
SETUP_TEMP_DIRS=()
SETUP_ROLLBACK_FUNCS=()

RECOVERED_ENV_CREATED=no
RECOVERED_INSTALL_DIR_CLAIM=no
RECOVERED_TUNNEL_CREATED=no
RECOVERED_TUNNEL_DELETE_ALLOWED=no
RECOVERED_TUNNEL_ID=""
RECOVERED_GIT_CHECKOUT_INTERRUPTED=no
RECOVERED_CF_CONFIG_CREATED=no
RECOVERED_SERVICE_RESTORE_FAILED=no

INSTALL_DIR_PREEXISTING=no
INSTALL_DIR_WAS_EMPTY=no
INSTALL_DIR_CLAIM=no
ENV_CREATED_BY_SETUP=no
TUNNEL_CREATED_BY_SETUP=no
CF_CONFIG_CREATED_BY_SETUP=no

durable_sync_file() {
    [ -n "${1:-}" ] || return 0
    sync -f -- "$1" >/dev/null 2>&1
}

durable_sync_dir() {
    [ -n "${1:-}" ] || return 0
    sync -f -- "$1" >/dev/null 2>&1
}

register_temp_file() {
    [ -n "${1:-}" ] || return 0
    SETUP_TEMP_FILES+=("$1")
}

register_temp_dir() {
    [ -n "${1:-}" ] || return 0
    SETUP_TEMP_DIRS+=("$1")
}

journal_put() {
    local key="$1"
    local value="${2:-}"
    [ -n "$SETUP_JOURNAL_FILE" ] || return 0
    case "$key" in
        *[!A-Za-z0-9_]*|'') return 1 ;;
    esac
    case "$value" in
        *$'\r'*|*$'\n'*) return 1 ;;
    esac
    SETUP_JOURNAL["$key"]="$value"
    journal_flush
}

journal_put_critical() {
    local key="$1"
    local value="${2:-}"
    if ! journal_put "$key" "$value"; then
        echo "❌ Fatal: Failed to persist critical journal record ($key=$value) to $SETUP_JOURNAL_FILE." >&2
        echo "   Aborting to prevent untracked state modifications." >&2
        exit 1
    fi
}

journal_flush() {
    [ -n "$SETUP_JOURNAL_FILE" ] || return 0
    [ "${HOME_CLOUD_SIMULATE_JOURNAL_FAIL:-0}" != "1" ] || return 1
    local tmp="" key
    tmp="$(mktemp "${SETUP_JOURNAL_FILE}.home-cloud-tmp.XXXXXX")" || return 1
    {
        printf 'version=1\n'
        for key in "${!SETUP_JOURNAL[@]}"; do
            printf '%s=%s\n' "$key" "${SETUP_JOURNAL[$key]}"
        done
    } > "$tmp" || { rm -f "$tmp"; return 1; }
    chmod 600 "$tmp" 2>/dev/null || true
    durable_sync_file "$tmp" || { rm -f -- "$tmp"; return 1; }
    mv -fT -- "$tmp" "$SETUP_JOURNAL_FILE" || { rm -f "$tmp"; return 1; }
    durable_sync_dir "$(dirname "$SETUP_JOURNAL_FILE")" || return 1
}

journal_load() {
    local file="$1"
    local key value
    SETUP_JOURNAL=()
    [ -f "$file" ] || return 0
    while IFS='=' read -r key value; do
        case "$key" in
            ''|'#'*) continue ;;
        esac
        [[ "$key" =~ ^[A-Za-z0-9_]+$ ]] || continue
        SETUP_JOURNAL["$key"]="$value"
    done < "$file"
}

dir_has_entries() {
    local dir="$1"
    local entry
    [ -d "$dir" ] || return 1
    for entry in "$dir"/* "$dir"/.[!.]* "$dir"/..?*; do
        if [ -e "$entry" ] || [ -L "$entry" ]; then
            return 0
        fi
    done
    return 1
}

cleanup_pattern_in_dir() {
    local dir="$1"
    local pattern="$2"
    local entry
    [ -d "$dir" ] || return 0
    for entry in "$dir"/$pattern; do
        [ -e "$entry" ] || [ -L "$entry" ] || continue
        rm -f -- "$entry" 2>/dev/null || run_privileged rm -f -- "$entry" 2>/dev/null || true
    done
}

cleanup_owned_temp_files() {
    local install_dir="${INSTALL_DIR:-}"
    local parent=""
    local entry=""
    cleanup_pattern_in_dir "$CURRENT_HOME/.cloudflared" '.config.yml.home-cloud-tmp.*'
    cleanup_pattern_in_dir "$SETUP_STATE_DIR" 'transaction-*.home-cloud-tmp.*'
    if [ -n "$SETUP_STATE_KEY" ]; then
        cleanup_pattern_in_dir "$SETUP_STATE_DIR" "service-unit.${SETUP_STATE_KEY}.render.*"
    fi
    cleanup_pattern_in_dir "$(dirname "$TARGET_SERVICE")" '.home-cloud.service.home-cloud-tmp.*'
    cleanup_pattern_in_dir "/usr/local/bin" '.cloudflared.home-cloud-tmp.*'
    if [ -n "$install_dir" ]; then
        cleanup_pattern_in_dir "$install_dir/agent" '.env.home-cloud-tmp.*'
        parent="$(dirname "$install_dir")"
        for entry in "$parent"/"$(basename "$install_dir")".home-cloud-clone.*; do
            if [ -d "$entry" ] && [ ! -L "$entry" ]; then
                # Only remove staging directories that carry our marker, plus
                # empty shells left between mkdir and marker creation.
                if [ -f "$entry/.home-cloud-attempt" ] || ! dir_has_entries "$entry"; then
                    rm -rf -- "$entry" 2>/dev/null || run_privileged rm -rf -- "$entry" 2>/dev/null || true
                fi
            fi
        done
    fi
    for entry in "${TMPDIR:-/tmp}"/home-cloud-setup.*; do
        if [ -d "$entry" ] && [ ! -L "$entry" ] && [ -f "$entry/.home-cloud-attempt" ]; then
            rm -rf -- "$entry" 2>/dev/null || run_privileged rm -rf -- "$entry" 2>/dev/null || true
        fi
    done
}
cleanup_current_temps() {
    local entry
    for entry in "${SETUP_TEMP_FILES[@]}"; do
        [ -e "$entry" ] || [ -L "$entry" ] || continue
        rm -f -- "$entry" 2>/dev/null || run_privileged rm -f -- "$entry" 2>/dev/null || true
    done
    for entry in "${SETUP_TEMP_DIRS[@]}"; do
        [ -d "$entry" ] || continue
        rm -rf -- "$entry" 2>/dev/null || run_privileged rm -rf -- "$entry" 2>/dev/null || true
    done
    SETUP_TEMP_FILES=()
    SETUP_TEMP_DIRS=()
}

recover_service_unit_backup() {
    local touched="${SETUP_JOURNAL[service_unit_touched]:-no}"
    local backup="${SETUP_JOURNAL[service_unit_backup]:-}"
    local journal_target="${SETUP_JOURNAL[service_unit_target]:-}"
    local restore_tmp=""

    # A backup is recorded before it is created. If the process died before
    # the target replacement intent was committed, the target is untouched;
    # remove only that journal-owned partial backup on the next run.
    if [ "$touched" != "yes" ]; then
        if [ "${SETUP_JOURNAL[service_unit_preexisting]:-no}" = "yes" ] && [ -n "$backup" ]; then
            case "$backup" in
                "$SETUP_STATE_DIR/service-unit.$SETUP_STATE_KEY.backup."*) ;;
                *)
                    echo "⚠️ Interrupted setup recorded an invalid systemd backup path; refusing to remove it." >&2
                    RECOVERED_SERVICE_RESTORE_FAILED=yes
                    return 0
                    ;;
            esac
            if [ -e "$backup" ] || [ -L "$backup" ]; then
                if ! rm -f -- "$backup" 2>/dev/null && ! run_privileged rm -f -- "$backup" 2>/dev/null; then
                    echo "⚠️ Could not remove the incomplete systemd backup at $backup." >&2
                    RECOVERED_SERVICE_RESTORE_FAILED=yes
                    return 0
                fi
                durable_sync_dir "$SETUP_STATE_DIR" || {
                    echo "⚠️ Could not sync systemd backup cleanup in $SETUP_STATE_DIR." >&2
                    RECOVERED_SERVICE_RESTORE_FAILED=yes
                    return 0
                }
            fi
        fi
        return 0
    fi
    if [ "${SETUP_JOURNAL[service_unit_preexisting]:-no}" != "yes" ]; then
        run_privileged rm -f -- "$TARGET_SERVICE" 2>/dev/null || true
        return 0
    fi
    case "$backup" in
        "$SETUP_STATE_DIR/service-unit.$SETUP_STATE_KEY.backup."*) ;;
        *)
            echo "⚠️ Interrupted setup recorded an invalid systemd backup path; refusing to restore it." >&2
            RECOVERED_SERVICE_RESTORE_FAILED=yes
            return 0
            ;;
    esac
    if [ -z "$backup" ] || [ ! -f "$backup" ] || [ -L "$backup" ]; then
        echo "⚠️ Interrupted setup recorded a pre-existing systemd unit backup, but $backup is missing or invalid." >&2
        RECOVERED_SERVICE_RESTORE_FAILED=yes
        return 0
    fi
    if [ -n "$journal_target" ] && [ "$journal_target" != "$TARGET_SERVICE" ]; then
        echo "⚠️ Interrupted setup recorded a different systemd unit path; leaving its backup in place." >&2
        RECOVERED_SERVICE_RESTORE_FAILED=yes
        return 0
    fi
    if [ -L "$TARGET_SERVICE" ]; then
        echo "⚠️ $TARGET_SERVICE is now a symlink; refusing to overwrite it from the transaction backup." >&2
        RECOVERED_SERVICE_RESTORE_FAILED=yes
        return 0
    fi
    restore_tmp="$(run_privileged mktemp "$(dirname "$TARGET_SERVICE")/.home-cloud.service.home-cloud-tmp.XXXXXX")" || {
        echo "⚠️ Could not stage a systemd unit restore from $backup." >&2
        RECOVERED_SERVICE_RESTORE_FAILED=yes
        return 0
    }
    if run_privileged cp -p "$backup" "$restore_tmp" && \
       run_privileged mv -fT -- "$restore_tmp" "$TARGET_SERVICE"; then
        durable_sync_file "$TARGET_SERVICE" && durable_sync_dir "$(dirname "$TARGET_SERVICE")" || {
            echo "⚠️ Restored the systemd unit but could not confirm it was synced; keeping backup at $backup." >&2
            RECOVERED_SERVICE_RESTORE_FAILED=yes
            return 0
        }
        rm -f -- "$backup" 2>/dev/null || run_privileged rm -f -- "$backup" 2>/dev/null || true
        durable_sync_dir "$(dirname "$backup")"
        echo "↩ Restored the pre-existing systemd unit from the interrupted transaction."
        return 0
    fi
    rm -f -- "$restore_tmp" 2>/dev/null || run_privileged rm -f -- "$restore_tmp" 2>/dev/null || true
    echo "⚠️ Could not restore the pre-existing systemd unit; its backup was kept at $backup." >&2
    RECOVERED_SERVICE_RESTORE_FAILED=yes
}
recover_stale_transaction() {
    local prior_phase="${SETUP_JOURNAL[phase]:-unknown}"
    echo "♻️  Recovering interrupted Home Cloud setup transaction (last phase: $prior_phase)..."
    RECOVERED_ENV_CREATED="${SETUP_JOURNAL[env_created_by_setup]:-no}"
    RECOVERED_INSTALL_DIR_CLAIM="${SETUP_JOURNAL[install_dir_claim]:-no}"
    RECOVERED_TUNNEL_CREATED="${SETUP_JOURNAL[tunnel_created_by_setup]:-no}"
    RECOVERED_TUNNEL_ID="${SETUP_JOURNAL[tunnel_id]:-}"
    RECOVERED_CF_CONFIG_CREATED="${SETUP_JOURNAL[cf_config_created_by_setup]:-no}"
    if [ "$prior_phase" = "git_checkout" ]; then
        RECOVERED_GIT_CHECKOUT_INTERRUPTED=yes
    fi
    if [ "$RECOVERED_TUNNEL_CREATED" = "yes" ] || \
       { [ "${SETUP_JOURNAL[tunnel_pre_create_absent]:-no}" = "yes" ] && \
         [ "${SETUP_JOURNAL[tunnel_create_attempted]:-no}" = "yes" ]; }; then
        RECOVERED_TUNNEL_DELETE_ALLOWED=yes
    fi
    recover_service_unit_backup
    echo "✔ Stale transaction state identified; setup-owned temporary files will be reconciled."
}

begin_transaction() {
    local install_dir="$1"
    local state_key=""
    [ "$DRY_RUN" = true ] && return 0

    SETUP_TXN_ACTIVE=true
    SETUP_TXN_COMPLETE=false
    if command -v sha256sum >/dev/null 2>&1; then
        state_key="$(printf '%s' "$install_dir" | sha256sum | awk '{print $1}')"
    else
        state_key="$(printf '%s' "$install_dir" | cksum | awk '{print $1 "-" $2}')"
    fi
    SETUP_STATE_KEY="$state_key"
    SETUP_JOURNAL_FILE="$SETUP_STATE_DIR/transaction-${state_key}.state"

    if [ -f "$SETUP_JOURNAL_FILE" ]; then
        journal_load "$SETUP_JOURNAL_FILE"
        if [ -n "${SETUP_JOURNAL[install_dir]:-}" ] && [ "${SETUP_JOURNAL[install_dir]}" != "$install_dir" ]; then
            echo "❌ Refusing to reuse a setup journal that belongs to a different installation directory." >&2
            SETUP_TXN_ACTIVE=false
            SETUP_JOURNAL_FILE=""
            exit 1
        fi
        if [ "${SETUP_JOURNAL[status]:-unknown}" != "complete" ]; then
            recover_stale_transaction
        fi
    fi

    # Keep stale backup references if restoration could not be confirmed
    if [ "$RECOVERED_SERVICE_RESTORE_FAILED" = "yes" ]; then
        echo "❌ Cannot safely proceed: pre-existing systemd unit backup could not be restored." >&2
        echo "   The backup file and journal reference have been preserved." >&2
        exit 1
    fi

    # Clean setup-owned leftovers even when a previous run had already marked
    # its journal complete but was killed before removing its temporary files.
    cleanup_owned_temp_files

    if [ -e "$install_dir" ]; then
        INSTALL_DIR_PREEXISTING=yes
        if [ -d "$install_dir" ] && ! dir_has_entries "$install_dir"; then
            INSTALL_DIR_WAS_EMPTY=yes
        fi
    fi
    if [ "$RECOVERED_INSTALL_DIR_CLAIM" = "yes" ] || \
       { [ "$INSTALL_DIR_PREEXISTING" = "no" ] || [ "$INSTALL_DIR_WAS_EMPTY" = "yes" ]; }; then
        INSTALL_DIR_CLAIM=yes
    fi
    if [ "$RECOVERED_ENV_CREATED" = "yes" ]; then
        ENV_CREATED_BY_SETUP=yes
    fi
    if [ "$RECOVERED_TUNNEL_CREATED" = "yes" ]; then
        TUNNEL_CREATED_BY_SETUP=yes
    fi
    if [ "$RECOVERED_CF_CONFIG_CREATED" = "yes" ]; then
        CF_CONFIG_CREATED_BY_SETUP=yes
    fi

    SETUP_JOURNAL=()
    journal_put_critical status running
    journal_put_critical attempt "$SETUP_ATTEMPT_ID"
    journal_put_critical pid "$$"
    journal_put_critical started "$(date +%s 2>/dev/null || echo 0)"
    journal_put_critical install_dir "$install_dir"
    journal_put_critical service_unit_target "$TARGET_SERVICE"
    journal_put_critical phase init
    journal_put_critical install_dir_claim "$INSTALL_DIR_CLAIM"
    journal_put_critical install_dir_preexisting "$INSTALL_DIR_PREEXISTING"
    journal_put_critical install_dir_was_empty "$INSTALL_DIR_WAS_EMPTY"
    journal_put_critical env_created_by_setup "$ENV_CREATED_BY_SETUP"
    journal_put_critical tunnel_created_by_setup "$TUNNEL_CREATED_BY_SETUP"
    journal_put_critical cf_config_created_by_setup "$CF_CONFIG_CREATED_BY_SETUP"
    if [ -f "$install_dir/agent/.env" ]; then
        journal_put_critical env_preexisting yes
    else
        journal_put_critical env_preexisting no
    fi
    if [ -f "$CURRENT_HOME/.cloudflared/config.yml" ]; then
        journal_put_critical cf_config_preexisting yes
    else
        journal_put_critical cf_config_preexisting no
    fi
}
set_phase() {
    SETUP_PHASE="$1"
    journal_put phase "$1" || true
}

set_phase_critical() {
    SETUP_PHASE="$1"
    if ! journal_put phase "$1"; then
        echo "❌ Fatal: Failed to persist phase '$1' to journal at $SETUP_JOURNAL_FILE." >&2
        echo "   Aborting to prevent untracked state modifications." >&2
        exit 1
    fi
}

finish_transaction() {
    [ "$SETUP_TXN_ACTIVE" = true ] || return 0
    if [ -n "$SETUP_JOURNAL_FILE" ]; then
        journal_put status complete || true
        journal_put phase complete || true
    fi
    SETUP_TXN_COMPLETE=true
    cleanup_current_temps
    if [ -n "${SERVICE_UNIT_BACKUP:-}" ]; then
        rm -f -- "$SERVICE_UNIT_BACKUP" 2>/dev/null || run_privileged rm -f -- "$SERVICE_UNIT_BACKUP" 2>/dev/null || true
    fi
    if [ -n "$SETUP_JOURNAL_FILE" ]; then
        rm -f -- "$SETUP_JOURNAL_FILE" 2>/dev/null || true
    fi
    release_setup_lock
}

is_pid_alive() {
    local pid="$1"
    [ -n "$pid" ] || return 1
    if ! kill -0 "$pid" 2>/dev/null; then
        return 1
    fi
    if [ -f "/proc/$pid/stat" ]; then
        local state=""
        state="$(awk '{print $3}' "/proc/$pid/stat" 2>/dev/null || true)"
        if [ "$state" = "Z" ]; then
            return 1
        fi
    fi
    return 0
}

acquire_setup_lock() {
    [ "$DRY_RUN" = true ] && return 0
    mkdir -p "$SETUP_STATE_DIR" || {
        echo "❌ Could not create setup state directory: $SETUP_STATE_DIR" >&2
        exit 1
    }
    chmod 700 "$SETUP_STATE_BASE" "$SETUP_STATE_DIR" 2>/dev/null || true
    if [ "$EUID" -eq 0 ] && [ "$CURRENT_USER" != "root" ]; then
        chown -R "$CURRENT_USER:$CURRENT_GROUP" "$SETUP_STATE_BASE" 2>/dev/null || true
    fi
    if command -v flock >/dev/null 2>&1 && [ "${HOME_CLOUD_FORCE_LOCK_DIR:-false}" != "true" ]; then
        exec 9>"$SETUP_LOCK_FILE" || {
            echo "❌ Could not open setup lock: $SETUP_LOCK_FILE" >&2
            exit 1
        }
        if ! flock -w 30 9; then
            echo "❌ Another setup.sh run is already using this installation state." >&2
            exit 1
        fi
        printf '%s\n' "$$" >&9 2>/dev/null || true
        SETUP_LOCK_HELD=true
        return 0
    fi
    SETUP_LOCK_DIR="$SETUP_LOCK_FILE.d"
    local elapsed=0
    local timeout=30
    while ! mkdir "$SETUP_LOCK_DIR" 2>/dev/null; do
        local lock_owner=""
        if [ -f "$SETUP_LOCK_DIR/pid" ]; then
            IFS= read -r lock_owner < "$SETUP_LOCK_DIR/pid" || true
        fi
        if [ -n "$lock_owner" ]; then
            if is_pid_alive "$lock_owner"; then
                if [ "$elapsed" -eq 0 ]; then
                    echo "⏳ Another setup.sh run (pid $lock_owner) holds the lock. Waiting..."
                fi
                sleep 1
                elapsed=$((elapsed + 1))
                if [ "$elapsed" -ge "$timeout" ]; then
                    echo "❌ Another setup.sh run (pid $lock_owner) is already using this installation state." >&2
                    exit 1
                fi
                continue
            fi
            # Stale lock: PID is not running
            rm -rf -- "$SETUP_LOCK_DIR" 2>/dev/null || true
            continue
        fi
        sleep 1
        elapsed=$((elapsed + 1))
        if [ "$elapsed" -ge "$timeout" ]; then
            echo "❌ Timed out waiting for setup lock directory to become available." >&2
            exit 1
        fi
        if [ ! -f "$SETUP_LOCK_DIR/pid" ] && [ "$elapsed" -ge 2 ]; then
            rm -rf -- "$SETUP_LOCK_DIR" 2>/dev/null || true
        fi
    done
    local pid_tmp="$SETUP_STATE_DIR/lock-pid.$$.tmp"
    printf '%s\n' "$$" > "$pid_tmp"
    durable_sync_file "$pid_tmp"
    mv -f -- "$pid_tmp" "$SETUP_LOCK_DIR/pid" 2>/dev/null || printf '%s\n' "$$" > "$SETUP_LOCK_DIR/pid"
    SETUP_LOCK_HELD=true
}
release_setup_lock() {
    [ "$SETUP_LOCK_HELD" = true ] || return 0
    if [ -n "$SETUP_LOCK_DIR" ]; then
        rm -rf -- "$SETUP_LOCK_DIR" 2>/dev/null || true
    else
        flock -u 9 2>/dev/null || true
        exec 9>&- 2>/dev/null || true
    fi
    SETUP_LOCK_HELD=false
}

register_rollback() {
    SETUP_ROLLBACK_FUNCS+=("$1")
}

clear_rollbacks() {
    SETUP_ROLLBACK_FUNCS=()
}

setup_on_signal() {
    local signal_name="$1"
    local exit_code="$2"
    echo "" >&2
    echo "⚠️  Setup interrupted by SIG${signal_name}. Recording transaction state for a safe rerun..." >&2
    exit "$exit_code"
}

setup_finalize_on_exit() {
    local rc=$?
    trap - EXIT
    if [ "$SETUP_TXN_ACTIVE" = true ] && [ "$SETUP_TXN_COMPLETE" != true ]; then
        if [ -n "$SETUP_JOURNAL_FILE" ]; then
            journal_put status interrupted || true
            journal_put phase "${SETUP_PHASE:-unknown}" || true
            journal_put exit_code "$rc" || true
        fi
        local i
        for ((i=${#SETUP_ROLLBACK_FUNCS[@]}-1; i>=0; i--)); do
            "${SETUP_ROLLBACK_FUNCS[$i]}" || true
        done
        cleanup_current_temps || true
    fi
    release_setup_lock || true
    exit "$rc"
}

trap setup_finalize_on_exit EXIT
trap 'setup_on_signal INT 130' INT
trap 'setup_on_signal TERM 143' TERM
trap 'setup_on_signal HUP 129' HUP

# Update one key in an env file through a same-directory temp file plus rename.
# Values travel through the child environment, never argv, so secrets do not
# appear in process listings.
apply_env_update() {
    local env_path="$1"
    local env_key="$2"
    local env_value="$3"
    HOME_CLOUD_ENV_PATH="$env_path" \
    HOME_CLOUD_ENV_KEY="$env_key" \
    HOME_CLOUD_ENV_VALUE="$env_value" \
    "$NODE_PATH" -e '
        const fs = require("fs");
        const path = require("path");
        const crypto = require("crypto");
        const envPath = process.env.HOME_CLOUD_ENV_PATH;
        const key = process.env.HOME_CLOUD_ENV_KEY;
        const value = process.env.HOME_CLOUD_ENV_VALUE;
        if (!envPath || !key || typeof value !== "string") {
            console.error("Missing HOME_CLOUD_ENV_PATH, HOME_CLOUD_ENV_KEY, or HOME_CLOUD_ENV_VALUE.");
            process.exit(1);
        }
        if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /[\r\n]/.test(value)) {
            console.error("Invalid environment key or value.");
            process.exit(1);
        }
        let content = fs.readFileSync(envPath, "utf8");
        const regex = new RegExp("^" + key + "=.*$", "gm");
        const matches = content.match(regex) || [];
        if (matches.length > 1) throw new Error(`Refusing to update duplicate ${key} entries.`);
        if (matches.length === 1) {
            // A function replacer keeps $&, $1 and similar sequences in the
            // value literal instead of treating them as replacement patterns.
            content = content.replace(regex, () => key + "=" + value);
        } else {
            const trimmed = content.replace(/\s*$/, "");
            content = (trimmed ? trimmed + "\n" : "") + key + "=" + value + "\n";
        }
        const tempPath = path.join(
            path.dirname(envPath),
            "." + path.basename(envPath) + ".home-cloud-tmp." + process.pid + "." + crypto.randomBytes(4).toString("hex"),
        );
        let fd = null;
        try {
            fd = fs.openSync(tempPath, "wx", 0o600);
            fs.writeFileSync(fd, content);
            fs.fsyncSync(fd);
            fs.closeSync(fd);
            fd = null;
            fs.renameSync(tempPath, envPath);
        } catch (error) {
            if (fd !== null) {
                try { fs.closeSync(fd); } catch {}
            }
            try { fs.unlinkSync(tempPath); } catch {}
            throw error;
        }
        try {
            const dirFd = fs.openSync(path.dirname(envPath), "r");
            fs.fsyncSync(dirFd);
            fs.closeSync(dirFd);
        } catch {}
    '
}

# <<< HOME CLOUD TRANSACTION HELPERS <<<

acquire_setup_lock

# Resolve active outbound network gateway IP early for status messages
ACTIVE_IP="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' || true)"
if [ -z "$ACTIVE_IP" ]; then
    ACTIVE_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")"
fi

ARCH="$(uname -m)"
case "$ARCH" in
    x86_64)        CF_ARCH="amd64" ;;
    aarch64|arm64) CF_ARCH="arm64" ;;
    armv7l)        CF_ARCH="arm" ;;
    i386|i686)     CF_ARCH="386" ;;
    *)             CF_ARCH="amd64" ;;
esac

# Linux Distribution & Package Manager Detection
DISTRO_ID="unknown"
PKG_MANAGER=""
if [ -f /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    DISTRO_ID="${ID:-unknown}"
elif [ -f /usr/lib/os-release ]; then
    # shellcheck disable=SC1091
    . /usr/lib/os-release
    DISTRO_ID="${ID:-unknown}"
fi

if command -v apt-get >/dev/null 2>&1; then
    PKG_MANAGER="apt"
elif command -v dnf >/dev/null 2>&1; then
    PKG_MANAGER="dnf"
elif command -v yum >/dev/null 2>&1; then
    PKG_MANAGER="yum"
elif command -v pacman >/dev/null 2>&1; then
    PKG_MANAGER="pacman"
fi

echo "✔ Resolved User:      $CURRENT_USER ($CURRENT_GROUP)"
echo "✔ User Home:          $CURRENT_HOME"
echo "✔ Detected Arch:      $ARCH (CF: $CF_ARCH)"
echo "✔ Detected Distro:    $DISTRO_ID (pkg: ${PKG_MANAGER:-none})"
echo "✔ Primary Host IP:    $ACTIVE_IP"
echo "✔ Working Directory:  $SCRIPT_DIR"

# 2. Install essential system tools for bare-bones Ubuntu Server
install_essential_packages() {
    if [ "$DRY_RUN" = true ]; then
        echo "[DRY-RUN] Would install essential system packages via ${PKG_MANAGER:-package manager}."
        return 0
    fi
    echo "📦 Checking and installing essential system packages..."
    if [ "$PKG_MANAGER" = "apt" ]; then
        wait_for_apt_lock
        run_privileged apt-get update -qq
        wait_for_apt_lock
        run_privileged apt-get install -y -qq \
            curl ca-certificates gnupg \
            build-essential python3 \
            git psmisc
    elif [ "$PKG_MANAGER" = "dnf" ] || [ "$PKG_MANAGER" = "yum" ]; then
        run_privileged "$PKG_MANAGER" install -y \
            curl ca-certificates gnupg2 \
            gcc-c++ make python3 \
            git psmisc
    elif [ "$PKG_MANAGER" = "pacman" ]; then
        run_privileged pacman -Sy --noconfirm \
            curl ca-certificates \
            base-devel python \
            git psmisc
    fi
}

install_essential_packages

# Ensure git is verified and available
if ! command -v git >/dev/null 2>&1; then
    if [ "$DRY_RUN" = true ]; then
        echo "[DRY-RUN] git is missing; would install git via ${PKG_MANAGER:-package manager}."
    else
        echo "📦 git is required but not installed. Installing git..."
        if [ "$PKG_MANAGER" = "apt" ]; then
            wait_for_apt_lock
            run_privileged apt-get install -y -qq git
        elif [ "$PKG_MANAGER" = "dnf" ] || [ "$PKG_MANAGER" = "yum" ]; then
            run_privileged "$PKG_MANAGER" install -y git
        elif [ "$PKG_MANAGER" = "pacman" ]; then
            run_privileged pacman -Sy --noconfirm git
        fi
    fi
fi

if command -v git >/dev/null 2>&1; then
    echo "✔ git is available:   $(git --version | head -n 1)"
elif [ "$DRY_RUN" = true ]; then
    echo "[DRY-RUN] git would be verified after installation."
else
    echo "❌ git could not be found or installed. Please install git manually." >&2
    exit 1
fi

# Determine Canonical Installation Directory & ensure repository tree is present
if [ -n "$TARGET_DIR" ]; then
    INSTALL_DIR="$TARGET_DIR"
elif [ -f "$SCRIPT_DIR/home-cloud.service.template" ] && [ -f "$SCRIPT_DIR/agent/package.json" ]; then
    INSTALL_DIR="$SCRIPT_DIR"
else
    INSTALL_DIR="$CURRENT_HOME/home-cloud"
fi
while [ "$INSTALL_DIR" != "/" ] && [ "${INSTALL_DIR%/}" != "$INSTALL_DIR" ]; do
    INSTALL_DIR="${INSTALL_DIR%/}"
done

install_dir_ready() {
    [ -f "$1/home-cloud.service.template" ] && [ -f "$1/agent/package.json" ]
}

begin_transaction "$INSTALL_DIR"

# Ensure repository tree is present (in case setup.sh was executed standalone or via curl)
if ! install_dir_ready "$INSTALL_DIR"; then
    echo "⚠️ Home Cloud repository files not found in $INSTALL_DIR."
    echo "⬇ Cloning full repository (branch: $BRANCH) from https://github.com/Cypher0071/home_cloud.git..."
    if [ "$DRY_RUN" = true ]; then
        echo "[DRY-RUN] Would clone https://github.com/Cypher0071/home_cloud.git (branch: $BRANCH) to $INSTALL_DIR"
    else
        if [ -d "$INSTALL_DIR" ] && dir_has_entries "$INSTALL_DIR"; then
            echo "❌ $INSTALL_DIR already exists and is not a complete Home Cloud checkout." >&2
            echo "   Refusing to delete or overwrite pre-existing files. Move it aside or choose --dir." >&2
            exit 1
        fi
        set_phase_critical repo_clone
        journal_put_critical install_dir_claim yes
        INSTALL_DIR_CLAIM=yes
        CLONE_STAGE="${INSTALL_DIR}.home-cloud-clone.$$.$RANDOM"
        CLONE_TMP="$CLONE_STAGE/repo"
        register_temp_dir "$CLONE_STAGE"
        run_as_current_user mkdir -p "$CLONE_STAGE" || {
            echo "❌ Could not create a staging directory next to $INSTALL_DIR." >&2
            exit 1
        }
        # The marker proves ownership of the staging directory to later runs.
        printf '%s\n' "$SETUP_ATTEMPT_ID" > "$CLONE_STAGE/.home-cloud-attempt" || {
            echo "❌ Could not mark the clone staging directory." >&2
            exit 1
        }
        durable_sync_file "$CLONE_STAGE/.home-cloud-attempt"
        durable_sync_dir "$CLONE_STAGE"
        if ! run_as_current_user git clone --branch "$BRANCH" https://github.com/Cypher0071/home_cloud.git "$CLONE_TMP"; then
            rm -rf -- "$CLONE_STAGE" 2>/dev/null || true
            echo "❌ Repository clone failed. Any partial clone was discarded; rerun setup.sh to retry." >&2
            exit 1
        fi
        if ! install_dir_ready "$CLONE_TMP"; then
            rm -rf -- "$CLONE_STAGE" 2>/dev/null || true
            echo "❌ Cloned repository is incomplete (missing template or agent/package.json)." >&2
            exit 1
        fi
        if [ -d "$INSTALL_DIR" ]; then
            rmdir "$INSTALL_DIR" 2>/dev/null || {
                echo "❌ $INSTALL_DIR became non-empty during install. Refusing to overwrite it." >&2
                rm -rf -- "$CLONE_STAGE" 2>/dev/null || true
                exit 1
            }
        fi
        mv -T -- "$CLONE_TMP" "$INSTALL_DIR" || {
            echo "❌ Could not atomically move the fresh clone into $INSTALL_DIR." >&2
            rm -rf -- "$CLONE_STAGE" 2>/dev/null || true
            exit 1
        }
        rm -rf -- "$CLONE_STAGE" 2>/dev/null || true
        durable_sync_dir "$(dirname "$INSTALL_DIR")"
        set_phase repo_ready
    fi
fi

git_process_running() {
    if command -v pgrep >/dev/null 2>&1; then
        pgrep -x git >/dev/null 2>&1
    else
        ps -eo comm= 2>/dev/null | awk '$1 == "git" { found = 1 } END { exit found ? 0 : 1 }'
    fi
}

if [ -d "$INSTALL_DIR/.git" ] && [ "$DRY_RUN" = false ]; then
    CURRENT_GIT_BRANCH="$(run_as_current_user git -C "$INSTALL_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    CURRENT_GIT_TAG="$(run_as_current_user git -C "$INSTALL_DIR" describe --tags --exact-match 2>/dev/null || true)"
    if [ -n "$BRANCH" ] && [ "$CURRENT_GIT_BRANCH" != "$BRANCH" ] && [ "$CURRENT_GIT_TAG" != "$BRANCH" ]; then
        if [ "$RECOVERED_GIT_CHECKOUT_INTERRUPTED" = "yes" ] && [ -f "$INSTALL_DIR/.git/index.lock" ]; then
            if git_process_running; then
                echo "⚠️ Found a stale git index.lock, but another git process may be running; leaving it in place." >&2
                exit 1
            fi
            echo "♻️  Removing a stale git index.lock from an interrupted setup checkout..."
            rm -f -- "$INSTALL_DIR/.git/index.lock" 2>/dev/null || true
        fi
        echo "🔄 Checking out '$BRANCH' in $INSTALL_DIR..."
        set_phase git_checkout
        run_as_current_user git -C "$INSTALL_DIR" checkout "$BRANCH"
        set_phase repo_ready
    fi
fi

SCRIPT_DIR="$INSTALL_DIR"
TEMPLATE_FILE="$SCRIPT_DIR/home-cloud.service.template"

# 3. Node.js Runtime Check (operator-installed; never piped from NodeSource)
# Require Node.js >= 22.23.4, including the patch version Astro needs to build.
node_satisfies_minimum() {
    local raw="${1#v}"
    local major="" minor="" patch=""
    IFS='.' read -r major minor patch <<< "$raw"
    major="${major//[^0-9]/}"
    minor="${minor//[^0-9]/}"
    patch="${patch%%-*}"
    patch="${patch//[^0-9]/}"
    if [ -z "$major" ] || [ -z "$minor" ] || [ -z "$patch" ]; then
        return 1
    fi
    if [ "$major" -gt 22 ]; then
        return 0
    fi
    if [ "$major" -eq 22 ] && [ "$minor" -gt 23 ]; then
        return 0
    fi
    if [ "$major" -eq 22 ] && [ "$minor" -eq 23 ] && [ "$patch" -ge 4 ]; then
        return 0
    fi
    return 1
}

NODE_PATH="$(command -v node || true)"
NODE_VERSION=""
NEED_NODE_REFUSE=false

if [ -z "$NODE_PATH" ]; then
    echo "⚠️ Node.js is not installed on this system."
    NEED_NODE_REFUSE=true
else
    NODE_VERSION="$("$NODE_PATH" -v)"
    if ! node_satisfies_minimum "$NODE_VERSION"; then
        echo "⚠️ Detected Node.js $NODE_VERSION, but Home Cloud requires Node.js >= 22.23.4."
        NEED_NODE_REFUSE=true
    fi
fi

if [ "$NEED_NODE_REFUSE" = true ]; then
    if [ "$DRY_RUN" = true ]; then
        echo "[DRY-RUN] Node.js >= 22.23.4 must be installed by the operator. Setup would refuse and exit 1. Not installing Node.js."
        if [ -z "$NODE_PATH" ]; then
            NODE_PATH="/usr/bin/node"
            NODE_VERSION="(not installed)"
        fi
    else
        echo "❌ Node.js >= 22.23.4 must be installed by the operator." >&2
        exit 1
    fi
fi

NODE_DIR="$(dirname "$NODE_PATH")"
echo "✔ Active Node.js:     $NODE_PATH ($NODE_VERSION)"

# 4. pnpm via corepack (pinned 12.15.0; never npm -g and never get.pnpm.io)
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
PNPM_PIN="12.15.0"

pnpm_is_pinned_line() {
    [ "${1:-}" = "$PNPM_PIN" ]
}

print_pnpm_corepack_plan() {
    if ! command -v corepack >/dev/null 2>&1; then
        echo "[DRY-RUN] corepack is not on PATH; not activating it during dry-run."
    fi
    echo "[DRY-RUN] Would run: corepack enable && corepack prepare pnpm@${PNPM_PIN} --activate"
}

if [ "$DRY_RUN" = true ]; then
    if command -v pnpm >/dev/null 2>&1; then
        PNPM_VER="$(pnpm --version 2>/dev/null || true)"
        if pnpm_is_pinned_line "$PNPM_VER"; then
            echo "✔ Active pnpm:        $(command -v pnpm) ($PNPM_VER)"
        else
            echo "[DRY-RUN] pnpm ${PNPM_VER:-unknown} is not ${PNPM_PIN}. Not downloading."
            print_pnpm_corepack_plan
        fi
    else
        echo "[DRY-RUN] pnpm is not installed. Not downloading."
        print_pnpm_corepack_plan
    fi
else
    if ! command -v corepack >/dev/null 2>&1; then
        echo "❌ corepack is required to activate pnpm@${PNPM_PIN}. Node.js >= 22.23.4 must be installed by the operator." >&2
        exit 1
    fi
    PNPM_VER=""
    if command -v pnpm >/dev/null 2>&1; then
        PNPM_VER="$(pnpm --version 2>/dev/null || true)"
    fi
    if pnpm_is_pinned_line "$PNPM_VER"; then
        echo "✔ Active pnpm:        $(command -v pnpm) ($PNPM_VER)"
    else
        if [ -n "$PNPM_VER" ]; then
            echo "📦 pnpm $PNPM_VER is not ${PNPM_PIN}. Activating pnpm@${PNPM_PIN} via corepack..."
        else
            echo "📦 Installing pnpm@${PNPM_PIN} via corepack..."
        fi
        run_privileged corepack enable
        run_privileged corepack prepare "pnpm@${PNPM_PIN}" --activate
        hash -r || true
        if ! command -v pnpm >/dev/null 2>&1; then
            echo "❌ Error: pnpm@${PNPM_PIN} could not be activated via corepack." >&2
            exit 1
        fi
        PNPM_VER="$(pnpm --version 2>/dev/null || true)"
        if ! pnpm_is_pinned_line "$PNPM_VER"; then
            echo "❌ Error: expected pnpm ${PNPM_PIN} after corepack prepare, found '${PNPM_VER:-none}'." >&2
            exit 1
        fi
        echo "✔ Active pnpm:        $(command -v pnpm) ($PNPM_VER)"
    fi
fi

# 5. Docker Engine & Compose Plugin Check (operator-installed; never piped)
if ! command -v docker >/dev/null 2>&1; then
    echo ""
    echo "⚠️ Docker Engine is required to run containers, but was not found on this system."
    echo "❌ Docker Engine and the Compose plugin must be installed by the operator." >&2
    if [ "$DRY_RUN" = true ]; then
        echo "[DRY-RUN] Docker Engine and the compose plugin are absent. Setup would exit 1. Continuing dry-run without installing packages."
    else
        exit 1
    fi
else
    echo "✔ Detected Docker:    $(command -v docker)"
    if [ "$DRY_RUN" = false ]; then
        if command -v systemctl >/dev/null 2>&1 && ! run_privileged systemctl is-active --quiet docker; then
            echo "🔄 Starting docker.service..."
            run_privileged systemctl enable --now docker || true
        fi
    fi
fi

if [ "$DRY_RUN" = false ]; then
    if command -v docker >/dev/null 2>&1; then
        # Ensure docker-compose-plugin is present
        if ! docker compose version >/dev/null 2>&1; then
            if [ "$PKG_MANAGER" = "apt" ]; then
                echo "📦 Installing docker-compose-plugin..."
                wait_for_apt_lock
                run_privileged apt-get install -y -qq docker-compose-plugin
            else
                echo "❌ The Docker Compose plugin is missing. Install it and re-run setup.sh." >&2
                exit 1
            fi
        fi

        # Ensure user is in the docker group (not executed during dry-run)
        CURRENT_USER_GROUPS="$(id -nG "$CURRENT_USER")"
        if [[ " $CURRENT_USER_GROUPS " != *" docker "* ]]; then
            echo "⚠️ Adding '$CURRENT_USER' to 'docker' group for socket permissions..."
            run_privileged usermod -aG docker "$CURRENT_USER"
            echo "✔ Added $CURRENT_USER to docker group."
        fi
    fi
elif command -v docker >/dev/null 2>&1; then
    echo "[DRY-RUN] Would verify docker compose and ensure $CURRENT_USER is in docker group."
fi

# 6. Check & Prompt for Cloudflared (Optional Remote Tunnel)
# Pin cloudflared to a release whose published asset hashes are checked in below.
# >>> CLOUDFLARED HELPERS >>>
CLOUDFLARED_VERSION="2026.10.3"
CLOUDFLARED_RELEASE_BASE="https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}"

expected_sha256_for_asset() {
    local asset_name="$1"
    local expected=""
    # Hashes published by Cloudflare for https://github.com/cloudflare/cloudflared/releases/tag/2026.10.3
    case "${CLOUDFLARED_VERSION}:${asset_name}" in
        2026.10.3:cloudflared-linux-amd64) expected="053b80b0a23031a038fdbf3c073f59f82b8f1f152aa67971d7383ffafc0dbab0" ;;
        2026.10.3:cloudflared-linux-arm64) expected="89297ebfb9e8c99c0dc013a1140601453cf3798d8306c5591651f4a3f5210be8" ;;
        2026.10.3:cloudflared-linux-arm) expected="76f35faae119881ddf766b61baa9e27803aea6bea7111ed4170ed1b7a5c8637e" ;;
        2026.10.3:cloudflared-linux-386) expected="7c533230928eae6443d6d87dce16e0af67fa1f60fb56860dca4e09883a8ee394" ;;
        2026.10.3:cloudflared-linux-amd64.deb) expected="297d906a8fef396ec888b51571e783d594bde280f3b44d63e8fa343ef2c4cc4e" ;;
        2026.10.3:cloudflared-linux-arm64.deb) expected="9382c5406c5cb64821114360550b8903c600b20052e9e82359acf343834be2b7" ;;
        2026.10.3:cloudflared-linux-arm.deb) expected="53af737052f3d964956c5fbaca1d1f1ece85b72cdbc8c9b2e55f5961dae4f657" ;;
        2026.10.3:cloudflared-linux-386.deb) expected="eaf686113a233fd03953720b905e2ee974bf15e5909965c14ecef3951cb788f7" ;;
        2026.10.3:cloudflared-linux-x86_64.rpm) expected="de14351f7859728b166e411967ba9440c563c6953a0ca671f6ffb8a24ec6942f" ;;
        2026.10.3:cloudflared-linux-aarch64.rpm) expected="f1f91e23bf38219f59bbb52022214f1c99b0b6e14589f86907f9ba3ced53a281" ;;
        2026.10.3:cloudflared-linux-arm.rpm) expected="5e0b22ffd1e85bc3c7bd189b0bd92ba81b7ce001e8d10cd8c1b22f8f46b3198a" ;;
        2026.10.3:cloudflared-linux-386.rpm) expected="3390a8fa2e1bcb10cfcf87870698841c509fa62d4c6ac8c1e7905c4407535a3e" ;;
        *)
            echo "❌ No pinned SHA256 for ${asset_name} (cloudflared ${CLOUDFLARED_VERSION})." >&2
            return 1
            ;;
    esac
    printf '%s\n' "$expected"
}

cloudflared_work_dir() {
    if [ -z "${CLOUDFLARED_TMP_DIR:-}" ]; then
        CLOUDFLARED_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/home-cloud-setup.XXXXXX")" || {
            echo "❌ Could not create a temporary directory for cloudflared." >&2
            exit 1
        }
        printf '%s\n' "$SETUP_ATTEMPT_ID" > "$CLOUDFLARED_TMP_DIR/.home-cloud-attempt"
        chmod 700 "$CLOUDFLARED_TMP_DIR" 2>/dev/null || true
        register_temp_dir "$CLOUDFLARED_TMP_DIR"
    fi
}

remove_temp_file() {
    local path="$1"
    [ -n "$path" ] || return 0
    rm -f -- "$path" 2>/dev/null || run_privileged rm -f -- "$path" 2>/dev/null || true
}

download_verified_cloudflared() {
    local asset_name="$1"
    local dest="$2"
    local part="${dest}.part"
    local expected="" actual=""
    remove_temp_file "$part"
    if ! curl -fsSL "${CLOUDFLARED_RELEASE_BASE}/${asset_name}" -o "$part"; then
        remove_temp_file "$part"
        echo "❌ Failed to download ${asset_name} for cloudflared ${CLOUDFLARED_VERSION}." >&2
        exit 1
    fi
    if ! expected="$(expected_sha256_for_asset "$asset_name")"; then
        remove_temp_file "$part"
        echo "❌ Refusing to install unverified ${asset_name}." >&2
        exit 1
    fi
    expected="${expected//$'\r'/}"
    expected="${expected//$'\n'/}"
    if ! command -v sha256sum >/dev/null 2>&1; then
        remove_temp_file "$part"
        echo "❌ sha256sum is required to verify ${asset_name}." >&2
        exit 1
    fi
    actual="$(sha256sum "$part" | awk '{print tolower($1)}')"
    if [ -z "$expected" ] || [ "$actual" != "$expected" ]; then
        remove_temp_file "$part"
        echo "❌ SHA256 verification failed for ${asset_name}. Deleted the partial download." >&2
        exit 1
    fi
    mv -fT -- "$part" "$dest" || {
        remove_temp_file "$part"
        echo "❌ Could not promote the verified ${asset_name} download." >&2
        exit 1
    }
    durable_sync_file "$dest"
    echo "✔ SHA256 verified ${asset_name} (${CLOUDFLARED_VERSION})"
}

install_cloudflared_binary_atomic() {
    local src="$1"
    local dest="/usr/local/bin/cloudflared"
    local dest_dir="" tmp=""
    dest_dir="$(dirname "$dest")"
    run_privileged mkdir -p "$dest_dir" || {
        echo "❌ Could not create $dest_dir." >&2
        exit 1
    }
    tmp="$(run_privileged mktemp "$dest_dir/.cloudflared.home-cloud-tmp.XXXXXX")" || {
        echo "❌ Could not create a temporary cloudflared binary in $dest_dir." >&2
        exit 1
    }
    register_temp_file "$tmp"
    if command -v install >/dev/null 2>&1; then
        if ! run_privileged install -m 0755 "$src" "$tmp"; then
            remove_temp_file "$tmp"
            echo "❌ Could not stage the cloudflared binary." >&2
            exit 1
        fi
    else
        if ! run_privileged cp "$src" "$tmp"; then
            remove_temp_file "$tmp"
            echo "❌ Could not stage the cloudflared binary." >&2
            exit 1
        fi
        run_privileged chmod 0755 "$tmp"
    fi
    run_privileged chown root:root "$tmp" 2>/dev/null || true
    durable_sync_file "$tmp"
    if ! run_privileged mv -fT -- "$tmp" "$dest"; then
        remove_temp_file "$tmp"
        echo "❌ Could not atomically replace $dest." >&2
        exit 1
    fi
    durable_sync_dir "$dest_dir"
}

install_verified_cloudflared_package() {
    local asset_name="$1"
    local kind="$2"
    local tmp=""
    cloudflared_work_dir
    tmp="$(mktemp "$CLOUDFLARED_TMP_DIR/cloudflared.XXXXXX")" || {
        echo "❌ Could not create a temporary cloudflared file." >&2
        exit 1
    }
    register_temp_file "$tmp"
    download_verified_cloudflared "$asset_name" "$tmp"
    if [ "$kind" = "deb" ]; then
        if ! run_privileged dpkg -i "$tmp"; then
            if ! run_privileged apt-get install -f -y; then
                remove_temp_file "$tmp"
                exit 1
            fi
        fi
    elif [ "$kind" = "rpm" ]; then
        if ! run_privileged "$PKG_MANAGER" install -y "$tmp"; then
            if ! run_privileged rpm -i "$tmp"; then
                remove_temp_file "$tmp"
                exit 1
            fi
        fi
    else
        install_cloudflared_binary_atomic "$tmp"
    fi
    remove_temp_file "$tmp"
    echo "✔ cloudflared ${CLOUDFLARED_VERSION} installed: $(command -v cloudflared || echo '/usr/local/bin/cloudflared')"
}
# <<< CLOUDFLARED HELPERS <<<

if [ "${SKIP_CLOUDFLARED:-false}" = "true" ]; then
    echo "ℹ Skipping cloudflared installation (--skip-cloudflared specified)."
elif ! command -v cloudflared >/dev/null 2>&1; then
    echo ""
    echo "ℹ cloudflared is not installed. (Required for free remote HTTPS access via custom domain)"
    if [ "$DRY_RUN" = true ]; then
        echo "[DRY-RUN] cloudflared ${CLOUDFLARED_VERSION} would be downloaded for ${CF_ARCH}, SHA256-verified, then installed. Not downloading."
    else
        INSTALL_CF="N"
        if [ "$NON_INTERACTIVE" != true ]; then
            if read_input "Would you like setup.sh to download and install cloudflared now? [Y/n] " PROMPT_CF_IN; then
                INSTALL_CF="${PROMPT_CF_IN:-Y}"
            fi
        elif [ -n "$CF_DOMAIN_INPUT" ]; then
            INSTALL_CF="Y"
        fi

        if [[ "$INSTALL_CF" =~ ^[Yy]$ ]]; then
            echo "⬇ Downloading and verifying cloudflared ${CLOUDFLARED_VERSION} for $CF_ARCH..."
            if [ "$PKG_MANAGER" = "apt" ]; then
                wait_for_apt_lock
                install_verified_cloudflared_package "cloudflared-linux-${CF_ARCH}.deb" deb
            elif [ "$PKG_MANAGER" = "dnf" ] || [ "$PKG_MANAGER" = "yum" ]; then
                case "$CF_ARCH" in
                    amd64) CF_RPM_ASSET="cloudflared-linux-x86_64.rpm" ;;
                    arm64) CF_RPM_ASSET="cloudflared-linux-aarch64.rpm" ;;
                    *) CF_RPM_ASSET="cloudflared-linux-${CF_ARCH}.rpm" ;;
                esac
                install_verified_cloudflared_package "$CF_RPM_ASSET" rpm
            else
                install_verified_cloudflared_package "cloudflared-linux-${CF_ARCH}" bin
            fi
        else
            echo "ℹ Skipping cloudflared installation. Direct local LAN access (:3000) will still function."
        fi
    fi
else
    echo "✔ Detected Cloudflare: $(command -v cloudflared)"
fi

# Create skeleton ~/.cloudflared directory if cloudflared is installed
if [ "$DRY_RUN" = false ] && [ "${SKIP_CLOUDFLARED:-false}" != "true" ] && command -v cloudflared >/dev/null 2>&1; then
    CF_DIR="$CURRENT_HOME/.cloudflared"
    mkdir -p "$CF_DIR"
    if [ "$EUID" -eq 0 ]; then
        chown -R "$CURRENT_USER:$CURRENT_GROUP" "$CF_DIR"
    fi
fi

# 7. Environment & Secure Admin Password Configuration (Using Node.js to prevent delimiter bugs)
# Password and JWT are passed only through the node process environment, never argv.
write_jwt_secret() {
    local secret="$1"
    local env_path="${2:-$SCRIPT_DIR/agent/.env}"
    apply_env_update "$env_path" "JWT_SECRET" "$secret"
    chmod 600 "$env_path"
}

write_admin_password() {
    HOME_CLOUD_ENV_PATH="$SCRIPT_DIR/agent/.env" \
    HOME_CLOUD_NEW_PASSWORD="$1" \
    "$NODE_PATH" -e '
        const fs = require("fs");
        const path = require("path");
        const crypto = require("crypto");
        const dotenv = require(require.resolve("dotenv", { paths: [path.join(process.argv[1], "agent")] }));
        const envPath = process.env.HOME_CLOUD_ENV_PATH;
        const pass = process.env.HOME_CLOUD_NEW_PASSWORD;
        if (!envPath || typeof pass !== "string") {
            console.error("Missing HOME_CLOUD_ENV_PATH or HOME_CLOUD_NEW_PASSWORD.");
            process.exit(1);
        }
        if (pass.length < 8 || /[\r\n]/.test(pass)) {
            console.error("Refusing to write a password shorter than 8 characters or containing CR/LF.");
            process.exit(1);
        }
        const original = fs.readFileSync(envPath, "utf8");
        const before = dotenv.parse(original);
        let matches = 0;
        let updated = original.replace(/^\s*(?:export\s+)?PASSWORD\s*=.*$/gm, () => {
            matches += 1;
            return `PASSWORD=${JSON.stringify(pass)}`;
        });
        if (matches > 1) throw new Error("Refusing to update an .env file with duplicate PASSWORD entries.");
        if (matches === 0) updated = `${updated.replace(/\s*$/, "")}\nPASSWORD=${JSON.stringify(pass)}\n`;

        const after = dotenv.parse(updated);
        if (after.PASSWORD !== pass) throw new Error("Updated password did not round-trip through dotenv.");
        for (const [key, value] of Object.entries(before)) {
            if (key !== "PASSWORD" && after[key] !== value) throw new Error(`Updating PASSWORD changed ${key}.`);
        }
        for (const key of Object.keys(after)) {
            if (key !== "PASSWORD" && !Object.hasOwn(before, key)) throw new Error(`Updating PASSWORD added ${key}.`);
        }

        const tempPath = path.join(
            path.dirname(envPath),
            "." + path.basename(envPath) + ".home-cloud-tmp." + process.pid + "." + crypto.randomBytes(4).toString("hex"),
        );
        let fd = null;
        try {
            fd = fs.openSync(tempPath, "wx", 0o600);
            fs.writeFileSync(fd, updated);
            fs.fsyncSync(fd);
            fs.closeSync(fd);
            fd = null;
            fs.renameSync(tempPath, envPath);
        } catch (error) {
            if (fd !== null) {
                try { fs.closeSync(fd); } catch {}
            }
            try { fs.unlinkSync(tempPath); } catch {}
            throw error;
        }
        try {
            const dirFd = fs.openSync(path.dirname(envPath), "r");
            fs.fsyncSync(dirFd);
            fs.closeSync(dirFd);
        } catch {}
    ' \
    "$SCRIPT_DIR"
    chmod 600 "$SCRIPT_DIR/agent/.env"
}

echo ""
echo "⚙ Configuring environment & security credentials..."

if [ "$DRY_RUN" = true ]; then
    echo "[DRY-RUN] Would generate a JWT_SECRET and write the admin password only to ${SCRIPT_DIR}/agent/.env (mode 0600). The password would not be printed."
else
    if [ ! -f "$SCRIPT_DIR/agent/.env" ]; then
        set_phase_critical env_create
        journal_put_critical env_created_by_setup yes
        ENV_CREATED_BY_SETUP=yes
        ENV_TMP="$(mktemp "$SCRIPT_DIR/agent/.env.home-cloud-tmp.XXXXXX")" || {
            echo "❌ Could not create a temporary agent/.env file." >&2
            exit 1
        }
        register_temp_file "$ENV_TMP"
        if [ -f "$SCRIPT_DIR/agent/.env.example" ]; then
            cp "$SCRIPT_DIR/agent/.env.example" "$ENV_TMP"
        else
            printf '%s\n' 'PASSWORD=change-me' 'JWT_SECRET=generate-a-long-random-string' 'PORT=3000' > "$ENV_TMP"
        fi
        chmod 600 "$ENV_TMP"
        # Generate cryptographically secure JWT secret (not passed on argv)
        RANDOM_JWT="$("$NODE_PATH" -e 'process.stdout.write(require("crypto").randomBytes(24).toString("hex"))')"
        write_jwt_secret "$RANDOM_JWT" "$ENV_TMP"
        if ! awk -F= '$1 == "JWT_SECRET" && length($2) > 0 { found = 1 } END { exit found ? 0 : 1 }' "$ENV_TMP"; then
            echo "❌ Generated agent/.env is missing JWT_SECRET; refusing to install it." >&2
            exit 1
        fi
        durable_sync_file "$ENV_TMP"
        mv -fT -- "$ENV_TMP" "$SCRIPT_DIR/agent/.env" || {
            echo "❌ Could not atomically install agent/.env." >&2
            exit 1
        }
        durable_sync_dir "$SCRIPT_DIR/agent"
        echo "✔ Generated secure random JWT_SECRET."
    else
        # Repair only a missing/placeholder JWT secret. Real secrets are never regenerated.
        CURRENT_JWT_STATE="$(
            "$NODE_PATH" -e '
                const fs = require("fs");
                const path = require("path");
                const dotenv = require(require.resolve("dotenv", { paths: [path.join(process.argv[1], "agent")] }));
                const parsed = dotenv.parse(fs.readFileSync(path.join(process.argv[1], "agent", ".env"), "utf8"));
                const secret = parsed.JWT_SECRET || "";
                process.stdout.write(!secret ? "missing" : secret === "generate-a-long-random-string" ? "placeholder" : "configured");
            ' "$SCRIPT_DIR"
        )"
        if [ "$CURRENT_JWT_STATE" = "missing" ] || [ "$CURRENT_JWT_STATE" = "placeholder" ]; then
            set_phase env_repair
            RANDOM_JWT="$("$NODE_PATH" -e 'process.stdout.write(require("crypto").randomBytes(24).toString("hex"))')"
            write_jwt_secret "$RANDOM_JWT"
            echo "✔ Repaired missing/placeholder JWT_SECRET in agent/.env."
        fi
    fi

    # Secure file permissions on agent/.env
    chmod 600 "$SCRIPT_DIR/agent/.env"
    run_privileged chown "$CURRENT_USER:$CURRENT_GROUP" "$SCRIPT_DIR/agent/.env" 2>/dev/null || true

    # Check if PASSWORD needs to be configured
    CURRENT_PASS_STATE="$(
        "$NODE_PATH" -e '
            const fs = require("fs");
            const path = require("path");
            const dotenv = require(require.resolve("dotenv", { paths: [path.join(process.argv[1], "agent")] }));
            const parsed = dotenv.parse(fs.readFileSync(path.join(process.argv[1], "agent", ".env"), "utf8"));
            const password = parsed.PASSWORD || "";
            process.stdout.write(!password ? "missing" : password === "change-me" ? "placeholder" : "configured");
        ' "$SCRIPT_DIR"
    )"
    if [ -n "$ADMIN_PASS_INPUT" ]; then
        ADMIN_PASS="$ADMIN_PASS_INPUT"
        echo "✔ Using admin password provided via CLI / environment."
        write_admin_password "$ADMIN_PASS"
        echo "✔ Admin password written to ${SCRIPT_DIR}/agent/.env"
    elif [ "$CURRENT_PASS_STATE" = "missing" ] || [ "$CURRENT_PASS_STATE" = "placeholder" ]; then
        echo ""
        echo "┌──────────────────────────────────────────────────────────┐"
        echo "│ 🔐 SET ADMIN DASHBOARD PASSWORD                          │"
        echo "│ Set the security password used to log into Home Cloud.   │"
        echo "└──────────────────────────────────────────────────────────┘"

        ADMIN_PASS=""
        if [ "$NON_INTERACTIVE" != true ]; then
            while true; do
                if ! read_input "Enter dashboard admin password: " P1 true; then
                    break
                fi
                if [ -z "$P1" ] || [ "${#P1}" -lt 8 ]; then
                    echo "❌ Password must be at least 8 characters. Please try again." >&2
                    continue
                fi
                if [[ "$P1" == *$'\r'* || "$P1" == *$'\n'* ]]; then
                    echo "❌ Password must not contain CR or LF. Please try again." >&2
                    continue
                fi
                if ! read_input "Confirm dashboard admin password: " P2 true; then
                    break
                fi
                if [ "$P1" != "$P2" ]; then
                    echo "❌ Passwords do not match. Please try again." >&2
                else
                    ADMIN_PASS="$P1"
                    break
                fi
            done
        fi

        if [ -z "$ADMIN_PASS" ]; then
            ADMIN_PASS="$("$NODE_PATH" -e 'process.stdout.write(require("crypto").randomBytes(16).toString("hex"))')"
        fi

        write_admin_password "$ADMIN_PASS"
        unset ADMIN_PASS P1 P2
        echo "✔ Admin password written to ${SCRIPT_DIR}/agent/.env"
    else
        echo "✔ Admin password is already configured in agent/.env"
    fi
fi

# 8. Automated Cloudflare Tunnel Setup (Optional Remote HTTPS Access)
setup_cloudflare_tunnel() {
    echo ""
    echo "⚙ Checking Cloudflare Tunnel & remote access configuration..."

    clean_domain() {
        local d="$1"
        d="$(echo "$d" | tr -d '[:space:]')"
        d="${d#https://}"
        d="${d#http://}"
        d="${d%%/*}"
        d="${d%%:*}"
        d="$(echo "$d" | tr '[:upper:]' '[:lower:]')"
        d="${d#dash.}"
        echo "$d"
    }

    if [ "${SKIP_CLOUDFLARED:-false}" = "true" ]; then
        echo "ℹ Cloudflare Tunnel setup skipped (--skip-cloudflared specified)."
        echo "ℹ Home Cloud will run in LAN-only mode (http://$ACTIVE_IP:3000)."
        return 0
    fi

    if [ "${DRY_RUN:-false}" = "true" ]; then
        local target_domain="${CF_DOMAIN_INPUT:-${CF_DOMAIN:-${CLOUDFLARE_DOMAIN:-none}}}"
        local target_tunnel="${TUNNEL_NAME_INPUT:-${TUNNEL_NAME:-home-cloud}}"
        echo "[DRY-RUN] Cloudflare Tunnel check: domain='$target_domain', tunnel='$target_tunnel'"
        return 0
    fi

    if command -v cloudflared >/dev/null 2>&1; then
        CF_DIR="$CURRENT_HOME/.cloudflared"
        CF_CONFIG_FILE="$CF_DIR/config.yml"
        CF_CERT_FILE="$CF_DIR/cert.pem"

        # Ensure directory exists and has proper user ownership before running any commands
        if [ ! -d "$CF_DIR" ]; then
            mkdir -p "$CF_DIR"
        fi
        if [ "$EUID" -eq 0 ]; then
            chown -R "$CURRENT_USER:$CURRENT_GROUP" "$CF_DIR"
        else
            chown -R "$CURRENT_USER:$CURRENT_GROUP" "$CF_DIR" 2>/dev/null || sudo -n chown -R "$CURRENT_USER:$CURRENT_GROUP" "$CF_DIR" 2>/dev/null || true
        fi
        chmod 700 "$CF_DIR" 2>/dev/null || true

        cf_config_valid() {
            [ -f "$1" ] || return 1
            awk '
                /^[[:space:]]*tunnel:[[:space:]]*[^[:space:]]/ { tunnel = 1 }
                /^[[:space:]]*credentials-file:[[:space:]]*[^[:space:]]/ { credentials = 1 }
                /^[[:space:]]*ingress:[[:space:]]*$/ { ingress = 1 }
                /{{/ { unresolved = 1 }
                END { exit (tunnel && credentials && ingress && !unresolved) ? 0 : 1 }
            ' "$1"
        }

        CF_CONFIG_EXISTING=no
        CF_CONFIG_UNUSABLE_PREEXISTING=no
        if [ -L "$CF_CONFIG_FILE" ] && [ ! -f "$CF_CONFIG_FILE" ]; then
            CF_CONFIG_UNUSABLE_PREEXISTING=yes
            echo "❌ Existing Cloudflare Tunnel configuration is a dangling symlink: $CF_CONFIG_FILE" >&2
            echo "   Refusing to replace a pre-existing link. Repair or remove it, then rerun setup.sh." >&2
            echo "ℹ Home Cloud will run in LAN-only mode (http://$ACTIVE_IP:3000)."
        fi
        if [ "$CF_CONFIG_UNUSABLE_PREEXISTING" = "no" ] && [ -f "$CF_CONFIG_FILE" ]; then
            if cf_config_valid "$CF_CONFIG_FILE"; then
                CF_CONFIG_EXISTING=yes
                echo "✔ Existing Cloudflare Tunnel configuration detected: $CF_CONFIG_FILE"
                EXISTING_DASH_HOST="$(awk '/hostname:.*dash\./ {print $NF}' "$CF_CONFIG_FILE" 2>/dev/null | head -n1 || true)"
                if [ -n "$EXISTING_DASH_HOST" ]; then
                    EXISTING_CF_DOMAIN="$(clean_domain "$EXISTING_DASH_HOST")"
                    set_phase tunnel_env_sync
                    apply_env_update "$SCRIPT_DIR/agent/.env" "CF_DOMAIN" "$EXISTING_CF_DOMAIN"
                    apply_env_update "$SCRIPT_DIR/agent/.env" "TUNNEL_NAME" "home-cloud"
                    chmod 600 "$SCRIPT_DIR/agent/.env" 2>/dev/null || true
                    run_privileged chown "$CURRENT_USER:$CURRENT_GROUP" "$SCRIPT_DIR/agent/.env" 2>/dev/null || true
                    echo "✔ Synced CF_DOMAIN=$EXISTING_CF_DOMAIN from config.yml to agent/.env"
                fi
            elif [ "$CF_CONFIG_CREATED_BY_SETUP" = "yes" ] || [ "${SETUP_JOURNAL[cf_config_preexisting]:-yes}" = "no" ]; then
                echo "♻️  Replacing an incomplete Cloudflare config left by an interrupted setup run..."
            else
                CF_CONFIG_UNUSABLE_PREEXISTING=yes
                echo "❌ Existing Cloudflare Tunnel configuration is incomplete or malformed: $CF_CONFIG_FILE" >&2
                echo "   Refusing to overwrite a pre-existing file. Repair or move it aside, then rerun setup.sh." >&2
                echo "ℹ Home Cloud will run in LAN-only mode (http://$ACTIVE_IP:3000)."
            fi
        fi
        if [ "$CF_CONFIG_EXISTING" = "no" ] && [ "$CF_CONFIG_UNUSABLE_PREEXISTING" = "no" ]; then
            SETUP_CF=""
            if [ -t 0 ] || [ "${SETUP_FORCE_INTERACTIVE:-false}" = "true" ]; then
                echo ""
                echo "┌──────────────────────────────────────────────────────────┐"
                echo "│ 🌐 CLOUDFLARE TUNNEL SETUP (FREE REMOTE HTTPS)           │"
                echo "│ Expose Home Cloud securely on your custom domain without  │"
                echo "│ opening router ports or exposing your public home IP.    │"
                echo "└──────────────────────────────────────────────────────────┘"
                if read -rp "Would you like to set up Cloudflare Tunnel now for free remote HTTPS access on a custom domain? [Y/n] " SETUP_CF; then
                    SETUP_CF="${SETUP_CF:-Y}"
                else
                    # EOF is a refusal, not an implicit yes. This also keeps
                    # unattended reruns from entering follow-up prompts.
                    SETUP_CF="N"
                fi
            elif [ "${NON_INTERACTIVE:-false}" != "true" ] && read_input "Would you like to set up Cloudflare Tunnel now for free remote HTTPS access on a custom domain? [Y/n] " PROMPT_CF; then
                SETUP_CF="${PROMPT_CF:-Y}"
            else
                if [ -n "${CF_DOMAIN_INPUT:-${CF_DOMAIN:-${CLOUDFLARE_DOMAIN:-}}}" ]; then
                    SETUP_CF="Y"
                else
                    SETUP_CF="N"
                fi
            fi

            if [[ "$SETUP_CF" =~ ^[Yy]$ ]]; then
                # a) Check if cert.pem exists; if not, invoke cloudflared tunnel login as target user
                if [ ! -f "$CF_CERT_FILE" ] && [ -f "/etc/cloudflared/cert.pem" ]; then
                    cp "/etc/cloudflared/cert.pem" "$CF_CERT_FILE"
                    chown "$CURRENT_USER:$CURRENT_GROUP" "$CF_CERT_FILE" 2>/dev/null || true
                    chmod 600 "$CF_CERT_FILE" 2>/dev/null || true
                fi

                if [ ! -f "$CF_CERT_FILE" ]; then
                    if [ ! -t 0 ] && [ "${SETUP_FORCE_INTERACTIVE:-false}" != "true" ]; then
                        echo "⚠️ Non-interactive mode detected and $CF_CERT_FILE not found."
                        echo "ℹ Cloudflare login requires interactive browser authorization."
                    else
                        echo ""
                        echo "🔑 Cloudflare authentication certificate not found."
                        echo "👉 cloudflared will now display an authorization URL below."
                        echo "   Please open the URL in your browser and select your domain."
                        echo ""
                        run_as_current_user cloudflared tunnel login || true
                        for _ in {1..3}; do
                            if [ -f "$CF_CERT_FILE" ]; then break; fi
                            sleep 1
                        done
                    fi
                fi

                if [ ! -f "$CF_CERT_FILE" ]; then
                    echo "⚠️ Cloudflare login was not completed ($CF_CERT_FILE not found)."
                    echo "ℹ Home Cloud will run in LAN-only mode (http://$ACTIVE_IP:3000)."
                    echo "  Remote access can be enabled later by running: cloudflared tunnel login && cloudflared tunnel create home-cloud"
                else
                    # b) Prompt user or resolve root domain name
                    CF_DOMAIN_VAL="${CF_DOMAIN_INPUT:-${CF_DOMAIN:-${CLOUDFLARE_DOMAIN:-}}}"
                    CF_DOMAIN_VAL="$(clean_domain "$CF_DOMAIN_VAL")"

                    if [ -t 0 ] || [ "${SETUP_FORCE_INTERACTIVE:-false}" = "true" ]; then
                        while true; do
                            if [ -n "$CF_DOMAIN_VAL" ]; then
                                read -rp "Enter your root domain name [default: $CF_DOMAIN_VAL]: " INPUT_DOMAIN || true
                                INPUT_CLEAN="$(clean_domain "${INPUT_DOMAIN:-}")"
                                if [ -n "$INPUT_CLEAN" ]; then
                                    CF_DOMAIN_VAL="$INPUT_CLEAN"
                                fi
                            else
                                if ! read -rp "Enter your root domain name (e.g. home-cloud.live): " INPUT_DOMAIN; then
                                    break
                                fi
                                CF_DOMAIN_VAL="$(clean_domain "${INPUT_DOMAIN:-}")"
                            fi
                            if [ -n "$CF_DOMAIN_VAL" ]; then
                                break
                            fi
                            echo "❌ Domain name cannot be empty. Please try again."
                        done
                    elif [ "${NON_INTERACTIVE:-false}" != "true" ]; then
                        while true; do
                            if [ -n "$CF_DOMAIN_VAL" ]; then
                                if read_input "Enter your root domain name [default: $CF_DOMAIN_VAL]: " INPUT_DOMAIN; then
                                    INPUT_CLEAN="$(clean_domain "${INPUT_DOMAIN:-}")"
                                    if [ -n "$INPUT_CLEAN" ]; then
                                        CF_DOMAIN_VAL="$INPUT_CLEAN"
                                    fi
                                fi
                            else
                                if ! read_input "Enter your root domain name (e.g. home-cloud.live): " INPUT_DOMAIN; then
                                    break
                                fi
                                CF_DOMAIN_VAL="$(clean_domain "${INPUT_DOMAIN:-}")"
                            fi
                            if [ -n "$CF_DOMAIN_VAL" ]; then
                                break
                            fi
                            echo "❌ Domain name cannot be empty. Please try again."
                        done
                    fi

                    CF_DOMAIN_VAL="$(clean_domain "$CF_DOMAIN_VAL")"

                    if [ -z "$CF_DOMAIN_VAL" ]; then
                        echo "⚠️ No domain provided."
                        echo "ℹ Home Cloud will run in LAN-only mode (http://$ACTIVE_IP:3000)."
                        echo "  Remote access can be enabled later by running: cloudflared tunnel login && cloudflared tunnel create home-cloud"
                    else
                        TUNNEL_NAME="${TUNNEL_NAME_INPUT:-${TUNNEL_NAME:-home-cloud}}"
                        echo "🔍 Checking for existing Cloudflare tunnel '$TUNNEL_NAME'..."
                        TUNNEL_LIST_OK=no
                        TUNNEL_LIST_OUT="$(run_as_current_user cloudflared tunnel list 2>/dev/null)" && TUNNEL_LIST_OK=yes || true
                        TUNNEL_ID="$(printf '%s\n' "$TUNNEL_LIST_OUT" | awk -v name="$TUNNEL_NAME" '$2 == name {print $1; exit}')"
                        TUNNEL_UNUSABLE=no

                        # If tunnel was found remotely in cloudflared tunnel list, verify local credentials exist
                        if [ -n "$TUNNEL_ID" ]; then
                            if [ ! -f "$CF_DIR/$TUNNEL_ID.json" ]; then
                                # Check if credentials file exists under another name or in directory
                                MATCHED_CRED=""
                                for cred_file in "$CF_DIR"/*.json; do
                                    if [ -f "$cred_file" ]; then
                                        base_name="$(basename "$cred_file" .json)"
                                        if [ "$base_name" = "$TUNNEL_ID" ]; then
                                            MATCHED_CRED="$cred_file"
                                            break
                                        fi
                                        if "$NODE_PATH" -e '
                                            const fs = require("fs");
                                            try {
                                                const credentials = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
                                                process.exit(credentials.TunnelID === process.argv[2] ? 0 : 1);
                                            } catch {
                                                process.exit(1);
                                            }
                                        ' "$cred_file" "$TUNNEL_ID" 2>/dev/null; then
                                            MATCHED_CRED="$cred_file"
                                            cp "$cred_file" "$CF_DIR/$TUNNEL_ID.json"
                                            break
                                        fi
                                    fi
                                done

                                if [ -z "$MATCHED_CRED" ] && [ ! -f "$CF_DIR/$TUNNEL_ID.json" ]; then
                                    echo "⚠️ Tunnel '$TUNNEL_NAME' exists on Cloudflare, but local credentials file was not found."
                                    if { [ "$RECOVERED_TUNNEL_DELETE_ALLOWED" = "yes" ] || [ "$TUNNEL_CREATED_BY_SETUP" = "yes" ]; } && \
                                       { [ -z "$RECOVERED_TUNNEL_ID" ] || [ "$RECOVERED_TUNNEL_ID" = "$TUNNEL_ID" ]; }; then
                                        echo "🔄 Removing an orphaned remote tunnel proven to have been created by an interrupted setup run..."
                                        run_as_current_user cloudflared tunnel delete -f "$TUNNEL_NAME" >/dev/null 2>&1 || true
                                        TUNNEL_ID=""
                                        TUNNEL_CREATED_BY_SETUP=no
                                        journal_put tunnel_created_by_setup no || true
                                        journal_put tunnel_id "" || true
                                    else
                                        echo "ℹ Refusing to delete a remote tunnel that was not proven to be owned by this setup transaction."
                                        echo "ℹ Home Cloud will run in LAN-only mode until $CF_DIR/$TUNNEL_ID.json is restored or the tunnel is removed manually."
                                        TUNNEL_UNUSABLE=yes
                                    fi
                                fi
                            fi
                        fi

                        # c) Create tunnel if it does not exist (or was cleaned up due to missing local credentials)
                        if [ "$TUNNEL_UNUSABLE" = "no" ] && [ -z "$TUNNEL_ID" ]; then
                            echo "🔨 Creating tunnel '$TUNNEL_NAME'..."
                            set_phase_critical tunnel_create
                            if [ "$TUNNEL_LIST_OK" = "yes" ]; then
                                journal_put_critical tunnel_pre_create_absent yes
                            else
                                journal_put_critical tunnel_pre_create_absent no
                            fi
                            # Any ID this run creates is new ownership; never
                            # inherit a stale proof from an earlier attempt.
                            TUNNEL_CREATED_BY_SETUP=no
                            journal_put_critical tunnel_created_by_setup no
                            journal_put_critical tunnel_id ""
                            journal_put_critical tunnel_name "$TUNNEL_NAME"
                            journal_put_critical tunnel_create_attempted yes
                            CREATE_OUTPUT="$(run_as_current_user cloudflared tunnel create "$TUNNEL_NAME" 2>&1 || true)"
                            echo "$CREATE_OUTPUT"
                            TUNNEL_CREATED_PROVEN=no
                            if [[ "$CREATE_OUTPUT" =~ ([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}) ]]; then
                                TUNNEL_ID="${BASH_REMATCH[1]}"
                                TUNNEL_CREATED_PROVEN=yes
                            fi
                            if [ -z "$TUNNEL_ID" ]; then
                                TUNNEL_ID="$(run_as_current_user cloudflared tunnel list 2>/dev/null | awk -v name="$TUNNEL_NAME" '$2 == name {print $1; exit}' || true)"
                                # A post-create listing only proves ownership when
                                # the pre-create listing succeeded and was empty.
                                if [ -n "$TUNNEL_ID" ] && [ "$TUNNEL_LIST_OK" = "yes" ]; then
                                    TUNNEL_CREATED_PROVEN=yes
                                fi
                            fi
                            if [ -n "$TUNNEL_ID" ] && [ "$TUNNEL_CREATED_PROVEN" = "yes" ]; then
                                TUNNEL_CREATED_BY_SETUP=yes
                                journal_put_critical tunnel_created_by_setup yes
                                journal_put_critical tunnel_id "$TUNNEL_ID"
                                set_phase_critical tunnel_created
                            fi
                        elif [ "$TUNNEL_UNUSABLE" = "no" ]; then
                            echo "✔ Found existing tunnel '$TUNNEL_NAME' with ID: $TUNNEL_ID"
                        fi

                        # d) Extract Tunnel UUID from JSON credentials file or tunnel list
                        if [ "$TUNNEL_UNUSABLE" = "no" ] && { [ -z "$TUNNEL_ID" ] || [ ! -f "$CF_DIR/$TUNNEL_ID.json" ]; }; then
                            for cred_file in "$CF_DIR"/*.json; do
                                if [ -f "$cred_file" ]; then
                                    base_name="$(basename "$cred_file" .json)"
                                    if [[ "$base_name" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
                                        TUNNEL_ID="$base_name"
                                        break
                                    fi
                                fi
                            done
                        fi

                        if [ "$TUNNEL_UNUSABLE" = "yes" ] || [ -z "$TUNNEL_ID" ] || [ ! -f "$CF_DIR/$TUNNEL_ID.json" ]; then
                            echo "❌ Failed to determine Tunnel UUID or credentials file for '$TUNNEL_NAME'."
                            echo "ℹ Home Cloud will run in LAN-only mode (http://$ACTIVE_IP:3000)."
                            echo "  Remote access can be enabled later by running: cloudflared tunnel login && cloudflared tunnel create home-cloud"
                        else
                            # e) Automatically generate config.yml atomically
                            echo "📝 Generating $CF_CONFIG_FILE..."
                            set_phase_critical tunnel_config
                            CF_CONFIG_TMP="$(mktemp "$CF_DIR/.config.yml.home-cloud-tmp.XXXXXX")" || {
                                echo "❌ Could not create a temporary Cloudflare config file." >&2
                                exit 1
                            }
                            register_temp_file "$CF_CONFIG_TMP"
                            printf '%s\n' \
                                "tunnel: $TUNNEL_ID" \
                                "credentials-file: $CF_DIR/$TUNNEL_ID.json" \
                                '' \
                                'ingress:' \
                                "  - hostname: dash.$CF_DOMAIN_VAL" \
                                '    service: http://localhost:3000' \
                                '  - service: http_status:404' > "$CF_CONFIG_TMP"
                            if ! cf_config_valid "$CF_CONFIG_TMP"; then
                                echo "❌ Rendered Cloudflare config failed validation; refusing to install it." >&2
                                exit 1
                            fi
                            chmod 644 "$CF_CONFIG_TMP" 2>/dev/null || true
                            if [ "$EUID" -eq 0 ]; then
                                chown "$CURRENT_USER:$CURRENT_GROUP" "$CF_CONFIG_TMP" 2>/dev/null || true
                            fi
                            durable_sync_file "$CF_CONFIG_TMP"
                            CF_CONFIG_CREATED_BY_SETUP=yes
                            journal_put_critical cf_config_created_by_setup yes
                            mv -fT -- "$CF_CONFIG_TMP" "$CF_CONFIG_FILE" || {
                                echo "❌ Could not atomically install $CF_CONFIG_FILE." >&2
                                exit 1
                            }
                            durable_sync_dir "$CF_DIR"
                            echo "✔ Successfully generated $CF_CONFIG_FILE"

                            # f) Automatically route DNS for the dashboard subdomain
                            echo "🌐 Routing DNS for dash.$CF_DOMAIN_VAL..."
                            set_phase tunnel_dns
                            if DNS_OUT="$(run_as_current_user cloudflared tunnel route dns --overwrite-dns "$TUNNEL_NAME" "dash.$CF_DOMAIN_VAL" 2>&1)"; then
                                echo "$DNS_OUT"
                                echo "✔ DNS routing configured for dash.$CF_DOMAIN_VAL"
                            else
                                echo "$DNS_OUT"
                                echo "⚠️ DNS routing did not complete; setup is idempotent and a rerun will retry it."
                            fi

                            # g) Update agent/.env atomically
                            echo "⚙ Updating agent/.env with CF_DOMAIN and TUNNEL_NAME..."
                            set_phase tunnel_env_sync
                            apply_env_update "$SCRIPT_DIR/agent/.env" "CF_DOMAIN" "$CF_DOMAIN_VAL"
                            apply_env_update "$SCRIPT_DIR/agent/.env" "TUNNEL_NAME" "$TUNNEL_NAME"
                            chmod 600 "$SCRIPT_DIR/agent/.env" 2>/dev/null || true
                            run_privileged chown "$CURRENT_USER:$CURRENT_GROUP" "$SCRIPT_DIR/agent/.env" 2>/dev/null || true
                            echo "✔ Updated agent/.env with CF_DOMAIN=$CF_DOMAIN_VAL and TUNNEL_NAME=$TUNNEL_NAME"

                            # h) Ensure file permissions
                            if [ -d "$CF_DIR" ]; then
                                if [ "$EUID" -eq 0 ]; then
                                    chown -R "$CURRENT_USER:$CURRENT_GROUP" "$CF_DIR"
                                else
                                    chown -R "$CURRENT_USER:$CURRENT_GROUP" "$CF_DIR" 2>/dev/null || sudo -n chown -R "$CURRENT_USER:$CURRENT_GROUP" "$CF_DIR" 2>/dev/null || true
                                fi
                                chmod 700 "$CF_DIR" 2>/dev/null || true
                                chmod 600 "$CF_DIR"/*.json "$CF_DIR"/*.pem 2>/dev/null || true
                                chmod 644 "$CF_CONFIG_FILE" 2>/dev/null || true
                            fi
                            echo "✔ Ensured permissions for $CF_DIR"
                        fi
                    fi
                fi
            else
                echo "ℹ Cloudflare Tunnel setup skipped."
                echo "ℹ Home Cloud will run in LAN-only mode (http://$ACTIVE_IP:3000)."
                echo "  Remote access can be enabled later by running: cloudflared tunnel login && cloudflared tunnel create home-cloud"
            fi
        fi
    else
        echo "ℹ cloudflared is not installed. Home Cloud will run in LAN-only mode (http://$ACTIVE_IP:3000)."
    fi
}

setup_cloudflare_tunnel

# 9. Monorepo Dependencies & Production Dashboard Build
if [ "$DRY_RUN" = true ]; then
    echo ""
    echo "[DRY-RUN] Would run pnpm install --frozen-lockfile and build the dashboard in $SCRIPT_DIR"
else
    echo ""
    echo "📦 Installing dependencies & building dashboard..."
    export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
    (cd "$SCRIPT_DIR" && run_as_current_user pnpm install --frozen-lockfile)
    (cd "$SCRIPT_DIR" && run_as_current_user pnpm --filter dashboard build)
    echo "✔ Dashboard bundle built successfully in dashboard/dist/"
fi

# 10. Configure UFW Firewall for LAN port 3000 if UFW is active
if [ "$DRY_RUN" = true ]; then
    echo "[DRY-RUN] Would configure UFW firewall rule for port 3000/tcp if active."
else
    if command -v ufw >/dev/null 2>&1; then
        if firewall_status="$(run_privileged ufw status 2>/dev/null)" && [[ "$firewall_status" == *"Status: active"* ]]; then
            echo "🛡 UFW is active. Allowing incoming traffic on port 3000/tcp..."
            run_privileged ufw allow 3000/tcp comment "Home Cloud Dashboard" >/dev/null 2>&1 || true
        fi
    fi
fi

# 11. Render & Inject Systemd Service File
reject_systemd_unit_value() {
    local label="$1"
    local value="$2"
    case "$value" in
        *$'\r'*|*$'\n'*|*'|'*|*'&'*)
            echo "❌ Refusing to render systemd unit: ${label} contains CR, LF, '|', or '&'." >&2
            exit 1
            ;;
    esac
}

if [ "$CURRENT_USER" = "root" ]; then
    echo "❌ Refusing to render a systemd unit with User=root." >&2
    if [ "$DRY_RUN" = true ]; then
        echo "[DRY-RUN] Would not write $TARGET_SERVICE because User=root is not allowed. Set HOME_CLOUD_SERVICE_USER to a non-root account." >&2
    fi
    exit 1
fi

# Reject metacharacters before sed | tee so a bad value cannot truncate the unit.
reject_systemd_unit_value "SCRIPT_DIR" "$SCRIPT_DIR"
reject_systemd_unit_value "TARGET_DIR" "${TARGET_DIR:-}"
reject_systemd_unit_value "NODE_PATH" "$NODE_PATH"
reject_systemd_unit_value "NODE_DIR" "$NODE_DIR"
reject_systemd_unit_value "CURRENT_USER" "$CURRENT_USER"
reject_systemd_unit_value "CURRENT_GROUP" "$CURRENT_GROUP"

SERVICE_UNIT_BACKUP=""
SERVICE_UNIT_PREEXISTING=no
SERVICE_UNIT_TOUCHED=no

rollback_service_unit() {
    [ "$SERVICE_UNIT_TOUCHED" = "yes" ] || return 0
    echo "↩ Restoring the previous systemd unit after setup failed..." >&2
    if [ "$SERVICE_UNIT_PREEXISTING" = "yes" ] && [ -f "$SERVICE_UNIT_BACKUP" ]; then
        local restore_tmp=""
        restore_tmp="$(run_privileged mktemp "$(dirname "$TARGET_SERVICE")/.home-cloud.service.home-cloud-tmp.XXXXXX")" || return 1
        if run_privileged cp -p "$SERVICE_UNIT_BACKUP" "$restore_tmp" && \
           run_privileged mv -fT -- "$restore_tmp" "$TARGET_SERVICE"; then
            durable_sync_file "$TARGET_SERVICE"
            durable_sync_dir "$(dirname "$TARGET_SERVICE")"
            rm -f -- "$SERVICE_UNIT_BACKUP" 2>/dev/null || run_privileged rm -f -- "$SERVICE_UNIT_BACKUP" 2>/dev/null || true
            durable_sync_dir "$(dirname "$SERVICE_UNIT_BACKUP")"
            SERVICE_UNIT_TOUCHED=no
            journal_put service_unit_touched no || true
            journal_put service_unit_backup "" || true
            return 0
        fi
        rm -f -- "$restore_tmp" 2>/dev/null || run_privileged rm -f -- "$restore_tmp" 2>/dev/null || true
        return 1
    fi
    run_privileged rm -f -- "$TARGET_SERVICE" 2>/dev/null || true
    SERVICE_UNIT_TOUCHED=no
    journal_put service_unit_touched no || true
}
if [ "$DRY_RUN" = true ]; then
    echo ""
    echo "[DRY-RUN] Would compile ${TEMPLATE_FILE} -> $TARGET_SERVICE with:"
    echo "          USER=$CURRENT_USER, GROUP=$CURRENT_GROUP, DIR=$SCRIPT_DIR, NODE=$NODE_PATH"
else
    if [ ! -f "$TEMPLATE_FILE" ]; then
        echo "❌ Error: Template file $TEMPLATE_FILE not found!" >&2
        exit 1
    fi
    if [ -L "$TARGET_SERVICE" ]; then
        echo "❌ Refusing to replace the symlink at $TARGET_SERVICE." >&2
        echo "   Install the unit as a regular file, or remove the link and rerun setup.sh." >&2
        exit 1
    fi
    echo ""
    echo "⚙ Compiling $TEMPLATE_FILE -> $TARGET_SERVICE..."
    set_phase_critical service_install
    run_privileged mkdir -p "$(dirname "$TARGET_SERVICE")" || {
        echo "❌ Could not create systemd unit directory $(dirname "$TARGET_SERVICE")." >&2
        exit 1
    }
    SERVICE_RENDER_TMP="$(mktemp "$SETUP_STATE_DIR/service-unit.${SETUP_STATE_KEY}.render.XXXXXX")" || {
        echo "❌ Could not create a temporary systemd unit." >&2
        exit 1
    }
    register_temp_file "$SERVICE_RENDER_TMP"
    sed \
        -e "s|{{USER}}|$CURRENT_USER|g" \
        -e "s|{{GROUP}}|$CURRENT_GROUP|g" \
        -e "s|{{WORKING_DIR}}|$SCRIPT_DIR|g" \
        -e "s|{{NODE_PATH}}|$NODE_PATH|g" \
        -e "s|{{NODE_DIR}}|$NODE_DIR|g" \
        "$TEMPLATE_FILE" > "$SERVICE_RENDER_TMP"
    if awk '/{{/ { found = 1 } END { exit found ? 0 : 1 }' "$SERVICE_RENDER_TMP"; then
        echo "❌ Rendered systemd unit contains unresolved template variables; refusing to install it." >&2
        exit 1
    fi
    if [ -f "$TARGET_SERVICE" ]; then
        SERVICE_UNIT_PREEXISTING=yes
        SERVICE_UNIT_BACKUP="$SETUP_STATE_DIR/service-unit.${SETUP_STATE_KEY}.backup.$$"
        # Persist the exact owned path before creating the backup so a SIGKILL
        # during cp leaves a recoverable reference rather than an orphan.
        journal_put_critical service_unit_preexisting yes
        journal_put_critical service_unit_backup "$SERVICE_UNIT_BACKUP"
        journal_put_critical service_unit_touched no
        run_privileged cp -p "$TARGET_SERVICE" "$SERVICE_UNIT_BACKUP" || {
            echo "❌ Could not back up the existing systemd unit." >&2
            exit 1
        }
        durable_sync_file "$SERVICE_UNIT_BACKUP" || {
            echo "❌ Could not sync the systemd unit backup." >&2
            exit 1
        }
        durable_sync_dir "$SETUP_STATE_DIR" || {
            echo "❌ Could not sync the systemd unit backup directory." >&2
            exit 1
        }
    else
        SERVICE_UNIT_PREEXISTING=no
        SERVICE_UNIT_BACKUP=""
        journal_put_critical service_unit_preexisting no
        journal_put_critical service_unit_backup ""
    fi
    journal_put_critical service_unit_target "$TARGET_SERVICE"
    SERVICE_TMP="$(run_privileged mktemp "$(dirname "$TARGET_SERVICE")/.home-cloud.service.home-cloud-tmp.XXXXXX")" || {
        echo "❌ Could not create a temporary systemd unit in $(dirname "$TARGET_SERVICE")." >&2
        exit 1
    }
    register_temp_file "$SERVICE_TMP"
    if ! run_privileged cp "$SERVICE_RENDER_TMP" "$SERVICE_TMP"; then
        echo "❌ Could not stage the systemd unit." >&2
        exit 1
    fi
    run_privileged chmod 0644 "$SERVICE_TMP" 2>/dev/null || true
    run_privileged chown root:root "$SERVICE_TMP" 2>/dev/null || true
    durable_sync_file "$SERVICE_TMP"

    # Close recovery gap: register rollback and persist critical journal state
    # BEFORE modifying the live target unit on disk
    SERVICE_UNIT_TOUCHED=yes
    register_rollback rollback_service_unit
    journal_put_critical service_unit_touched yes

    if ! run_privileged mv -fT -- "$SERVICE_TMP" "$TARGET_SERVICE"; then
        echo "❌ Could not atomically install $TARGET_SERVICE." >&2
        exit 1
    fi
    durable_sync_dir "$(dirname "$TARGET_SERVICE")"
    set_phase_critical service_installed
    rm -f -- "$SERVICE_RENDER_TMP" 2>/dev/null || true
    echo "✔ Successfully generated $TARGET_SERVICE"
fi

# 12. Fix file permissions on the repository directory so non-root user owns build artifacts
if [ "$DRY_RUN" = true ]; then
    echo "[DRY-RUN] Would fix permissions: chown -R $CURRENT_USER:$CURRENT_GROUP $SCRIPT_DIR"
else
    run_privileged chown -R "$CURRENT_USER:$CURRENT_GROUP" "$SCRIPT_DIR"
fi

# 13. Register and Start Service with systemd
if [ "$DRY_RUN" = true ]; then
    echo "[DRY-RUN] Would reload systemd daemon and enable --now home-cloud.service"
    echo ""
    echo "========================================================"
    echo "  ✔ [DRY-RUN] Setup verification completed successfully! "
    echo "  All arguments, prerequisites, and templates verified.   "
    echo "========================================================"
    exit 0
fi

echo "🔄 Reloading systemd daemon..."
set_phase systemd_reload
run_privileged systemctl daemon-reload

echo "🚀 Enabling and starting home-cloud.service..."
set_phase systemd_enable
run_privileged systemctl enable --now home-cloud.service

finish_transaction
clear_rollbacks

echo ""
echo "========================================================"
echo "  🎉 Home Cloud successfully installed & running!     "
echo "========================================================"
echo ""

echo "  Access locally at:  http://$ACTIVE_IP:3000"
ACTIVE_CF_DOMAIN=""
if [ -f "$SCRIPT_DIR/agent/.env" ]; then
    ACTIVE_CF_DOMAIN="$(
        "$NODE_PATH" -e '
            const fs = require("fs");
            const path = require("path");
            const dotenv = require(require.resolve("dotenv", { paths: [path.join(process.argv[1], "agent")] }));
            const parsed = dotenv.parse(fs.readFileSync(path.join(process.argv[1], "agent", ".env"), "utf8"));
            process.stdout.write(String(parsed.CF_DOMAIN || "").trim());
        ' "$SCRIPT_DIR"
    )"
fi
if [ -n "$ACTIVE_CF_DOMAIN" ] && [ -f "$CURRENT_HOME/.cloudflared/config.yml" ]; then
    echo "  Access remotely at: https://dash.$ACTIVE_CF_DOMAIN"
fi
echo ""
echo "Service management commands:"
echo "  Check status:       sudo systemctl status home-cloud"
echo "  Stream live logs:   sudo journalctl -u home-cloud -f -o cat"
echo "  Restart service:    sudo systemctl restart home-cloud"
echo "  Stop service:       sudo systemctl stop home-cloud"
echo "========================================================"
