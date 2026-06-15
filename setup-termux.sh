#!/bin/bash
# ============================================
# JhopanWa Bot - Setup Termux (Android)
# No sudo, pkg package manager, no systemd
# ============================================
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

STATE_FILE=".setup-state"

echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     JhopanWa Bot - Termux Setup Wizard            ║${NC}"
echo -e "${CYAN}║     Baileys - No Chromium, No Root                ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════╝${NC}"
echo ""

info()    { echo -e "${BLUE}i  $1${NC}"; }
success() { echo -e "${GREEN}OK $1${NC}"; }
warn()    { echo -e "${YELLOW}!! $1${NC}"; }
error()   { echo -e "${RED}XX $1${NC}"; }
step()    { echo -e "\n${CYAN}--- $1 ---${NC}"; }

save_state() { echo "$1=done" >> "$STATE_FILE"; }
is_done() { grep -q "^$1=done$" "$STATE_FILE" 2>/dev/null; }

# No sudo on Termux
SUDO=""

echo -e "  ${CYAN}Platform:${NC} Termux (Android)"
echo -e "  ${CYAN}Arch:${NC}     $(uname -m)"
echo -e "  ${CYAN}Home:${NC}     $HOME"
echo ""

# ── Step 1: Prerequisites ──
step "Step 1/4: Prerequisites"

# Update packages
info "Updating Termux packages..."
pkg update -y && pkg upgrade -y
success "Packages updated"

# Node.js
if command -v node &>/dev/null; then
  NODE_VER=$(node -v)
  NODE_MAJOR=$(echo "$NODE_VER" | grep -oE '[0-9]+' | head -1)
  if [ "$NODE_MAJOR" -ge 20 ]; then
    success "Node.js $NODE_VER"
  else
    pkg install -y nodejs
    success "Node.js $(node -v)"
  fi
else
  pkg install -y nodejs
  success "Node.js $(node -v)"
fi

command -v npm &>/dev/null || { error "npm not found"; exit 1; }
success "npm $(npm -v)"

# Git
command -v git &>/dev/null || { pkg install -y git; success "git installed"; }
success "git available"

# curl
command -v curl &>/dev/null || pkg install -y curl

# Storage access
if [ ! -d "$HOME/storage" ]; then
  info "Requesting storage access..."
  termux-setup-storage 2>/dev/null || warn "Storage not granted (optional)"
fi

save_state "prerequisites"

# ── Step 2: Configuration ──
step "Step 2/4: Configuration"

USE_EXISTING_ENV=false
if [ -f ".env" ]; then
  echo ""
  read -p "  .env exists. Use existing? (Y/n): " use_existing
  [[ "$use_existing" != "n" && "$use_existing" != "N" ]] && USE_EXISTING_ENV=true && success "Using existing .env"
fi

