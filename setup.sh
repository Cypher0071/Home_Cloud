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
TARGET_SERVICE="/etc/systemd/system/home-cloud.service"

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

# Ensure repository tree is present (in case setup.sh was executed standalone or via curl)
if [ ! -f "$INSTALL_DIR/home-cloud.service.template" ] || [ ! -f "$INSTALL_DIR/agent/package.json" ]; then
    echo "⚠️ Home Cloud repository files not found in $INSTALL_DIR."
    echo "⬇ Cloning full repository (branch: $BRANCH) from https://github.com/Cypher0071/home_cloud.git..."
    if [ "$DRY_RUN" = true ]; then
        echo "[DRY-RUN] Would clone https://github.com/Cypher0071/home_cloud.git (branch: $BRANCH) to $INSTALL_DIR"
    else
        mkdir -p "$INSTALL_DIR"
        run_as_current_user git clone --branch "$BRANCH" https://github.com/Cypher0071/home_cloud.git "$INSTALL_DIR"
    fi
fi

if [ -d "$INSTALL_DIR/.git" ] && [ "$DRY_RUN" = false ]; then
    CURRENT_GIT_BRANCH="$(run_as_current_user git -C "$INSTALL_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    CURRENT_GIT_TAG="$(run_as_current_user git -C "$INSTALL_DIR" describe --tags --exact-match 2>/dev/null || true)"
    if [ -n "$BRANCH" ] && [ "$CURRENT_GIT_BRANCH" != "$BRANCH" ] && [ "$CURRENT_GIT_TAG" != "$BRANCH" ]; then
        echo "🔄 Checking out '$BRANCH' in $INSTALL_DIR..."
        run_as_current_user git -C "$INSTALL_DIR" checkout "$BRANCH"
    fi
fi

SCRIPT_DIR="$INSTALL_DIR"
TEMPLATE_FILE="$SCRIPT_DIR/home-cloud.service.template"

