#!/bin/sh
# ============================================
# JhopanWa Bot - Setup OpenWRT
# Uses: opkg, procd init, ash shell
# NOTE: OpenWRT routers usually have limited
# RAM (128-512MB). Baileys is lightweight
# enough to run on these devices.
# ============================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

STATE_FILE=".setup-state"

echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     JhopanWa Bot - OpenWRT Setup Wizard           ║${NC}"
echo -e "${CYAN}║     Baileys - Ultra Lightweight on Router         ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════╝${NC}"
echo ""

info()    { echo -e "${BLUE}i  $1${NC}"; }
success() { echo -e "${GREEN}OK $1${NC}"; }
warn()    { echo -e "${YELLOW}!! $1${NC}"; }
error()   { echo -e "${RED}XX $1${NC}"; }
step()    { echo -e "\n${CYAN}--- $1 ---${NC}"; }

save_state() { echo "$1=done" >> "$STATE_FILE"; }
is_done() { grep -q "^$1=done$" "$STATE_FILE" 2>/dev/null; }

# No sudo on OpenWRT (usually root)
SUDO=""

# OpenWRT info
OWRT_VERSION=$(cat /etc/openwrt_release 2>/dev/null | grep DISTRIB_RELEASE | cut -d"'" -f2 || echo "unknown")
TOTAL_RAM=$(awk '/MemTotal/{printf "%.0f", $2/1024}' /proc/meminfo 2>/dev/null || echo "0")
FREE_RAM=$(awk '/MemAvailable/{printf "%.0f", $2/1024}' /proc/meminfo 2>/dev/null || echo "0")

echo -e "  ${CYAN}OpenWRT:${NC}  $OWRT_VERSION"
echo -e "  ${CYAN}RAM:${NC}      ${TOTAL_RAM} MB (${FREE_RAM} MB free)"
echo -e "  ${CYAN}Arch:${NC}     $(uname -m)"
echo ""

# Check minimum RAM
if [ "$TOTAL_RAM" -lt 128 ] 2>/dev/null; then
  error "RAM terlalu kecil (${TOTAL_RAM}MB). Minimum 128MB."
  error "Bot Baileys butuh ~100MB RAM."
  exit 1
fi

# ── Step 1: Prerequisites ──
step "Step 1/4: Prerequisites"

# Update opkg
info "Updating package lists..."
opkg update 2>/dev/null || warn "opkg update failed (offline?)"

# Node.js — OpenWRT packages node
if command -v node &>/dev/null; then
  NODE_VER=$(node -v)
  NODE_MAJOR=$(echo "$NODE_VER" | grep -oE '[0-9]+' | head -1)
  if [ "$NODE_MAJOR" -ge 18 ]; then
    success "Node.js $NODE_VER"
  else
    warn "Node.js $NODE_VER terlalu lama, coba upgrade"
    opkg install node node-npm 2>/dev/null || true
  fi
else
  info "Installing Node.js..."
  # Try common OpenWRT node packages
  opkg install node 2>/dev/null || \
  opkg install nodejs 2>/dev/null || \
  {
    error "Node.js tidak tersedia di repo OpenWRT kamu."
    error "Install manual dari: https://nodejs.org/dist/"
    echo ""
    echo "  Contoh untuk ARM:"
    echo "  wget https://nodejs.org/dist/v20.11.0/node-v20.11.0-linux-arm64.tar.xz"
    echo "  tar xf node-v20.11.0-linux-arm64.tar.xz -C /usr/local --strip-components=1"
    echo ""
    exit 1
  }
  success "Node.js $(node -v)"
fi

# npm
if ! command -v npm &>/dev/null; then
  opkg install node-npm 2>/dev/null || {
    error "npm not found. Install node-npm via opkg."
    exit 1
  }
fi
success "npm $(npm -v)"

# Git
command -v git &>/dev/null || opkg install git 2>/dev/null || warn "git not available (clone repo manually)"
# curl
command -v curl &>/dev/null || opkg install curl 2>/dev/null || warn "curl not available"

save_state "prerequisites"

# ── Step 2: Configuration ──
step "Step 2/4: Configuration"

USE_EXISTING_ENV=false
if [ -f ".env" ]; then
  echo ""
  printf "  .env exists. Use existing? (Y/n): "
  read use_existing
  [ "$use_existing" != "n" ] && [ "$use_existing" != "N" ] && USE_EXISTING_ENV=true && success "Using existing .env"
fi