if [ "$USE_EXISTING_ENV" = false ]; then
  echo ""
  echo "  Bot Configuration:"
  echo ""
  while true; do
    read -p "  Telegram Bot Token (@BotFather): " TG_TOKEN
    [[ "$TG_TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]] && break
    error "Format invalid"
  done
  read -p "  AI API Endpoint: " AI_ENDPOINT
  AI_ENDPOINT=${AI_ENDPOINT:-"https://your-api-endpoint.com/v1"}
  read -p "  AI API Key: " AI_KEY
  while [ -z "$AI_KEY" ]; do error "Required"; read -p "  AI API Key: " AI_KEY; done
  read -p "  AI Model [gemini/gemini-2.5-flash-lite]: " AI_MODEL
  AI_MODEL=${AI_MODEL:-"gemini/gemini-2.5-flash-lite"}
  read -p "  Telegram Admin ID: " ADMIN_ID
  while [ -z "$ADMIN_ID" ]; do error "Required"; read -p "  Telegram Admin ID: " ADMIN_ID; done
  read -p "  Timezone [Asia/Makassar]: " TIMEZONE
  TIMEZONE=${TIMEZONE:-"Asia/Makassar"}
  read -p "  Renungan Time [08:00]: " RENUNGAN_TIME
  RENUNGAN_TIME=${RENUNGAN_TIME:-"08:00"}

  cat > .env << ENVEOF
# Generated on $(date) - Termux
TIMEZONE=${TIMEZONE}
TELEGRAM_BOT_TOKEN=***  success ".env written"
fi
save_state "config"

# ── Step 3: Cloudflare Tunnel (Optional) ──
step "Step 3/4: Cloudflare Tunnel Setup"

# cloudflared on Termux
HAS_CLOUDFLARED=false
if command -v cloudflared &>/dev/null; then
  success "cloudflared available"
  HAS_CLOUDFLARED=true
fi

WEBHOOK_URL=""
SETUP_TUNNEL=false

if is_done "tunnel"; then
  WEBHOOK_URL=$(grep "^WEBHOOK_URL=" .env 2>/dev/null | cut -d= -f2)
  [ -n "$WEBHOOK_URL" ] && success "Tunnel configured: $WEBHOOK_URL"
else
  echo ""
  if [ "$HAS_CLOUDFLARED" = false ]; then
    read -p "  Install cloudflared? (y/N): " install_cf
    if [[ "$install_cf" == "y" || "$install_cf" == "Y" ]]; then
      pkg install -y cloudflared 2>/dev/null || {
        ARCH=$(uname -m)
        case "$ARCH" in
          aarch64) CF_ARCH="arm64" ;;
          armv7l|armv8l) CF_ARCH="arm" ;;
          x86_64) CF_ARCH="amd64" ;;
          *) error "Unsupported arch: $ARCH"; CF_ARCH="" ;;
        esac
        if [ -n "$CF_ARCH" ]; then
          curl -L --output "$PREFIX/bin/cloudflared" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}"
          chmod +x "$PREFIX/bin/cloudflared"
        fi
      }
      command -v cloudflared &>/dev/null && { HAS_CLOUDFLARED=true; success "cloudflared installed"; }
    fi
  fi

  if [ "$HAS_CLOUDFLARED" = true ]; then
    read -p "  Setup Cloudflare Tunnel? (y/N): " setup_cf
    [[ "$setup_cf" == "y" || "$setup_cf" == "Y" ]] && SETUP_TUNNEL=true
  fi

  if [ "$SETUP_TUNNEL" = true ]; then
    CERT_FILE=$(ls ~/.cloudflared/cert.pem 2>/dev/null || true)
    if [ -n "$CERT_FILE" ]; then
      success "Cloudflare authorized"
    else
      cloudflared tunnel login
      CERT_FILE=$(ls ~/.cloudflared/cert.pem 2>/dev/null || true)
    fi
    [ -z "$CERT_FILE" ] && { error "Cert not found"; exit 1; }

    TUNNEL_NAME="wa-renungan"
    EXISTING=$(cloudflared tunnel list 2>/dev/null | grep -w "$TUNNEL_NAME" || true)
    if [ -n "$EXISTING" ]; then
      TUNNEL_ID=$(cloudflared tunnel list 2>/dev/null | grep -w "$TUNNEL_NAME" | head -1 | awk '{print $1}')
      success "Reusing tunnel: $TUNNEL_ID"
    else
      cloudflared tunnel create "$TUNNEL_NAME" 2>/dev/null || true
      TUNNEL_ID=$(cloudflared tunnel list 2>/dev/null | grep -w "$TUNNEL_NAME" | head -1 | awk '{print $1}')
      [ -z "$TUNNEL_ID" ] && { error "Tunnel creation failed"; exit 1; }
      success "Tunnel: $TUNNEL_ID"
    fi

    read -p "  Domain: " DOMAIN
    while [ -z "$DOMAIN" ]; do read -p "  Domain: " DOMAIN; done
    read -p "  Subdomain [wa-bot]: " SUBDOMAIN
    SUBDOMAIN=${SUBDOMAIN:-"wa-bot"}
    FULL_HOSTNAME="${SUBDOMAIN}.${DOMAIN}"

    cloudflared tunnel route dns "$TUNNEL_NAME" "$FULL_HOSTNAME" 2>/dev/null || warn "DNS may exist"

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
    success "config.yml (QUIC)"

    WEBHOOK_URL="https://${FULL_HOSTNAME}"
    if grep -q "^WEBHOOK_URL=" .env 2>/dev/null; then
      sed -i "s|^WEBHOOK_URL=.*|WEBHOOK_URL=${WEBHOOK_URL}|" .env
    else
      echo "" >> .env; echo "WEBHOOK_URL=${WEBHOOK_URL}" >> .env; echo "WEBHOOK_PORT=3000" >> .env
    fi
    success "Webhook: $WEBHOOK_URL"

    warn "Termux: no systemd. Tunnel harus jalan manual atau pakai nohup"
    info "  Nohup: nohup cloudflared tunnel --protocol quic run $TUNNEL_NAME &"
    info "  Termux boot: ~/.termux/boot/cloudflared.sh"
    save_state "tunnel"
  else
    info "Polling mode"
    save_state "tunnel"
  fi
