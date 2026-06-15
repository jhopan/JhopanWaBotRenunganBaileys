/**
 * Telegram Bot - Control Panel
 * Panel kontrol untuk mengatur WhatsApp Bot
 * Fokus: Renungan Harian Multi-Group (Optimized for GCP Free Tier)
 *
 * MODE:
 * - Webhook: Hemat bandwidth (recommended untuk GCP free tier)
 * - Polling: Fallback jika tidak ada WEBHOOK_URL
 */

const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const fs = require("fs-extra");
const moment = require("moment-timezone");
const wa = require("./botWhatsApp");
const renungan = require("./renunganHandler");
const { testAIConnection, getProvider } = require("./services/aiService");
const {
  loadConfig,
  saveConfig,
  setRenunganGroupId,
  setRenunganTime,
  toggleHideTag,
  toggleMultiGroup,
  addRenunganGroup,
  removeRenunganGroup,
  setMultiGroupDelay,
} = require("./utils/configManager");

moment.tz.setDefault(process.env.TIMEZONE || "Asia/Makassar");

// ============================================
// BOT MODE: WEBHOOK vs POLLING
// ============================================
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || null;
const WEBHOOK_URL = process.env.WEBHOOK_URL || RENDER_URL || null;
const WEBHOOK_PORT = parseInt(process.env.PORT || process.env.WEBHOOK_PORT || "3000");
const USE_WEBHOOK = !!WEBHOOK_URL;
const IS_RENDER = !!process.env.RENDER;

// Inisialisasi bot - NO polling jika pakai webhook
let bot;
let expressApp = null;

if (USE_WEBHOOK) {
  // Webhook mode - HEMAT BANDWIDTH
  console.log("🌐 Telegram Bot Mode: WEBHOOK (hemat bandwidth)");
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
} else {
  // Polling mode - Fallback
  console.log("🔄 Telegram Bot Mode: POLLING (development mode)");
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
    polling: {
      interval: 2000, // 2 detik (lebih hemat dari 1 detik)
      autoStart: false, // Manual start
      params: {
        timeout: 30, // Long polling 30 detik (lebih hemat)
      },
    },
  });
}

// Retry state untuk koneksi
let pollingRetries = 0;
const MAX_POLLING_RETRIES = 10;
const POLLING_RETRY_DELAY = 5000;

// Internet connection state
let isOnline = true;
let reconnectTimeout = null;

// Admin IDs
const ADMIN_IDS = process.env.ADMIN_TELEGRAM_IDS
  ? process.env.ADMIN_TELEGRAM_IDS.split(",").map((id) => parseInt(id.trim()))
  : [];

// Simpan preview message untuk setiap user
const previewMessages = new Map();

// State management
const userStates = new Map();

// ============================================
// HELPER FUNCTIONS
// ============================================

function isAdmin(userId) {
  return ADMIN_IDS.includes(userId);
}

function denyAccess(chatId) {
  bot.sendMessage(
    chatId,
    "❌ *Akses Ditolak*\n\nAnda tidak memiliki izin untuk menggunakan bot ini.",
    { parse_mode: "Markdown" },
  );
}

function getStatusEmoji(connected) {
  return connected ? "🟢" : "🔴";
}

/**
 * Escape markdown untuk Telegram (v1)
 * Menghandle underscore, asterisk, dll
 */
function escapeMarkdown(text) {
  if (!text) return "";
  // Untuk markdown v1, escape karakter khusus dalam context italic
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

/**
 * Safe send message dengan HTML fallback
 */
async function safeSendMessage(chatId, text, options = {}) {
  try {
    return await bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      ...options,
    });
  } catch (error) {
    if (error.message.includes("parse entities")) {
      // Fallback: kirim tanpa formatting
      const plainText = text
        .replace(/\*/g, "")
        .replace(/_/g, "")
        .replace(/`/g, "");
      return await bot.sendMessage(chatId, plainText, options);
    }
    throw error;
  }
}

/**
 * Safe edit message dengan error handling
 */
async function safeEditMessage(text, options) {
  try {
    return await bot.editMessageText(text, {
      parse_mode: "Markdown",
      ...options,
    });
  } catch (error) {
    if (error.message.includes("parse entities")) {
      const plainText = text
        .replace(/\*/g, "")
        .replace(/_/g, "")
        .replace(/`/g, "");
      return await bot.editMessageText(plainText, options);
    }
    throw error;
  }
}

// ============================================
// MAIN MENU
// ============================================

const mainMenuKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [{ text: "📖 Renungan Harian", callback_data: "menu_renungan" }],
      [{ text: "⚙️ Pengaturan", callback_data: "menu_settings" }],
      [{ text: "📊 Status Bot", callback_data: "menu_status" }],
    ],
  },
};

async function showMainMenu(chatId, userId) {
  const waConnected = await wa.isConnected();
  const status = getStatusEmoji(waConnected);

  const message = `🤖 *Panel Kontrol WhatsApp Bot*

${status} WhatsApp: ${waConnected ? "Terhubung" : "Tidak Terhubung"}
📅 Tanggal: ${moment().format("dddd, DD MMMM YYYY")}
⏰ Waktu: ${moment().format("HH:mm")} WITA

Pilih menu di bawah:`;

  return safeSendMessage(chatId, message, mainMenuKeyboard);
}

async function editToMainMenu(chatId, messageId) {
  const waConnected = await wa.isConnected();
  const status = getStatusEmoji(waConnected);

  const message = `🤖 *Panel Kontrol WhatsApp Bot*

${status} WhatsApp: ${waConnected ? "Terhubung" : "Tidak Terhubung"}
📅 Tanggal: ${moment().format("dddd, DD MMMM YYYY")}
⏰ Waktu: ${moment().format("HH:mm")} WITA

Pilih menu di bawah:`;

  return safeEditMessage(message, {
    chat_id: chatId,
    message_id: messageId,
    ...mainMenuKeyboard,
  });
}

// ============================================
// COMMAND HANDLERS
// ============================================