# 3. Node.js Runtime Check (operator-installed; never piped from NodeSource)
# Compare major.minor so 22.12 is rejected and 22.13.0 / 23.x are accepted.
node_satisfies_minimum() {
    local raw="${1#v}"
    local major="" minor=""
    IFS='.' read -r major minor _ <<< "$raw"
    major="${major//[^0-9]/}"
    minor="${minor//[^0-9]/}"
    if [ -z "$major" ] || [ -z "$minor" ]; then
        return 1
    fi
    if [ "$major" -gt 22 ]; then
        return 0
    fi
    if [ "$major" -eq 22 ] && [ "$minor" -ge 13 ]; then
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
        echo "⚠️ Detected Node.js $NODE_VERSION, but Home Cloud requires Node.js >= 22.13."
        NEED_NODE_REFUSE=true
    fi
fi

if [ "$NEED_NODE_REFUSE" = true ]; then
    if [ "$DRY_RUN" = true ]; then
        echo "[DRY-RUN] Node.js >= 22.13 must be installed by the operator. Setup would refuse and exit 1. Not installing Node.js."
        if [ -z "$NODE_PATH" ]; then
            NODE_PATH="/usr/bin/node"
            NODE_VERSION="(not installed)"
        fi
    else
        echo "❌ Node.js >= 22.13 must be installed by the operator." >&2
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
        echo "❌ corepack is required to activate pnpm@${PNPM_PIN}. Node.js >= 22.13 must be installed by the operator." >&2
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

download_verified_cloudflared() {
    local asset_name="$1"
    local dest="$2"
    local expected="" actual=""
    rm -f "$dest"
    if ! curl -fsSL "${CLOUDFLARED_RELEASE_BASE}/${asset_name}" -o "$dest"; then
        rm -f "$dest"
        echo "❌ Failed to download ${asset_name} for cloudflared ${CLOUDFLARED_VERSION}." >&2
        exit 1
    fi
    if ! expected="$(expected_sha256_for_asset "$asset_name")"; then
        rm -f "$dest"
        echo "❌ Refusing to install unverified ${asset_name}." >&2
        exit 1
    fi
    expected="${expected//$'\r'/}"
    expected="${expected//$'\n'/}"
    if ! command -v sha256sum >/dev/null 2>&1; then
        rm -f "$dest"
        echo "❌ sha256sum is required to verify ${asset_name}." >&2
        exit 1
    fi
    actual="$(sha256sum "$dest" | awk '{print tolower($1)}')"
    if [ -z "$expected" ] || [ "$actual" != "$expected" ]; then
        rm -f "$dest"
        echo "❌ SHA256 verification failed for ${asset_name}. Deleted the temp file." >&2
        exit 1
    fi
    echo "✔ SHA256 verified ${asset_name} (${CLOUDFLARED_VERSION})"
}

install_verified_cloudflared_package() {
    local asset_name="$1"
    local kind="$2"
    local tmp=""
    tmp="$(mktemp)"
    download_verified_cloudflared "$asset_name" "$tmp"
    if [ "$kind" = "deb" ]; then
        if ! run_privileged dpkg -i "$tmp"; then
            if ! run_privileged apt-get install -f -y; then
                rm -f "$tmp"
                exit 1
            fi
        fi
    elif [ "$kind" = "rpm" ]; then
        if ! run_privileged "$PKG_MANAGER" install -y "$tmp"; then
            if ! run_privileged rpm -i "$tmp"; then
                rm -f "$tmp"
                exit 1
            fi
        fi
    else
        if command -v install >/dev/null 2>&1; then
            if ! run_privileged install -m 0755 "$tmp" /usr/local/bin/cloudflared; then
                rm -f "$tmp"
                exit 1
            fi
        else
            if ! run_privileged cp "$tmp" /usr/local/bin/cloudflared; then
                rm -f "$tmp"
                exit 1
            fi
            run_privileged chmod +x /usr/local/bin/cloudflared
        fi
    fi
    rm -f "$tmp"
    echo "✔ cloudflared ${CLOUDFLARED_VERSION} installed: $(command -v cloudflared || echo '/usr/local/bin/cloudflared')"
}

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
    HOME_CLOUD_ENV_PATH="$SCRIPT_DIR/agent/.env" \
    HOME_CLOUD_NEW_JWT="$1" \
    "$NODE_PATH" -e '
        const fs = require("fs");
        const envPath = process.env.HOME_CLOUD_ENV_PATH;
        const secret = process.env.HOME_CLOUD_NEW_JWT;
        if (!envPath || typeof secret !== "string" || secret.length === 0 || /[\r\n]/.test(secret)) {
            console.error("Missing or invalid HOME_CLOUD_NEW_JWT.");
            process.exit(1);
        }
        let content = fs.readFileSync(envPath, "utf8");
        content = content.replace(/^JWT_SECRET=.*/m, "JWT_SECRET=" + secret);
        fs.writeFileSync(envPath, content, { mode: 0o600 });
    '
    chmod 600 "$SCRIPT_DIR/agent/.env"
}

write_admin_password() {
    HOME_CLOUD_ENV_PATH="$SCRIPT_DIR/agent/.env" \
    HOME_CLOUD_NEW_PASSWORD="$1" \
    "$NODE_PATH" -e '
        const fs = require("fs");
        const path = require("path");
        const dotenv = require(require.resolve("dotenv", { paths: [path.join(process.argv[1], "agent")] }));
        const projectDir = process.argv[1];
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

        const tempPath = `${envPath}.${process.pid}.${require("crypto").randomBytes(4).toString("hex")}.tmp`;
        try {
            fs.writeFileSync(tempPath, updated, { mode: 0o600, flag: "wx" });
            fs.renameSync(tempPath, envPath);
        } finally {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        }
    '
    "$SCRIPT_DIR"
    chmod 600 "$SCRIPT_DIR/agent/.env"
}

echo ""
echo "⚙ Configuring environment & security credentials..."

if [ "$DRY_RUN" = true ]; then
    echo "[DRY-RUN] Would generate a JWT_SECRET and write the admin password only to ${SCRIPT_DIR}/agent/.env (mode 0600). The password would not be printed."
