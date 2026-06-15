/**
 * Renungan Handler
 * Mengelola pengiriman renungan harian dengan AI
 * AI akan generate seluruh isi renungan berdasarkan referensi ayat
 *
 * Storage: MongoDB (primary) → Local JSON file (fallback)
 */

const cron = require("node-cron");
const moment = require("moment-timezone");
const { generateRenungan, checkSpecialDay } = require("./services/aiService");
const wa = require("./botWhatsApp");
const { loadConfig } = require("./utils/configManager");
const mongoData = require("./services/mongoDataService");

moment.tz.setDefault(process.env.TIMEZONE || "Asia/Makassar");

// Cron job instance
let renunganCronJob = null;

/**
 * Load verses data untuk tahun tertentu
 * MongoDB → file → empty
 */
async function loadVerses(year = null) {
  try {
    return await mongoData.loadVerses(year);
  } catch (error) {
    console.error("❌ Error load verses:", error.message);
    return { verses: [], specialDayVerses: {}, metadata: {} };
  }
}

/**
 * Save verses data untuk tahun tertentu
 * MongoDB → file
 */
async function saveVerses(data, year = null) {
  try {
    await mongoData.saveVerses(data, year);
  } catch (error) {
    console.error("❌ Error save verses:", error.message);
  }
}

/**
 * Get ayat untuk hari ini
 * Sistem random dengan history: ayat yang sudah terpakai tidak akan diulang
 * Prioritas: Hari spesial > Random dari ayat yang belum terpakai
 */
async function getVerseForToday() {
  const currentYear = new Date().getFullYear();
  const versesData = await loadVerses(currentYear);

  if (!versesData.verses || versesData.verses.length === 0) {
    console.error(`❌ Tidak ada data verses untuk tahun ${currentYear}`);
    return { verseRef: "Mazmur 119:105", specialDay: null, isSpecial: false };
  }

  // 1. Cek apakah hari spesial
  const specialDay = await checkSpecialDay();

  if (specialDay) {
    // Cari ayat khusus untuk hari spesial
    const specialKey = specialDay
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/hari_/g, "");

    // Cek di specialDayVerses
    for (const [key, verseRef] of Object.entries(
      versesData.specialDayVerses || {},
    )) {
      if (specialKey.includes(key) || key.includes(specialKey)) {
        return { verseRef, specialDay, isSpecial: true };
      }
    }
  }

  // 2. Pilih random dari ayat yang belum terpakai
  let unusedVerses = versesData.verses.filter((v) => !v.used);

  // 3. Jika semua sudah dipakai, reset otomatis
  if (unusedVerses.length === 0) {
    console.log("🔄 Semua ayat sudah dipakai, auto-reset...");
    versesData.verses.forEach((v) => {
      v.used = false;
    });
    await saveVerses(versesData, currentYear);
    unusedVerses = versesData.verses;
  }

  // 4. Pilih random dari yang belum dipakai
  const randomIndex = Math.floor(Math.random() * unusedVerses.length);
  const selectedVerse = unusedVerses[randomIndex];

  // 5. Mark as used dan simpan
  const idx = versesData.verses.findIndex((v) => v.id === selectedVerse.id);
  if (idx !== -1) {
    versesData.verses[idx].used = true;
    await saveVerses(versesData, currentYear);
  }

  console.log(
    `📖 Verse dipilih: ${selectedVerse.verse} (${
      unusedVerses.length - 1
    } tersisa)`,
  );

  return {
    verseRef: selectedVerse.verse,
    specialDay,
    isSpecial: !!specialDay,
    category: selectedVerse.category,
  };
}

/**
 * Reset semua ayat (mark as unused)
 */
async function resetVerses(year = null) {
  const currentYear = year || new Date().getFullYear();
  const versesData = await loadVerses(currentYear);

  if (!versesData.verses || versesData.verses.length === 0) {
    return { success: false, error: "Tidak ada data verses" };
  }

  versesData.verses.forEach((v) => {
    v.used = false;
  });

  await saveVerses(versesData, currentYear);

  return {
    success: true,
    total: versesData.verses.length,
    year: currentYear,
  };
}

