#!/usr/bin/env bash
# ==============================================================================
# Home Cloud — Bare-Metal & Standalone Host Setup Script
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_FILE="$SCRIPT_DIR/home-cloud.service.template"
TARGET_SERVICE="/etc/systemd/system/home-cloud.service"

echo "========================================================"
echo "  Home Cloud — Production Host & Systemd Installer      "
echo "========================================================"

# 0. Wait for apt / dpkg locks on fresh boot (e.g. unattended-upgrades)
wait_for_apt_lock() {
    local timeout=300
    local elapsed=0
    while sudo fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || \
          sudo fuser /var/lib/apt/lists/lock >/dev/null 2>&1 || \
          sudo fuser /var/lib/dpkg/lock >/dev/null 2>&1; do
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

# 1. Resolve Execution Context & Actual User (handles sudo ./setup.sh cleanly)
if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
    CURRENT_USER="$SUDO_USER"
    CURRENT_GROUP="$(id -gn "$SUDO_USER")"
    CURRENT_HOME="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
else
    CURRENT_USER="$(id -un)"
    CURRENT_GROUP="$(id -gn)"
    CURRENT_HOME="${HOME:-/home/$CURRENT_USER}"
fi

run_as_current_user() {
    if [ "$EUID" -eq 0 ] && [ "$CURRENT_USER" != "root" ]; then
        sudo -u "$CURRENT_USER" -H "$@"
    else
        "$@"
    fi
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
    *)             CF_ARCH="amd64" ;;
esac

echo "✔ Resolved User:      $CURRENT_USER ($CURRENT_GROUP)"
echo "✔ User Home:          $CURRENT_HOME"
echo "✔ Detected Arch:      $ARCH (CF: $CF_ARCH)"
echo "✔ Primary Host IP:    $ACTIVE_IP"
echo "✔ Working Directory:  $SCRIPT_DIR"

# 2. Install essential system tools for bare-bones Ubuntu Server
if command -v apt-get >/dev/null 2>&1; then
    echo "📦 Checking and installing essential system packages..."
    wait_for_apt_lock
    sudo apt-get update -qq || true
    wait_for_apt_lock
    sudo apt-get install -y -qq \
        curl ca-certificates gnupg \
        build-essential python3 \
        fd-find fzf git psmisc >/dev/null 2>&1 || true
fi

# Ensure git is verified and available
if ! command -v git >/dev/null 2>&1; then
    echo "📦 git is required but not installed. Installing git..."
    if command -v apt-get >/dev/null 2>&1; then
        wait_for_apt_lock
        sudo apt-get install -y -qq git
    elif command -v dnf >/dev/null 2>&1; then
        sudo dnf install -y git
    elif command -v pacman >/dev/null 2>&1; then
        sudo pacman -Sy --noconfirm git
    fi
fi

if command -v git >/dev/null 2>&1; then
    echo "✔ git is available:   $(git --version | head -n 1)"
else
    echo "❌ git could not be found or installed. Please install git manually." >&2
    exit 1
fi

# Ensure repository tree is present (in case setup.sh was executed standalone)
if [ ! -f "$SCRIPT_DIR/home-cloud.service.template" ] || [ ! -f "$SCRIPT_DIR/agent/package.json" ]; then
    echo "⚠ Home Cloud repository files not found in $SCRIPT_DIR."
    echo "⬇ Cloning full repository from https://github.com/Cypher0071/Home_Cloud.git..."
    CLONE_TARGET="$SCRIPT_DIR/Home_Cloud"
    if [ -d "$CLONE_TARGET" ]; then
        echo "Found existing $CLONE_TARGET directory. Using it."
    else
        run_as_current_user git clone https://github.com/Cypher0071/Home_Cloud.git "$CLONE_TARGET"
    fi
    SCRIPT_DIR="$CLONE_TARGET"
    TEMPLATE_FILE="$SCRIPT_DIR/home-cloud.service.template"
    echo "✔ Switched working directory to: $SCRIPT_DIR"
fi

# 3. Node.js Runtime Check & Auto-Installation
install_nodejs() {
    echo "⬇ Installing Node.js 24 LTS & build essentials..."
    if command -v apt-get >/dev/null 2>&1; then
        wait_for_apt_lock
        curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
        wait_for_apt_lock
        sudo apt-get install -y -qq nodejs build-essential python3
    elif command -v dnf >/dev/null 2>&1; then
        curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
        sudo dnf install -y nodejs gcc-c++ make python3
    elif command -v pacman >/dev/null 2>&1; then
        sudo pacman -Sy --noconfirm nodejs npm base-devel python
    else
        echo "❌ Unsupported package manager. Please install Node.js 20+ manually." >&2
        exit 1
    fi
}

NODE_PATH="$(command -v node || true)"
NEED_NODE_INSTALL=false

if [ -z "$NODE_PATH" ]; then
    echo "⚠ Node.js is not installed on this system."
    NEED_NODE_INSTALL=true
else
    NODE_VERSION="$("$NODE_PATH" -v)"
    NODE_MAJOR="$(echo "$NODE_VERSION" | sed -E 's/^v([0-9]+).*/\1/')"
    if [ "$NODE_MAJOR" -lt 20 ]; then
        echo "⚠ Detected Node.js $NODE_VERSION, but Home Cloud requires Node.js v20+ LTS."
        NEED_NODE_INSTALL=true
    fi
fi

if [ "$NEED_NODE_INSTALL" = true ]; then
    if [ -t 0 ]; then
        read -rp "Would you like setup.sh to install Node.js 24 LTS automatically via NodeSource? [Y/n] " PROMPT_NODE || PROMPT_NODE="Y"
        PROMPT_NODE="${PROMPT_NODE:-Y}"
    else
        PROMPT_NODE="Y"
    fi

    if [[ "$PROMPT_NODE" =~ ^[Yy]$ ]]; then
        install_nodejs
        NODE_PATH="$(command -v node)"
    else
        echo "❌ Node.js 20+ is required to run Home Cloud. Aborting setup." >&2
        exit 1
    fi
fi

NODE_DIR="$(dirname "$NODE_PATH")"
NODE_VERSION="$("$NODE_PATH" -v)"
echo "✔ Active Node.js:     $NODE_PATH ($NODE_VERSION)"

# 4. Mandatory pnpm Installation
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if ! command -v pnpm >/dev/null 2>&1; then
    echo "📦 Installing pnpm..."
    if command -v npm >/dev/null 2>&1; then
        sudo npm install -g pnpm@latest || true
    fi
    if ! command -v pnpm >/dev/null 2>&1 && command -v corepack >/dev/null 2>&1; then
        sudo corepack enable || true
    fi
    if ! command -v pnpm >/dev/null 2>&1; then
        curl -fsSL https://get.pnpm.io/install.sh | env PNPM_VERSION=latest SHELL="$(which bash)" bash - || true
        export PATH="$CURRENT_HOME/.local/share/pnpm:$PATH"
    fi
fi

if ! command -v pnpm >/dev/null 2>&1; then
    echo "❌ Error: pnpm could not be installed. Please install pnpm (npm install -g pnpm) and re-run setup.sh." >&2
    exit 1
fi
echo "✔ Active pnpm:        $(command -v pnpm)"

# 5. Docker Engine & Compose Plugin Check / Auto-Installation
if ! command -v docker >/dev/null 2>&1; then
    echo ""
    echo "⚠ Docker Engine is required to run containers, but was not found on this system."
    if [ -t 0 ]; then
        read -rp "Would you like setup.sh to install Docker Engine automatically via get.docker.com? [Y/n] " INSTALL_DOCKER || INSTALL_DOCKER="Y"
        INSTALL_DOCKER="${INSTALL_DOCKER:-Y}"
    else
        INSTALL_DOCKER="Y"
    fi

    if [[ "$INSTALL_DOCKER" =~ ^[Yy]$ ]]; then
        echo "⬇ Installing Docker Engine via official installer..."
        wait_for_apt_lock
        curl -fsSL https://get.docker.com | sudo sh
        sudo systemctl enable --now docker
        echo "✔ Docker Engine installed and service started."
    else
        echo "❌ Docker is mandatory for Home Cloud container operations. Aborting setup." >&2
        exit 1
    fi
else
    echo "✔ Detected Docker:    $(command -v docker)"
    if ! sudo systemctl is-active --quiet docker; then
        echo "🔄 Starting docker.service..."
        sudo systemctl enable --now docker
    fi
fi

# Ensure docker-compose-plugin is present
if ! docker compose version >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
        echo "📦 Installing docker-compose-plugin..."
        wait_for_apt_lock
        sudo apt-get install -y -qq docker-compose-plugin >/dev/null 2>&1 || true
    fi
fi

# Ensure user is in the docker group
if ! id -nG "$CURRENT_USER" | grep -qw "docker"; then
    echo "⚠ Adding '$CURRENT_USER' to 'docker' group for socket permissions..."
    sudo usermod -aG docker "$CURRENT_USER"
    echo "✔ Added $CURRENT_USER to docker group."
fi

# 6. Check & Prompt for Cloudflared (Optional Remote Tunnel)
if ! command -v cloudflared >/dev/null 2>&1; then
    echo ""
    echo "ℹ cloudflared is not installed. (Required for free remote HTTPS access via *.home-cloud.live)"
    if [ -t 0 ]; then
        read -rp "Would you like setup.sh to download and install cloudflared now? [Y/n] " INSTALL_CF || INSTALL_CF="Y"
        INSTALL_CF="${INSTALL_CF:-Y}"
    else
        INSTALL_CF="N"
    fi

    if [[ "$INSTALL_CF" =~ ^[Yy]$ ]]; then
        echo "⬇ Downloading cloudflared for $CF_ARCH..."
        TEMP_DEB="/tmp/cloudflared-${CF_ARCH}.deb"
        if curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}.deb" -o "$TEMP_DEB"; then
            wait_for_apt_lock
            sudo dpkg -i "$TEMP_DEB" || sudo apt-get install -f -y
            rm -f "$TEMP_DEB"
            echo "✔ cloudflared installed successfully: $(command -v cloudflared)"
        else
            echo "⚠ Could not auto-download deb package. Skipping cloudflared (LAN access will still function)."
        fi
    else
        echo "ℹ Skipping cloudflared installation. Direct local LAN access (:3000) will still function."
    fi
