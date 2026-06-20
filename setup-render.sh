#!/bin/bash
# ============================================
# JhopanWa Bot - Setup Render
# Render.com Web Service deployment script
# ============================================
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     JhopanWa Bot - Render Setup                   ║${NC}"
echo -e "${CYAN}║     Baileys on Render.com                         ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════╝${NC}"
echo ""

info()    { echo -e "${CYAN}i  $1${NC}"; }
success() { echo -e "${GREEN}OK $1${NC}"; }
warn()    { echo -e "${YELLOW}!! $1${NC}"; }
error()   { echo -e "${RED}XX $1${NC}"; }

echo -e "  ${CYAN}Platform:${NC} Render.com"
echo -e "  ${CYAN}Node:${NC}     $(node -v 2>/dev/null || echo 'not found')"
echo -e "  ${CYAN}Port:${NC}     ${PORT:-not set}"
echo -e "  ${CYAN}Render:${NC}   ${RENDER:-not detected}"
echo ""

# ── Step 1: Install Dependencies ──
info "Installing dependencies..."
npm install --production
success "Dependencies installed ($(ls node_modules | wc -l) packages)"

# ── Step 1b: Install Python dependencies (for TTS) ──
info "Installing Python dependencies (edge-tts for TTS)..."
if command -v pip3 &> /dev/null; then
  pip3 install -r requirements.txt --quiet 2>/dev/null && success "edge-tts installed" || warn "edge-tts install failed (TTS will not work)"
elif command -v pip &> /dev/null; then
  pip install -r requirements.txt --quiet 2>/dev/null && success "edge-tts installed" || warn "edge-tts install failed (TTS will not work)"
else
  warn "pip not found — TTS will not work. Add Python buildpack in Render."
fi

# ── Step 2: Create logs directory ──
mkdir -p logs
success "Logs directory ready"

# ── Step 3: Create auth_state directory ──
mkdir -p auth_state
success "Auth state directory ready"

# ── Step 4: Check environment variables ──
info "Checking environment variables..."
MISSING=0

if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  success "TELEGRAM_BOT_TOKEN is set"
else
  error "TELEGRAM_BOT_TOKEN not set! Add in Render Dashboard → Environment"
  MISSING=$((MISSING + 1))
fi

if [ -n "$ADMIN_TELEGRAM_IDS" ]; then
  success "ADMIN_TELEGRAM_IDS is set"
else
  warn "ADMIN_TELEGRAM_IDS not set"
fi

# AI key check
if [ -n "$AI_API_KEY" ] || [ -n "$OPENROUTER_API_KEY" ] || [ -n "$GEMINI_API_KEY" ]; then
  success "AI API key is set"
else
  warn "No AI API key found (renungan won't work without it)"
fi

# MongoDB check
if [ -n "$MONGODB_URI" ]; then
  success "MONGODB_URI is set (persistent storage enabled!)"
else
  warn "MONGODB_URI not set — data will be lost on restart!"
  warn "Setup free MongoDB at https://cloud.mongodb.com"
fi

# TTS check
if [ "$TTS_ENABLED" = "true" ]; then
  if command -v edge-tts &> /dev/null; then
    success "TTS enabled and edge-tts found"
  else
    warn "TTS enabled but edge-tts not installed — audio will not be generated"
  fi
else
  info "TTS disabled (set TTS_ENABLED=true to enable)"
fi

if [ "$MISSING" -gt 0 ]; then
  echo ""
  error "Missing $MISSING required environment variable(s)!"
  echo ""
  echo "  Add them in Render Dashboard:"
  echo "  Dashboard → Your Service → Environment → Add Environment Variable"
  echo ""
  echo "  Required:"
  echo "    TELEGRAM_BOT_TOKEN = your_bot_token"
  echo ""
  echo "  Optional but recommended:"
  echo "    ADMIN_TELEGRAM_IDS = your_telegram_id"
  echo "    AI_API_KEY         = your_ai_api_key"
  echo "    AI_API_ENDPOINT    = your_ai_endpoint"
  echo "    AI_MODEL           = gemini/gemini-2.5-flash-lite"
  echo "    TIMEZONE           = Asia/Makassar"
  echo "    RENUNGAN_TIME      = 08:00"
  echo "    VERSE_MODE         = bible"
  echo "    TTS_ENABLED        = true"
  echo ""
fi

# ── Step 5: Render-specific info ──
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Render Build Complete!                           ║${NC}"
echo -e "${GREEN}╠═══════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Next steps:                                      ║${NC}"
echo -e "${GREEN}║  1. Bot will start automatically                  ║${NC}"
echo -e "${GREEN}║  2. Scan QR code from Render logs                 ║${NC}"
echo -e "${GREEN}║  3. Setup cron-job.org to ping /health every 5min ║${NC}"
echo -e "${GREEN}╠═══════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Important Notes:                                 ║${NC}"
echo -e "${GREEN}║  - Render storage is EPHEMERAL                    ║${NC}"
echo -e "${GREEN}║  - WhatsApp session lost on restart/redeploy      ║${NC}"
echo -e "${GREEN}║  - Need to re-scan QR after each restart          ║${NC}"
echo -e "${GREEN}║  - Use cron-job.org to prevent sleep              ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════╝${NC}"