bot.onText(/\/start/, async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;

  if (!isAdmin(userId)) {
    return denyAccess(chatId);
  }

  wa.setAdminChatId(userId, chatId);

  const waConnected = await wa.isConnected();

  if (!waConnected) {
    return safeSendMessage(
      chatId,
      `👋 *Selamat Datang!*\n\n⚠️ WhatsApp belum terhubung.\n\nKlik tombol di bawah untuk login.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📱 Login WhatsApp", callback_data: "wa_login" }],
          ],
        },
      },
    );
  }

  await showMainMenu(chatId, userId);
});

bot.onText(/\/status/, async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  if (!isAdmin(userId)) return denyAccess(chatId);
  await showStatus(chatId);
});

bot.onText(/\/renungan/, async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  if (!isAdmin(userId)) return denyAccess(chatId);
  await showRenunganMenu(chatId, null);
});

bot.onText(/\/testai/, async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  if (!isAdmin(userId)) return denyAccess(chatId);

  await safeSendMessage(chatId, "⏳ Testing AI connection...");

  const result = await testAIConnection();

  if (result.success) {
    await safeSendMessage(
      chatId,
      `✅ *AI Connected!*\n\nModel: ${result.model}`,
    );
  } else {
    await safeSendMessage(chatId, `❌ *AI Error*\n\n${result.error}`);
  }
});

// ============================================
// CALLBACK HANDLERS
// ============================================

bot.on("callback_query", async (query) => {
  const userId = query.from.id;
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;

  if (!isAdmin(userId)) {
    bot.answerCallbackQuery(query.id, {
      text: "❌ Akses ditolak!",
      show_alert: true,
    });
    return;
  }

  bot.answerCallbackQuery(query.id);

  try {
    if (data === "back_main") {
      return editToMainMenu(chatId, messageId);
    }

    if (data.startsWith("menu_")) {
      return handleMenuCallback(data, chatId, messageId, userId);
    }

    if (data.startsWith("renungan_")) {
      return handleRenunganCallback(data, chatId, messageId, userId);
    }

    if (data.startsWith("settings_")) {
      return handleSettingsCallback(data, chatId, messageId, userId);
    }

    if (data.startsWith("wa_")) {
      return handleWACallback(data, chatId, messageId, userId);
    }

    if (data.startsWith("verse_")) {
      return handleVerseCallback(data, chatId, messageId, userId);
    }

    if (data.startsWith("cat_")) {
      return handleCategoryCallback(data, chatId, messageId, userId);
    }

    if (data.startsWith("time_")) {
      return handleTimeCallback(data, chatId, messageId, userId);
    }
  } catch (error) {
    console.error("❌ Callback error:", error.message);
    safeSendMessage(chatId, `❌ Error: ${error.message}`);
  }
});

async function handleMenuCallback(data, chatId, messageId) {
  switch (data) {
    case "menu_renungan":
      return showRenunganMenu(chatId, messageId);
    case "menu_settings":
      return showSettingsMenu(chatId, messageId);
    case "menu_status":
      return showStatus(chatId, messageId);
  }
}

// ============================================
// RENUNGAN MENU
// ============================================

async function showRenunganMenu(chatId, messageId) {
  const stats = await renungan.getVersesStats();
  const config = await loadConfig();

  const groupDisplay = config.renunganGroupId || "Belum diatur";
  const hideTagStatus = config.hideTagEnabled ? "🟢 ON" : "🔴 OFF";
  const multiGroupStatus = config.multiGroupEnabled ? "🟢 ON" : "🔴 OFF";
  const groupCount = config.renunganGroups?.length || 0;

  const message = `📖 *Menu Renungan Harian*

⏰ Jadwal: ${config.renunganTime || "08:00"} WITA
👥 Group Utama: ${groupDisplay.substring(0, 20)}...

📢 Hide Tag: ${hideTagStatus}
📡 Multi-Group: ${multiGroupStatus} (${groupCount} grup)

📊 Statistik Ayat:
• Total: ${stats.total} ayat
• Sudah dipakai: ${stats.used}
• Belum dipakai: ${stats.unused}

Pilih aksi:`;

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📤 Kirim Sekarang", callback_data: "renungan_send_now" }],
        [{ text: "👀 Preview Renungan", callback_data: "renungan_preview" }],
        [
          {
            text: `📢 Hide Tag: ${hideTagStatus}`,
            callback_data: "renungan_toggle_hidetag",
          },
        ],
        [
          {
            text: `📡 Multi-Group: ${multiGroupStatus}`,
            callback_data: "renungan_multigroup_menu",
          },
        ],
        [
          {
            text: "📝 Lihat Daftar Ayat",
            callback_data: "renungan_list_verses",
          },
        ],
        [{ text: "➕ Tambah Ayat Baru", callback_data: "renungan_add_verse" }],
        [{ text: "🔄 Reset Status Ayat", callback_data: "renungan_reset" }],
        [{ text: "⏰ Atur Jadwal", callback_data: "settings_renungan_time" }],
        [{ text: "⬅️ Kembali", callback_data: "back_main" }],
      ],
    },
  };

  if (messageId) {
    return safeEditMessage(message, {
      chat_id: chatId,
      message_id: messageId,
      ...keyboard,
    });
  }

  return safeSendMessage(chatId, message, keyboard);
}

async function handleRenunganCallback(data, chatId, messageId, userId) {
  switch (data) {
    case "renungan_send_now":
      await safeEditMessage("⏳ *Mengirim renungan...*", {
        chat_id: chatId,
        message_id: messageId,
      });

      // Cek apakah ada preview message yang disimpan
      const savedPreview = previewMessages.get(userId);
      let sendResult;

      if (savedPreview && Date.now() - savedPreview.timestamp < 3600000) {
        // Gunakan preview yang sudah dibuat (valid 1 jam)
        sendResult = await renungan.sendRenunganWithMessage(
          savedPreview.message,
        );
        // Tambahkan data verse dari preview
        sendResult.verse = savedPreview.verse;
        sendResult.specialDay = savedPreview.specialDay;
        // Hapus preview setelah dikirim
        previewMessages.delete(userId);
      } else {
        // Generate baru jika tidak ada preview atau sudah expired
        sendResult = await renungan.sendRenungan();
      }

      if (sendResult.success) {
        const specialText = sendResult.specialDay
          ? `\n🎉 Hari Spesial: ${sendResult.specialDay}`
          : "";
        await safeEditMessage(
          `✅ *Renungan Terkirim!*\n\n📖 Ayat: ${sendResult.verse}${specialText}`,
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
              inline_keyboard: [
                [{ text: "⬅️ Kembali", callback_data: "menu_renungan" }],
              ],
            },
          },
        );
      } else {
        await safeEditMessage(
          `❌ *Gagal Kirim Renungan*\n\n${sendResult.error}`,
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
              inline_keyboard: [
                [{ text: "⬅️ Kembali", callback_data: "menu_renungan" }],
              ],
            },
          },
        );
      }
      break;

    case "renungan_preview":
      await safeEditMessage(
        "⏳ *Generating preview...*\n\nAI sedang membuat renungan...",
        {
          chat_id: chatId,
          message_id: messageId,
        },
      );

      const preview = await renungan.previewRenungan();

      if (preview.success) {
        // Simpan preview message untuk user ini
        previewMessages.set(userId, {
          message: preview.message,
          verse: preview.verse,
          specialDay: preview.specialDay,
          timestamp: Date.now(),
        });

        // Kirim preview tanpa markdown karena sudah diformat untuk WhatsApp
        await bot.sendMessage(chatId, preview.message);

        const specialText = preview.specialDay
          ? `\n🎉 Hari Spesial: ${preview.specialDay}`
          : "";
        await safeEditMessage(
          `✅ *Preview Generated*\n\n📖 Ayat: ${preview.verse}${specialText}`,
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
              inline_keyboard: [
                [{ text: "📤 Kirim Ini", callback_data: "renungan_send_now" }],
                [{ text: "⬅️ Kembali", callback_data: "menu_renungan" }],
              ],
            },
          },
        );
      } else {
        await safeEditMessage(
          `❌ *Gagal Generate Preview*\n\n${preview.error}`,
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
              inline_keyboard: [
                [{ text: "⬅️ Kembali", callback_data: "menu_renungan" }],
              ],
            },
          },
        );
      }
      break;

    case "renungan_list_verses":
      return showCategoryMenu(chatId, messageId);

    case "renungan_add_verse":
      userStates.set(userId, { action: "add_verse", step: "verse", data: {} });
      await safeEditMessage(
        `➕ *Tambah Ayat Baru*\n\nKirim alamat ayat (contoh: Yohanes 3:16)\n\nKetik "batal" untuk membatalkan.`,
        { chat_id: chatId, message_id: messageId },
      );
      break;

    case "renungan_reset":
      const resetResult = await renungan.resetVerses();

      if (resetResult.success) {
        await safeEditMessage(
          `✅ *Status ayat berhasil direset!*\n\n📖 Total ayat: ${resetResult.total}\n📅 Tahun: ${resetResult.year}\n\n✨ Semua ayat ditandai belum dipakai dan siap digunakan kembali dari awal.`,
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
              inline_keyboard: [
                [{ text: "⬅️ Kembali", callback_data: "menu_renungan" }],
              ],
            },
          },
        );
      } else {
        await safeEditMessage(`❌ *Gagal reset ayat*\n\n${resetResult.error}`, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [{ text: "⬅️ Kembali", callback_data: "menu_renungan" }],
            ],
          },
        });
      }
      break;

    case "renungan_toggle_hidetag":
      const newConfigHT = await toggleHideTag();
      const htStatus = newConfigHT.hideTagEnabled ? "🟢 ON" : "🔴 OFF";
      await safeSendMessage(
        chatId,
        `📢 *Hide Tag* berhasil diubah ke ${htStatus}\n\n${
          newConfigHT.hideTagEnabled
            ? "Semua member akan di-mention (tidak terlihat) saat renungan dikirim."
            : "Renungan akan dikirim tanpa mention."
        }`,
      );
      return showRenunganMenu(chatId, null);

    case "renungan_multigroup_menu":
      return showMultiGroupMenu(chatId, messageId);

    case "renungan_toggle_multigroup":
      const newConfigMG = await toggleMultiGroup();
      const mgStatus = newConfigMG.multiGroupEnabled ? "🟢 ON" : "🔴 OFF";
      await safeSendMessage(
        chatId,
        `📡 *Multi-Group* berhasil diubah ke ${mgStatus}\n\n${
          newConfigMG.multiGroupEnabled
            ? "Renungan akan dikirim ke beberapa grup dengan delay."
            : "Renungan hanya dikirim ke grup utama."
        }`,
      );
      return showMultiGroupMenu(chatId, null);

    case "renungan_add_group":
      userStates.set(userId, { action: "add_renungan_group" });
      await safeEditMessage(
        `➕ *Tambah Grup Renungan*\n\nKirim link invite atau Group ID:\n\n• https://chat.whatsapp.com/xxxxx\n• 6281234567890-1234567890@g.us\n\nKetik "batal" untuk membatalkan.`,
        { chat_id: chatId, message_id: messageId },
      );
      break;

    case "renungan_list_groups":
      return showRenunganGroupsList(chatId, messageId);

    case "renungan_set_delay":
      userStates.set(userId, { action: "set_multigroup_delay" });
      await safeEditMessage(
        `⏱️ *Atur Delay Multi-Group*\n\nMasukkan delay dalam menit (1-10):\n\nContoh: 2\n\nKetik "batal" untuk membatalkan.`,
        { chat_id: chatId, message_id: messageId },
      );
      break;

    default:
      // Handle remove group callback
      if (data.startsWith("renungan_remove_group_")) {
        const index = parseInt(data.replace("renungan_remove_group_", ""));
        const config = await loadConfig();
        const groups = config.renunganGroups || [];

        if (index >= 0 && index < groups.length) {
          const removedGroup = groups[index];
          await removeRenunganGroup(removedGroup.id);
          await safeSendMessage(
            chatId,
            `✅ Grup berhasil dihapus: ${removedGroup.name || removedGroup.id.substring(0, 20)}...`,
          );
        }
        return showRenunganGroupsList(chatId, null);
      }
      break;
  }
}

