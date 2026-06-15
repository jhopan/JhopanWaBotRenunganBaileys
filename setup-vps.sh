#!/bin/bash
# ============================================
# JhopanWa Bot - Setup VPS (Generic Linux)
# Supports: Debian, Ubuntu, CentOS, Fedora, Alpine, Arch
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
echo -e "${CYAN}║     JhopanWa Bot - VPS Setup Wizard              ║${NC}"
echo -e "${CYAN}║     Baileys + Cloudflare Tunnel                   ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════╝${NC}"
echo ""

info()    { echo -e "${BLUE}i  $1${NC}"; }
success() { echo -e "${GREEN}OK $1${NC}"; }
warn()    { echo -e "${YELLOW}!! $1${NC}"; }
error()   { echo -e "${RED}XX $1${NC}"; }
step()    { echo -e "\n${CYAN}--- $1 ---${NC}"; }

save_state() { echo "$1=done" >> "$STATE_FILE"; }
is_done() { grep -q "^$1=done$" "$STATE_FILE" 2>/dev/null; }

ROLLBACK_ACTIONS=()
add_rollback() { ROLLBACK_ACTIONS+=("$1"); }
rollback() {
  if [ ${#ROLLBACK_ACTIONS[@]} -gt 0 ]; then
    warn "Rolling back..."
    for ((i=${#ROLLBACK_ACTIONS[@]}-1; i>=0; i--)); do
      eval "${ROLLBACK_ACTIONS[$i]}" 2>/dev/null || true
    done
  fi
  rm -f "$STATE_FILE"; exit 1
}
trap 'if [ $? -ne 0 ]; then error "Setup failed!"; rollback; fi' EXIT

# Detect sudo
SUDO=""
if [ "$(id -u)" -ne 0 ] && command -v sudo &>/dev/null; then SUDO="sudo"; fi

# Detect distro & package manager
DISTRO="unknown"
PKG_MGR="unknown"
INSTALL_CMD=""

if [ -f /etc/os-release ]; then
  . /etc/os-release
  DISTRO="$ID"
fi

if command -v apt &>/dev/null; then
  PKG_MGR="apt"
  INSTALL_CMD="$SUDO apt install -y"
elif command -v dnf &>/dev/null; then
  PKG_MGR="dnf"
  INSTALL_CMD="$SUDO dnf install -y"
elif command -v yum &>/dev/null; then
  PKG_MGR="yum"
  INSTALL_CMD="$SUDO yum install -y"
elif command -v apk &>/dev/null; then
  PKG_MGR="apk"
  INSTALL_CMD="$SUDO apk add"
elif command -v pacman &>/dev/null; then
  PKG_MGR="pacman"
  INSTALL_CMD="$SUDO pacman -S --noconfirm"
else
  error "No supported package manager found"
  exit 1
fi

TOTAL_RAM=$(free -m 2>/dev/null | awk '/^Mem:/{print $2}' || echo "0")

echo -e "  ${CYAN}Distro:${NC}  $DISTRO"
echo -e "  ${CYAN}PkgMgr:${NC}  $PKG_MGR"
echo -e "  ${CYAN}RAM:${NC}     ${TOTAL_RAM} MB"
echo -e "  ${CYAN}Kernel:${NC}  $(uname -r)"
echo ""

# ── Step 1: Prerequisites ──
step "Step 1/5: Prerequisites"

# Node.js
if command -v node &>/dev/null; then
  NODE_VER=$(node -v)
  NODE_MAJOR=$(echo "$NODE_VER" | grep -oE '[0-9]+' | head -1)
  if [ "$NODE_MAJOR" -ge 20 ]; then
    success "Node.js $NODE_VER"
  else
    error "Node.js >= 20 required (found $NODE_VER)"
    info "Installing Node.js 20..."
    case "$PKG_MGR" in
      apt)
        curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
        $SUDO apt install -y nodejs ;;
      dnf|yum)
        curl -fsSL https://rpm.nodesource.com/setup_20.x | $SUDO bash -
        $INSTALL_CMD nodejs ;;
      apk)
        $INSTALL_CMD nodejs npm ;;
      pacman)
        $INSTALL_CMD nodejs npm ;;
    esac
  fi
else
  info "Installing Node.js 20..."
  case "$PKG_MGR" in
    apt)
      curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
      $SUDO apt install -y nodejs ;;
    dnf|yum)
      curl -fsSL https://rpm.nodesource.com/setup_20.x | $SUDO bash -
      $INSTALL_CMD nodejs ;;
    apk)
      $INSTALL_CMD nodejs npm ;;
    pacman)
      $INSTALL_CMD nodejs npm ;;
  esac
  success "Node.js $(node -v)"
fi

command -v npm &>/dev/null || { error "npm not found"; exit 1; }
success "npm $(npm -v)"

# Git
if command -v git &>/dev/null; then
  success "git available"
