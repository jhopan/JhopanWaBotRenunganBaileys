/**
 * Renungan Handler
 * Mengelola pengiriman renungan harian dengan AI
 * AI akan generate seluruh isi renungan berdasarkan referensi ayat
 *
 * DUAL MODE:
 *   VERSE_MODE=pool   → Unified Pool (1825 ayat, AI theme, multi-ayat) [default]
 *   VERSE_MODE=yearly → Per-Year Verses (365 ayat/tahun, manual control)
 *
 * Storage: MongoDB (primary) → Local JSON file (fallback)
 */

const cron = require("node-cron");
const moment = require("moment-timezone");
const { generateRenungan, checkSpecialDay } = require("./services/aiService");
const wa = require("./botWhatsApp");
const { loadConfig } = require("./utils/configManager");
const versePool = require("./services/versePool");
const mongoData = require("./services/mongoDataService");
const bibleVerseDB = require("./services/bibleVerseDB");
const bibleScraper = require("./services/bibleScrapeScheduler");
const mongoService = require("./services/mongoService");
const ttsService = require("./services/ttsService");

moment.tz.setDefault(process.env.TIMEZONE || "Asia/Makassar");

// Cron job instance
let renunganCronJob = null;
let themePrecomputeJob = null;

/**
 * Check verse mode: "pool" (default) or "yearly"
 */
function getVerseMode() {
  const mode = (process.env.VERSE_MODE || "pool").toLowerCase();
  return mode === "yearly" ? "yearly" : "pool";
}

/**
 * Get ayat untuk hari ini
 * Mode-aware: pool → unified pool | yearly → per-year verses
 */
async function getVerseForToday() {
  const mode = getVerseMode();
  console.log(`📖 Verse mode: ${mode}`);

  if (mode === "yearly") {
    return getVerseForTodayYearly();
  }
  return getVerseForTodayPool();
}

// ─── POOL MODE ───────────────────────────────────────────────────────────────

async function getVerseForTodayPool() {
  const todayTheme = await versePool.getTodayTheme();

  let theme = "umum";
  let specialDay = null;
  let isSpecial = false;

  if (todayTheme) {
    theme = todayTheme.theme || "umum";
    if (todayTheme.isSpecial) {
      specialDay = todayTheme.specialDayName || todayTheme.theme;
      isSpecial = true;
    }
    console.log(`🎨 Theme: ${theme} (${todayTheme.reason || ""})`);
  } else {
    const dayOfWeek = moment().day();
    theme = versePool.DAILY_THEMES[dayOfWeek] || "umum";
    const sd = await checkSpecialDay();
    if (sd) { specialDay = sd; isSpecial = true; }
    console.log(`📅 Fallback theme: ${theme}`);
  }

  const result = await versePool.getVersesForToday(
    theme, isSpecial ? { name: specialDay } : null
  );

  if (!result.verses || result.verses.length === 0) {
    return { verseRef: "Mazmur 119:105", verseUids: [], specialDay: null, isSpecial: false };
  }

  const verseRefs = result.verses.map((v) => v.verse).join("; ");
  const verseUids = result.verses.map((v) => v._uid);

  console.log(`📖 Verse(s): ${verseRefs} (${result.verses.length} ayat, tema: ${result.theme})`);

  return {
    verseRef: verseRefs, verseUids, specialDay, isSpecial,
    theme: result.theme, verseCount: result.verses.length,
  };
}

// ─── YEARLY MODE ─────────────────────────────────────────────────────────────

async function getVerseForTodayYearly() {
  const currentYear = new Date().getFullYear();
  const versesData = await mongoData.loadVerses(currentYear);

  if (!versesData.verses || versesData.verses.length === 0) {
    return { verseRef: "Mazmur 119:105", verseUids: [], specialDay: null, isSpecial: false };
  }

  // Cek hari spesial
  const specialDay = await checkSpecialDay();
  if (specialDay) {
    const specialKey = specialDay.toLowerCase().replace(/\s+/g, "_").replace(/hari_/g, "");
    for (const [key, verseRef] of Object.entries(versesData.specialDayVerses || {})) {
      if (specialKey.includes(key) || key.includes(specialKey)) {
        return { verseRef, verseUids: [], specialDay, isSpecial: true, verseCount: 1 };
      }
    }
  }

  // Pilih random dari yang belum dipakai
  let unusedVerses = versesData.verses.filter((v) => !v.used);
  if (unusedVerses.length === 0) {
    console.log("🔄 Semua ayat terpakai, auto-reset...");
    versesData.verses.forEach((v) => { v.used = false; });
    await mongoData.saveVerses(versesData, currentYear);
    unusedVerses = versesData.verses;
  }

  const selected = unusedVerses[Math.floor(Math.random() * unusedVerses.length)];
  const idx = versesData.verses.findIndex((v) => v.id === selected.id);
  if (idx !== -1) {
    versesData.verses[idx].used = true;
    await mongoData.saveVerses(versesData, currentYear);
  }

  console.log(`📖 Verse: ${selected.verse} (${unusedVerses.length - 1} tersisa)`);
  return { verseRef: selected.verse, verseUids: [], specialDay, isSpecial: !!specialDay, verseCount: 1 };
}

