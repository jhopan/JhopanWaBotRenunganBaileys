/**
 * WhatsApp Bot - Baileys Version (No Chromium!)
 * Migrasi dari whatsapp-web.js ke @whiskeysockets/baileys
 * Jauh lebih ringan: ~50-100MB RAM vs ~300-500MB
 *
 * Storage: MongoDB (primary) → Local file (fallback)
 * Interface publik TETAP SAMA agar file lain tidak perlu diubah.
 */

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  Browsers,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const pino = require("pino");
const qrcode = require("qrcode");
const qrcodeTerminal = require("qrcode-terminal");
const mongoService = require("./services/mongoService");
const { initAuthState: initMongoAuthState } = require("./services/mongoAuthState");
const fs = require("fs");
const EventEmitter = require("events");

// ============================================
// STATE MANAGEMENT
// ============================================

let sock = null;
let telegramBot = null;
let adminChatIds = new Map();
let connectionState = "DISCONNECTED";
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 20;
const BASE_RECONNECT_DELAY = 10000;

// Event emitter untuk notifikasi (dipakai oleh module lain)
const waEvents = new EventEmitter();

// Logger - hanya error agar tidak noisy
const logger = pino({ level: "silent" });

// ============================================
// SIMPLE IN-MEMORY STORE
// (makeInMemoryStore sudah dihapus dari Baileys terbaru)
// ============================================

const store = {
  chats: new Map(),
  contacts: new Map(),

  bind(ev) {
    ev.on("messaging-history.set", ({ chats, contacts }) => {
      for (const chat of chats) {
        if (chat.id) store.chats.set(chat.id, chat);
      }
      for (const contact of contacts) {
        if (contact.id) store.contacts.set(contact.id, contact);
      }
      console.log(
        `📦 Store loaded: ${store.chats.size} chats, ${store.contacts.size} contacts`,
      );
    });

    ev.on("chats.upsert", (chats) => {
      for (const chat of chats) {
        if (chat.id) store.chats.set(chat.id, chat);
      }
    });

    ev.on("chats.update", (updates) => {
      for (const update of updates) {
        const existing = store.chats.get(update.id);
        if (existing) {
          Object.assign(existing, update);
        } else if (update.id) {
          store.chats.set(update.id, update);
        }
      }
    });

    ev.on("chats.delete", (ids) => {
      for (const id of ids) {
        store.chats.delete(id);
      }
    });

    ev.on("contacts.upsert", (contacts) => {
      for (const contact of contacts) {
        if (contact.id) store.contacts.set(contact.id, contact);
      }
    });

    ev.on("contacts.update", (updates) => {
      for (const update of updates) {
        if (!update.id) continue;
        const existing = store.contacts.get(update.id);
        if (existing) {
          Object.assign(existing, update);
        } else {
          store.contacts.set(update.id, update);
        }
      }
    });
  },
};

// ============================================
// SOCK CREATION & EVENT HANDLING
// ============================================

/**
 * Start/restart WhatsApp socket
 * Pattern standar Baileys: panggil ulang fungsi ini saat disconnect
 */
