<div align="center">

# 🤖 JhopanWa Bot Renungan

### WhatsApp & Telegram Bot untuk Renungan Harian Kristen dengan AI

**Powered by Baileys — Tanpa Chromium, Ultra Ringan, Jalan di Mana Saja**

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green?logo=node.js)](https://nodejs.org/)
[![Baileys](https://img.shields.io/badge/Baileys-8.x-blue?logo=whatsapp)](https://github.com/WhiskeySockets/Baileys)
[![MongoDB](https://img.shields.io/badge/MongoDB-7.x-green?logo=mongodb)](https://www.mongodb.com/)
[![Gemini AI](https://img.shields.io/badge/AI-Gemini%20Flash--Lite-yellow?logo=google)](https://ai.google.dev/)
[![License](https://img.shields.io/badge/License-MIT-orange)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Multi--OS-lightgrey)](#-supported-platforms)

**[🚀 Quick Start](#-quick-start)** • **[✨ Features](#-features)** • **[📖 Bible Scrape System](#-bible-scrape-system)** • **[🏗️ Architecture](#️-architecture)** • **[📚 Docs](#-commands)**

</div>

---

## 🌟 Highlights

> **Bot WhatsApp + Telegram yang super ringan dengan sistem scraping Alkitab otomatis dan AI-powered renungan — bisa jalan di mana saja, dari VPS murah, GCP free tier, router OpenWRT, hingga HP Android pakai Termux!**

| Metric | Value |
|--------|-------|
| 🧠 RAM Usage | ~100 MB |
| ⚡ CPU Usage | < 1% |
| 🚀 Startup Time | 2-5 detik |
| 💾 Disk Size | ~10 MB (no browser!) |
| 📖 Bible Database | 31,102 ayat (~15 MB di MongoDB) |
| 🤖 AI Generation | ~5 detik per renungan |
| 📡 Bandwidth (Webhook) | ~1 MB/bulan |
| 📡 Bandwidth (Polling) | ~750 MB/bulan |
| 🖥️ Min. RAM | 256 MB |

---

## ✨ Features

### 📖 Renungan Harian Otomatis dengan AI
AI generate renungan berdasarkan ayat Alkitab dengan **Prompt V4** — sistem message + verse text injection yang menghasilkan renungan berkualitas tinggi, context-aware, dan bebas halusinasi.

- ✅ Teks ayat **PASTI akurat** (dari database, bukan AI hallucinate)
- ✅ Perikop sebagai konteks tema renungan
- ✅ Paragraf context-aware (terkait pesan ayat, bukan generic)
- ✅ Bahasa sederhana & mudah dipahami mahasiswa
- ✅ Support hari spesial (Natal, Paskah, Jumat Agung, dll)

### 📖 Bible Scrape System (BARU!)
Sistem scraping otomatis seluruh Alkitab Terjemahan Baru (31,102 ayat) dari [alkitab.mobi](https://alkitab.mobi):

- 🕐 **1 kitab/jam** — scraping terjadwal agar tidak terdeteksi sebagai bot
- 🛡️ **3 Layer Protection** — memastikan 100% ayat berhasil di-scrape
- ⏸️ **Smart Pause** — berhenti scraping jam 07:00-09:00 (waktu renungan)
- 🔍 **On-demand Scrape** — ayat yang belum ada di DB langsung di-scrape saat renungan
- 💾 **MongoDB Storage** — data persisten, survive restart
- 🎯 **One-cycle Stop** — setelah 1 siklus selesai (~3 hari), scraper berhenti permanen

### 🤖 Dual Bot
WhatsApp (Baileys) + Telegram berjalan bersamaan dalam satu proses.

### 🎂 Ucapan Ulang Tahun _(Coming Soon)_
Fitur ucapan ulang tahun otomatis sedang dalam pengembangan. Komponen AI sudah siap, tinggal wiring scheduler & Telegram UI.

### 🌐 Multi-Group Support
Kirim renungan ke beberapa grup dengan delay antar grup (1-10 menit).

### ⚙️ Panel Kontrol Telegram
Kelola semua setting bot dari Telegram:
- Set grup tujuan renungan
- Ubah jadwal pengiriman (06:00 - 10:00)
- Preview & kirim renungan manual
- Kelola daftar ayat (filter kategori, paginate, delete)
- Multi-group management
- Hide-tag (invisible mention)
- Monitor status bot

### 🧠 AI-Powered
Support multiple AI providers dengan **API Key Rotation** (multiple keys per provider):
- Custom OpenAI-compatible API
- Google Gemini (default: Flash-Lite)
- OpenRouter

### 💾 Ultra Lightweight
Menggunakan **Baileys** (WhatsApp Web API) — **tanpa Chromium**, hemat RAM, startup cepat.

---

## 📖 Bible Scrape System

Sistem scraping Alkitab TB (31,102 ayat) yang **guaranteed complete** dengan 3 layer protection.

### Cara Kerja

```
BOT STARTUP
  │
  ├── 1. Connect MongoDB
  ├── 2. Start WhatsApp + Telegram
  ├── 3. Start Renungan Scheduler (jam 08:00)
  └── 4. Start Bible Scrape Scheduler
         │
         ├── Jam 00:00 → Scrape Kejadian (50 pasal)
         ├── Jam 01:00 → Scrape Keluaran (40 pasal)
         ├── Jam 02:00 → Scrape Imamat (27 pasal)
         ├── ...
         ├── ⏸️  Jam 07:00 → PAUSE (waktu renungan)
         ├── 📖 Jam 08:00 → RENUNGAN (pakai ayat dari DB)
         ├── ▶️  Jam 09:00 → RESUME scraping
         ├── ...
         ├── ~Hari 3   → Wahyu selesai → VERIFIKASI FINAL
         └── ✅ STOP (data sudah 100% lengkap)
```

### 3 Layer Protection

| Layer | Kapan | Retry | Delay |
|-------|-------|-------|-------|
| **Layer 1** | Saat scraping pasal | 3 attempt | 2s, 4s, 6s |
| **Layer 2** | Setelah 1 kitab selesai | 1 attempt/pasal | 5s + 3s/pasal |
| **Layer 3** | Setelah 66 kitab selesai | 2 batch | 2s + 10s wait + 5s |

**Total: hingga 6 attempt per pasal** — peluang gagal 6x berturut-turut sangat kecil.

### Storage

```
31,102 ayat × 325 bytes = 9.6 MB
MongoDB overhead:        ~14.5 MB
Free tier 512 MB:        AMAN! (pakai 2.8%)
```

### Verse Injection (Prompt V4)

Saat generate renungan:
1. Cek ayat di database → ada? → inject ke prompt AI
2. Belum ada? → scrape on-demand → simpan → inject
3. AI fokus **menulis renungan** (bukan mengingat ayat)
4. Hasil: **akurat, context-aware, tidak hallucinate**

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
git clone https://github.com/jhopan/JhopanWaBotRenungan.git
cd JhopanWaBotRenungan
bash setup.sh  # Auto-detect platform!
```

### Platform-Specific Setup

<details>
<summary><b>🐧 Linux VPS / Server</b></summary>

```bash
git clone https://github.com/jhopan/JhopanWaBotRenungan.git
cd JhopanWaBotRenungan
bash setup-vps.sh
```

**Supports:** Debian, Ubuntu, CentOS, Fedora, Alpine, Arch Linux  
**Features:** Auto-detect distro, optional zram setup, PM2 + systemd
</details>

<details>
<summary><b>☁️ Google Cloud Platform (GCP)</b></summary>

```bash
git clone https://github.com/jhopan/JhopanWaBotRenungan.git
cd JhopanWaBotRenungan
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
git clone https://github.com/jhopan/JhopanWaBotRenungan.git
cd JhopanWaBotRenungan
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
git clone https://github.com/jhopan/JhopanWaBotRenungan.git
cd JhopanWaBotRenungan
sh setup-openwrt.sh
```

**Min. RAM:** 128 MB  
**Service:** procd init.d + auto-start on boot
</details>

<details>
<summary><b>🍎 macOS</b></summary>

```bash
git clone https://github.com/jhopan/JhopanWaBotRenungan.git
cd JhopanWaBotRenungan
bash setup-macos.sh
```

**Requires:** Homebrew  
**Service:** launchd + auto-start on boot
</details>

<details>
<summary><b>🪟 Windows</b></summary>

```cmd
git clone https://github.com/jhopan/JhopanWaBotRenungan.git
cd JhopanWaBotRenungan
setup.bat
```

**Requires:** Node.js 20+, Git  
**Service:** NSSM (Windows Service)
</details>

### Manual Setup

```bash
git clone https://github.com/jhopan/JhopanWaBotRenungan.git
cd JhopanWaBotRenungan
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
TELEGRAM_BOT_TOKEN=***
ADMIN_TELEGRAM_IDS=123456789

# MongoDB (wajib untuk Bible Scrape System)
MONGO_URI=mongodb+srv://user:***@cluster.mongodb.net/botdb

# AI Provider (pilih salah satu)
# Option A: Custom OpenAI-Compatible API
AI_API_KEY=***
AI_API_ENDPOINT=https://your-api-endpoint.com/v1
AI_MODEL=gemini/gemini-2.5-flash-lite

# Option B: Google Gemini
GEMINI_API_KEY=***

# Option C: OpenRouter
OPENROUTER_API_KEY=***

# Renungan
VERSE_MODE=pool          # "pool" atau "yearly"
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
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) → Create API Key |
| `MONGO_URI` | [MongoDB Atlas](https://www.mongodb.com/atlas) → Free tier (512MB) |

---

## 🚀 Deployment Guide: Render + MongoDB Atlas

Panduan deploy gratis/paling murah: **Render** (hosting) + **MongoDB Atlas** (database).

### Step 1: Setup MongoDB Atlas (Database)

```
1. Daftar di https://www.mongodb.com/atlas (gratis)

2. Buat Organization & Project
   → Organization: nama bebas (misal "JhopanBot")
   → Project: "wa-renungan-bot"

3. Buat Cluster (FREE TIER - M0)
   → Provider: AWS / GCP / Azure (pilih yang terdekat)
   → Region: Singapore (ap-southeast-1) ← terdekat dari Indonesia
   → Cluster Name: "wa-bot-cluster"
   → Tier: M0 FREE (512 MB storage)

4. Buat Database User
   → Security → Database Access → Add New User
   → Username: wa_bot_user (bebas)
   → Password: (generate random, CATAT!)
   → Role: Read and write to any database
   → Create User

5. Whitelist IP
   → Network Access → Add IP Address
   → Pilih "Allow Access from Anywhere" (0.0.0.0/0)
     ⚠️  Wajib 0.0.0.0/0 karena Render IP dinamis
   → Confirm

6. Ambil Connection String
   → Database → Connect → Drivers → Node.js
   → Copy URI, format:
     mongodb+srv://<username>:<password>@<cluster>.mongodb.net/<dbname>
   
   → Ganti <username> dan <password> dengan yang kamu buat
   → Ganti <dbname> dengan: wa_renungan_bot
   
   Contoh final:
     mongodb+srv://wa_bot_user:***@cluster0.xxxxx.mongodb.net/wa_renungan_bot
```

### Step 2: Push Code ke GitHub

```bash
# Pastikan semua kode sudah di-push
git add .
git commit -m "ready for deploy"
git push origin main
```

### Step 3: Deploy ke Render

```
1. Daftar di https://render.com (bisa pakai GitHub login)

2. Buat Web Service
   → Dashboard → New → Web Service
   → Connect repo: pilih "JhopanWaBotRenungan"
   → Name: "wa-renungan-bot"
   → Region: Singapore (closest to Indonesia)
   → Branch: main
   → Runtime: Node
   → Build Command: npm install
   → Start Command: npm start

3. Instance Type
   → Free (spin down setelah 15 menit idle)
   ATAU
   → Starter $7/bulan (always on, recommended)
   
   ⚠️  Free tier akan sleep setelah 15 menit tanpa traffic!
       Solusi: pakai webhook mode + Cloudflare Tunnel
       atau pakai cron-job.org untuk ping setiap 10 menit

4. Environment Variables (⚠️ PENTING — set semua di sini!)
   → Klik "Advanced" → "Add Environment Variable"
   
   ┌──────────────────────┬──────────────────────────────────────┐
   │ Key                  │ Value                                │
   ├──────────────────────┼──────────────────────────────────────┤
   │ NODE_ENV             │ production                           │
   │ TIMEZONE             │ Asia/Makassar                        │
   │ TELEGRAM_BOT_TOKEN   │ (token dari @BotFather)              │
   │ ADMIN_TELEGRAM_IDS   │ (Telegram user ID kamu)              │
   │ GEMINI_API_KEY       │ (API key dari Google AI Studio)      │
   │ MONGO_URI            │ (connection string dari MongoDB)     │
   │ RENUNGAN_TIME        │ 08:00                                │
   │ VERSE_MODE           │ pool                                 │
   │ WEBHOOK_URL          │ https://wa-renungan-bot.onrender.com │
   │ WEBHOOK_PORT         │ 10000                                │
   └──────────────────────┴──────────────────────────────────────┘

   ⚠️ JANGAN pernah commit credentials ke GitHub!
   ⚠️ Semua secrets hanya di Render Environment Variables!

5. Deploy
   → Klik "Create Web Service"
   → Tunggu build selesai (~2-3 menit)
   → Cek logs: "✅ Bot siap!" = berhasil

6. (Opsional) Keep-Alive untuk Free Tier
   → Buka https://cron-job.org (gratis)
   → Buat cron job:
     URL: https://wa-renungan-bot.onrender.com/health
     Schedule: Every 10 minutes
   → Ini mencegah Render sleep
```

### Step 4: Verifikasi

```
Setelah deploy berhasil:

1. Cek Render Logs:
   ✅ MongoDB connected
   ✅ WhatsApp client ready (atau QR muncul)
   ✅ Telegram bot started
   ✅ Renungan scheduler started
   ✅ Bible scrape scheduler started

2. Scan QR WhatsApp:
   → QR dikirim otomatis ke Telegram admin
   → Scan dari WhatsApp → Linked Devices

3. Test dari Telegram:
   → /start → muncul menu
   → /status → semua hijau ✅
   → /renungan → test kirim renungan

4. Bible Scrape:
   → Cek log: "🕐 [Scraper] Memulai Bible Scrape Scheduler"
   → Otomatis scrape 1 kitab/jam
   → ~3 hari selesai → otomatis stop
```

### Estimasi Biaya

```
┌─────────────────┬────────────────────┬──────────────┐
│ Service         │ Plan               │ Biaya/Bulan  │
├─────────────────┼────────────────────┼──────────────┤
│ Render          │ Free (spin down)   │ Rp 0         │
│ Render          │ Starter (always on)│ ~Rp 110.000  │
│ MongoDB Atlas   │ M0 Free (512MB)    │ Rp 0         │
│ Gemini API      │ Free tier          │ Rp 0         │
│ Cloudflare      │ Free               │ Rp 0         │
│ Domain          │ .my.id / .com      │ Rp 15-150rb  │
├─────────────────┼────────────────────┼──────────────┤
│ TOTAL (Free)    │                    │ Rp 0         │
│ TOTAL (Starter) │                    │ ~Rp 125.000  │
└─────────────────┴────────────────────┴──────────────┘

* Gemini Flash-Lite free tier: 1,500 requests/hari
  Renungan 1x/hari = 30/bulan → JAUH di bawah limit
* MongoDB M0: 512MB storage, shared RAM
  Bible text ~15MB → masih sisa 497MB
```

### ⚠️ Penting untuk Render Free Tier

```
Masalah: Render free tier sleep setelah 15 menit idle
Dampak:  Bot mati, renungan tidak terkirim

Solusi (pilih salah satu):
┌──────────────────────────────────────────────────────────┐
│ 1. Webhook + Cloudflare Tunnel (RECOMMENDED)            │
│    → Telegram kirim webhook ke bot → bot tetap awake    │
│    → Set WEBHOOK_URL = URL Render kamu                  │
│                                                          │
│ 2. Cron-job.org Ping                                    │
│    → Ping /health endpoint setiap 10 menit              │
│    → Gratis, reliable                                   │
│                                                          │
│ 3. Upgrade ke Starter ($7/bulan)                        │
│    → Always on, tidak ada sleep                         │
│    → Paling hassle-free                                 │
└──────────────────────────────────────────────────────────┘
```

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
JhopanWaBotRenungan/
├── src/
│   ├── index.js                    # Entry point
│   ├── botWhatsApp.js              # WhatsApp bot (Baileys)
│   ├── botTelegram.js              # Telegram bot (panel kontrol)
│   ├── renunganHandler.js          # Orchestrator renungan + verse inject
│   ├── services/
│   │   ├── aiService.js            # AI provider + Prompt V4
│   │   ├── versePool.js            # Unified verse pool manager
│   │   ├── verseScraper.js         # 🆕 Scraping alkitab.mobi (TB)
│   │   ├── bibleVerseDB.js         # 🆕 MongoDB Bible text (31,102 ayat)
│   │   ├── bibleScrapeScheduler.js # 🆕 1 kitab/jam scheduler
│   │   ├── mongoService.js         # MongoDB connection
│   │   ├── mongoDataService.js     # MongoDB data CRUD
│   │   └── mongoAuthState.js       # WhatsApp auth in MongoDB
│   ├── utils/
│   │   ├── configManager.js        # Persistent config (MongoDB/JSON)
│   │   ├── dateHelper.js           # Date utilities
│   │   ├── fileHelper.js           # File operations
│   │   └── logger.js               # Logging
│   └── data/                       # Verse data (JSON per tahun)
│       ├── verses_2026.json        # 365 ayat tahun 2026
│       ├── verses_2027.json        # 365 ayat tahun 2027
│       ├── ... (sampai 2030)
│       └── verses_text.json        # Legacy cached verse texts
├── scripts/
│   ├── fetchAllVerses.js           # Manual scraping script
│   └── testVerseInject.js          # Verse inject test script
├── setup.sh                        # 🚀 Universal launcher (auto-detect)
├── setup-gcp.sh                    # ☁️ GCP setup (auto zram)
├── setup-vps.sh                    # 🐧 Generic Linux VPS
├── setup-termux.sh                 # 📱 Termux (Android)
├── setup-openwrt.sh                # 🔌 OpenWRT Router
├── setup-macos.sh                  # 🍎 macOS
├── setup.bat                       # 🪟 Windows
├── ecosystem.config.js             # PM2 configuration
├── package.json                    # Dependencies
├── .env.example                    # Environment template
└── README.md                       # This file
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    JhopanWa Bot Renungan                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │  WhatsApp    │    │   Telegram   │    │   Scheduler      │  │
│  │  (Baileys)   │    │  Bot (API)   │    │                  │  │
│  │              │    │              │    │  ┌────────────┐  │  │
│  │  Kirim pesan │    │  Admin panel │    │  │ Renungan   │  │  │
│  │  ke group    │◄───┤  Dashboard   │    │  │ (08:00)    │  │  │
│  │              │    │  Commands    │    │  ├────────────┤  │  │
│  └──────────────┘    └──────────────┘    │  │ Scraper    │  │  │
│                                           │  │ (1 kitab/  │  │  │
│                                           │  │  jam)      │  │  │
│                                           │  └────────────┘  │  │
│                                           └──────────────────┘  │
│         │                   │                    │               │
│         └───────────────────┼────────────────────┘               │
│                             │                                    │
│              ┌──────────────┼──────────────┐                     │
│              │              │              │                     │
│     ┌────────┴────────┐ ┌──┴───┐ ┌───────┴───────┐             │
│     │   AI Service    │ │Verse │ │  Bible Verse  │             │
│     │ (Gemini Flash-  │ │Pool  │ │  DB (MongoDB) │             │
│     │  Lite + V4)     │ │      │ │  31,102 ayat  │             │
│     └─────────────────┘ └──────┘ └───────────────┘             │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Express Webhook Server                        │   │
│  │              (Cloudflare Tunnel / Polling)                 │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Alur Harian

```
07:30  → AI pre-compute tema hari ini (pool mode)
07:00  → Scraper PAUSE
08:00  → RENUNGAN
         ├── Pilih ayat (pool/yearly mode)
         ├── Ambil teks dari DB (atau scrape on-demand)
         ├── AI generate renungan (Prompt V4 + verse inject)
         ├── Kirim ke WA group utama
         └── Kirim ke multi-group (delayed)
09:00  → Scraper RESUME
setiap jam → Scrape 1 kitab dari alkitab.mobi (~3 hari = selesai)
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
| `/start` | Panel kontrol utama (atau login WA) |
| `/status` | Status bot, WA, AI, memory, verses |
| `/renungan` | Menu pengelolaan renungan |
| `/testai` | Test koneksi AI |
| `/pool` | Statistik verse pool |
| `/seedpool` | Re-seed pool dari file JSON |
| `/help` | Bantuan |

---

## 🛠️ Tech Stack

| Library | Purpose |
|---------|---------|
| [Baileys](https://github.com/WhiskeySockets/Baileys) | WhatsApp Web API (no Chromium!) |
| [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api) | Telegram Bot API |
| [Mongoose](https://mongoosejs.com/) | MongoDB ODM (Bible text + auth + config) |
| [Express](https://expressjs.com/) | Webhook server |
| [node-cron](https://github.com/node-cron/node-cron) | Task scheduler (renungan) |
| [axios](https://axios-http.com/) | HTTP client (AI API + scraping) |
| [moment-timezone](https://momentjs.com/timezone/) | Timezone-aware scheduling |
| [PM2](https://pm2.keymetrics.io/) | Process manager |
| [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) | Free HTTPS tunnel |

---

## 🔧 Troubleshooting

<details>
<summary><b>Bot tidak bisa connect WhatsApp</b></summary>

- Hapus auth dari MongoDB: `db.whatsapp_auth.deleteMany({})`
- Restart bot dan scan QR code ulang
- QR code dikirim otomatis ke Telegram admin
- Pastikan WhatsApp di HP aktif dan terkoneksi internet
</details>

<details>
<summary><b>Scraping gagal terus untuk beberapa pasal</b></summary>

- Cek koneksi internet server
- Layer 2 & 3 akan otomatis retry
- Kalau tetap gagal, cek apakah alkitab.mobi bisa diakses dari server
- Ayat yang gagal akan di-scrape on-demand saat renungan
</details>

<details>
<summary><b>Renungan tidak terkirim</b></summary>

- Cek WhatsApp connected: `/status` di Telegram
- Cek AI API key valid: `/testai` di Telegram
- Cek MongoDB connected: lihat log startup
- Kalau WA disconnect, retry otomatis dalam 10 menit
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

<details>
<summary><b>Mau reset scraping dari awal</b></summary>

```bash
# Hapus state scraping dari MongoDB
mongosh "YOUR_MONGO_URI" --eval "db.scrape_state.deleteOne({_id: 'bible_scrape_progress'})"

# Restart bot — scraper akan mulai dari Kejadian lagi
```
</details>

---

## 📄 License

MIT License — Bebas digunakan dan dimodifikasi.

---

## 🙏 Credits

- [JhopanStore](https://jhopanstore.my.id) — Infrastructure & AI API Provider
- [Baileys](https://github.com/WhiskeySockets/Baileys) — WhatsApp Web API (lightweight, no Chromium)
- [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api) — Telegram Bot API
- [alkitab.mobi](https://alkitab.mobi) — Sumber teks Alkitab Terjemahan Baru (Yayasan Lembaga SABDA)
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/) — Free HTTPS tunnel
- [Google Gemini AI](https://ai.google.dev/) — AI provider

---

<div align="center">

**Made with ❤️ by [Jhopan](https://github.com/jhopan)**

⭐ Star this repo if you find it useful!

</div>