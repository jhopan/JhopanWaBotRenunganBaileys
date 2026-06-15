<div align="center">

# 🤖 JhopanWa Bot Renungan

### WhatsApp & Telegram Bot untuk Renungan Harian dengan AI

**Powered by Baileys — Tanpa Chromium, Ultra Ringan, Jalan di Mana Saja**

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green?logo=node.js)](https://nodejs.org/)
[![Baileys](https://img.shields.io/badge/Baileys-8.x-blue?logo=whatsapp)](https://github.com/WhiskeySockets/Baileys)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Multi--OS-orange)](#-supported-platforms)

**[🚀 Quick Start](#-quick-start)** • **[📖 Features](#-features)** • **[🌐 Deployment](#-deployment)** • **[📚 Docs](#-commands)**

</div>

---

## 🌟 Highlights

> **Bot WhatsApp + Telegram yang super ringan, bisa jalan di mana saja — dari VPS murah, GCP free tier, router OpenWRT, hingga HP Android pakai Termux!**

| Metric | Value |
|--------|-------|
| 🧠 RAM Usage | ~100 MB |
| ⚡ CPU Usage | < 1% |
| 🚀 Startup Time | 2-5 detik |
| 💾 Disk Size | ~10 MB (no browser!) |
| 📡 Bandwidth (Webhook) | ~1 MB/bulan |
| 📡 Bandwidth (Polling) | ~750 MB/bulan |
| 🖥️ Min. RAM | 256 MB |

---

## ✨ Features

### 📖 Renungan Harian Otomatis
AI generate renungan berdasarkan ayat Alkitab, dikirim otomatis setiap pagi ke grup WhatsApp & Telegram.

### 🤖 Dual Bot
WhatsApp (Baileys) + Telegram berjalan bersamaan dalam satu proses.

### 🎂 Ucapan Ulang Tahun
Otomatis kirim ucapan selamat ulang tahun ke member grup.

### 🌐 Multi-Group Support
Kirim renungan ke beberapa grup dengan delay antar grup.

### ⚙️ Panel Kontrol Telegram
Kelola semua setting bot dari Telegram:
- Set grup tujuan renungan
- Ubah jadwal pengiriman
- Test kirim renungan
- Kelola daftar ayat
- Monitor status bot

### 🧠 AI-Powered
Support multiple AI providers:
- Custom OpenAI-compatible API
- Google Gemini
- OpenRouter

### 💾 Ultra Lightweight
Menggunakan **Baileys** (WhatsApp Web API) — **tanpa Chromium**, hemat RAM, startup cepat.

---

## 🖥️ Supported Platforms

| Platform | Script | Package Manager | Service | Status |
|----------|--------|-----------------|---------|--------|
| 🐧 Linux VPS (Debian/Ubuntu/CentOS/Fedora/Alpine/Arch) | `setup-vps.sh` | apt/dnf/yum/apk/pacman | systemd/openrc | ✅ |
| ☁️ Google Cloud Platform | `setup-gcp.sh` | apt | systemd + zram | ✅ |
| 📱 Termux (Android) | `setup-termux.sh` | pkg | nohup/Termux:Boot | ✅ |
| 🔌 OpenWRT Router | `setup-openwrt.sh` | opkg | procd init.d | ✅ |
| 🍎 macOS | `setup-macos.sh` | brew | launchd | ✅ |
| 🪟 Windows | `setup.bat` | chocolatey/winget | NSSM | ✅ |

---

## 🚀 Quick Start

### One Command to Rule Them All

```bash
git clone https://github.com/jhopan/JhopanWaBotRenunganBaileys.git
cd JhopanWaBotRenunganBaileys
bash setup.sh  # Auto-detect platform!
```

### Platform-Specific Setup

<details>
<summary><b>🐧 Linux VPS / Server</b></summary>

```bash
git clone https://github.com/jhopan/JhopanWaBotRenunganBaileys.git
cd JhopanWaBotRenunganBaileys
bash setup-vps.sh
```

**Supports:** Debian, Ubuntu, CentOS, Fedora, Alpine, Arch Linux  
**Features:** Auto-detect distro, optional zram setup, PM2 + systemd
</details>

<details>
<summary><b>☁️ Google Cloud Platform (GCP)</b></summary>

```bash
git clone https://github.com/jhopan/JhopanWaBotRenunganBaileys.git
cd JhopanWaBotRenunganBaileys
bash setup-gcp.sh
```

**Auto-detect:** GCP metadata, machine type, zone  
**Auto-setup:** zram 512MB (untuk e2-micro 1GB RAM)  
**Service:** systemd + auto-restart
</details>

<details>
<summary><b>📱 Termux (Android)</b></summary>

```bash
pkg install git
git clone https://github.com/jhopan/JhopanWaBotRenunganBaileys.git
cd JhopanWaBotRenunganBaileys
bash setup-termux.sh
```

**Note:** Jalankan `termux-wake-lock` agar tidak di-kill Android  
**Auto-start:** Install Termux:Boot app dari F-Droid
</details>

<details>
<summary><b>🔌 OpenWRT Router</b></summary>

```bash
# SSH ke router
opkg install git git-http
git clone https://github.com/jhopan/JhopanWaBotRenunganBaileys.git
cd JhopanWaBotRenunganBaileys
sh setup-openwrt.sh
```

**Min. RAM:** 128 MB  
**Service:** procd init.d + auto-start on boot
</details>

<details>
<summary><b>🍎 macOS</b></summary>

```bash
git clone https://github.com/jhopan/JhopanWaBotRenunganBaileys.git
cd JhopanWaBotRenunganBaileys
bash setup-macos.sh
```

**Requires:** Homebrew  
**Service:** launchd + auto-start on boot
</details>

<details>
<summary><b>🪟 Windows</b></summary>

```cmd
git clone https://github.com/jhopan/JhopanWaBotRenunganBaileys.git
cd JhopanWaBotRenunganBaileys
setup.bat
```

**Requires:** Node.js 20+, Git  
**Service:** NSSM (Windows Service)
</details>

### Manual Setup

```bash
git clone https://github.com/jhopan/JhopanWaBotRenunganBaileys.git
cd JhopanWaBotRenunganBaileys
npm install
cp .env.example .env
# Edit .env dengan credentials kamu
npm start
```

---

## ⚙️ Configuration

### Environment Variables (.env)

```env
# Timezone
TIMEZONE=Asia/Makassar

# Telegram Bot (wajib)
TELEGRAM_BOT_TOKEN=***_ADMIN_TELEGRAM_IDS=123456789

# AI Provider (pilih salah satu)
# Option A: Custom OpenAI-Compatible API
AI_API_KEY=your_a***_API_ENDPOINT=https://your-api-endpoint.com/v1
AI_MODEL=gemini/gemini-2.5-flash-lite

# Option B: Google Gemini
GEMINI_API_KEY=your_gem...y

# Option C: OpenRouter
OPENROUTER_API_KEY=your_ope...n

# Renungan
RENUNGAN_GROUP_ID=
RENUNGAN_TIME=08:00

# Webhook (opsional — hemat bandwidth)
WEBHOOK_URL=https://your-domain.com
WEBHOOK_PORT=3000
```

### Cara Dapat Credentials

| Credential | Cara Dapat |
|------------|------------|
| `TELEGRAM_BOT_TOKEN` | Chat [@BotFather](https://t.me/BotFather) → `/newbot` → copy token |
| `ADMIN_TELEGRAM_IDS` | Chat [@userinfobot](https://t.me/userinfobot) → copy ID |
| `AI_API_KEY` | Dari provider AI kamu (Gemini/OpenRouter/Custom) |

---

## 🌐 Cloudflare Tunnel (Webhook Mode)

**Hemat bandwidth ~97% — dari ~750MB/bulan jadi ~1MB/bulan!**

Setup wizard akan otomatis tanya apakah mau setup Cloudflare Tunnel. Jawab **Y** dan ikuti instruksinya.

### Requirements
- ✅ Akun Cloudflare (gratis)
- ✅ Domain yang di-manage di Cloudflare
- ✅ cloudflared (auto-install oleh setup script)

### Mode Comparison

| Mode | Bandwidth | Latency | Setup |
|------|-----------|---------|-------|
| Polling (default) | ~750 MB/bulan | Real-time | No setup |
| Webhook + Tunnel | ~1 MB/bulan | Real-time | Need domain |

### Service per Platform

| Platform | Service | Auto-restart |
|----------|---------|--------------|
| Linux (systemd) | `cloudflared.service` | ✅ |
| GCP | `cloudflared.service` + QUIC | ✅ |
| Termux | nohup + Termux:Boot | ❌ |
| OpenWRT | `/etc/init.d/cloudflared` | ✅ |
| macOS | `com.jhopan.cloudflared.plist` | ✅ |
| Windows | NSSM service | ✅ |

---

## 📊 Migration: whatsapp-web.js → Baileys

| Aspek | whatsapp-web.js | Baileys | Improvement |
|-------|-----------------|---------|-------------|
| RAM | 300-500 MB | ~100 MB | **5x lebih hemat** |
| Disk (deps) | ~300 MB (Chromium) | ~10 MB | **30x lebih kecil** |
| Startup | 10-30 detik | 2-5 detik | **6x lebih cepat** |
| Min. VPS | 1 GB RAM | 256 MB RAM | **4x lebih murah** |
| Browser | Chrome/Chromium | ❌ Tidak perlu | **No overhead** |
| CPU | 5-15% (Chromium) | < 1% | **10x lebih hemat** |

---

## 📁 Project Structure

```
JhopanWaBotRenunganBaileys/
├── src/
│   ├── index.js              # Entry point
│   ├── botWhatsApp.js        # WhatsApp bot (Baileys)
│   ├── botTelegram.js        # Telegram bot (panel kontrol)
│   ├── renunganHandler.js    # Cron job renungan
│   ├── services/
│   │   └── aiService.js      # AI provider (Custom/Gemini/OpenRouter)
│   ├── utils/
│   │   ├── configManager.js  # Config management
│   │   ├── dateHelper.js     # Date utilities
│   │   ├── fileHelper.js     # File operations
│   │   └── logger.js         # Logging
│   └── data/                 # Data storage (JSON)
├── setup.sh                  # 🚀 Universal launcher (auto-detect)
├── setup-gcp.sh              # ☁️ GCP setup (auto zram)
├── setup-vps.sh              # 🐧 Generic Linux VPS
├── setup-termux.sh           # 📱 Termux (Android)
├── setup-openwrt.sh          # 🔌 OpenWRT Router
├── setup-macos.sh            # 🍎 macOS
├── setup.bat                 # 🪟 Windows
├── ecosystem.config.js       # PM2 configuration
├── package.json              # Dependencies
├── .env.example              # Environment template
└── README.md                 # This file
```

---

## 📚 Commands

### NPM Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start bot (development) |
| `npm run start:prod` | Start dengan optimasi memory |
| `npm run dev` | Start dengan auto-reload (nodemon) |
| `npm run setup` | Run setup wizard |
| `npm run tunnel` | Quick tunnel (random URL via cloudflared) |

### PM2 (Production)

| Command | Description |
|---------|-------------|
| `pm2 start ecosystem.config.js` | Start bot |
| `pm2 status` | Check status |
| `pm2 logs` | View logs |
| `pm2 restart all` | Restart bot |
| `pm2 save` | Save process list |
| `pm2 startup` | Setup auto-start on boot |

### Telegram Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Panel kontrol utama |
| `/status` | Status bot & koneksi |
| `/test` | Test kirim renungan sekarang |
| `/settings` | Pengaturan bot |
| `/verses` | Kelola daftar ayat |
| `/help` | Bantuan |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    JhopanWa Bot Renungan                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  WhatsApp    │    │   Telegram   │    │   Renungan   │  │
│  │   (Baileys)  │    │  Bot (API)   │    │  Scheduler   │  │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘  │
│         │                   │                   │          │
│         └───────────────────┼───────────────────┘          │
│                             │                              │
│                    ┌────────┴────────┐                     │
│                    │   AI Service    │                     │
│                    │ (Gemini/OpenAI) │                     │
│                    └─────────────────┘                     │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Express Webhook Server                   │  │
│  │              (Cloudflare Tunnel / Polling)            │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

| Library | Purpose |
|---------|---------|
| [Baileys](https://github.com/WhiskeySockets/Baileys) | WhatsApp Web API (no Chromium!) |
| [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api) | Telegram Bot API |
| [Express](https://expressjs.com/) | Webhook server |
| [node-cron](https://github.com/node-cron/node-cron) | Task scheduler |
| [axios](https://axios-http.com/) | HTTP client (AI API calls) |
| [PM2](https://pm2.keymetrics.io/) | Process manager |
| [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) | Free HTTPS tunnel |

---

## 🔧 Troubleshooting

<details>
<summary><b>Bot tidak bisa connect WhatsApp</b></summary>

- Hapus folder `auth_state/` dan restart bot
- Scan QR code ulang dari WhatsApp → Linked Devices
- Pastikan WhatsApp di HP aktif dan terkoneksi internet
</details>

<details>
<summary><b>Cloudflare Tunnel error 530</b></summary>

- Pastikan DNS CNAME record mengarah ke `<tunnel-id>.cfargotunnel.com`
- Cek: `cloudflared tunnel info wa-renungan`
- Re-route DNS: Edit di Cloudflare Dashboard → DNS → Edit CNAME
</details>

<details>
<summary><b>Termux bot mati sendiri</b></summary>

- Jalankan: `termux-wake-lock`
- Install Termux:Boot app dari F-Droid
- Setup auto-start: `~/.termux/boot/wa-bot.sh`
</details>

<details>
<summary><b>GCP e2-micro OOM (Out of Memory)</b></summary>

- Setup zram: `sudo apt install zram-tools`
- Config: `/etc/default/zramswap` → `SIZE=512, ALGO=lz4`
- Restart: `sudo systemctl restart zramswap`
</details>

---

## 📄 License

MIT License — Bebas digunakan dan dimodifikasi.

---

## 🙏 Credits

- [Baileys](https://github.com/WhiskeySockets/Baileys) — WhatsApp Web API (lightweight, no Chromium)
- [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api) — Telegram Bot API
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) — Free HTTPS tunnel
- [Google Gemini AI](https://ai.google.dev/) — AI provider

---

<div align="center">

**Made with ❤️ by [Jhopan](https://github.com/jhopan)**

⭐ Star this repo if you find it useful!

</div>
