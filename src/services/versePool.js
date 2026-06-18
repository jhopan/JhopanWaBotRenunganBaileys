/**
 * Verse Pool Service - Unified verse management
 *
 * Gabung semua verses (2026-2030+) jadi 1 pool besar di MongoDB.
 * Theme pre-compute pakai AI 30 menit sebelum renungan.
 *
 * Features:
 * - 1825+ ayat dalam 1 pool (no year dependency)
 * - Theme pre-compute via AI (07:30) + hardcoded fallback
 * - Multi-verse per day (1-3 ayat sesuai tema)
 * - Special day priority (override theme)
 * - Auto-reset when pool exhausted
 * - Persistent tracking di MongoDB
 */

const cron = require("node-cron");
const moment = require("moment-timezone");
const fs = require("fs-extra");
const path = require("path");
const mongoService = require("./mongoService");

moment.tz.setDefault(process.env.TIMEZONE || "Asia/Makassar");

const DATA_DIR = path.join(__dirname, "../data");

// ─── Daily themes (fallback kalau AI gagal) ──────────────────────────────────
const DAILY_THEMES = {
  1: "kekuatan", // Senin - awal minggu, butuh semangat
  2: "hikmat", // Selasa - butuh kebijaksanaan
  3: "doa", // Rabu - pertengahan minggu, berdoa
  4: "iman", // Kamis - perteguh iman
  5: "kasih", // Jumat - hari kasih
  6: "damai", // Sabtu - akhir minggu, istirahat
  0: "harapan", // Minggu - hari Tuhan, bersyukur
};

const VALID_THEMES = [
  "iman", "doa", "harapan", "kekuatan", "damai",
  "kasih", "hikmat", "pertumbuhan_rohani", "pertobatan",
  "penghiburan", "umum",
];

// ─── Mongoose Model ──────────────────────────────────────────────────────────

let PoolModel = null;

function getPoolModel() {
  if (PoolModel) return PoolModel;
  const mongoose = mongoService.getMongoose();
  if (!mongoose) throw new Error("MongoDB not connected");

  if (mongoose.models.VersePool) return mongoose.model("VersePool");

  PoolModel = mongoose.model(
    "VersePool",
    new mongoose.Schema(
      {
        _id: { type: String, default: "main" },
        verses: { type: Array, default: [] },
        specialDayVerses: { type: Object, default: {} },
        todayTheme: {
          theme: String,
          reason: String,
          computedAt: String,
          date: String,
        },
        metadata: {
          totalVerses: Number,
          usedCount: Number,
          unusedCount: Number,
          lastReset: String,
          totalResets: { type: Number, default: 0 },
          lastUpdated: String,
        },
      },
      { timestamps: false, collection: "verse_pool" }
    )
  );

  return PoolModel;
}

// ─── Seed Pool ───────────────────────────────────────────────────────────────

/**
 * Load semua verses_YYYY.json dan gabung jadi 1 pool.
 * Dipanggil saat first deploy atau manual re-seed.
 */
async function seedPoolFromFiles() {
  console.log("🌱 Seeding verse pool from JSON files...");

  const allVerses = [];
  const allSpecialDayVerses = {};
  const years = [];

  // Scan for verses_YYYY.json files
  const files = await fs.readdir(DATA_DIR);
  const verseFiles = files.filter((f) => /^verses_\d{4}\.json$/.test(f));

  if (verseFiles.length === 0) {
    console.error("❌ No verses_YYYY.json files found!");
    return { success: false, error: "No verse files found" };
  }

  for (const file of verseFiles) {
    try {
      const data = await fs.readJson(path.join(DATA_DIR, file));
      const year = data.year;
      years.push(year);

      // Add verses with year reference
      for (const verse of data.verses || []) {
        allVerses.push({
          ...verse,
          _uid: `${year}_${verse.id}`, // unique ID across years
          sourceYear: year,
          used: false,
          sentAt: null,
          sentTo: null,
        });
      }

      // Merge special day verses
      if (data.specialDayVerses) {
        Object.assign(allSpecialDayVerses, data.specialDayVerses);
      }
    } catch (err) {
      console.error(`❌ Error reading ${file}:`, err.message);
    }
  }

  // Shuffle pool for randomness
  shuffleArray(allVerses);

  const poolData = {
    _id: "main",
    verses: allVerses,
    specialDayVerses: allSpecialDayVerses,
    todayTheme: null,
    metadata: {
      totalVerses: allVerses.length,
      usedCount: 0,
      unusedCount: allVerses.length,
      lastReset: new Date().toISOString(),
      totalResets: 0,
      lastUpdated: new Date().toISOString(),
      sourceYears: years,
    },
  };

  // Save to MongoDB
  if (mongoService.isConnected()) {
    const Model = getPoolModel();
    await Model.updateOne({ _id: "main" }, { $set: poolData }, { upsert: true }).exec();
    console.log(`✅ Pooled ${allVerses.length} verses from years: ${years.join(", ")}`);
  }

  return {
    success: true,
    totalVerses: allVerses.length,
    years,
    specialDays: Object.keys(allSpecialDayVerses).length,
  };
}