/**
 * Generate dan kirim renungan dengan retry mechanism
 * AI generate seluruh pesan berdasarkan referensi ayat saja
 */
async function sendRenungan(isRetry = false) {
  const groupId = process.env.RENUNGAN_GROUP_ID;

  if (!groupId) {
    console.log("⚠️ RENUNGAN_GROUP_ID belum diatur di .env");
    return { success: false, error: "Group ID belum diatur" };
  }

  try {
    // Cek koneksi WhatsApp
    if (!(await wa.isConnected())) {
      console.log("⏳ Renungan menunggu WhatsApp reconnect...");

      // Schedule retry 10 menit kemudian jika belum retry
      if (!isRetry) {
        console.log("🔄 Akan retry dalam 10 menit...");
        setTimeout(
          () => {
            sendRenungan(true);
          },
          10 * 60 * 1000,
        ); // 10 menit
      }

      return {
        success: false,
        error: "WhatsApp tidak terhubung",
        willRetry: !isRetry,
      };
    }

    console.log(
      isRetry
        ? "🔄 Retry kirim renungan..."
        : "📖 Generating renungan harian...",
    );

    // Get referensi ayat hari ini
    const { verseRef, specialDay, isSpecial } = await getVerseForToday();

    if (isSpecial) {
      console.log(`🎉 Hari spesial: ${specialDay}`);
    }

    console.log(`📖 Ayat: ${verseRef}`);

    // AI generate seluruh isi renungan (termasuk cari isi ayat)
    const message = await generateRenungan(verseRef, specialDay);

    // Jika AI error, kirim notifikasi ke Telegram saja
    if (!message || message.includes("Error") || message.includes("Maaf")) {
      console.error("❌ AI gagal generate renungan");

      // Kirim notif error ke Telegram (jangan ke WhatsApp)
      const telegram = require("./botTelegram");
      if (telegram && telegram.notifyAdminError) {
        await telegram.notifyAdminError(
          `❌ AI Error saat generate renungan\nAyat: ${verseRef}\nHari: ${
            specialDay || "Normal"
          }`,
        );
      }

      return { success: false, error: "AI error", verse: verseRef };
    }

    // Load config untuk cek hide tag dan multi-group
    const config = await loadConfig();
    const useHideTag = config.hideTagEnabled || false;
    const useMultiGroup = config.multiGroupEnabled || false;
    const renunganGroups = config.renunganGroups || [];
    const delayMinutes = config.multiGroupDelayMinutes || 2;

    // Fungsi helper untuk kirim ke satu grup
    const sendToGroup = async (targetGroupId) => {
      if (useHideTag) {
        await wa.sendMessageWithHideTag(targetGroupId, message);
      } else {
        await wa.sendMessage(targetGroupId, message);
      }
      console.log(
        `✅ Renungan terkirim ke ${targetGroupId} (hideTag: ${useHideTag})`,
      );
    };

    // Kirim ke grup utama
    await sendToGroup(groupId);

    // Jika multi-group enabled, kirim ke grup lain dengan delay
    if (useMultiGroup && renunganGroups.length > 0) {
      console.log(
        `📢 Multi-group mode: akan kirim ke ${renunganGroups.length} grup tambahan`,
      );

      for (let i = 0; i < renunganGroups.length; i++) {
        const group = renunganGroups[i];
        if (group.id === groupId) continue; // Skip grup utama

        // Delay antara grup (1-3 menit acak atau sesuai config)
        const delayMs = delayMinutes * 60 * 1000 + Math.random() * 60000;

        setTimeout(
          async () => {
            try {
              await sendToGroup(group.id);
              console.log(
                `✅ Renungan terkirim ke grup ${group.name || group.id}`,
              );
            } catch (err) {
              console.error(
                `❌ Gagal kirim ke grup ${group.name || group.id}:`,
                err.message,
              );
            }
          },
          delayMs * (i + 1),
        );
      }
    }

    console.log(`✅ Renungan terkirim ke ${groupId}`);

    return {
      success: true,
      verse: verseRef,
      specialDay,
      groupId,
      isRetry,
    };
  } catch (error) {
    console.error("❌ Gagal kirim renungan:", error.message);

    // Schedule retry 10 menit kemudian jika belum retry
    if (!isRetry) {
      console.log("🔄 Akan retry dalam 10 menit...");
      setTimeout(
        () => {
          sendRenungan(true);
        },
        10 * 60 * 1000,
      ); // 10 menit
    }

    // Notif error ke Telegram saja
    const telegram = require("./botTelegram");
    if (telegram && telegram.notifyAdminError) {
      await telegram.notifyAdminError(
        `❌ Error kirim renungan:\n${error.message}\n${
          isRetry ? "(Retry gagal)" : "(Akan retry 10 menit)"
        }`,
      );
    }

    return { success: false, error: error.message, willRetry: !isRetry };
  }
}