else
    if [ ! -f "$SCRIPT_DIR/agent/.env" ]; then
        if [ -f "$SCRIPT_DIR/agent/.env.example" ]; then
            cp "$SCRIPT_DIR/agent/.env.example" "$SCRIPT_DIR/agent/.env"
        else
            printf '%s\n' 'PASSWORD=change-me' 'JWT_SECRET=generate-a-long-random-string' 'PORT=3000' > "$SCRIPT_DIR/agent/.env"
        fi
        # Generate cryptographically secure JWT secret (not passed on argv)
        RANDOM_JWT="$("$NODE_PATH" -e 'process.stdout.write(require("crypto").randomBytes(24).toString("hex"))')"
        write_jwt_secret "$RANDOM_JWT"
        echo "✔ Generated secure random JWT_SECRET."
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

        if [ -f "$CF_CONFIG_FILE" ]; then
            echo "✔ Existing Cloudflare Tunnel configuration detected: $CF_CONFIG_FILE"
            EXISTING_DASH_HOST="$(awk '/hostname:.*dash\./ {print $NF}' "$CF_CONFIG_FILE" 2>/dev/null | head -n1 || true)"
            if [ -n "$EXISTING_DASH_HOST" ]; then
                EXISTING_CF_DOMAIN="$(clean_domain "$EXISTING_DASH_HOST")"
                HOME_CLOUD_ENV_PATH="$SCRIPT_DIR/agent/.env" \
                HOME_CLOUD_CF_DOMAIN="$EXISTING_CF_DOMAIN" \
                "$NODE_PATH" -e '
                    const fs = require("fs");
                    const envPath = process.env.HOME_CLOUD_ENV_PATH;
                    const cfDomain = process.env.HOME_CLOUD_CF_DOMAIN;
                    let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

                    function updateOrAppend(key, val) {
                        const regex = new RegExp("^" + key + "=.*", "m");
                        if (regex.test(content)) {
                            content = content.replace(regex, key + "=" + val);
                        } else {
                            const trimmed = content.trimEnd();
                            content = (trimmed ? trimmed + "\n" : "") + key + "=" + val + "\n";
                        }
                    }

                    updateOrAppend("CF_DOMAIN", cfDomain);
                    updateOrAppend("TUNNEL_NAME", "home-cloud");
                    fs.writeFileSync(envPath, content, { mode: 0o600 });
                '
                echo "✔ Synced CF_DOMAIN=$EXISTING_CF_DOMAIN from config.yml to agent/.env"
            fi
        else
            SETUP_CF=""
            if [ -t 0 ] || [ "${SETUP_FORCE_INTERACTIVE:-false}" = "true" ]; then
                echo ""
                echo "┌──────────────────────────────────────────────────────────┐"
                echo "│ 🌐 CLOUDFLARE TUNNEL SETUP (FREE REMOTE HTTPS)           │"
                echo "│ Expose Home Cloud securely on your custom domain without  │"
                echo "│ opening router ports or exposing your public home IP.    │"
                echo "└──────────────────────────────────────────────────────────┘"
                read -rp "Would you like to set up Cloudflare Tunnel now for free remote HTTPS access on a custom domain? [Y/n] " SETUP_CF || SETUP_CF="N"
                SETUP_CF="${SETUP_CF:-Y}"
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
                                read -rp "Enter your root domain name (e.g. home-cloud.live): " INPUT_DOMAIN || true
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
                        TUNNEL_ID="$(run_as_current_user cloudflared tunnel list 2>/dev/null | awk -v name="$TUNNEL_NAME" '$2 == name {print $1; exit}' || true)"

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
                                    echo "🔄 Removing orphaned remote tunnel and generating new credentials..."
                                    run_as_current_user cloudflared tunnel delete -f "$TUNNEL_NAME" >/dev/null 2>&1 || true
                                    TUNNEL_ID=""
                                fi
                            fi
                        fi

                        # c) Create tunnel if it does not exist (or was cleaned up due to missing local credentials)
                        if [ -z "$TUNNEL_ID" ]; then
                            echo "🔨 Creating tunnel '$TUNNEL_NAME'..."
                            CREATE_OUTPUT="$(run_as_current_user cloudflared tunnel create "$TUNNEL_NAME" 2>&1 || true)"
                            echo "$CREATE_OUTPUT"
                            if [[ "$CREATE_OUTPUT" =~ ([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}) ]]; then
                                TUNNEL_ID="${BASH_REMATCH[1]}"
                            fi
                            if [ -z "$TUNNEL_ID" ]; then
                                TUNNEL_ID="$(run_as_current_user cloudflared tunnel list 2>/dev/null | awk -v name="$TUNNEL_NAME" '$2 == name {print $1; exit}' || true)"
                            fi
                        else
                            echo "✔ Found existing tunnel '$TUNNEL_NAME' with ID: $TUNNEL_ID"
                        fi

                        # d) Extract Tunnel UUID from JSON credentials file or tunnel list
                        if [ -z "$TUNNEL_ID" ] || [ ! -f "$CF_DIR/$TUNNEL_ID.json" ]; then
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

                        if [ -z "$TUNNEL_ID" ] || [ ! -f "$CF_DIR/$TUNNEL_ID.json" ]; then
                            echo "❌ Failed to determine Tunnel UUID or credentials file for '$TUNNEL_NAME'."
                            echo "ℹ Home Cloud will run in LAN-only mode (http://$ACTIVE_IP:3000)."
                            echo "  Remote access can be enabled later by running: cloudflared tunnel login && cloudflared tunnel create home-cloud"
                        else
                            # e) Automatically generate config.yml
                            echo "📝 Generating $CF_CONFIG_FILE..."
                            printf '%s\n' \
                                "tunnel: $TUNNEL_ID" \
                                "credentials-file: $CF_DIR/$TUNNEL_ID.json" \
                                '' \
                                'ingress:' \
                                "  - hostname: dash.$CF_DOMAIN_VAL" \
                                '    service: http://localhost:3000' \
                                '  - service: http_status:404' > "$CF_CONFIG_FILE"
                            echo "✔ Successfully generated $CF_CONFIG_FILE"

                            # f) Automatically route DNS for the dashboard subdomain
                            echo "🌐 Routing DNS for dash.$CF_DOMAIN_VAL..."
                            DNS_OUT="$(run_as_current_user cloudflared tunnel route dns --overwrite-dns "$TUNNEL_NAME" "dash.$CF_DOMAIN_VAL" 2>&1 || true)"
                            echo "$DNS_OUT"
                            echo "✔ DNS routing configured for dash.$CF_DOMAIN_VAL"

                            # g) Update agent/.env using Node-based environment updater
                            echo "⚙ Updating agent/.env with CF_DOMAIN and TUNNEL_NAME..."
                            HOME_CLOUD_ENV_PATH="$SCRIPT_DIR/agent/.env" \
                            HOME_CLOUD_CF_DOMAIN="$CF_DOMAIN_VAL" \
                            HOME_CLOUD_TUNNEL_NAME="$TUNNEL_NAME" \
                            "$NODE_PATH" -e '
                                const fs = require("fs");
                                const envPath = process.env.HOME_CLOUD_ENV_PATH;
                                const cfDomain = process.env.HOME_CLOUD_CF_DOMAIN;
                                const tunnelName = process.env.HOME_CLOUD_TUNNEL_NAME;
                                let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

                                function updateOrAppend(key, val) {
                                    const regex = new RegExp("^" + key + "=.*", "m");
                                    if (regex.test(content)) {
                                        content = content.replace(regex, key + "=" + val);
                                    } else {
                                        const trimmed = content.trimEnd();
                                        content = (trimmed ? trimmed + "\n" : "") + key + "=" + val + "\n";
                                    }
                                }

                                updateOrAppend("CF_DOMAIN", cfDomain);
                                updateOrAppend("TUNNEL_NAME", tunnelName);
                                fs.writeFileSync(envPath, content, { mode: 0o600 });
                            '
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

