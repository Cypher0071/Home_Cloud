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
BRANCH="${HOME_CLOUD_BRANCH:-main}"

show_help() {
    cat << 'EOF'
Home Cloud — Production Host & Systemd Installer

Usage:
  ./setup.sh [OPTIONS]
  curl -fsSL https://raw.githubusercontent.com/Cypher0071/home_cloud/main/setup.sh | bash -s -- [OPTIONS]

Options:
  -h, --help                    Show this help message and exit
  -d, --domain <domain>         Cloudflare root domain for tunnel (e.g. example.com)
  -p, --password <password>     Dashboard admin password (auto-generated if omitted in non-interactive)
  --tunnel <name>               Cloudflare tunnel name (default: home-cloud)
  --dir <path>                  Installation target directory (default: current repo or $HOME/home-cloud)
  --branch <branch>             Git branch to install from (default: main)
  -y, --yes, --non-interactive  Non-interactive mode (auto-accept defaults, no prompts)
  --skip-cloudflared            Skip cloudflared download, installation, and tunnel configuration
  --dry-run, --check-only       Verify prerequisites, flags, and configuration without modifying system

Environment Variables:
  HOME_CLOUD_PASSWORD           Admin dashboard password
  CF_DOMAIN                     Cloudflare root domain
  TUNNEL_NAME                   Cloudflare tunnel name
  HOME_CLOUD_DIR                Installation directory
  HOME_CLOUD_BRANCH             Git branch
  NON_INTERACTIVE=true          Run non-interactively
  SKIP_CLOUDFLARED=true         Skip cloudflared
  DRY_RUN=true                  Simulate setup without modifying system

Documentation: https://github.com/Cypher0071/home_cloud
EOF
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
    # If stdin is a pipe (e.g. curl ... | bash), read from controlling terminal if terminal is attached
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
        run_privileged apt-get update -qq || true
        wait_for_apt_lock
        run_privileged apt-get install -y -qq \
            curl ca-certificates gnupg \
            build-essential python3 \
            git psmisc >/dev/null 2>&1 || true
    elif [ "$PKG_MANAGER" = "dnf" ] || [ "$PKG_MANAGER" = "yum" ]; then
        run_privileged "$PKG_MANAGER" install -y \
            curl ca-certificates gnupg2 \
            gcc-c++ make python3 \
            git psmisc >/dev/null 2>&1 || true
    elif [ "$PKG_MANAGER" = "pacman" ]; then
        run_privileged pacman -Sy --noconfirm \
            curl ca-certificates \
            base-devel python \
            git psmisc >/dev/null 2>&1 || true
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
    if [ -n "$BRANCH" ] && [ "$CURRENT_GIT_BRANCH" != "$BRANCH" ]; then
        echo "🔄 Checking out branch '$BRANCH' in $INSTALL_DIR..."
        run_as_current_user git -C "$INSTALL_DIR" checkout "$BRANCH" 2>/dev/null || true
    fi
fi

SCRIPT_DIR="$INSTALL_DIR"
TEMPLATE_FILE="$SCRIPT_DIR/home-cloud.service.template"

# 3. Node.js Runtime Check & Auto-Installation
install_nodejs() {
    echo "⬇ Installing Node.js 24 LTS & build essentials..."
    if [ "$PKG_MANAGER" = "apt" ]; then
        wait_for_apt_lock
        curl -fsSL https://deb.nodesource.com/setup_24.x | run_privileged -E bash -
        wait_for_apt_lock
        run_privileged apt-get install -y -qq nodejs build-essential python3
    elif [ "$PKG_MANAGER" = "dnf" ] || [ "$PKG_MANAGER" = "yum" ]; then
        curl -fsSL https://rpm.nodesource.com/setup_24.x | run_privileged bash -
        run_privileged "$PKG_MANAGER" install -y nodejs gcc-c++ make python3
    elif [ "$PKG_MANAGER" = "pacman" ]; then
        run_privileged pacman -Sy --noconfirm nodejs npm base-devel python
    else
        echo "❌ Unsupported package manager. Please install Node.js 20+ manually." >&2
        exit 1
    fi
}

NODE_PATH="$(command -v node || true)"
NEED_NODE_INSTALL=false

if [ -z "$NODE_PATH" ]; then
    echo "⚠️ Node.js is not installed on this system."
    NEED_NODE_INSTALL=true
else
    NODE_VERSION="$("$NODE_PATH" -v)"
    NODE_MAJOR="$(echo "$NODE_VERSION" | sed -E 's/^v([0-9]+).*/\1/')"
    if [ "$NODE_MAJOR" -lt 20 ]; then
        echo "⚠️ Detected Node.js $NODE_VERSION, but Home Cloud requires Node.js v20+ LTS."
        NEED_NODE_INSTALL=true
    fi
fi

if [ "$NEED_NODE_INSTALL" = true ]; then
    if [ "$DRY_RUN" = true ]; then
        echo "[DRY-RUN] Would install Node.js 24 LTS via ${PKG_MANAGER:-package manager}."
        NODE_PATH="/usr/bin/node"
        NODE_VERSION="v24.x (projected)"
    else
        PROMPT_NODE="Y"
        if [ "$NON_INTERACTIVE" != true ]; then
            if read_input "Would you like setup.sh to install Node.js 24 LTS automatically via NodeSource? [Y/n] " PROMPT_NODE_IN; then
                PROMPT_NODE="${PROMPT_NODE_IN:-Y}"
            fi
        fi

        if [[ "$PROMPT_NODE" =~ ^[Yy]$ ]]; then
            install_nodejs
            NODE_PATH="$(command -v node)"
            NODE_VERSION="$("$NODE_PATH" -v)"
        else
            echo "❌ Node.js 20+ is required to run Home Cloud. Aborting setup." >&2
            exit 1
        fi
    fi
else
    NODE_VERSION="$("$NODE_PATH" -v)"
fi

NODE_DIR="$(dirname "$NODE_PATH")"
echo "✔ Active Node.js:     $NODE_PATH ($NODE_VERSION)"

# 4. Mandatory pnpm Installation
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if ! command -v pnpm >/dev/null 2>&1; then
    if [ "$DRY_RUN" = true ]; then
        echo "[DRY-RUN] pnpm is not installed; would install pnpm via npm / corepack / get.pnpm.io."
    else
        echo "📦 Installing pnpm..."
        if command -v npm >/dev/null 2>&1; then
            run_privileged npm install -g pnpm@latest || true
        fi
        if ! command -v pnpm >/dev/null 2>&1 && command -v corepack >/dev/null 2>&1; then
            run_privileged corepack enable || true
        fi
        if ! command -v pnpm >/dev/null 2>&1; then
            curl -fsSL https://get.pnpm.io/install.sh | env PNPM_VERSION=latest SHELL="$(which bash)" bash - || true
            export PATH="$CURRENT_HOME/.local/share/pnpm:$PATH"
        fi
        if ! command -v pnpm >/dev/null 2>&1; then
            echo "❌ Error: pnpm could not be installed. Please install pnpm (npm install -g pnpm) and re-run setup.sh." >&2
            exit 1
        fi
        echo "✔ Active pnpm:        $(command -v pnpm)"
    fi
else
    echo "✔ Active pnpm:        $(command -v pnpm)"
fi

# 5. Docker Engine & Compose Plugin Check / Auto-Installation
if ! command -v docker >/dev/null 2>&1; then
    echo ""
    echo "⚠️ Docker Engine is required to run containers, but was not found on this system."
    if [ "$DRY_RUN" = true ]; then
        echo "[DRY-RUN] Docker is not installed; would prompt/install Docker Engine via get.docker.com."
    else
        INSTALL_DOCKER="Y"
        if [ "$NON_INTERACTIVE" != true ]; then
            if read_input "Would you like setup.sh to install Docker Engine automatically via get.docker.com? [Y/n] " PROMPT_DOCKER_IN; then
                INSTALL_DOCKER="${PROMPT_DOCKER_IN:-Y}"
            fi
        fi

        if [[ "$INSTALL_DOCKER" =~ ^[Yy]$ ]]; then
            echo "⬇ Installing Docker Engine via official installer..."
            if [ "$PKG_MANAGER" = "apt" ]; then
                wait_for_apt_lock
            fi
            curl -fsSL https://get.docker.com | run_privileged sh
            run_privileged systemctl enable --now docker
            echo "✔ Docker Engine installed and service started."
        else
            echo "❌ Docker is mandatory for Home Cloud container operations. Aborting setup." >&2
            exit 1
        fi
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
    # Ensure docker-compose-plugin is present
    if ! docker compose version >/dev/null 2>&1; then
        if [ "$PKG_MANAGER" = "apt" ]; then
            echo "📦 Installing docker-compose-plugin..."
            wait_for_apt_lock
            run_privileged apt-get install -y -qq docker-compose-plugin >/dev/null 2>&1 || true
        fi
    fi

    # Ensure user is in the docker group
    if ! id -nG "$CURRENT_USER" 2>/dev/null | grep -qw "docker"; then
        echo "⚠️ Adding '$CURRENT_USER' to 'docker' group for socket permissions..."
        run_privileged usermod -aG docker "$CURRENT_USER" || true
        echo "✔ Added $CURRENT_USER to docker group."
    fi
else
    echo "[DRY-RUN] Would verify docker compose and ensure $CURRENT_USER is in docker group."
fi

# 6. Check & Prompt for Cloudflared (Optional Remote Tunnel)
if [ "${SKIP_CLOUDFLARED:-false}" = "true" ]; then
    echo "ℹ Skipping cloudflared installation (--skip-cloudflared specified)."
elif ! command -v cloudflared >/dev/null 2>&1; then
    echo ""
    echo "ℹ cloudflared is not installed. (Required for free remote HTTPS access via custom domain)"
    if [ "$DRY_RUN" = true ]; then
        echo "[DRY-RUN] cloudflared is not installed; would install for $CF_ARCH via $PKG_MANAGER / binary."
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
            echo "⬇ Downloading and installing cloudflared for $CF_ARCH..."
            if [ "$PKG_MANAGER" = "apt" ]; then
                TEMP_DEB="/tmp/cloudflared-${CF_ARCH}.deb"
                if curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}.deb" -o "$TEMP_DEB"; then
                    wait_for_apt_lock
                    run_privileged dpkg -i "$TEMP_DEB" || run_privileged apt-get install -f -y
                    rm -f "$TEMP_DEB"
                    echo "✔ cloudflared installed successfully: $(command -v cloudflared || echo '/usr/local/bin/cloudflared')"
                else
                    echo "⚠️ Could not download .deb package; falling back to static binary..."
                    run_privileged curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" -o /usr/local/bin/cloudflared
                    run_privileged chmod +x /usr/local/bin/cloudflared
                fi
            elif [ "$PKG_MANAGER" = "dnf" ] || [ "$PKG_MANAGER" = "yum" ]; then
                TEMP_RPM="/tmp/cloudflared-${CF_ARCH}.rpm"
                if curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}.rpm" -o "$TEMP_RPM"; then
                    run_privileged "$PKG_MANAGER" install -y "$TEMP_RPM" || run_privileged rpm -i "$TEMP_RPM"
                    rm -f "$TEMP_RPM"
                    echo "✔ cloudflared installed successfully: $(command -v cloudflared || echo '/usr/local/bin/cloudflared')"
                else
                    echo "⚠️ Could not download .rpm package; falling back to static binary..."
                    run_privileged curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" -o /usr/local/bin/cloudflared
                    run_privileged chmod +x /usr/local/bin/cloudflared
                fi
            else
                echo "⬇ Installing cloudflared static binary to /usr/local/bin/cloudflared..."
                run_privileged curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}" -o /usr/local/bin/cloudflared
                run_privileged chmod +x /usr/local/bin/cloudflared
                echo "✔ cloudflared installed successfully: /usr/local/bin/cloudflared"
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
echo ""
echo "⚙ Configuring environment & security credentials..."