if [ "$USE_EXISTING_ENV" = false ]; then
  echo ""
  echo "  Bot Configuration:"
  printf "  Telegram Bot Token (@BotFather): "; read TG_TOKEN
  printf "  AI API Endpoint: "; read AI_ENDPOINT
  AI_ENDPOINT=${AI_ENDPOINT:-"https://your-api-endpoint.com/v1"}
  printf "  AI API Key: "; read AI_KEY
  while [ -z "$AI_KEY" ]; do printf "  AI API Key (required): "; read AI_KEY; done
  printf "  AI Model [gemini/gemini-2.5-flash-lite]: "; read AI_MODEL
  AI_MODEL=${AI_MODEL:-"gemini/gemini-2.5-flash-lite"}
  printf "  Telegram Admin ID: "; read ADMIN_ID
  while [ -z "$ADMIN_ID" ]; do printf "  Telegram Admin ID (required): "; read ADMIN_ID; done
  printf "  Timezone [Asia/Makassar]: "; read TIMEZONE
  TIMEZONE=${TIMEZONE:-"Asia/Makassar"}
  printf "  Renungan Time [08:00]: "; read RENUNGAN_TIME
  RENUNGAN_TIME=${RENUNGAN_TIME:-"08:00"}

  cat > .env << ENVEOF
# Generated on $(date) - OpenWRT
TIMEZONE=${TIMEZONE}
TELEGRAM_BOT_TOKEN=***  success ".env written"
fi
save_state "config"

# ── Step 3: Cloudflare Tunnel ──
step "Step 3/4: Cloudflare Tunnel (Optional)"

WEBHOOK_URL=""
HAS_CLOUDFLARED=false

if is_done "tunnel"; then
  WEBHOOK_URL=$(grep "^WEBHOOK_URL=" .env 2>/dev/null | cut -d= -f2)
  [ -n "$WEBHOOK_URL" ] && success "Tunnel configured: $WEBHOOK_URL"
else
  if command -v cloudflared &>/dev/null; then
    HAS_CLOUDFLARED=true
    success "cloudflared available"
  fi

  echo ""
  if [ "$HAS_CLOUDFLARED" = false ]; then
    printf "  Install cloudflared? (y/N): "
    read install_cf
    if [ "$install_cf" = "y" ] || [ "$install_cf" = "Y" ]; then
      ARCH=$(uname -m)
      case "$ARCH" in
        x86_64) CF_ARCH="amd64" ;;
        aarch64) CF_ARCH="arm64" ;;
        armv7l|armv6l) CF_ARCH="arm" ;;
        mips) CF_ARCH="mips" ;;
        *) warn "Unsupported arch: $ARCH"; CF_ARCH="" ;;
      esac
      if [ -n "$CF_ARCH" ]; then
        curl -L --output /usr/local/bin/cloudflared "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}"
        chmod +x /usr/local/bin/cloudflared
        success "cloudflared installed"
        HAS_CLOUDFLARED=true
      fi
    fi
  fi

  if [ "$HAS_CLOUDFLARED" = true ]; then
    printf "  Setup Cloudflare Tunnel? (y/N): "
    read setup_cf
    if [ "$setup_cf" = "y" ] || [ "$setup_cf" = "Y" ]; then
      CERT_FILE=$(ls ~/.cloudflared/cert.pem 2>/dev/null || true)
      if [ -n "$CERT_FILE" ]; then
        success "Cloudflare authorized"
      else
        cloudflared tunnel login
        CERT_FILE=$(ls ~/.cloudflared/cert.pem 2>/dev/null || true)
      fi

      if [ -n "$CERT_FILE" ]; then
        TUNNEL_NAME="wa-renungan"
        EXISTING=$(cloudflared tunnel list 2>/dev/null | grep -w "$TUNNEL_NAME" || true)
        if [ -n "$EXISTING" ]; then
          TUNNEL_ID=$(cloudflared tunnel list 2>/dev/null | grep -w "$TUNNEL_NAME" | head -1 | awk '{print $1}')
          success "Reusing tunnel: $TUNNEL_ID"
        else
          cloudflared tunnel create "$TUNNEL_NAME" 2>/dev/null || true
          TUNNEL_ID=$(cloudflared tunnel list 2>/dev/null | grep -w "$TUNNEL_NAME" | head -1 | awk '{print $1}')
          success "Tunnel: $TUNNEL_ID"
        fi

        printf "  Domain: "; read DOMAIN
        printf "  Subdomain [wa-bot]: "; read SUBDOMAIN
        SUBDOMAIN=${SUBDOMAIN:-"wa-bot"}
        FULL_HOSTNAME="${SUBDOMAIN}.${DOMAIN}"

        cloudflared tunnel route dns "$TUNNEL_NAME" "$FULL_HOSTNAME" 2>/dev/null || true

        USER_DIR="$HOME/.cloudflared"
        CRED_FILE=$(ls "${USER_DIR}/${TUNNEL_ID}.json" 2>/dev/null || echo "${USER_DIR}/${TUNNEL_ID}.json")

        cat > "${USER_DIR}/config.yml" << CFGEOF