/**
 * Reset semua ayat (mark as unused) - pool version
 */
async function resetVerses() {
  const result = await versePool.resetPool();
  if (!result) return { success: false, error: "Reset failed" };
  const stats = await versePool.getPoolStats();
  return { success: true, total: stats.total };
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
    const { verseRef, verseUids, specialDay, isSpecial, theme, verseCount } = await getVerseForToday();

    if (isSpecial) {
      console.log(`🎉 Hari spesial: ${specialDay}`);
    }

    console.log(`📖 Ayat (${verseCount || 1}): ${verseRef}`);

    // ===== VERSE INJECT: Ambil teks ayat dari database =====
    let verseData = null;
    if (mongoService.isConnected()) {
      try {
        // verseRef bisa multi-ayat: "Roma 8:28; Roma 8:30" atau "Roma 8:28, Roma 8:30"
        const refs = verseRef.split(/[;,]/).map(r => r.trim()).filter(Boolean);
        const verseDatas = [];

        for (const ref of refs) {
          let vd = await bibleVerseDB.getVerse(ref);
          if (!vd) {
            console.log(`   ⚠️  ${ref} belum ada di DB, scraping on-demand...`);
            vd = await bibleScraper.scrapeVerseOnDemand(ref);
          }
          if (vd) verseDatas.push(vd);
        }

        if (verseDatas.length > 0) {
          // Gabungkan untuk multi-ayat
          verseData = {
            text: verseDatas.map(v => v.text).join(' '),
            pericope: verseDatas[0].pericope, // pakai perikop ayat pertama
          };
          console.log(`   ✅ ${verseDatas.length} ayat ditemukan di DB`);
        }
      } catch (err) {
        console.log(`   ⚠️  Gagal ambil verse text: ${err.message}`);
        // Fallback ke mode lama (AI harus ingat ayat sendiri)
      }
    }

    // AI generate renungan (dengan verse text jika tersedia)
    const message = await generateRenungan(verseRef, specialDay, verseData);

    // Jika AI error, kirim notifikasi ke Telegram saja
    if (!message || message.includes("Error") || message.includes("Maaf")) {
      console.error("❌ AI gagal generate renungan");

      // Kirim notif error ke Telegram (jangan ke WhatsApp)
      const telegram = require("./botTelegram");
      if (telegram && telegram.notifyAdminError) {
        await telegram.notifyAdminError(
          `❌ AI Error saat generate renungan\nAyat: ${verseRef}\nHari: ${
            specialDay || "Normal"
          }\nTema: ${theme || "-"}`,
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

    // Generate TTS audio (if enabled)
    let audioPath = null;
    const ttsEnabled = process.env.TTS_ENABLED === 'true';
    if (ttsEnabled) {
      try {
        audioPath = await ttsService.generateTTS(message);
        console.log('✅ TTS audio generated');
      } catch (ttsError) {
        console.error('⚠️ TTS generation failed:', ttsError.message);
        // Continue without audio
      }
    }

    // Fungsi helper untuk kirim ke satu grup
    const sendToGroup = async (targetGroupId) => {
      if (useHideTag) {
        await wa.sendMessageWithHideTag(targetGroupId, message);
      } else {
        await wa.sendMessage(targetGroupId, message);
      }
      
      // Kirim audio (jika ada)
      if (audioPath) {
        try {
          await wa.sendVoiceMessage(targetGroupId, audioPath);
        } catch (audioError) {
          console.error('⚠️ Failed to send audio:', audioError.message);
        }
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

      // Filter grup tambahan (bukan grup utama)
      const additionalGroups = renunganGroups.filter(g => g.id !== groupId);

      for (let i = 0; i < additionalGroups.length; i++) {
        const group = additionalGroups[i];
        const isLastGroup = i === additionalGroups.length - 1;

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
            } finally {
              // Cleanup audio after last group is processed
              if (isLastGroup && audioPath) {
                ttsService.cleanupAudio(audioPath);
              }
            }
          },
          delayMs * (i + 1),
        );
      }
    } else {
      // Single group mode: cleanup audio immediately after sending
      if (audioPath) {
        ttsService.cleanupAudio(audioPath);
      }
    }

    console.log(`✅ Renungan terkirim ke ${groupId}`);

    // Mark verses as used in pool
    if (verseUids && verseUids.length > 0) {
      await versePool.markVersesUsed(verseUids, groupId);
    }

    return {
      success: true,
      verse: verseRef,
      specialDay,
      theme,
      verseCount: verseCount || 1,
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
    const result = await getVerseForToday();
    const { verseRef, verseUids, specialDay, isSpecial, theme, verseCount } = result;

    console.log(`📖 Preview ayat: ${verseRef} (${verseCount || 1} ayat, tema: ${theme || "-"})`);

    // ===== VERSE INJECT: Ambil teks ayat dari database =====
    let verseData = null;
    if (mongoService.isConnected()) {
      try {
        const refs = verseRef.split(/[;,]/).map(r => r.trim()).filter(Boolean);
        const verseDatas = [];
        for (const ref of refs) {
          let vd = await bibleVerseDB.getVerse(ref);
          if (!vd) vd = await bibleScraper.scrapeVerseOnDemand(ref);
          if (vd) verseDatas.push(vd);
        }
        if (verseDatas.length > 0) {
          verseData = {
            text: verseDatas.map(v => v.text).join(' '),
            pericope: verseDatas[0].pericope,
          };
        }
      } catch (err) {
        console.log(`   ⚠️  Gagal ambil verse text: ${err.message}`);
      }
    }

    // AI generate renungan
    const message = await generateRenungan(verseRef, specialDay, verseData);

    // Generate TTS audio (if enabled)
    let audioPath = null;
    const ttsEnabled = process.env.TTS_ENABLED === 'true';
    if (ttsEnabled) {
      try {
        audioPath = await ttsService.generateTTS(message);
        console.log('✅ TTS audio generated for preview');
      } catch (ttsError) {
        console.error('⚠️ TTS generation failed:', ttsError.message);
      }
    }

    return {
      success: true,
      message,
      verse: verseRef,
      verseUids: verseUids || [],
      specialDay,
      isSpecial,
      theme: theme || "umum",
      verseCount: verseCount || 1,
      audioPath,
    };
  } catch (error) {
    console.error("❌ Error preview:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Kirim renungan dengan message yang sudah dibuat (dari preview)
 * @param {string} message - Pesan renungan yang sudah di-generate
 * @param {string[]} verseUids - UID ayat yang dipakai (untuk mark as used)
 * @param {string} audioPath - Path ke file audio (opsional)
 */
async function sendRenunganWithMessage(message, verseUids = [], audioPath = null) {
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
      
      // Kirim audio (jika ada)
      if (audioPath) {
        try {
          await wa.sendVoiceMessage(targetGroupId, audioPath);
        } catch (audioError) {
          console.error('⚠️ Failed to send audio:', audioError.message);
        }
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
              
              // Cleanup audio after last group
              if (i === renunganGroups.length - 1 && audioPath) {
                ttsService.cleanupAudio(audioPath);
              }
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
    } else {
      // Single group mode: cleanup immediately
      if (audioPath) {
        ttsService.cleanupAudio(audioPath);
      }
    }

    console.log(`✅ Renungan terkirim ke ${groupId}`);

    // Mark verses as used in pool
    if (verseUids && verseUids.length > 0) {
      await versePool.markVersesUsed(verseUids, groupId);
    }

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
 * Tambah ayat baru ke pool
 */
async function addVerse(verseRef, category = "umum") {
  try {
    const pool = await versePool.loadPool();
    if (!pool) return { success: false, error: "Pool not loaded" };

    // Check duplicate
    const exists = pool.verses.some(
      (v) => v.verse.toLowerCase() === verseRef.toLowerCase(),
    );

    if (exists) {
      return { success: false, error: "Ayat sudah ada di pool" };
    }

    // Generate new ID
    const maxId = Math.max(...pool.verses.map((v) => v.id || 0), 0);
    const newId = maxId + 1;

    pool.verses.push({
      id: newId,
      _uid: `custom_${newId}`,
      verse: verseRef,
      category,
      used: false,
      sourceYear: "custom",
      sentAt: null,
      sentTo: null,
    });

    pool.metadata.totalVerses = pool.verses.length;
    pool.metadata.unusedCount = pool.verses.filter((v) => !v.used).length;

    await versePool.savePool(pool);

    console.log(`✅ Ayat baru ditambahkan ke pool: ${verseRef}`);
    return { success: true, id: newId };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Get semua ayat (mode-aware)
 */
async function getAllVerses() {
  if (getVerseMode() === "yearly") {
    const data = await mongoData.loadVerses();
    return data.verses || [];
  }
  const pool = await versePool.loadPool();
  return pool ? pool.verses : [];
}

/**
 * Get statistik ayat (mode-aware)
 */
async function getVersesStats() {
  if (getVerseMode() === "yearly") {
    const data = await mongoData.loadVerses();
    const total = data.verses.length;
    const used = data.verses.filter((v) => v.used).length;
    return {
      mode: "yearly",
      year: data.year || new Date().getFullYear(),
      total, used, unused: total - used,
      specialDays: Object.keys(data.specialDayVerses || {}).length,
    };
  }
  const stats = await versePool.getPoolStats();
  return { ...stats, mode: "pool" };
}

/**
 * Hapus ayat dari pool
 */
async function deleteVerse(id) {
  try {
    const pool = await versePool.loadPool();
    if (!pool) return { success: false, error: "Pool not loaded" };

    const idx = pool.verses.findIndex((v) => v.id === id || v._uid === String(id));
    if (idx === -1) return { success: false, error: "Ayat tidak ditemukan" };

    const deleted = pool.verses.splice(idx, 1)[0];
    pool.metadata.totalVerses = pool.verses.length;
    pool.metadata.unusedCount = pool.verses.filter((v) => !v.used).length;
    pool.metadata.usedCount = pool.verses.length - pool.metadata.unusedCount;

    await versePool.savePool(pool);
    return { success: true, deleted };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Reset pool (semua ayat → unused)
 */
async function resetVersesStatus() {
  try {
    await versePool.resetPool();
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
  const mode = getVerseMode();

  const cronExpression = `${minute} ${hour} * * *`;

  // Stop existing jobs
  if (renunganCronJob) {
    renunganCronJob.stop();
    console.log("🔄 Menghentikan scheduler renungan lama...");
  }
  if (themePrecomputeJob) {
    themePrecomputeJob.stop();
    themePrecomputeJob = null;
  }

  // ── Theme pre-compute: only in POOL mode ──
  if (mode === "pool") {
    const precomputeMinutes = parseInt(process.env.THEME_PRECOMPUTE_MINUTES) || 30;
    let precomputeHour = parseInt(hour) - (precomputeMinutes >= 60 ? Math.floor(precomputeMinutes / 60) : 0);
    let precomputeMin = (parseInt(minute) - (precomputeMinutes % 60) + 60) % 60;
    if (precomputeHour < 0) precomputeHour += 24;

    const precomputeCron = `${precomputeMin} ${precomputeHour} * * *`;

    themePrecomputeJob = cron.schedule(
      precomputeCron,
      async () => {
        console.log(`\n🎨 Pre-compute theme (${moment().format("HH:mm")})...`);
        try {
          await versePool.precomputeTheme();
        } catch (e) {
          console.error("❌ Theme pre-compute failed:", e.message);
        }
      },
      { timezone: process.env.TIMEZONE || "Asia/Makassar" },
    );

    const precomputeTime = `${String(precomputeHour).padStart(2, "0")}:${String(precomputeMin).padStart(2, "0")}`;
    console.log(`🎨 Theme pre-compute dijadwalkan jam ${precomputeTime} (pool mode)`);
  }

  // ── Renungan cron ──
  renunganCronJob = cron.schedule(
    cronExpression,
    async () => {
      console.log(`\n⏰ Waktu renungan: ${moment().format("HH:mm")} (${mode} mode)`);
      await sendRenungan();
    },
    { timezone: process.env.TIMEZONE || "Asia/Makassar" },
  );

  console.log(
    `📖 Renungan dijadwalkan jam ${renunganTime} [${mode.toUpperCase()} mode]`,
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