if [ "$DRY_RUN" = true ]; then
    echo "[DRY-RUN] Would generate secure JWT_SECRET and configure admin password in agent/.env"
else
    if [ ! -f "$SCRIPT_DIR/agent/.env" ]; then
        if [ -f "$SCRIPT_DIR/agent/.env.example" ]; then
            cp "$SCRIPT_DIR/agent/.env.example" "$SCRIPT_DIR/agent/.env"
        else
            cat << 'EOF' > "$SCRIPT_DIR/agent/.env"
PASSWORD=change-me
JWT_SECRET=generate-a-long-random-string
PORT=3000
EOF
        fi
        # Generate cryptographically secure JWT secret
        RANDOM_JWT="$(head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 32 2>/dev/null || openssl rand -hex 16)"
        "$NODE_PATH" -e '
            const fs = require("fs");
            const envPath = process.argv[1];
            const secret = process.argv[2];
            let content = fs.readFileSync(envPath, "utf8");
            content = content.replace(/^JWT_SECRET=.*/m, "JWT_SECRET=" + secret);
            fs.writeFileSync(envPath, content);
        ' "$SCRIPT_DIR/agent/.env" "$RANDOM_JWT"
        echo "✔ Generated secure random JWT_SECRET."
    fi

    # Secure file permissions on agent/.env
    chmod 600 "$SCRIPT_DIR/agent/.env"
    run_privileged chown "$CURRENT_USER:$CURRENT_GROUP" "$SCRIPT_DIR/agent/.env" 2>/dev/null || true

    # Check if PASSWORD needs to be configured
    CURRENT_PASS="$(grep -E "^PASSWORD=" "$SCRIPT_DIR/agent/.env" | cut -d'=' -f2- || true)"
    if [ -n "$ADMIN_PASS_INPUT" ]; then
        ADMIN_PASS="$ADMIN_PASS_INPUT"
        echo "✔ Using admin password provided via CLI / environment."
        "$NODE_PATH" -e '
            const fs = require("fs");
            const envPath = process.argv[1];
            const pass = process.argv[2];
            let content = fs.readFileSync(envPath, "utf8");
            if (/^PASSWORD=/m.test(content)) {
                content = content.replace(/^PASSWORD=.*/m, "PASSWORD=" + pass);
            } else {
                content += "\nPASSWORD=" + pass + "\n";
            }
            fs.writeFileSync(envPath, content, { mode: 0o600 });
        ' "$SCRIPT_DIR/agent/.env" "$ADMIN_PASS"
        echo "✔ Admin password saved securely to agent/.env"
    elif [ -z "$CURRENT_PASS" ] || [ "$CURRENT_PASS" = "change-me" ]; then
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
                if [ -z "$P1" ]; then
                    echo "❌ Password cannot be empty. Please try again." >&2
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
            ADMIN_PASS="$(head -c 16 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 16 2>/dev/null || openssl rand -hex 8)"
            echo "⚠️ Non-interactive setup: generated temporary admin password: $ADMIN_PASS"
        fi

        # Write password safely using Node.js (completely immune to sed delimiter or escape character bugs)
        "$NODE_PATH" -e '
            const fs = require("fs");
            const envPath = process.argv[1];
            const pass = process.argv[2];
            let content = fs.readFileSync(envPath, "utf8");
            if (/^PASSWORD=/m.test(content)) {
                content = content.replace(/^PASSWORD=.*/m, "PASSWORD=" + pass);
            } else {
                content += "\nPASSWORD=" + pass + "\n";
            }
            fs.writeFileSync(envPath, content, { mode: 0o600 });
        ' "$SCRIPT_DIR/agent/.env" "$ADMIN_PASS"

        echo "✔ Admin password saved securely to agent/.env"
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
                "$NODE_PATH" -e '
                    const fs = require("fs");
                    const envPath = process.argv[1];
                    const cfDomain = process.argv[2];
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
                ' "$SCRIPT_DIR/agent/.env" "$EXISTING_CF_DOMAIN"
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
                                        if grep -q "\"TunnelID\":\"$TUNNEL_ID\"" "$cred_file" 2>/dev/null; then
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
                            cat << EOF > "$CF_CONFIG_FILE"