/**
 * Tampilkan menu Multi-Group
 */
async function showMultiGroupMenu(chatId, messageId) {
  const config = await loadConfig();
  const multiGroupStatus = config.multiGroupEnabled ? "🟢 ON" : "🔴 OFF";
  const groups = config.renunganGroups || [];
  const delay = config.multiGroupDelayMinutes || 2;

  let groupList = "Tidak ada grup tambahan";
  if (groups.length > 0) {
    groupList = groups
      .map((g, i) => `${i + 1}. ${g.name || g.id.substring(0, 20)}...`)
      .join("\n");
  }

  const message = `📡 *Menu Multi-Group*

Status: ${multiGroupStatus}
Delay: ${delay} menit antar grup

📋 Daftar Grup Tambahan:
${groupList}

_Grup utama: ${(config.renunganGroupId || "Belum diatur").substring(0, 20)}..._`;

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: `${config.multiGroupEnabled ? "🔴 Matikan" : "🟢 Aktifkan"} Multi-Group`,
            callback_data: "renungan_toggle_multigroup",
          },
        ],
        [{ text: "➕ Tambah Grup", callback_data: "renungan_add_group" }],
        [
          {
            text: "📋 Lihat/Hapus Grup",
            callback_data: "renungan_list_groups",
          },
        ],
        [{ text: "⏱️ Atur Delay", callback_data: "renungan_set_delay" }],
        [{ text: "⬅️ Kembali", callback_data: "menu_renungan" }],
      ],
    },
  };

  if (messageId) {
    return safeEditMessage(message, {
      chat_id: chatId,
      message_id: messageId,
      ...keyboard,
    });
  }

  return safeSendMessage(chatId, message, keyboard);
}