/**
 * Preview renungan tanpa kirim
 */
async function previewRenungan() {
  try {
    const { verseRef, specialDay, isSpecial } = await getVerseForToday();

    console.log(`📖 Preview ayat: ${verseRef}`);

    // AI generate seluruh isi renungan
    const message = await generateRenungan(verseRef, specialDay);

    return {
      success: true,
      message,
      verse: verseRef,
      specialDay,
      isSpecial,
    };
  } catch (error) {
    console.error("❌ Error preview:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Kirim renungan dengan message yang sudah dibuat (dari preview)
 */
async function sendRenunganWithMessage(message) {
  const groupId = process.env.RENUNGAN_GROUP_ID;

  if (!groupId) {
    console.log("⚠️ RENUNGAN_GROUP_ID belum diatur di .env");
    return { success: false, error: "Group ID belum diatur" };
  }

  try {
    // Cek koneksi WhatsApp
    if (!(await wa.isConnected())) {
      console.log("⏳ Renungan menunggu WhatsApp reconnect...");
      return { success: false, error: "WhatsApp tidak terhubung" };
    }

    console.log("📤 Mengirim renungan yang sudah di-preview...");

    // Load config untuk cek hide tag dan multi-group
    const config = await loadConfig();
    const useHideTag = config.hideTagEnabled || false;
    const useMultiGroup = config.multiGroupEnabled || false;
    const renunganGroups = config.renunganGroups || [];
    const delayMinutes = config.multiGroupDelayMinutes || 2;

    // Fungsi helper untuk kirim ke satu grup
    const sendToGroup = async (targetGroupId) => {
      if (useHideTag) {
        await wa.sendMessageWithHideTag(targetGroupId, message);
      } else {
        await wa.sendMessage(targetGroupId, message);
      }
      console.log(
        `✅ Renungan terkirim ke ${targetGroupId} (hideTag: ${useHideTag})`,
      );
    };

    // Kirim ke grup utama
    await sendToGroup(groupId);

    // Jika multi-group enabled, kirim ke grup lain dengan delay
    if (useMultiGroup && renunganGroups.length > 0) {
      console.log(
        `📢 Multi-group mode: akan kirim ke ${renunganGroups.length} grup tambahan`,
      );

      for (let i = 0; i < renunganGroups.length; i++) {
        const group = renunganGroups[i];
        if (group.id === groupId) continue; // Skip grup utama

        // Delay antara grup (1-3 menit acak atau sesuai config)
        const delayMs = delayMinutes * 60 * 1000 + Math.random() * 60000;

        setTimeout(
          async () => {
            try {
              await sendToGroup(group.id);
              console.log(
                `✅ Renungan terkirim ke grup ${group.name || group.id}`,
              );
            } catch (err) {
              console.error(
                `❌ Gagal kirim ke grup ${group.name || group.id}:`,
                err.message,
              );
            }
          },
          delayMs * (i + 1),
        );
      }
    }

    console.log(`✅ Renungan terkirim ke ${groupId}`);

    return {
      success: true,
      groupId,
      hideTagEnabled: useHideTag,
      multiGroupEnabled: useMultiGroup,
    };
  } catch (error) {
    console.error("❌ Gagal kirim renungan:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Tambah ayat baru ke database (hanya referensi)
 */
async function addVerse(verseRef, category = "umum") {
  try {
    const versesData = await loadVerses();

    // Check duplicate
    const exists = versesData.verses.some(
      (v) => v.verse.toLowerCase() === verseRef.toLowerCase(),
    );

    if (exists) {
      return { success: false, error: "Ayat sudah ada di database" };
    }

    // Generate new ID
    const maxId = Math.max(...versesData.verses.map((v) => v.id), 0);

    versesData.verses.push({
      id: maxId + 1,
      verse: verseRef,
      category,
      used: false,
    });

    await saveVerses(versesData);

    console.log(`✅ Ayat baru ditambahkan: ${verseRef}`);
    return { success: true, id: maxId + 1 };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get semua ayat
 */
async function getAllVerses() {
  const versesData = await loadVerses();
  return versesData.verses;
}

/**
 * Get statistik ayat
 */
async function getVersesStats() {
  const versesData = await loadVerses();
  const total = versesData.verses.length;
  const used = versesData.verses.filter((v) => v.used).length;
  const unused = total - used;

  return {
    total,
    used,
    unused,
    lastUpdated: versesData.metadata.lastUpdated,
  };
}

/**
 * Hapus ayat dari database
 */
async function deleteVerse(id) {
  try {
    const versesData = await loadVerses();
    const idx = versesData.verses.findIndex((v) => v.id === id);

    if (idx === -1) {
      return { success: false, error: "Ayat tidak ditemukan" };
    }

    const deleted = versesData.verses.splice(idx, 1)[0];
    await saveVerses(versesData);

    return { success: true, deleted };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Reset semua status used
 */
async function resetVersesStatus() {
  try {
    const versesData = await loadVerses();
    versesData.verses.forEach((v) => {
      v.used = false;
    });
    await saveVerses(versesData);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Start scheduler untuk renungan harian
 */
function startRenunganScheduler() {
  const renunganTime = process.env.RENUNGAN_TIME || "08:00";
  const [hour, minute] = renunganTime.split(":");

  // Schedule: menit jam * * * (setiap hari)
  const cronExpression = `${minute} ${hour} * * *`;

  // Stop existing job jika ada
  if (renunganCronJob) {
    renunganCronJob.stop();
    console.log("🔄 Menghentikan scheduler renungan lama...");
  }

  renunganCronJob = cron.schedule(
    cronExpression,
    async () => {
      console.log(`\n⏰ Waktu renungan: ${moment().format("HH:mm")}`);
      await sendRenungan();
    },
    { timezone: process.env.TIMEZONE || "Asia/Makassar" },
  );

  console.log(
    `📖 Renungan harian dijadwalkan jam ${renunganTime} ${
      process.env.TIMEZONE || "WITA"
    }`,
  );
}

/**
 * Restart scheduler dengan waktu baru
 * @param {string} newTime - Waktu baru (format HH:mm)
 */
function restartRenunganScheduler(newTime) {
  if (!newTime || !/^\d{2}:\d{2}$/.test(newTime)) {
    throw new Error("Format waktu tidak valid. Gunakan HH:mm (contoh: 08:00)");
  }

  // Update env variable
  process.env.RENUNGAN_TIME = newTime;

  // Restart scheduler
  startRenunganScheduler();

  console.log(`✅ Jadwal renungan diubah ke ${newTime}`);
}

/**
 * Get jadwal renungan saat ini
 */
function getRenunganSchedule() {
  return process.env.RENUNGAN_TIME || "08:00";
}

module.exports = {
  sendRenungan,
  sendRenunganWithMessage,
  previewRenungan,
  addVerse,
  getAllVerses,
  getVersesStats,
  deleteVerse,
  resetVersesStatus,
  resetVerses,
  startRenunganScheduler,
  restartRenunganScheduler,
  getRenunganSchedule,
  getVerseForToday,
};