// ─── Pool Operations ─────────────────────────────────────────────────────────

/**
 * Load pool dari MongoDB. Auto-seed kalau kosong.
 */
async function loadPool() {
  if (!mongoService.isConnected()) {
    console.warn("⚠️ MongoDB not connected, cannot load pool");
    return null;
  }

  const Model = getPoolModel();
  const doc = await Model.findById("main").lean().exec();

  if (!doc || !doc.verses || doc.verses.length === 0) {
    console.log("📖 Verse pool kosong, auto-seeding...");
    await seedPoolFromFiles();
    return Model.findById("main").lean().exec();
  }

  return doc;
}

/**
 * Save pool ke MongoDB
 */
async function savePool(poolData) {
  if (!mongoService.isConnected()) return false;
  const Model = getPoolModel();
  await Model.updateOne({ _id: "main" }, { $set: poolData }, { upsert: true }).exec();
  return true;
}

/**
 * Get verses untuk hari ini berdasarkan tema.
 * Returns 1-3 verses matching theme.
 *
 * @param {string} theme - Tema renungan
 * @param {object} specialDay - { name, verseRef } kalau hari spesial
 * @returns {object} { verses: [...], theme, isSpecial }
 */
async function getVersesForToday(theme, specialDay = null) {
  const pool = await loadPool();
  if (!pool) return { verses: [], theme: "umum", isSpecial: false };

  let selectedVerses = [];

  // ── HARI SPESIAL: pakai ayat spesial + 1-2 dari pool ──
  if (specialDay) {
    const specialKey = specialDay.name
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/hari_/g, "");

    // Get main special verse
    const specialVerseRef = findSpecialDayVerse(pool.specialDayVerses, specialKey);

    if (specialVerseRef) {
      selectedVerses.push({
        _uid: "special_" + specialKey,
        verse: specialVerseRef,
        category: "spesial",
        sourceYear: "special",
        isSpecialVerse: true,
      });
    }
    // Cukup 1 ayat spesial saja (bisa berupa range seperti "Lukas 2:10-14")

    return {
      verses: selectedVerses.slice(0, 3), // max 3
      theme: specialDay.name,
      isSpecial: true,
      specialDay: specialDay.name,
    };
  }

  // ── HARI BIASA: 1-2 ayat matching tema ──
  const unused = pool.verses.filter((v) => !v.used && v.category === theme);

  // Kalau tema ini habis, coba tema lain
  if (unused.length === 0) {
    console.log(`⚠️ Tema "${theme}" habis, cari tema lain...`);
    const anyUnused = pool.verses.filter((v) => !v.used);

    if (anyUnused.length === 0) {
      // SEMUA HABIS! Auto-reset
      console.log("🔄 Semua ayat terpakai! Auto-reset pool...");
      await resetPool();
      return getVersesForToday(theme, specialDay); // retry after reset
    }

    // Random pick dari semua unused
    shuffleArray(anyUnused);
    selectedVerses.push(anyUnused[0]);
    theme = anyUnused[0].category; // adjust theme to match
  } else {
    shuffleArray(unused);
    selectedVerses.push(unused[0]);
    // Cukup 1 ayat saja per hari (bisa berupa range seperti "Mazmur 4:5-7")
  }

  return {
    verses: selectedVerses,
    theme,
    isSpecial: false,
  };
}

/**
 * Mark verses sebagai used (setelah renungan terkirim)
 */
async function markVersesUsed(verseUids, sentTo = null) {
  const pool = await loadPool();
  if (!pool) return false;

  const now = new Date().toISOString();
  let updatedCount = 0;

  for (const uid of verseUids) {
    // Skip special verses (not in pool)
    if (uid.startsWith("special_")) continue;

    const idx = pool.verses.findIndex((v) => v._uid === uid);
    if (idx !== -1 && !pool.verses[idx].used) {
      pool.verses[idx].used = true;
      pool.verses[idx].sentAt = now;
      pool.verses[idx].sentTo = sentTo;
      updatedCount++;
    }
  }

  // Update metadata
  pool.metadata.usedCount = pool.verses.filter((v) => v.used).length;
  pool.metadata.unusedCount = pool.verses.length - pool.metadata.usedCount;
  pool.metadata.lastUpdated = now;

  await savePool(pool);
  console.log(`📖 Marked ${updatedCount} verses as used (${pool.metadata.unusedCount} remaining)`);
  return true;
}