tunnel: $TUNNEL_ID
credentials-file: $CF_DIR/$TUNNEL_ID.json

ingress:
  - hostname: dash.$CF_DOMAIN_VAL
    service: http://localhost:3000
  - service: http_status:404
EOF
                            echo "✔ Successfully generated $CF_CONFIG_FILE"

                            # f) Automatically route DNS for the dashboard subdomain
                            echo "🌐 Routing DNS for dash.$CF_DOMAIN_VAL..."
                            DNS_OUT="$(run_as_current_user cloudflared tunnel route dns --overwrite-dns "$TUNNEL_NAME" "dash.$CF_DOMAIN_VAL" 2>&1 || true)"
                            echo "$DNS_OUT"
                            echo "✔ DNS routing configured for dash.$CF_DOMAIN_VAL"

                            # g) Update agent/.env using Node-based environment updater
                            echo "⚙ Updating agent/.env with CF_DOMAIN and TUNNEL_NAME..."
                            "$NODE_PATH" -e '
                                const fs = require("fs");
                                const envPath = process.argv[1];
                                const cfDomain = process.argv[2];
                                const tunnelName = process.argv[3];
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
                            ' "$SCRIPT_DIR/agent/.env" "$CF_DOMAIN_VAL" "$TUNNEL_NAME"
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
    echo "[DRY-RUN] Would install dependencies and build dashboard via pnpm in $SCRIPT_DIR"
else
    echo ""
    echo "📦 Installing dependencies & building dashboard..."
    export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
    (cd "$SCRIPT_DIR" && run_as_current_user pnpm install)
    (cd "$SCRIPT_DIR" && run_as_current_user pnpm --filter dashboard build)
    echo "✔ Dashboard bundle built successfully in dashboard/dist/"
fi

# 10. Configure UFW Firewall for LAN port 3000 if UFW is active
if [ "$DRY_RUN" = true ]; then
    echo "[DRY-RUN] Would configure UFW firewall rule for port 3000/tcp if active."
else
    if command -v ufw >/dev/null 2>&1; then
        if run_privileged ufw status 2>/dev/null | grep -qw "active"; then
            echo "🛡 UFW is active. Allowing incoming traffic on port 3000/tcp..."
            run_privileged ufw allow 3000/tcp comment "Home Cloud Dashboard" >/dev/null 2>&1 || true
        fi
    fi
fi

# 11. Render & Inject Systemd Service File
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
ACTIVE_CF_DOMAIN="$(grep -E "^CF_DOMAIN=" "$SCRIPT_DIR/agent/.env" 2>/dev/null | cut -d'=' -f2- | tr -d ' "\r\n' || true)"
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