/**
 * Tampilkan daftar grup renungan
 */
async function showRenunganGroupsList(chatId, messageId) {
  const config = await loadConfig();
  const groups = config.renunganGroups || [];

  if (groups.length === 0) {
    const message = `📋 *Daftar Grup Renungan*\n\nBelum ada grup tambahan.\nKlik tombol di bawah untuk menambah grup.`;

    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "➕ Tambah Grup", callback_data: "renungan_add_group" }],
          [{ text: "⬅️ Kembali", callback_data: "renungan_multigroup_menu" }],
        ],
      },
    };

    if (messageId) {
      return safeEditMessage(message, {
        chat_id: chatId,
        message_id: messageId,
        ...keyboard,
      });
    }
    return safeSendMessage(chatId, message, keyboard);
  }

  let message = `📋 *Daftar Grup Renungan*\n\n`;
  message += groups
    .map(
      (g, i) =>
        `${i + 1}. ${g.name || "Grup"}\n   ID: ${g.id.substring(0, 25)}...`,
    )
    .join("\n\n");

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        ...groups.map((g, i) => [
          {
            text: `🗑️ Hapus: ${(g.name || g.id).substring(0, 15)}...`,
            callback_data: `renungan_remove_group_${i}`,
          },
        ]),
        [{ text: "➕ Tambah Grup", callback_data: "renungan_add_group" }],
        [{ text: "⬅️ Kembali", callback_data: "renungan_multigroup_menu" }],
      ],
    },
  };

  if (messageId) {
    return safeEditMessage(message, {
      chat_id: chatId,
      message_id: messageId,
      ...keyboard,
    });
  }
  return safeSendMessage(chatId, message, keyboard);
}

/**
 * Tampilkan menu kategori ayat
 */
async function showCategoryMenu(chatId, messageId) {
  const verses = await renungan.getAllVerses();

  // Hitung jumlah ayat per kategori
  const categoryCount = {};
  verses.forEach((v) => {
    const cat = v.category || "umum";
    categoryCount[cat] = (categoryCount[cat] || 0) + 1;
  });

  // Nama kategori yang lebih ramah
  const categoryNames = {
    kasih: "❤️ Kasih",
    iman: "✝️ Iman",
    harapan: "✨ Harapan",
    kekuatan: "💪 Kekuatan",
    penghiburan: "🤗 Penghiburan",
    doa: "🙏 Doa",
    hikmat: "⚖️ Hikmat",
    damai: "🕊️ Damai Sejahtera",
    pertobatan: "🔥 Pertobatan",
    pertumbuhan_rohani: "🌱 Pertumbuhan Rohani",
    umum: "📖 Umum",
  };

  let message = "📚 *Pilih Kategori Ayat*\n\n";

  const keyboard = [];

  // Urutkan kategori berdasarkan jumlah ayat (terbanyak di atas)
  const sortedCategories = Object.entries(categoryCount).sort(
    (a, b) => b[1] - a[1],
  );

  // Buat tombol kategori (2 kolom)
  for (let i = 0; i < sortedCategories.length; i += 2) {
    const row = [];

    const cat1 = sortedCategories[i][0];
    const count1 = sortedCategories[i][1];
    row.push({
      text: `${categoryNames[cat1] || cat1} (${count1})`,
      callback_data: `verses_cat_${cat1}`,
    });

    if (i + 1 < sortedCategories.length) {
      const cat2 = sortedCategories[i + 1][0];
      const count2 = sortedCategories[i + 1][1];
      row.push({
        text: `${categoryNames[cat2] || cat2} (${count2})`,
        callback_data: `verses_cat_${cat2}`,
      });
    }

    keyboard.push(row);
  }

  // Tombol "Semua Ayat"
  keyboard.push([
    {
      text: `📜 Semua Ayat (${verses.length})`,
      callback_data: "verses_cat_all",
    },
  ]);

  keyboard.push([
    {
      text: "⬅️ Kembali",
      callback_data: "menu_renungan",
    },
  ]);

  return safeEditMessage(message, {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: {
      inline_keyboard: keyboard,
    },
  });
}