/**
 * Reset pool: semua ayat → unused
 */
async function resetPool() {
  const pool = await loadPool();
  if (!pool) return false;

  pool.verses.forEach((v) => {
    v.used = false;
    v.sentAt = null;
    v.sentTo = null;
  });

  // Re-shuffle for new cycle
  shuffleArray(pool.verses);

  pool.metadata.usedCount = 0;
  pool.metadata.unusedCount = pool.verses.length;
  pool.metadata.lastReset = new Date().toISOString();
  pool.metadata.totalResets = (pool.metadata.totalResets || 0) + 1;

  await savePool(pool);
  console.log(`🔄 Pool reset! ${pool.verses.length} verses available (cycle #${pool.metadata.totalResets})`);
  return true;
}

// ─── Theme Pre-Compute ───────────────────────────────────────────────────────

/**
 * Pre-compute tema untuk hari ini (dipanggil 30 menit sebelum renungan).
 * Pakai AI yang sudah dikonfigurasi, fallback ke hardcoded.
 */
async function precomputeTheme() {
  const today = moment();
  const dayName = today.format("dddd");
  const dateStr = today.format("D MMMM YYYY");
  const dayOfWeek = today.day();

  console.log(`🎨 Pre-computing theme for ${dayName}, ${dateStr}...`);

  // 1. Cek special day dulu (override AI)
  try {
    const { checkSpecialDay } = require("./aiService");
    const specialDay = await checkSpecialDay();
    if (specialDay) {
      const themeData = {
        theme: specialDay.toLowerCase().replace(/\s+/g, "_"),
        reason: `Hari spesial: ${specialDay}`,
        computedAt: new Date().toISOString(),
        date: today.format("YYYY-MM-DD"),
        isSpecial: true,
        specialDayName: specialDay,
      };
      await saveTodayTheme(themeData);
      console.log(`🎉 Special day theme: ${specialDay}`);
      return themeData;
    }
  } catch (e) {
    console.warn("⚠️ checkSpecialDay failed:", e.message);
  }

  // 2. Try AI theme generation
  try {
    const aiTheme = await generateThemeWithAI(dayName, dateStr, dayOfWeek);
    if (aiTheme) {
      const themeData = {
        theme: aiTheme.theme,
        reason: aiTheme.reason || "AI generated",
        computedAt: new Date().toISOString(),
        date: today.format("YYYY-MM-DD"),
        isSpecial: false,
      };
      await saveTodayTheme(themeData);
      console.log(`🎨 AI theme: ${aiTheme.theme} (${aiTheme.reason || ""})`);
      return themeData;
    }
  } catch (e) {
    console.warn("⚠️ AI theme generation failed:", e.message);
  }

  // 3. Fallback: hardcoded by day of week
  const fallbackTheme = DAILY_THEMES[dayOfWeek] || "umum";
  const themeData = {
    theme: fallbackTheme,
    reason: `Default: ${dayName} = ${fallbackTheme}`,
    computedAt: new Date().toISOString(),
    date: today.format("YYYY-MM-DD"),
    isSpecial: false,
    isFallback: true,
  };
  await saveTodayTheme(themeData);
  console.log(`📅 Fallback theme: ${fallbackTheme} (${dayName})`);
  return themeData;
}

/**
 * Call AI untuk generate tema
 */
async function generateThemeWithAI(dayName, dateStr, dayOfWeek) {
  const axios = require("axios");

  // Use configured AI endpoint
  const endpoint = process.env.AI_API_ENDPOINT;
  const apiKey = (process.env.AI_API_KEY || "").split(",")[0].trim();
  const model = process.env.AI_MODEL || "gemini/gemini-2.5-flash-lite";

  if (!endpoint || !apiKey) {
    console.log("⚠️ No AI endpoint configured, using fallback theme");
    return null;
  }

  const prompt = `Kamu asisten renungan Kristen. Hari ini: ${dayName}, ${dateStr}.

Pilih 1 tema renungan dari daftar ini:
${VALID_THEMES.join(", ")}

Pertimbangkan:
- Hari dalam minggu (${dayName})
- Konteks waktu (${dateStr})
- Variasi (jangan terlalu sering pilih tema yang sama)

Jawab HANYA dalam format JSON (tanpa markdown):
{"theme": "...", "reason": "...singkat..."}`;

  try {
    const response = await axios.post(
      `${endpoint}/chat/completions`,
      {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 100,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    const content = response.data.choices?.[0]?.message?.content || "";

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.theme && VALID_THEMES.includes(parsed.theme)) {
        return { theme: parsed.theme, reason: parsed.reason || "" };
      }
    }

    console.warn("⚠️ AI returned invalid theme, using fallback");
    return null;
  } catch (error) {
    console.error("❌ AI theme call failed:", error.message);
    return null;
  }
}