else
  $INSTALL_CMD git
  success "git installed"
fi

# curl
command -v curl &>/dev/null || $INSTALL_CMD curl

save_state "prerequisites"

# ── Step 2: Configuration ──
step "Step 2/5: Configuration"

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
# Generated on $(date)
TIMEZONE=${TIMEZONE}
TELEGRAM_BOT_TOKEN=${TG_T...OF
  success ".env written"
  add_rollback "rm -f .env"
fi
save_state "config"

# ── Step 3: Cloudflare Tunnel ──
step "Step 3/5: Cloudflare Tunnel Setup"

SETUP_TUNNEL=false
WEBHOOK_URL=""

if is_done "tunnel"; then
  WEBHOOK_URL=$(grep "^WEBHOOK_URL=" .env 2>/dev/null | cut -d= -f2)
  [ -n "$WEBHOOK_URL" ] && success "Tunnel configured: $WEBHOOK_URL"
else
  HAS_CLOUDFLARED=false
  if command -v cloudflared &>/dev/null; then
    success "cloudflared $(cloudflared --version 2>&1 | head -1)"
    HAS_CLOUDFLARED=true
  fi

  echo ""
  if [ "$HAS_CLOUDFLARED" = true ]; then
    read -p "  Setup Cloudflare Tunnel? (Y/n): " setup_cf
    [[ "$setup_cf" != "n" && "$setup_cf" != "N" ]] && SETUP_TUNNEL=true
  else
    read -p "  Install cloudflared and setup tunnel? (y/N): " install_cf
    if [[ "$install_cf" == "y" || "$install_cf" == "Y" ]]; then
      info "Installing cloudflared..."
      ARCH=$(uname -m)
      case "$ARCH" in
        x86_64) CF_ARCH="amd64" ;;
        aarch64) CF_ARCH="arm64" ;;
        armv7l) CF_ARCH="arm" ;;
        *) error "Unsupported: $ARCH"; exit 1 ;;
      esac
      case "$PKG_MGR" in
        apt)
          curl -L --output /tmp/cloudflared.deb "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}.deb"
          $SUDO dpkg -i /tmp/cloudflared.deb && rm -f /tmp/cloudflared.deb ;;
        dnf|yum)
          $SUDO rpm -ivh "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}.rpm" ;;
        *)
          curl -L --output /usr/local/bin/cloudflared "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}"
          chmod +x /usr/local/bin/cloudflared ;;
      esac
      success "cloudflared installed"
      SETUP_TUNNEL=true
    fi
  fi

  if [ "$SETUP_TUNNEL" = true ]; then
    CERT_FILE=$(ls ~/.cloudflared/cert.pem 2>/dev/null || ls /etc/cloudflared/cert.pem 2>/dev/null || true)
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

    echo ""
    read -p "  Domain: " DOMAIN
    while [ -z "$DOMAIN" ]; do read -p "  Domain: " DOMAIN; done
    read -p "  Subdomain [wa-bot]: " SUBDOMAIN
    SUBDOMAIN=${SUBDOMAIN:-"wa-bot"}
    FULL_HOSTNAME="${SUBDOMAIN}.${DOMAIN}"

    cloudflared tunnel route dns "$TUNNEL_NAME" "$FULL_HOSTNAME" 2>/dev/null || warn "DNS may exist"

    SYS_DIR="/etc/cloudflared"
    USER_DIR="$HOME/.cloudflared"
    $SUDO mkdir -p "$SYS_DIR"
    CRED_FILE=$(ls "${USER_DIR}/${TUNNEL_ID}.json" 2>/dev/null || echo "${USER_DIR}/${TUNNEL_ID}.json")
    $SUDO cp -f "${USER_DIR}/cert.pem" "${SYS_DIR}/" 2>/dev/null || true
    $SUDO cp -f "${CRED_FILE}" "${SYS_DIR}/" 2>/dev/null || true

    $SUDO tee "${SYS_DIR}/config.yml" > /dev/null << CFGEOF
tunnel: ${TUNNEL_ID}
credentials-file: ${SYS_DIR}/$(basename "$CRED_FILE")
protocol: quic
ingress:
  - hostname: ${FULL_HOSTNAME}
    service: http://localhost:3000
  - service: http_status:404