async function showVersesList(chatId, messageId, page, category = null) {
  const allVerses = await renungan.getAllVerses();

  // Filter berdasarkan kategori jika ada
  const verses =
    category && category !== "all"
      ? allVerses.filter((v) => v.category === category)
      : allVerses;

  const perPage = 5;
  const totalPages = Math.ceil(verses.length / perPage);
  const start = page * perPage;
  const end = start + perPage;
  const pageVerses = verses.slice(start, end);

  // Nama kategori untuk header
  const categoryNames = {
    kasih: "❤️ Kasih",
    iman: "✝️ Iman",
    harapan: "✨ Harapan",
    kekuatan: "💪 Kekuatan",
    penghiburan: "🤗 Penghiburan",
    doa: "🙏 Doa",
    hikmat: "⚖️ Hikmat",
    damai: "🕊️ Damai Sejahtera",
    pertobatan: "🔥 Pertobatan",
    pertumbuhan_rohani: "🌱 Pertumbuhan Rohani",
    umum: "📖 Umum",
  };

  const categoryTitle =
    category && category !== "all"
      ? categoryNames[category] || category
      : "📜 Semua Kategori";

  // Format tanpa underscore yang menyebabkan error
  let message = `📝 *Daftar Ayat*\n${categoryTitle}\n\nHalaman ${
    page + 1
  }/${totalPages}\n\n`;

  pageVerses.forEach((v, i) => {
    const status = v.used ? "✅" : "⭕";
    message += `${status} ${start + i + 1}. ${v.verse}\n`;
    if (category === "all" || !category) {
      // Tampilkan kategori jika melihat semua ayat
      const cat = v.category || "umum";
      const safeCat = cat.replace(/_/g, " ");
      message += `   📁 ${safeCat}\n`;
    }
    message += `\n`;
  });

  const navButtons = [];
  if (page > 0) {
    navButtons.push({
      text: "⬅️ Prev",
      callback_data: category
        ? `verse_cat_${category}_page_${page - 1}`
        : `verse_page_${page - 1}`,
    });
  }
  if (page < totalPages - 1) {
    navButtons.push({
      text: "Next ➡️",
      callback_data: category
        ? `verse_cat_${category}_page_${page + 1}`
        : `verse_page_${page + 1}`,
    });
  }

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        navButtons.length > 0 ? navButtons : [],
        [
          {
            text: "🔙 Pilih Kategori Lain",
            callback_data: "renungan_list_verses",
          },
        ],
        [{ text: "➕ Tambah Ayat", callback_data: "renungan_add_verse" }],
        [{ text: "⬅️ Menu Utama", callback_data: "menu_renungan" }],
      ].filter((row) => row.length > 0),
    },
  };

  // Kirim tanpa parse_mode karena tidak ada formatting
  return bot.editMessageText(message, {
    chat_id: chatId,
    message_id: messageId,
    ...keyboard,
  });
}

async function handleVerseCallback(data, chatId, messageId) {
  // Handle category selection
  if (data.startsWith("verses_cat_")) {
    const category = data.replace("verses_cat_", "");
    return showVersesList(chatId, messageId, 0, category);
  }

  // Handle pagination with category
  if (data.includes("_cat_") && data.includes("_page_")) {
    const parts = data.replace("verse_cat_", "").split("_page_");
    const category = parts[0];
    const page = parseInt(parts[1]);
    return showVersesList(chatId, messageId, page, category);
  }

  // Handle pagination without category
  if (data.startsWith("verse_page_")) {
    const page = parseInt(data.replace("verse_page_", ""));
    return showVersesList(chatId, messageId, page);
  }

  if (data.startsWith("verse_delete_")) {
    const id = parseInt(data.replace("verse_delete_", ""));
    await renungan.deleteVerse(id);
    return showVersesList(chatId, messageId, 0);
  }
}

async function handleCategoryCallback(data, chatId, messageId, userId) {
  const category = data.replace("cat_", "");
  const state = userStates.get(userId);

  if (!state || state.action !== "add_verse") return;

  const result = await renungan.addVerse(state.data.verse, category);

  userStates.delete(userId);

  if (result.success) {
    await safeSendMessage(
      chatId,
      `✅ *Ayat Berhasil Ditambahkan!*\n\n📖 ${state.data.verse}\n📁 Kategori: ${category}`,
    );
  } else {
    await safeSendMessage(
      chatId,
      `❌ *Gagal Menambahkan Ayat*\n\n${result.error}`,
    );
  }

  await showRenunganMenu(chatId, null);
}

// ============================================
// SETTINGS MENU
// ============================================

async function showSettingsMenu(chatId, messageId) {
  const config = await loadConfig();
  const waConnected = await wa.isConnected();

  const message = `⚙️ *Pengaturan Bot*

📱 WhatsApp: ${waConnected ? "Terhubung" : "Tidak Terhubung"}

📖 Renungan:
• Waktu: ${config.renunganTime || "08:00"} WITA
• Grup Utama: ${config.renunganGroupId ? config.renunganGroupName || "Sudah diatur" : "❌ Belum diatur"}
• Multi-Group: ${config.multiGroupEnabled ? "🟢 ON" : "🔴 OFF"}

🤖 AI Provider: ${getProvider().toUpperCase()}
💡 Model: ${process.env.AI_MODEL || "gemini-pro"}

Pilih pengaturan:`;

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "📖 Atur Group Renungan",
            callback_data: "settings_renungan_group",
          },
        ],
        [
          {
            text: "⏰ Atur Jadwal Renungan",
            callback_data: "settings_renungan_time",
          },
        ],
        [{ text: "🤖 Test AI Connection", callback_data: "settings_test_ai" }],
        [{ text: "📱 WhatsApp Login/Logout", callback_data: "settings_wa" }],
        [{ text: "⬅️ Kembali", callback_data: "back_main" }],
      ],
    },
  };

  if (messageId) {
    return safeEditMessage(message, {
      chat_id: chatId,
      message_id: messageId,
      ...keyboard,
    });
  }

  return safeSendMessage(chatId, message, keyboard);
}

async function handleSettingsCallback(data, chatId, messageId, userId) {
  switch (data) {
    case "settings_renungan_group":
      userStates.set(userId, { action: "set_renungan_group" });
      await safeEditMessage(
        `⚙️ *Atur Grup Utama Renungan*

💡 *Cara Setting:*

1️⃣ *Invite bot ke grup WhatsApp terlebih dahulu*
   (Jika belum)

2️⃣ *Kirim salah satu dari:*

   📱 *Link Invite WhatsApp*
   https://chat.whatsapp.com/xxxxx
   _Bot akan ambil info grup otomatis_

   🆔 *Group ID Manual*
   Format: 6281234567890-1234567890@g.us
   _Cara dapat: Buka grup \u2192 Info \u2192 scroll bawah_

⚠️ *Catatan:* Bot TIDAK akan auto-join. Pastikan bot sudah ada di grup!

Ketik "batal" untuk membatalkan.`,
        { chat_id: chatId, message_id: messageId },
      );
      break;

    case "settings_renungan_time":
      await safeEditMessage(
        "⏰ *Pilih Waktu Renungan*\n\nPilih jam pengiriman renungan harian:",
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [
                { text: "06:00", callback_data: "time_renungan_06:00" },
                { text: "07:00", callback_data: "time_renungan_07:00" },
                { text: "08:00", callback_data: "time_renungan_08:00" },
              ],
              [
                { text: "09:00", callback_data: "time_renungan_09:00" },
                { text: "10:00", callback_data: "time_renungan_10:00" },
              ],
              [{ text: "⬅️ Kembali", callback_data: "menu_settings" }],
            ],
          },
        },
      );
      break;

    case "settings_test_ai":
      await safeEditMessage("⏳ Testing AI connection...", {
        chat_id: chatId,
        message_id: messageId,
      });

      const aiResult = await testAIConnection();

      if (aiResult.success) {
        await safeEditMessage(
          `✅ *AI Connected!*\n\nModel: ${aiResult.model}`,
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
              inline_keyboard: [
                [{ text: "⬅️ Kembali", callback_data: "menu_settings" }],
              ],
            },
          },
        );
      } else {
        await safeEditMessage(`❌ *AI Error*\n\n${aiResult.error}`, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [{ text: "⬅️ Kembali", callback_data: "menu_settings" }],
            ],
          },
        });
      }
      break;

    case "settings_wa":
      const waConnected = await wa.isConnected();

      if (waConnected) {
        await safeEditMessage(
          `📱 *WhatsApp Terhubung*\n\nApakah Anda ingin logout?`,
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
              inline_keyboard: [
                [{ text: "🚪 Logout", callback_data: "wa_logout" }],
                [{ text: "⬅️ Kembali", callback_data: "menu_settings" }],
              ],
            },
          },
        );
      } else {
        await safeEditMessage(
          `📱 *WhatsApp Tidak Terhubung*\n\nKlik untuk login:`,
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
              inline_keyboard: [
                [{ text: "📱 Login WhatsApp", callback_data: "wa_login" }],
                [{ text: "⬅️ Kembali", callback_data: "menu_settings" }],
              ],
            },
          },
        );
      }
      break;
  }
}