tunnel: ${TUNNEL_ID}
credentials-file: ${CRED_FILE}
protocol: quic
ingress:
  - hostname: ${FULL_HOSTNAME}
    service: http://localhost:3000
  - service: http_status:404
CFGEOF
        success "config.yml written"

        # OpenWRT init script
        cat > /etc/init.d/cloudflared << INITEOF
#!/bin/sh /etc/rc.common
START=99
STOP=10
USE_PROCD=1
start_service() {
  procd_open_instance
  procd_set_param command /usr/local/bin/cloudflared tunnel --protocol quic run ${TUNNEL_NAME}
  procd_set_param stdout 1
  procd_set_param stderr 1
  procd_set_param respawn
  procd_close_instance
}
INITEOF
        chmod +x /etc/init.d/cloudflared
        /etc/init.d/cloudflared enable 2>/dev/null || true
        /etc/init.d/cloudflared start 2>/dev/null || true
        success "cloudflared init.d service installed"

        WEBHOOK_URL="https://${FULL_HOSTNAME}"
        if grep -q "^WEBHOOK_URL=" .env 2>/dev/null; then
          sed -i "s|^WEBHOOK_URL=.*|WEBHOOK_URL=${WEBHOOK_URL}|" .env
        else
          echo "" >> .env
          echo "WEBHOOK_URL=${WEBHOOK_URL}" >> .env
          echo "WEBHOOK_PORT=3000" >> .env
        fi
        success "Webhook: $WEBHOOK_URL"
      fi
    fi
  fi

  [ -z "$WEBHOOK_URL" ] && info "Polling mode"
  save_state "tunnel"
fi

# ── Step 4: Bot ──
step "Step 4/4: Bot Setup"

if [ -d "node_modules" ] && [ -f "package-lock.json" ]; then
  success "Dependencies OK"
else
  info "Installing dependencies (this may take a while on router)..."
  npm install --production 2>/dev/null || npm install
  success "Installed"
fi

mkdir -p logs

# PM2 or direct
if command -v pm2 &>/dev/null; then
  success "PM2 available"
  pm2 delete renungan-bot 2>/dev/null || true
  pm2 start ecosystem.config.js
  pm2 save
else
  npm install -g pm2 2>/dev/null || {
    warn "PM2 install failed. Running bot directly."
    info "Start bot: nohup node src/index.js > logs/out.log 2>&1 &"

    # OpenWRT init script for bot
    BOT_DIR=$(pwd)
    cat > /etc/init.d/wa-bot << BINIT
#!/bin/sh /etc/rc.common
START=99
STOP=10
USE_PROCD=1
start_service() {
  procd_open_instance
  procd_set_param command /usr/bin/node ${BOT_DIR}/src/index.js
  procd_set_param env HOME=/root
  procd_set_param stdout 1
  procd_set_param stderr 1
  procd_set_param respawn
  procd_close_instance
}
BINIT
    chmod +x /etc/init.d/wa-bot
    /etc/init.d/wa-bot enable 2>/dev/null || true
    success "Init script: /etc/init.d/wa-bot"
  }

  if command -v pm2 &>/dev/null; then
    pm2 delete renungan-bot 2>/dev/null || true
    pm2 start ecosystem.config.js
    pm2 save
    success "Bot running via PM2"
  fi
fi

# ── Done ──
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Setup Complete! (OpenWRT)                        ║${NC}"
echo -e "${GREEN}╠═══════════════════════════════════════════════════╣${NC}"
[ -n "$WEBHOOK_URL" ] && echo -e "${GREEN}║  Webhook: ${WEBHOOK_URL}${NC}"
[ -z "$WEBHOOK_URL" ] && echo -e "${GREEN}║  Mode: POLLING${NC}" || echo -e "${GREEN}║  Mode: WEBHOOK${NC}"
echo -e "${GREEN}╠═══════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Commands:                                       ║${NC}"
echo -e "${GREEN}║    pm2 status / pm2 logs / pm2 restart all        ║${NC}"
echo -e "${GREEN}║    /etc/init.d/wa-bot restart                     ║${NC}"
echo -e "${GREEN}║    /etc/init.d/cloudflared restart                ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════╝${NC}"