/**
 * Save today's theme ke MongoDB
 */
async function saveTodayTheme(themeData) {
  if (!mongoService.isConnected()) return false;
  const Model = getPoolModel();
  await Model.updateOne(
    { _id: "main" },
    { $set: { todayTheme: themeData } },
    { upsert: true }
  ).exec();
  return true;
}

/**
 * Get pre-computed theme untuk hari ini.
 * Kalau belum ada atau sudah expired (beda tanggal), return null.
 */
async function getTodayTheme() {
  const pool = await loadPool();
  if (!pool || !pool.todayTheme) return null;

  const today = moment().format("YYYY-MM-DD");
  if (pool.todayTheme.date !== today) {
    return null; // expired, need re-compute
  }

  return pool.todayTheme;
}

// ─── Stats ───────────────────────────────────────────────────────────────────

/**
 * Get pool statistics
 */
async function getPoolStats() {
  const pool = await loadPool();
  if (!pool) {
    return { total: 0, used: 0, unused: 0, error: "Pool not loaded" };
  }

  const total = pool.verses.length;
  const used = pool.verses.filter((v) => v.used).length;
  const unused = total - used;

  // Category breakdown
  const byCategory = {};
  for (const v of pool.verses) {
    if (!byCategory[v.category]) {
      byCategory[v.category] = { total: 0, used: 0, unused: 0 };
    }
    byCategory[v.category].total++;
    if (v.used) byCategory[v.category].used++;
    else byCategory[v.category].unused++;
  }

  return {
    total,
    used,
    unused,
    percentage: total > 0 ? Math.round((used / total) * 100) : 0,
    specialDays: Object.keys(pool.specialDayVerses || {}).length,
    todayTheme: pool.todayTheme,
    byCategory,
    lastReset: pool.metadata?.lastReset,
    totalResets: pool.metadata?.totalResets || 0,
    estimatedDaysLeft: unused, // 1 verse/day approx
    estimatedYearsLeft: (unused / 365).toFixed(1),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function findSpecialDayVerse(specialDayVerses, key) {
  if (!specialDayVerses) return null;
  // Direct match
  if (specialDayVerses[key]) return specialDayVerses[key];
  // Partial match
  for (const [k, v] of Object.entries(specialDayVerses)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return null;
}

function getRelatedThemes(specialDayName) {
  const name = specialDayName.toLowerCase();
  if (name.includes("natal") || name.includes("malam natal")) return ["harapan", "kasih", "iman"];
  if (name.includes("paskah") || name.includes("senin paskah")) return ["harapan", "iman", "kekuatan"];
  if (name.includes("jumat agung")) return ["kasih", "pertobatan", "iman"];
  if (name.includes("kamis putih")) return ["kasih", "doa", "pertobatan"];
  if (name.includes("pentakosta")) return ["kekuatan", "iman", "doa"];
  if (name.includes("kenaikan")) return ["harapan", "iman"];
  if (name.includes("tritunggal")) return ["iman", "hikmat"];
  if (name.includes("minggu palma")) return ["harapan", "iman"];
  if (name.includes("rabu abu")) return ["pertobatan", "doa"];
  if (name.includes("tahun baru") || name.includes("malam tahun")) return ["harapan", "hikmat"];
  if (name.includes("kemerdekaan")) return ["kekuatan", "harapan"];
  if (name.includes("kasih sayang")) return ["kasih"];
  if (name.includes("ibu")) return ["kasih", "hikmat"];
  if (name.includes("ayah")) return ["kekuatan", "hikmat"];
  if (name.includes("reformasi")) return ["iman", "kekuatan"];
  if (name.includes("pahlawan")) return ["kekuatan", "iman"];
  if (name.includes("guru")) return ["hikmat", "pertumbuhan_rohani"];
  if (name.includes("anak")) return ["kasih", "harapan"];
  if (name.includes("orang kudus")) return ["iman", "harapan"];
  if (name.includes("epifani")) return ["harapan", "iman"];
  if (name.includes("adven")) return ["harapan", "doa"];
  if (name.includes("pengucapan syukur") || name.includes("thanksgiving")) return ["harapan", "kasih"];
  return ["harapan", "kasih", "iman", "kekuatan"];
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  // Pool management
  loadPool,
  savePool,
  seedPoolFromFiles,
  resetPool,

  // Daily operations
  getVersesForToday,
  markVersesUsed,

  // Theme
  precomputeTheme,
  getTodayTheme,
  DAILY_THEMES,
  VALID_THEMES,

  // Stats
  getPoolStats,
};