async function startSock() {
  // 1. Auth state - MongoDB (primary) → Local file (fallback)
  let state, saveCreds;

  if (mongoService.isConnected()) {
    try {
      console.log("🗄️  Loading WhatsApp auth from MongoDB...");
      const authResult = await initMongoAuthState();
      state = authResult.state;
      saveCreds = authResult.saveCreds;
      console.log("✅ MongoDB auth state loaded");
    } catch (error) {
      console.warn("⚠️ MongoDB auth failed, falling back to local file:", error.message);
      const fileAuth = await useMultiFileAuthState("./baileys_auth_info");
      state = fileAuth.state;
      saveCreds = fileAuth.saveCreds;
    }
  } else {
    console.log("📁 Using local file auth (MongoDB not available)");
    const fileAuth = await useMultiFileAuthState("./baileys_auth_info");
    state = fileAuth.state;
    saveCreds = fileAuth.saveCreds;
  }

  // 2. Fetch versi WhatsApp Web terbaru
  let version;
  try {
    const result = await fetchLatestBaileysVersion();
    version = result.version;
    console.log(`📱 WhatsApp Web version: ${version.join(".")}`);
  } catch {
    // Fallback jika gagal fetch
    version = [2, 3000, 1035194821];
    console.log("⚠️ Gagal fetch version, pakai fallback:", version.join("."));
  }

  // 3. Buat socket - TANPA Chromium/Puppeteer!
  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    browser: Browsers.ubuntu("Chrome"),
    // Tidak perlu keep-alive manual, Baileys sudah handle (30s default)
    markOnlineOnConnect: true,
    // Retry config
    retryRequestDelayMs: 250,
    maxMsgRetryCount: 5,
  });

  // 4. Bind store ke events
  store.bind(sock.ev);

  // 5. Process events
  sock.ev.process(async (events) => {
    // ---- CONNECTION UPDATE ----
    if (events["connection.update"]) {
      const update = events["connection.update"];
      const { connection, lastDisconnect, qr } = update;

      // QR Code - perlu scan
      if (qr) {
        console.log("📱 Scan QR Code:");
        qrcodeTerminal.generate(qr, { small: true });
        connectionState = "WAITING_QR";
        await sendQRToAdmins(qr);
      }

      // Connection terbuka - siap!
      if (connection === "open") {
        console.log("✅ WhatsApp siap dan terhubung!");
        connectionState = "CONNECTED";
        reconnectAttempts = 0;

        const phoneInfo = sock.user
          ? `${sock.user.id.split(":")[0]} (${sock.user.name || "Unknown"})`
          : "Unknown";
        console.log(`📱 Logged in as: ${phoneInfo}`);

        await notifyAdmins(
          "✅ *WhatsApp Terhubung!*\n\n" +
            "Bot WhatsApp sudah siap digunakan.\n" +
            "Ketik /start untuk membuka panel kontrol.",
        );

        waEvents.emit("ready");
      }

      // Connection tertutup - handle reconnect
      if (connection === "close") {
        const reason = lastDisconnect?.error?.output?.statusCode;
        connectionState = "DISCONNECTED";

        console.log(
          `⚠️ WhatsApp terputus. Reason code: ${reason || "unknown"}`,
        );

        if (reason === DisconnectReason.loggedOut) {
          // Permanent logout - perlu scan QR ulang
          console.error("❌ Session logged out! Perlu scan QR ulang.");
          connectionState = "AUTH_FAILURE";

          await notifyAdmins(
            "❌ *Autentikasi WhatsApp Gagal!*\n\n" +
              "Session expired atau tidak valid.\n" +
              "Silakan hapus folder `baileys_auth_info` dan restart bot untuk scan QR ulang.",
          );
        } else if (reason === DisconnectReason.connectionReplaced) {
          console.log(
            "⚠️ Koneksi diganti (perangkat lain login). Reconnecting...",
          );
          scheduleReconnect();
        } else if (reason === DisconnectReason.restartRequired) {
          console.log("🔄 Restart diperlukan, reconnecting...");
          scheduleReconnect();
        } else if (reason === DisconnectReason.multideviceMismatch) {
          console.error("❌ Multi-device mismatch. Perlu login ulang.");
          connectionState = "AUTH_FAILURE";
          await notifyAdmins(
            "❌ *Multi-device Mismatch!*\n\nHapus folder `baileys_auth_info` dan scan QR ulang.",
          );
        } else {
          // Transient disconnect - auto reconnect
          if (reason !== 428) {
            // 428 = connectionClosed, skip notification
            await notifyAdmins(
              `⚠️ *WhatsApp Terputus!*\n\nKode: ${reason || "unknown"}\n\n🔄 Reconnect otomatis...`,
            );
          }
          scheduleReconnect();
        }
      }
    }

    // ---- CREDENTIALS UPDATE ----
    if (events["creds.update"]) {
      await saveCreds();
    }
  });

  return sock;
}

// ============================================
// INITIALIZATION (entry point - dipanggil dari index.js)
// ============================================

/**
 * Inisialisasi WhatsApp Client
 * @param {object} bot - Telegram bot instance (untuk kirim QR & notifikasi)
 */
async function initWhatsApp(bot) {
  telegramBot = bot;

  try {
    console.log("🚀 Memulai WhatsApp Client (Baileys - No Chromium)...");
    await startSock();
    return sock;
  } catch (error) {
    console.error("❌ Error inisialisasi WhatsApp:", error.message);
    scheduleReconnect();
    return sock;
  }
}

// ============================================
// RECONNECT LOGIC
// ============================================

/**
 * Schedule reconnect dengan exponential backoff
 */
function scheduleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.log(
      "❌ Max reconnect tercapai. Menunggu 10 menit sebelum reset counter...",
    );
    notifyAdmins(
      "❌ *Gagal Reconnect WhatsApp!*\n\n" +
        `${MAX_RECONNECT_ATTEMPTS}x percobaan gagal.\n` +
        "Bot akan mencoba lagi dalam 10 menit.\n" +
        "Atau silakan restart bot manual.",
    );

    setTimeout(
      () => {
        console.log("🔄 Reset reconnect counter, mencoba lagi...");
        reconnectAttempts = 0;
        scheduleReconnect();
      },
      10 * 60 * 1000,
    );
    return;
  }

  reconnectAttempts++;
  const delay = Math.min(
    BASE_RECONNECT_DELAY * Math.pow(1.5, reconnectAttempts - 1),
    120000,
  );

  console.log(
    `🔄 Reconnect #${reconnectAttempts} dalam ${Math.round(delay / 1000)}s...`,
  );

  setTimeout(async () => {
    try {
      // End existing socket jika ada
      if (sock) {
        try {
          sock.end(undefined);
        } catch (e) {
          // ignore
        }
      }

      // Re-create socket
      await startSock();
    } catch (error) {
      console.error("❌ Reconnect gagal:", error.message);
      scheduleReconnect();
    }
  }, delay);
}

// ============================================
// QR CODE & NOTIFICATIONS
// ============================================

/**
 * Kirim QR Code ke semua admin via Telegram
 */
async function sendQRToAdmins(qr) {
  if (!telegramBot || adminChatIds.size === 0) return;

  try {
    const qrImagePath = "./qr-code.png";
    await qrcode.toFile(qrImagePath, qr, { width: 300, margin: 2 });

    const caption =
      `📱 *Scan QR Code WhatsApp*\n\n` +
      `1️⃣ Buka WhatsApp di HP\n` +
      `2️⃣ Tap Menu (⋮) → Perangkat Tertaut\n` +
      `3️⃣ Tap "Tautkan Perangkat"\n` +
      `4️⃣ Scan QR Code ini\n\n` +
      `⏳ QR berlaku 60 detik...`;

    for (const [userId, chatId] of adminChatIds.entries()) {
      try {
        await telegramBot.sendPhoto(chatId, qrImagePath, {
          caption,
          parse_mode: "Markdown",
        });
        console.log(`📤 QR dikirim ke admin ${userId}`);
      } catch (err) {
        console.error(`❌ Gagal kirim QR ke ${userId}:`, err.message);
      }
    }

    setTimeout(() => {
      if (fs.existsSync(qrImagePath)) fs.unlinkSync(qrImagePath);
    }, 3000);
  } catch (error) {
    console.error("❌ Error generate QR:", error.message);
  }
}

/**
 * Notifikasi ke semua admin via Telegram
 */
async function notifyAdmins(message) {
  if (!telegramBot || adminChatIds.size === 0) return;

  for (const [userId, chatId] of adminChatIds.entries()) {
    try {
      await telegramBot.sendMessage(chatId, message, {
        parse_mode: "Markdown",
      });
    } catch (err) {
      console.error(`❌ Gagal notifikasi ke ${userId}:`, err.message);
    }
  }
}

// ============================================
// PUBLIC API FUNCTIONS
// (Interface SAMA dengan versi whatsapp-web.js)
// ============================================

function setAdminChatId(userId, chatId) {
  adminChatIds.set(userId, chatId);
}

function removeAdminChatId(userId) {
  adminChatIds.delete(userId);
}

async function isConnected() {
  try {
    if (!sock || !sock.user) return false;
    return connectionState === "CONNECTED";
  } catch {
    return false;
  }
}

function getConnectionState() {
  return connectionState;
}

/**
 * Kirim pesan text ke WhatsApp
 * @param {string} to - JID tujuan (format: 628xxx@g.us atau 62xxx@s.whatsapp.net)
 * @param {string} message - Pesan text
 */
async function sendMessage(to, message) {
  if (!(await isConnected())) {
    throw new Error("WhatsApp tidak terhubung");
  }
  return sock.sendMessage(to, { text: message });
}

/**
 * Kirim pesan dengan hide tag (mention semua member tanpa terlihat)
 * @param {string} to - Group JID
 * @param {string} message - Pesan yang akan dikirim
 */
async function sendMessageWithHideTag(to, message) {
  if (!(await isConnected())) {
    throw new Error("WhatsApp tidak terhubung");
  }

  try {
    // Cek apakah ini grup (JID mengandung @g.us)
    if (!to.includes("@g.us")) {
      return sock.sendMessage(to, { text: message });
    }

    // Dapatkan metadata grup untuk participants
    const metadata = await sock.groupMetadata(to);
    const participants = metadata.participants || [];

    // Extract JID dari setiap participant
    const mentions = participants.map((p) => p.id);

    console.log(`📢 Hide tag: ${mentions.length} members akan di-mention`);

    // Kirim dengan mentions (hide tag - tidak ada @nama di text)
    return sock.sendMessage(to, { text: message, mentions });
  } catch (error) {
    console.error("❌ Error sendMessageWithHideTag:", error.message);
    // Fallback: kirim biasa tanpa mention
    return sock.sendMessage(to, { text: message });
  }
}