if [ "$DRY_RUN" = true ]; then
    echo ""
    echo "[DRY-RUN] Would compile ${TEMPLATE_FILE} -> $TARGET_SERVICE with:"
    echo "          USER=$CURRENT_USER, GROUP=$CURRENT_GROUP, DIR=$SCRIPT_DIR, NODE=$NODE_PATH"
else
    if [ ! -f "$TEMPLATE_FILE" ]; then
        echo "❌ Error: Template file $TEMPLATE_FILE not found!" >&2
        exit 1
    fi
    echo ""
    echo "⚙ Compiling $TEMPLATE_FILE -> $TARGET_SERVICE..."
    sed \
        -e "s|{{USER}}|$CURRENT_USER|g" \
        -e "s|{{GROUP}}|$CURRENT_GROUP|g" \
        -e "s|{{WORKING_DIR}}|$SCRIPT_DIR|g" \
        -e "s|{{NODE_PATH}}|$NODE_PATH|g" \
        -e "s|{{NODE_DIR}}|$NODE_DIR|g" \
        "$TEMPLATE_FILE" | run_privileged tee "$TARGET_SERVICE" > /dev/null

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
run_privileged systemctl daemon-reload

echo "🚀 Enabling and starting home-cloud.service..."
run_privileged systemctl enable --now home-cloud.service

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