CFGEOF
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

    if command -v systemctl &>/dev/null; then
      $SUDO cloudflared service uninstall 2>/dev/null || true
      $SUDO cloudflared --config "${SYS_DIR}/config.yml" service install 2>&1 || true
      $SUDO systemctl daemon-reload 2>/dev/null || true
      $SUDO systemctl enable cloudflared 2>/dev/null || true
      $SUDO systemctl restart cloudflared 2>/dev/null || true
      sleep 3
      systemctl is-active --quiet cloudflared 2>/dev/null && success "Service running" || warn "Manual: cloudflared tunnel --protocol quic run $TUNNEL_NAME"
    else
      warn "No systemd. Run manually: cloudflared tunnel --protocol quic run $TUNNEL_NAME"
    fi

    WEBHOOK_URL="https://${FULL_HOSTNAME}"
    if grep -q "^WEBHOOK_URL=" .env 2>/dev/null; then
      sed -i "s|^WEBHOOK_URL=.*|WEBHOOK_URL=${WEBHOOK_URL}|" .env
    else
      echo "" >> .env; echo "WEBHOOK_URL=${WEBHOOK_URL}" >> .env; echo "WEBHOOK_PORT=3000" >> .env
    fi
    success "Webhook: $WEBHOOK_URL"
    save_state "tunnel"
  else
    info "Polling mode"
    grep -q "^WEBHOOK_URL=" .env 2>/dev/null && { sed -i '/^WEBHOOK_URL=/d' .env; sed -i '/^WEBHOOK_PORT=/d' .env; }
    save_state "tunnel"
  fi
fi

# ── Step 4: zram (optional) ──
step "Step 4/5: Memory Optimization"

if cat /proc/swaps 2>/dev/null | grep -q "zram"; then
  success "zram active: $(cat /proc/swaps | grep zram | awk '{print $3}') KB"
elif [ "$TOTAL_RAM" -le 2048 ] && [ "$TOTAL_RAM" -gt 0 ]; then
  echo ""
  read -p "  RAM ${TOTAL_RAM}MB. Setup zram 512MB? (y/N): " sz
  if [[ "$sz" == "y" || "$sz" == "Y" ]]; then
    case "$PKG_MGR" in
      apt)
        $SUDO apt install -y zram-tools
        echo "ALGO=lz4" | $SUDO tee /etc/default/zramswap > /dev/null
        echo "SIZE=512" | $SUDO tee -a /etc/default/zramswap > /dev/null
        echo "PRIORITY=100" | $SUDO tee -a /etc/default/zramswap > /dev/null
        $SUDO systemctl restart zramswap 2>/dev/null || true ;;
      dnf|yum)
        $INSTALL_CMD zram-generator
        $SUDO mkdir -p /etc/systemd/zram-generator.conf.d
        echo "[zram0]" | $SUDO tee /etc/systemd/zram-generator.conf.d/zram.conf > /dev/null
        echo "zram-size = 512" | $SUDO tee -a /etc/systemd/zram-generator.conf.d/zram.conf > /dev/null
        echo "compression-algorithm = lz4" | $SUDO tee -a /etc/systemd/zram-generator.conf.d/zram.conf > /dev/null
        $SUDO systemctl restart systemd-zram-setup@zram0 2>/dev/null || true ;;
      *)
        warn "Auto zram not supported for $PKG_MGR. Setup manually." ;;
    esac
    cat /proc/swaps 2>/dev/null | grep -q "zram" && success "zram active" || warn "zram setup may need reboot"
  fi
else
  info "RAM ${TOTAL_RAM}MB - zram not needed"
fi

# ── Step 5: Bot + PM2 ──
step "Step 5/5: Bot Setup & Process Manager"

if [ -d "node_modules" ] && [ -f "package-lock.json" ]; then
  npm ls --depth=0 &>/dev/null && success "Dependencies OK" || { npm install --production; success "Reinstalled"; }
else
  info "Installing dependencies..."
  npm install --production
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

command -v pm2 &>/dev/null || { $SUDO npm install -g pm2; success "PM2 installed"; }
PM2_CMD=$(pm2 startup 2>&1 | grep "sudo env" || true)
[ -n "$PM2_CMD" ] && eval "$PM2_CMD" 2>/dev/null || true
pm2 delete renungan-bot 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
sleep 2
pm2 pid renungan-bot &>/dev/null && success "Bot running!" || warn "Check: pm2 logs"

# ── Done ──
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Setup Complete! (VPS)                            ║${NC}"
echo -e "${GREEN}╠═══════════════════════════════════════════════════╣${NC}"
TG_TOKEN_VAL=*** "^TELEGRAM_BOT_TOKEN=*** .env | cut -d= -f2)
TG_BOT_NAME=$(curl -s "https://api.telegram.org/bot${TG_TOKEN_VAL}/getMe" 2>/dev/null | grep -oE '"username":"[^"]*"' | cut -d'"' -f4 || true)
[ -n "$TG_BOT_NAME" ] && echo -e "${GREEN}║  Telegram: @${TG_BOT_NAME}${NC}"
[ -n "$WEBHOOK_URL" ] && echo -e "${GREEN}║  Webhook:  ${WEBHOOK_URL}${NC}"
echo -e "${GREEN}║  Distro: ${DISTRO} | PkgMgr: ${PKG_MGR}${NC}"
echo -e "${GREEN}╠═══════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  pm2 status | pm2 logs | pm2 restart all          ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════╝${NC}"