async function handleTimeCallback(data, chatId, messageId) {
  // Format: time_renungan_08:00
  const parts = data.replace("time_", "").split("_");
  const type = parts[0]; // renungan
  const time = parts[1]; // 08:00

  const config = await loadConfig();

  try {
    if (type === "renungan") {
      config.renunganTime = time;
      await saveConfig(config);

      // Restart scheduler langsung tanpa restart bot
      renungan.restartRenunganScheduler(time);

      await safeEditMessage(
        `✅ *Jadwal Renungan Diperbarui!*\n\nWaktu: ${time} WITA\n\n✨ Scheduler sudah aktif, tidak perlu restart bot!`,
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [{ text: "⬅️ Kembali", callback_data: "menu_settings" }],
            ],
          },
        },
      );
    }
  } catch (error) {
    await safeEditMessage(`❌ *Gagal Update Jadwal*\n\n${error.message}`, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: [
          [{ text: "⬅️ Kembali", callback_data: "menu_settings" }],
        ],
      },
    });
  }
}

async function handleWACallback(data, chatId, messageId, userId) {
  switch (data) {
    case "wa_login":
      wa.setAdminChatId(userId, chatId);
      await safeEditMessage(
        `📱 *Login WhatsApp*\n\n⏳ Menunggu QR Code...\n\nQR akan dikirim dalam beberapa saat.`,
        {
          chat_id: chatId,
          message_id: messageId,
        },
      );
      break;

    case "wa_logout":
      try {
        await wa.logout();
        await safeEditMessage(
          `✅ *Logout Berhasil*\n\nWhatsApp telah terputus.`,
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
              inline_keyboard: [
                [{ text: "⬅️ Kembali", callback_data: "menu_settings" }],
              ],
            },
          },
        );
      } catch (error) {
        await safeEditMessage(`❌ *Gagal Logout*\n\n${error.message}`, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [{ text: "⬅️ Kembali", callback_data: "menu_settings" }],
            ],
          },
        });
      }
      break;
  }
}

// ============================================
// STATUS
// ============================================

async function showStatus(chatId, messageId = null) {
  const waConnected = await wa.isConnected();
  const waState = wa.getConnectionState();
  const stats = await renungan.getVersesStats();
  const config = await loadConfig();

  // Memory usage
  const used = process.memoryUsage();
  const heapMB = Math.round(used.heapUsed / 1024 / 1024);
  const rssMB = Math.round(used.rss / 1024 / 1024);

  const message = `📊 *Status Bot*

📱 WhatsApp:
• Status: ${getStatusEmoji(waConnected)} ${
    waConnected ? "Terhubung" : "Tidak Terhubung"
  }
• State: ${waState}

📖 Renungan:
• Ayat tersedia: ${stats.unused}/${stats.total}
• Jadwal: ${config.renunganTime || "08:00"} WITA
• Multi-Group: ${config.multiGroupEnabled ? "🟢 ON" : "🔴 OFF"}

🤖 AI: ${getProvider()} (${process.env.AI_MODEL || "gemini-pro"})

💾 Memory:
• Heap: ${heapMB}MB
• RSS: ${rssMB}MB

⏰ Server:
• Waktu: ${moment().format("HH:mm:ss")}
• Tanggal: ${moment().format("DD/MM/YYYY")}
• Timezone: ${process.env.TIMEZONE || "Asia/Makassar"}`;

  const keyboard = {
    reply_markup: {
      inline_keyboard: [[{ text: "⬅️ Kembali", callback_data: "back_main" }]],
    },
  };

  if (messageId) {
    return safeEditMessage(message, {
      chat_id: chatId,
      message_id: messageId,
      ...keyboard,
    });
  }

  return safeSendMessage(chatId, message, keyboard);
}

// ============================================
// MESSAGE HANDLERS
// ============================================

bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;
  if (!msg.from || !msg.chat) return; // Guard: Skip malformed updates

  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  if (!isAdmin(userId)) return;

  const state = userStates.get(userId);
  if (!state) return;

  // Handle cancel
  if (text.toLowerCase() === "batal") {
    userStates.delete(userId);
    return showMainMenu(chatId, userId);
  }

  try {
    switch (state.action) {
      case "add_verse":
        await handleAddVerseInput(userId, chatId, text, state);
        break;

      case "set_renungan_group":
        let groupId = text;
        let groupName = "";

        // Cek apakah ini link invite WhatsApp
        if (text.includes("chat.whatsapp.com/")) {
          await safeSendMessage(
            chatId,
            "⏳ *Memproses link invite...*\n\nMengambil info grup...",
          );

          // HANYA ambil info grup, TIDAK auto-join
          const groupInfo = await wa.getGroupInfoFromInviteLink(text);

          if (groupInfo.success) {
            groupId = groupInfo.groupId;
            groupName = groupInfo.groupName || "";
          } else {
            await safeSendMessage(
              chatId,
              `❌ *Gagal Mengambil Info Grup*\n\n${groupInfo.error}\n\n💡 *Tips:*\n1. Pastikan bot sudah di-invite ke grup\n2. Atau masukkan Group ID manual (klik grup di WA → Info → scroll ke bawah)`,
            );
            return;
          }
        }

        // Simpan Group ID (baik dari link atau manual)
        const config1 = await loadConfig();
        config1.renunganGroupId = groupId;
        config1.renunganGroupName = groupName; // Save nama juga
        await saveConfig(config1);
        process.env.RENUNGAN_GROUP_ID = groupId;

        userStates.delete(userId);
        await safeSendMessage(
          chatId,
          `✅ *Grup Utama Berhasil Diatur!*\n\n📛 Nama: ${groupName || "Tidak diketahui"}\n🆔 ID: ${groupId.substring(0, 30)}...\n\n💡 Pastikan bot sudah ada di grup ini!`,
        );
        await showSettingsMenu(chatId, null);
        break;

      case "add_renungan_group":
        let addGroupId = text;
        let addGroupName = "";

        // Cek apakah ini link invite WhatsApp
        if (text.includes("chat.whatsapp.com/")) {
          await safeSendMessage(
            chatId,
            "⏳ *Memproses link invite...*\n\nMencoba mendapatkan info grup...",
          );

          // Coba dapatkan info grup dulu
          const groupInfo = await wa.getGroupInfoFromInviteLink(text);

          if (groupInfo.success) {
            addGroupId = groupInfo.groupId;
            addGroupName = groupInfo.groupName || "";
          } else {
            // Kalau gagal dapat info, coba join
            const joinResult = await wa.joinGroupByInviteLink(text);
            if (joinResult.success) {
              addGroupId = joinResult.groupId;
            } else {
              await safeSendMessage(
                chatId,
                `❌ *Gagal Memproses Link*\n\n${joinResult.error || groupInfo.error}\n\nSilakan coba masukkan Group ID manual.`,
              );
              return;
            }
          }
        }

        // Tambahkan grup ke daftar
        await addRenunganGroup(addGroupId, addGroupName);

        userStates.delete(userId);
        await safeSendMessage(
          chatId,
          `✅ *Grup Berhasil Ditambahkan!*\n\n📛 Nama: ${addGroupName || "Tidak diketahui"}\n🆔 ID: ${addGroupId.substring(0, 30)}...`,
        );
        await showMultiGroupMenu(chatId, null);
        break;

      case "set_multigroup_delay":
        const delayMinutes = parseInt(text);
        if (isNaN(delayMinutes) || delayMinutes < 1 || delayMinutes > 10) {
          await safeSendMessage(
            chatId,
            "❌ Delay harus angka antara 1-10 menit. Coba lagi.",
          );
          return;
        }

        await setMultiGroupDelay(delayMinutes);
        userStates.delete(userId);
        await safeSendMessage(
          chatId,
          `✅ *Delay Multi-Group Diatur*\n\nDelay: ${delayMinutes} menit antar grup`,
        );
        await showMultiGroupMenu(chatId, null);
        break;
    }
  } catch (error) {
    console.error("❌ Message handler error:", error.message);
    await safeSendMessage(chatId, `❌ Error: ${error.message}`);
    userStates.delete(userId);
  }
});

async function handleAddVerseInput(userId, chatId, text, state) {
  switch (state.step) {
    case "verse":
      state.data.verse = text;
      state.step = "category";
      userStates.set(userId, state);

      await safeSendMessage(chatId, `📖 Ayat: ${text}\n\nPilih kategori:`, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "❤️ Kasih", callback_data: "cat_kasih" },
              { text: "✝️ Iman", callback_data: "cat_iman" },
            ],
            [
              { text: "🌟 Harapan", callback_data: "cat_harapan" },
              { text: "💪 Kekuatan", callback_data: "cat_kekuatan" },
            ],
            [
              { text: "🤗 Penghiburan", callback_data: "cat_penghiburan" },
              { text: "📖 Umum", callback_data: "cat_umum" },
            ],
          ],
        },
      });
      break;
  }
}

// ============================================
// START FUNCTION
// ============================================

/**
 * Restart Telegram polling dengan backoff
 */
async function restartTelegramPolling() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }

  const delay = Math.min(
    POLLING_RETRY_DELAY * Math.pow(2, pollingRetries),
    60000,
  );

  console.log(`⏳ Mencoba reconnect Telegram dalam ${delay / 1000}s...`);

  reconnectTimeout = setTimeout(async () => {
    try {
      await bot.stopPolling();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await bot.startPolling();

      pollingRetries = 0;
      isOnline = true;
      console.log("✅ Telegram polling berhasil direstart");
    } catch (error) {
      pollingRetries++;
      if (pollingRetries < MAX_POLLING_RETRIES) {
        console.log(`🔄 Retry ${pollingRetries}/${MAX_POLLING_RETRIES}...`);
        restartTelegramPolling();
      } else {
        console.error(
          "❌ Max retries tercapai. Bot akan menunggu koneksi kembali.",
        );
        isOnline = false;
      }
    }
  }, delay);
}

function startTelegramBot() {
  console.log("🤖 Telegram Bot aktif!");
  console.log(
    `👮 Admin IDs: ${
      ADMIN_IDS.length > 0 ? ADMIN_IDS.join(", ") : "Belum diatur!"
    }`,
  );

  if (USE_WEBHOOK) {
    // ============================================
    // WEBHOOK MODE - HEMAT BANDWIDTH
    // ============================================
    setupWebhook();
  } else if (IS_RENDER) {
    // ============================================
    // RENDER POLLING - Health server + Telegram polling
    // ============================================
    setupHealthServer();
    setupPolling();
  } else {
    // ============================================
    // POLLING MODE - Development/Fallback
    // ============================================
    setupPolling();
  }
}

/**
 * Setup Health Server only (for Render polling mode)
 * Express server for health check, Telegram uses polling
 */