/**
 * Kirim media (image, video, document, dll)
 * @param {string} to - JID tujuan
 * @param {object} media - Konten media (Baileys format)
 * @param {object} options - Opsi tambahan
 */
async function sendMedia(to, media, options = {}) {
  if (!(await isConnected())) {
    throw new Error("WhatsApp tidak terhubung");
  }
  // Media object bisa berupa { image: buffer }, { video: url }, { document: path }, dll
  return sock.sendMessage(to, { ...media, ...options });
}

/**
 * Get daftar chats (dari in-memory store)
 */
async function getChats() {
  if (!(await isConnected())) return [];
  try {
    return Array.from(store.chats.values());
  } catch {
    return [];
  }
}

/**
 * Get daftar contacts (dari in-memory store)
 */
async function getContacts() {
  if (!(await isConnected())) return [];
  try {
    return Array.from(store.contacts.values());
  } catch {
    return [];
  }
}

/**
 * Cek apakah nomor terdaftar di WhatsApp
 * @param {string} number - Nomor telepon (format: 628xxx)
 */
async function isRegisteredUser(number) {
  if (!(await isConnected())) return false;
  try {
    const result = await sock.onWhatsApp(number);
    return result.length > 0 && result[0].exists;
  } catch {
    return false;
  }
}

/**
 * Logout dari WhatsApp (hapus session)
 */
async function logout() {
  try {
    if (sock) {
      await sock.logout();
      connectionState = "DISCONNECTED";
      console.log("🚪 WhatsApp logout berhasil");
    }
  } catch (error) {
    console.error("❌ Error logout:", error.message);
    throw error;
  }
}

/**
 * Destroy socket (cleanup)
 */
async function destroy() {
  try {
    if (sock) {
      sock.end(undefined);
      sock = null;
      connectionState = "DISCONNECTED";
    }
  } catch (error) {
    console.error("❌ Error destroy:", error.message);
  }
}

/**
 * Get socket instance (untuk akses advanced)
 */
function getClient() {
  return sock;
}

// ============================================
// GROUP MANAGEMENT
// ============================================

/**
 * Join grup WhatsApp menggunakan invite link
 * @param {string} inviteLink - Link invite grup (https://chat.whatsapp.com/xxxxx)
 */
async function joinGroupByInviteLink(inviteLink) {
  if (!(await isConnected())) {
    return { success: false, error: "WhatsApp tidak terhubung" };
  }

  try {
    const inviteCode = extractInviteCode(inviteLink);

    if (!inviteCode) {
      return { success: false, error: "Link invite tidak valid" };
    }

    console.log(`🔗 Mencoba join grup dengan code: ${inviteCode}`);

    // Accept invite - Baileys returns group JID
    const groupId = await sock.groupAcceptInvite(inviteCode);

    console.log(`✅ Berhasil join grup: ${groupId}`);

    // Format group ID
    const formattedGroupId = groupId.includes("@g.us")
      ? groupId
      : `${groupId}@g.us`;

    return {
      success: true,
      groupId: formattedGroupId,
    };
  } catch (error) {
    console.error("❌ Error join grup:", error.message);
    return {
      success: false,
      error: error.message || "Gagal join grup",
    };
  }
}

/**
 * Extract invite code dari link WhatsApp
 * @param {string} link - Link invite
 * @returns {string|null} - Invite code atau null
 */
function extractInviteCode(link) {
  try {
    const match = link.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Dapatkan Group Info dari link invite (tanpa join)
 * @param {string} inviteLink - Link invite
 */
async function getGroupInfoFromInviteLink(inviteLink) {
  if (!(await isConnected())) {
    return { success: false, error: "WhatsApp tidak terhubung" };
  }

  try {
    const inviteCode = extractInviteCode(inviteLink);

    if (!inviteCode) {
      return { success: false, error: "Link invite tidak valid" };
    }

    // Get invite info - Baileys returns group metadata
    const inviteInfo = await sock.groupGetInviteInfo(inviteCode);

    return {
      success: true,
      groupId: inviteInfo.id,
      groupName: inviteInfo.subject,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || "Gagal mendapatkan info grup",
    };
  }
}

// ============================================
// EXPORTS (Interface SAMA persis dengan versi lama)
// ============================================

module.exports = {
  initWhatsApp,
  setAdminChatId,
  removeAdminChatId,
  isConnected,
  getConnectionState,
  sendMessage,
  sendMessageWithHideTag,
  sendMedia,
  getChats,
  getContacts,
  isRegisteredUser,
  logout,
  destroy,
  getClient,
  waEvents,
  joinGroupByInviteLink,
  getGroupInfoFromInviteLink,
  extractInviteCode,
};