fi

# ── Step 4: Bot + PM2 ──
step "Step 4/4: Bot Setup"

if [ -d "node_modules" ] && [ -f "package-lock.json" ]; then
  npm ls --depth=0 &>/dev/null && success "Dependencies OK" || { npm install; success "Reinstalled"; }
else
  npm install
  success "Installed $(ls node_modules | wc -l) packages"
fi

mkdir -p logs

info "Testing AI..."
AI_TEST=$(node -e "
require('dotenv').config({override: true});
const ai = require('./src/services/aiService');
ai.testAIConnection().then(r => {
  if (r.success) console.log('OK:' + r.provider + ':' + r.model);
  else console.log('FAIL:' + (r.error || 'unknown'));
}).catch(e => console.log('FAIL:' + e.message));
" 2>/dev/null)
[[ "$AI_TEST" == OK:* ]] && success "AI: $(echo "$AI_TEST" | cut -d: -f2-)" || warn "AI: $(echo "$AI_TEST" | cut -d: -f2-)"

# PM2
command -v pm2 &>/dev/null || { npm install -g pm2; success "PM2 installed"; }

# On Termux, no pm2 startup. Use nohup or termux-services.
pm2 delete renungan-bot 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
sleep 2
pm2 pid renungan-bot &>/dev/null && success "Bot running!" || warn "Check: pm2 logs"

# Termux boot script
BOOT_DIR="$HOME/.termux/boot"
if [ -d "$BOOT_DIR" ] || [ -d "$PREFIX/share/termux" ]; then
  echo ""
  read -p "  Setup auto-start on Termux boot? (y/N): " boot_setup
  if [[ "$boot_setup" == "y" || "$boot_setup" == "Y" ]]; then
    mkdir -p "$BOOT_DIR"
    cat > "${BOOT_DIR}/wa-bot.sh" << BOOTEOF
#!/data/data/com.termux/files/usr/bin/bash
# JhopanWa Bot Auto-start
export PATH=$PREFIX/bin:\$PATH
sleep 10
cd $(pwd)
$PREFIX/bin/pm2 resurrect
BOOTEOF
    chmod +x "${BOOT_DIR}/wa-bot.sh"
    success "Auto-start script: ${BOOT_DIR}/wa-bot.sh"
    info "Install Termux:Boot app from F-Droid for auto-start"
  fi
fi

# ── Done ──
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Setup Complete! (Termux)                         ║${NC}"
echo -e "${GREEN}╠═══════════════════════════════════════════════════╣${NC}"
TG_TOKEN_VAL=*** "^TELEGRAM_BOT_TOKEN=*** .env | cut -d= -f2)
TG_BOT_NAME=$(curl -s "https://api.telegram.org/bot${TG_TOKEN_VAL}/getMe" 2>/dev/null | grep -oE '"username":"[^"]*"' | cut -d'"' -f4 || true)
[ -n "$TG_BOT_NAME" ] && echo -e "${GREEN}║  Telegram: @${TG_BOT_NAME}${NC}"
[ -n "$WEBHOOK_URL" ] && echo -e "${GREEN}║  Webhook:  ${WEBHOOK_URL}${NC}"
[ -z "$WEBHOOK_URL" ] && echo -e "${GREEN}║  Mode: POLLING${NC}" || echo -e "${GREEN}║  Mode: WEBHOOK${NC}"
echo -e "${GREEN}╠═══════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Commands:                                       ║${NC}"
echo -e "${GREEN}║    pm2 status | pm2 logs | pm2 restart all        ║${NC}"
echo -e "${GREEN}║  Tunnel (manual):                                 ║${NC}"
echo -e "${GREEN}║    cloudflared tunnel --protocol quic run wa-renungan ║${NC}"
echo -e "${GREEN}║  Keep alive: termux-wake-lock                     ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════╝${NC}"
echo ""
warn "PENTING: Jalankan 'termux-wake-lock' agar Termux tidak di-kill Android"