else
    echo "✔ Detected Cloudflare: $(command -v cloudflared)"
fi

# Create skeleton ~/.cloudflared directory if cloudflared is installed
if command -v cloudflared >/dev/null 2>&1; then
    CF_DIR="$CURRENT_HOME/.cloudflared"
    mkdir -p "$CF_DIR"
    if [ "$EUID" -eq 0 ]; then
        chown -R "$CURRENT_USER:$CURRENT_GROUP" "$CF_DIR"
    fi
fi

# 7. Environment & Secure Admin Password Configuration (Using Node.js to prevent delimiter bugs)
echo ""
echo "⚙ Configuring environment & security credentials..."

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

# Check if PASSWORD needs to be configured
CURRENT_PASS="$(grep -E "^PASSWORD=" "$SCRIPT_DIR/agent/.env" | cut -d'=' -f2- || true)"
if [ -z "$CURRENT_PASS" ] || [ "$CURRENT_PASS" = "change-me" ]; then
    echo ""
    echo "┌──────────────────────────────────────────────────────────┐"
    echo "│ 🔐 SET ADMIN DASHBOARD PASSWORD                          │"
    echo "│ Set the security password used to log into Home Cloud.   │"
    echo "└──────────────────────────────────────────────────────────┘"

    ADMIN_PASS=""
    if [ -t 0 ]; then
        while true; do
            read -rsp "Enter dashboard admin password: " ADMIN_PASS
            echo ""
            if [ -z "$ADMIN_PASS" ]; then
                echo "❌ Password cannot be empty. Please try again."
                continue
            fi
            read -rsp "Confirm dashboard admin password: " ADMIN_PASS_CONFIRM
            echo ""
            if [ "$ADMIN_PASS" != "$ADMIN_PASS_CONFIRM" ]; then
                echo "❌ Passwords do not match. Please try again."
            else
                break
            fi
        done
    else
        if [ -n "${HOME_CLOUD_PASSWORD:-}" ]; then
            ADMIN_PASS="$HOME_CLOUD_PASSWORD"
            echo "✔ Using admin password provided via HOME_CLOUD_PASSWORD environment variable."
        else
            ADMIN_PASS="$(head -c 16 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 12 2>/dev/null || openssl rand -hex 6)"
            echo "⚠ Non-interactive setup: generated temporary admin password: $ADMIN_PASS"
        fi
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
            else
                if [ -n "${CF_DOMAIN:-${CLOUDFLARE_DOMAIN:-}}" ]; then
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
                        echo "⚠ Non-interactive mode detected and $CF_CERT_FILE not found."
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
                    echo "⚠ Cloudflare login was not completed ($CF_CERT_FILE not found)."
                    echo "ℹ Home Cloud will run in LAN-only mode (http://$ACTIVE_IP:3000)."
                    echo "  Remote access can be enabled later by running: cloudflared tunnel login && cloudflared tunnel create home-cloud"
                else
                    # b) Prompt user for root domain name
                    CF_DOMAIN_VAL="${CF_DOMAIN:-${CLOUDFLARE_DOMAIN:-}}"
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
                    fi

                    CF_DOMAIN_VAL="$(clean_domain "$CF_DOMAIN_VAL")"

                    if [ -z "$CF_DOMAIN_VAL" ]; then
                        echo "⚠ No domain provided."
                        echo "ℹ Home Cloud will run in LAN-only mode (http://$ACTIVE_IP:3000)."
                        echo "  Remote access can be enabled later by running: cloudflared tunnel login && cloudflared tunnel create home-cloud"
                    else
                        TUNNEL_NAME="home-cloud"
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
                                    echo "⚠ Tunnel '$TUNNEL_NAME' exists on Cloudflare, but local credentials file was not found."
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
echo ""
echo "📦 Installing dependencies & building dashboard..."
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
(cd "$SCRIPT_DIR" && pnpm install)
(cd "$SCRIPT_DIR" && pnpm --filter dashboard build)
echo "✔ Dashboard bundle built successfully in dashboard/dist/"

# 10. Configure UFW Firewall for LAN port 3000 if UFW is active
if command -v ufw >/dev/null 2>&1; then
    if sudo ufw status | grep -qw "active"; then
        echo "🛡 UFW is active. Allowing incoming traffic on port 3000/tcp..."
        sudo ufw allow 3000/tcp comment "Home Cloud Dashboard" >/dev/null 2>&1 || true
    fi
fi

# 11. Render & Inject Systemd Service File
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
    "$TEMPLATE_FILE" | sudo tee "$TARGET_SERVICE" > /dev/null

echo "✔ Successfully generated $TARGET_SERVICE"

# 12. Fix file permissions on the repository directory so non-root user owns build artifacts
sudo chown -R "$CURRENT_USER:$CURRENT_GROUP" "$SCRIPT_DIR"

# 13. Register and Start Service with systemd
echo "🔄 Reloading systemd daemon..."
sudo systemctl daemon-reload

echo "🚀 Enabling and starting home-cloud.service..."
sudo systemctl enable --now home-cloud.service

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
