#!/bin/bash
# ============================================
# JhopanWa Bot - Universal Setup Launcher
# Auto-detect platform & run appropriate script
# ============================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     JhopanWa Bot - Universal Setup Launcher       ║${NC}"
echo -e "${CYAN}║     Baileys (No Chromium) - Any Platform          ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════╝${NC}"
echo ""

# Ensure we're in the project directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ── Platform Detection ──
detect_platform() {
  # Termux (Android)
  if [ -n "$TERMUX_VERSION" ] || [ -d "$PREFIX/share/termux" ]; then
    echo "termux"
    return
  fi

  # OpenWRT
  if [ -f /etc/openwrt_release ]; then
    echo "openwrt"
    return
  fi

  # macOS
  if [ "$(uname -s)" = "Darwin" ]; then
    echo "macos"
    return
  fi

  # Windows (Git Bash / MSYS / Cygwin)
  if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
    echo "windows"
    return
  fi

  # Linux — check if GCP
  if [ "$(uname -s)" = "Linux" ]; then
    if curl -s -m 2 -H "Metadata-Flavor: Google" \
       http://metadata.google.internal/computeMetadata/v1/ &>/dev/null; then
      echo "gcp"
      return
    fi
    echo "vps"
    return
  fi

  echo "unknown"
}

PLATFORM=$(detect_platform)

# Display platform info
echo -e "${GREEN}Platform detected:${NC}"
case "$PLATFORM" in
  gcp)
    echo -e "   ${CYAN}Google Cloud Platform (Compute Engine)${NC}"
    SCRIPT="setup-gcp.sh"
    ;;
  vps)
    echo -e "   ${CYAN}Linux VPS / Server${NC}"
    SCRIPT="setup-vps.sh"
    ;;
  termux)
    echo -e "   ${CYAN}Termux (Android)${NC}"
    SCRIPT="setup-termux.sh"
    ;;
  openwrt)
    echo -e "   ${CYAN}OpenWRT Router${NC}"
    SCRIPT="setup-openwrt.sh"
    ;;
  macos)
    echo -e "   ${CYAN}macOS${NC}"
    SCRIPT="setup-macos.sh"
    ;;
  windows)
    echo -e "   ${CYAN}Windows (Git Bash)${NC}"
    SCRIPT="setup.bat"
    ;;
  *)
    echo -e "   ${RED}Unknown platform${NC}"
    echo ""
    echo -e "${YELLOW}Available scripts:${NC}"
    echo "  bash setup-vps.sh      — Generic Linux VPS"
    echo "  bash setup-gcp.sh      — Google Cloud Platform"
    echo "  bash setup-termux.sh   — Termux (Android)"
    echo "  bash setup-openwrt.sh  — OpenWRT Router"
    echo "  bash setup-macos.sh    — macOS"
    echo "  cmd setup.bat          — Windows"
    echo ""
    read -p "Pilih script (vps/gcp/termux/openwrt/macos): " choice
    case "$choice" in
      vps) SCRIPT="setup-vps.sh" ;;
      gcp) SCRIPT="setup-gcp.sh" ;;
      termux) SCRIPT="setup-termux.sh" ;;
      openwrt) SCRIPT="setup-openwrt.sh" ;;
      macos) SCRIPT="setup-macos.sh" ;;
      *) echo -e "${RED}Pilihan tidak valid${NC}"; exit 1 ;;
    esac
    ;;
esac

echo ""

# Check if script exists
if [ ! -f "$SCRIPT_DIR/$SCRIPT" ]; then
  echo -e "${RED}Script not found: $SCRIPT${NC}"
  echo -e "${YELLOW}Pastikan semua file setup ada di directory yang sama.${NC}"
  exit 1
fi

# Run the appropriate script
echo -e "${GREEN}Menjalankan: $SCRIPT${NC}"
echo ""

if [ "$PLATFORM" = "windows" ]; then
  cmd.exe /c "$SCRIPT_DIR\\$SCRIPT"
else
  bash "$SCRIPT_DIR/$SCRIPT"
fi