function setupHealthServer() {
  expressApp = express();
  expressApp.use(express.json());

  // Health check endpoint (Render needs this to stay alive)
  expressApp.get("/health", (req, res) => {
    res.json({
      status: "ok",
      mode: "polling",
      platform: "render",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // Root endpoint
  expressApp.get("/", (req, res) => {
    res.json({
      name: "JhopanWa Bot Renungan",
      mode: "polling",
      platform: "render",
      status: "running",
    });
  });

  expressApp.listen(WEBHOOK_PORT, () => {
    console.log(`🏥 Health server listening on port ${WEBHOOK_PORT} (Render mode)`);
  });
}

/**
 * Setup Webhook mode - HEMAT BANDWIDTH
 * Telegram kirim update ke server kita, bukan kita yang request
 */
function setupWebhook() {
  const webhookPath = `/bot${process.env.TELEGRAM_BOT_TOKEN}`;
  const fullWebhookUrl = `${WEBHOOK_URL}${webhookPath}`;

  console.log(`🔧 Webhook path: ${webhookPath}`);

  // Create Express app
  expressApp = express();
  expressApp.use(express.json());

  // Debug middleware - log semua incoming requests
  expressApp.use((req, res, next) => {
    console.log(`📨 ${req.method} ${req.path} from ${req.ip}`);
    next();
  });

  // Health check endpoint
  expressApp.get("/health", (req, res) => {
    res.json({
      status: "ok",
      mode: "webhook",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // Webhook endpoint
  expressApp.post(webhookPath, (req, res) => {
    try {
      console.log(
        `✅ Webhook received! Body keys: ${Object.keys(req.body || {}).join(", ")}`,
      );
      bot.processUpdate(req.body);
      res.sendStatus(200);
    } catch (error) {
      console.error("❌ Webhook processing error:", error.message);
      res.sendStatus(500);
    }
  });

  // Catch-all handler untuk debug
  expressApp.use((req, res) => {
    console.log(`⚠️ Unhandled route: ${req.method} ${req.path}`);
    res.status(404).json({ error: "Route not found", path: req.path });
  });

  // Start Express server
  expressApp.listen(WEBHOOK_PORT, async () => {
    console.log(`🌐 Webhook server listening on port ${WEBHOOK_PORT}`);

    // Set webhook di Telegram
    try {
      // Hapus webhook lama dulu
      await bot.deleteWebHook();

      // Set webhook baru
      const result = await bot.setWebHook(fullWebhookUrl, {
        max_connections: 10, // Hemat resource
        allowed_updates: ["message", "callback_query"], // Hanya yang diperlukan
        drop_pending_updates: true, // Abaikan update lama
      });

      if (result) {
        console.log(`✅ Webhook berhasil diset: ${WEBHOOK_URL}`);
        console.log(`📊 Mode: WEBHOOK (hemat ~97% bandwidth)`);

        // Verify webhook
        const webhookInfo = await bot.getWebHookInfo();
        console.log(`🔗 Webhook URL: ${webhookInfo.url}`);
        console.log(
          `📬 Pending updates: ${webhookInfo.pending_update_count || 0}`,
        );
      }
    } catch (error) {
      console.error("❌ Gagal set webhook:", error.message);
      console.log("🔄 Fallback ke polling mode...");

      // Fallback ke polling
      expressApp = null;
      setupPolling();
    }
  });
}

/**
 * Setup Polling mode - Fallback/Development
 * Bot terus request ke Telegram (boros bandwidth)
 */
function setupPolling() {
  console.log("⚠️ Polling mode: ~25MB egress/day");
  console.log("💡 Set WEBHOOK_URL di .env untuk hemat bandwidth");

  // Start polling
  bot.startPolling();

  // Handle polling errors dengan retry
  bot.on("polling_error", (error) => {
    const errorCode = error.code || "UNKNOWN";
    const errorMsg = error.message || "";

    // Ignore error duplikat polling (409)
    if (errorCode === "ETELEGRAM" && errorMsg.includes("409")) {
      return;
    }

    // Handle EFATAL (koneksi terputus)
    if (errorCode === "EFATAL" || errorMsg.includes("EFATAL")) {
      console.log("⚠️ Koneksi internet terputus. Menunggu reconnect...");
      isOnline = false;

      // Auto-restart polling
      if (pollingRetries < MAX_POLLING_RETRIES) {
        restartTelegramPolling();
      }
      return;
    }

    // Handle error lainnya
    if (
      errorCode === "ECONNRESET" ||
      errorCode === "ETIMEDOUT" ||
      errorCode === "ENOTFOUND"
    ) {
      console.log(`⚠️ Network error (${errorCode}). Retry otomatis...`);
      if (pollingRetries < MAX_POLLING_RETRIES) {
        restartTelegramPolling();
      }
      return;
    }

    // Log error lainnya
    console.error(
      `❌ Telegram error [${errorCode}]:`,
      errorMsg.substring(0, 100),
    );
  });

  // Monitor koneksi kembali
  setInterval(() => {
    if (!isOnline && pollingRetries >= MAX_POLLING_RETRIES) {
      console.log("🔄 Mencoba reconnect Telegram...");
      pollingRetries = 0;
      restartTelegramPolling();
    }
  }, 30000); // Cek setiap 30 detik
}

/**
 * Get Express app untuk external use (jika diperlukan)
 */
function getExpressApp() {
  return expressApp;
}

/**
 * Get bot mode info
 */
function getBotMode() {
  return {
    mode: USE_WEBHOOK ? "webhook" : "polling",
    webhookUrl: WEBHOOK_URL,
    webhookPort: WEBHOOK_PORT,
    bandwidthEstimate: USE_WEBHOOK ? "~1MB/month" : "~750MB/month",
  };
}

/**
 * Kirim notifikasi error ke admin via Telegram
 */
async function notifyAdminError(errorMessage) {
  if (ADMIN_IDS.length === 0) {
    console.log("⚠️ Tidak ada admin untuk notifikasi error");
    return;
  }

  const message = `🚨 *Error Alert*\n\n${errorMessage}\n\n⏰ ${moment().format(
    "DD/MM/YYYY HH:mm:ss",
  )}`;

  for (const adminId of ADMIN_IDS) {
    try {
      await bot.sendMessage(adminId, message, { parse_mode: "Markdown" });
    } catch (err) {
      console.error(`❌ Gagal kirim notif ke admin ${adminId}:`, err.message);
    }
  }
}

/**
 * Cleanup webhook saat shutdown
 */
async function cleanupWebhook() {
  if (USE_WEBHOOK) {
    try {
      await bot.deleteWebHook();
      console.log("🧹 Webhook dihapus");
    } catch (error) {
      console.error("❌ Gagal hapus webhook:", error.message);
    }
  }
}

module.exports = {
  startTelegramBot,
  bot,
  notifyAdminError,
  getExpressApp,
  getBotMode,
  cleanupWebhook,
};
