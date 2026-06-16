/**
 * MongoDB Auth State Adapter untuk Baileys
 *
 * Drop-in replacement untuk useMultiFileAuthState() yang menyimpan
 * auth state di MongoDB alih-alih filesystem (folder baileys_auth_info/).
 *
 * Output function ini 100% kompatibel dengan Baileys AuthenticationState interface:
 *   { state: { creds, keys }, saveCreds }
 *
 * Keuntungan vs file-based auth:
 *   ✅ Persisten across deployments (container restart, redeploy, dsb)
 *   ✅ Tidak perlu volume mount untuk auth folder
 *   ✅ Siap untuk horizontal scaling (multiple instance)
 *   ✅ Atomic writes – tidak ada corrupt file saat crash
 *   ✅ Centralized storage – semua data di satu tempat
 *
 * Data yang disimpan:
 *   📄 wa_credentials (1 dokumen) – identity keys, registration info, noise keys
 *   📄 wa_auth_keys   (N dokumen) – pre-keys, sender-keys, session-keys, app-state
 *
 * @example
 *   // Di botWhatsApp.js – ganti useMultiFileAuthState:
 *   // SEBELUM:
 *   //   const { state, saveCreds } = await useMultiFileAuthState('./baileys_auth_info');
 *   // SESUDAH:
 *   const { initAuthState } = require('./services/mongoAuthState');
 *   const { state, saveCreds } = await initAuthState();
 *
 *   sock = makeWASocket({
 *     auth: {
 *       creds: state.creds,
 *       keys: makeCacheableSignalKeyStore(state.keys, logger),
 *     },
 *   });
 *
 *   sock.ev.on('creds.update', saveCreds);
 */

const { initAuthCreds, proto } = require("@whiskeysockets/baileys");
const mongoService = require("./mongoService");

// ============================================
// BUFFER SERIALIZATION HELPERS
// ============================================

/**
 * JSON reviver that converts {"type":"Buffer","data":[...]} objects back to real Buffers.
 * JSON.stringify(Buffer) produces this format, but JSON.parse doesn't restore Buffer.
 */
function bufferReviver(key, value) {
  if (value && typeof value === "object" && value.type === "Buffer" && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }
  return value;
}

/**
 * Safe JSON.parse with Buffer restoration
 */
function jsonParseWithBuffers(str) {
  return JSON.parse(str, bufferReviver);
}

// ============================================
// MONGOOSE SCHEMAS & MODELS
// ============================================

/**
 * Safe model getter – hindari "Cannot overwrite model" error
 * saat hot-reload atau multiple initialization.
 */
function getModel(name, schemaFactory) {
  const mongoose = mongoService.getMongoose();
  if (!mongoose) throw new Error("MongoDB belum terkoneksi");

  // Return existing model jika sudah terdaftar
  if (mongoose.models[name]) {
    return mongoose.model(name);
  }

  return mongoose.model(name, schemaFactory());
}

/**
 * CredentialModel – menyimpan creds (identity, registration, noise keys).
 * Hanya ada 1 dokumen di collection ini (singleton).
 *
 * Data disimpan sebagai JSON string untuk menghindari masalah serialisasi
 * BSON terhadap Buffer/Uint8Array yang ada di creds object Baileys.
 */
function getCredentialModel() {
  return getModel("BaileysCredential", () => {
    const mongoose = mongoService.getMongoose();
    const schema = new mongoose.Schema(
      {
        _id: { type: String, default: "main" },
        data: { type: String, required: true },
      },
      {
        timestamps: true,
        collection: "wa_credentials",
      },
    );
    return schema;
  });
}

/**
 * KeyModel – menyimpan Signal Protocol keys per kategori.
 *
 * Kategori:
 *   pre-key          – One-time pre-keys untuk X3DH handshake
 *   sender-key       – Sender keys untuk group messaging
 *   session          – Signal session state (pairwise)
 *   app-state-sync   – App state sync keys (multi-device)
 *
 * Setiap key diidentifikasi oleh (category, kid) composite key.
 */
function getKeyModel() {
  return getModel("BaileysKey", () => {
    const mongoose = mongoService.getMongoose();
    const schema = new mongoose.Schema(
      {
        category: { type: String, required: true },
        kid: { type: String, required: true },
        data: { type: String, required: true },
      },
      {
        timestamps: true,
        collection: "wa_auth_keys",
      },
    );
    schema.index({ category: 1, kid: 1 }, { unique: true });
    return schema;
  });
}

// ============================================
// DATABASE OPERATIONS
// ============================================

/**
 * Load credentials dari MongoDB.
 * @returns {Promise<object|null>} Parsed creds object atau null jika belum ada
 */
async function loadCreds() {
  const CredentialModel = getCredentialModel();
  const doc = await CredentialModel.findById("main").lean().exec();
  if (!doc?.data) return null;

  try {
    return jsonParseWithBuffers(doc.data);
  } catch (error) {
    console.warn("⚠️ Credential data corrupt, akan generate baru:", error.message);
    return null;
  }
}

/**
 * Save credentials ke MongoDB (upsert).
 * @param {object} creds - Baileys creds object
 */
async function saveCredsToDb(creds) {
  const CredentialModel = getCredentialModel();
  await CredentialModel.updateOne(
    { _id: "main" },
    { $set: { data: JSON.stringify(creds) } },
    { upsert: true },
  ).exec();
}

/**
 * Load keys berdasarkan kategori.
 * @param {string} category - Key category (pre-key, sender-key, session, app-state-sync)
 * @param {string[]} ids - Array of key IDs
 * @returns {Promise<Object<string, object>>} Map of id → parsed key data
 */
async function loadKeys(category, ids) {
  const KeyModel = getKeyModel();
  if (!ids || ids.length === 0) return {};

  const docs = await KeyModel.find({
    category,
    kid: { $in: ids },
  })
    .lean()
    .exec();

  const result = {};
  for (const doc of docs) {
    try {
      result[doc.kid] = jsonParseWithBuffers(doc.data);
    } catch {
      // Skip corrupt key entries
    }
  }

  return result;
}

/**
 * Save multiple keys (bulk upsert).
 * @param {string} category - Key category
 * @param {Object<string, object>} keyMap - Map of id → key data
 */
async function saveKeysToDb(category, keyMap) {
  const KeyModel = getKeyModel();
  const entries = Object.entries(keyMap);
  if (entries.length === 0) return;

  const bulkOps = entries.map(([kid, value]) => ({
    updateOne: {
      filter: { category, kid },
      update: { $set: { data: JSON.stringify(value) } },
      upsert: true,
    },
  }));

  await KeyModel.bulkWrite(bulkOps, { ordered: false });
}

/**
 * Delete keys berdasarkan kategori dan IDs.
 * @param {string} category - Key category
 * @param {string[]} ids - Array of key IDs to delete
 */
async function deleteKeys(category, ids) {
  const KeyModel = getKeyModel();
  if (!ids || ids.length === 0) return;

  await KeyModel.deleteMany({
    category,
    kid: { $in: ids },
  }).exec();
}

/**
 * Delete semua keys dalam satu kategori.
 * @param {string} category - Key category
 */
async function clearKeysByCategory(category) {
  const KeyModel = getKeyModel();
  await KeyModel.deleteMany({ category }).exec();
}

// ============================================
// AUTH STATE INITIALIZATION
// ============================================

/**
 * Inisialisasi Baileys AuthenticationState dengan MongoDB backend.
 *
 * Jika credentials sudah ada di DB → load dan gunakan.
 * Jika belum → generate credentials baru (perlu scan QR).
 *
 * @returns {Promise<{
 *   state: import('@whiskeysockets/baileys').AuthenticationState,
 *   saveCreds: () => Promise<void>
 * }>}
 */
async function initAuthState() {
  // Pastikan MongoDB sudah terkoneksi
  if (!mongoService.isConnected()) {
    console.log("🍃 MongoDB belum connect, mencoba connect...");
    await mongoService.connect();
  }

  // Load atau generate credentials
  let creds = await loadCreds();
  let isNewSession = false;

  if (creds) {
    const phoneId = creds.me?.id || "unknown";
    console.log(`🔐 Auth credentials loaded dari MongoDB (${phoneId})`);
  } else {
    console.log("🔐 Generating new auth credentials (perlu scan QR)...");
    creds = initAuthCreds();
    isNewSession = true;
  }

  // Debounced save – cegah excessive DB writes saat creds.update fire berkali-kali
  let saveTimeout = null;
  let pendingSave = null;

  /**
   * Save credentials ke MongoDB.
   * Debounced 200ms – jika dipanggil berulang dalam 200ms, hanya 1 write yang terjadi.
   * Baileys memanggil ini setiap kali creds.update event fire.
   *
   * @param {object} [update] - Optional partial creds update (merged oleh Baileys sebelum dipanggil)
   */
  const saveCreds = async (update) => {
    // Merge update ke creds jika diberikan (Baileys kadang pass partial update)
    if (update) {
      Object.assign(creds, update);
    }

    // Clear pending save sebelumnya
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    // Return existing promise jika ada save yang sedang menunggu
    if (pendingSave) {
      return pendingSave;
    }

    // Debounce: tunggu 200ms sebelum write ke DB
    pendingSave = new Promise((resolve) => {
      saveTimeout = setTimeout(async () => {
        saveTimeout = null;
        pendingSave = null;
        try {
          await saveCredsToDb(creds);
        } catch (error) {
          console.error("❌ Gagal save credentials ke MongoDB:", error.message);
        }
        resolve();
      }, 200);
    });

    return pendingSave;
  };

  // ============================================
  // KEYS PROXY (Baileys SignalKeyStore interface)
  // ============================================

  /**
   * Proxy object yang mengimplementasikan Baileys SignalKeyStore interface.
   *
   * Interface yang dibutuhkan:
   *   get(category, ids)  → Promise<{ [id]: data }>
   *   set({ category: { [id]: data } }) → Promise<void>
   *   clear(category?)    → Promise<void>
   */
  const keys = {
    /**
     * Ambil keys berdasarkan kategori dan IDs.
     * @param {string} category - pre-key | sender-key | session | app-state-sync
     * @param {string[]} ids - Array of key IDs
     */
    async get(category, ids) {
      try {
        return await loadKeys(category, ids);
      } catch (error) {
        console.error(`❌ Error load keys [${category}]:`, error.message);
        return {};
      }
    },

    /**
     * Simpan keys (bulk upsert per kategori).
     * @param {Object<string, Object<string, object>>} data - { category: { id: value } }
     */
    async set(data) {
      try {
        const promises = Object.entries(data).map(([category, keyMap]) => {
          // Filter out null/undefined values (Baileys sometimes sends these for deletion)
          const validEntries = {};
          const toDelete = [];

          for (const [id, value] of Object.entries(keyMap)) {
            if (value !== null && value !== undefined) {
              validEntries[id] = value;
            } else {
              toDelete.push(id);
            }
          }

          const ops = [];
          if (Object.keys(validEntries).length > 0) {
            ops.push(saveKeysToDb(category, validEntries));
          }
          if (toDelete.length > 0) {
            ops.push(deleteKeys(category, toDelete));
          }

          return Promise.all(ops);
        });

        await Promise.all(promises);
      } catch (error) {
        console.error("❌ Error save keys:", error.message);
      }
    },

    /**
     * Hapus keys. Jika category diberikan, hapus semua keys di kategori tersebut.
     * @param {string} [category] - Optional category to clear
     */
    async clear(category) {
      try {
        if (category) {
          await clearKeysByCategory(category);
          console.log(`🧹 Keys cleared: ${category}`);
        }
      } catch (error) {
        console.error(`❌ Error clear keys [${category}]:`, error.message);
      }
    },
  };

  // ============================================
  // BUILD AUTH STATE
  // ============================================

  /** @type {import('@whiskeysockets/baileys').AuthenticationState} */
  const state = {
    creds,
    keys,
  };

  if (isNewSession) {
    console.log("📝 New auth session – save credentials pertama ke MongoDB...");
    await saveCredsToDb(creds);
  }

  console.log("✅ MongoDB auth state initialized");

  return { state, saveCreds };
}

// ============================================
// MIGRATION HELPERS
// ============================================

/**
 * Migrasi auth state dari file-based (useMultiFileAuthState) ke MongoDB.
 * Jalankan SEKALI saat pertama kali switch ke MongoDB backend.
 *
 * @param {string} authFolder - Path ke folder baileys_auth_info
 * @returns {Promise<{ success: boolean, message: string, keysMigrated: number }>}
 */
async function migrateFromFile(authFolder = "./baileys_auth_info") {
  const fs = require("fs");
  const path = require("path");

  if (!mongoService.isConnected()) {
    await mongoService.connect();
  }

  const result = { success: false, message: "", keysMigrated: 0 };

  // Check folder exists
  if (!fs.existsSync(authFolder)) {
    result.message = `Folder tidak ditemukan: ${authFolder}`;
    return result;
  }

  try {
    // 1. Migrate creds
    const credsPath = path.join(authFolder, "creds.json");
    if (fs.existsSync(credsPath)) {
      const credsData = JSON.parse(fs.readFileSync(credsPath, "utf8"));
      await saveCredsToDb(credsData);
      console.log("✅ Credentials berhasil dimigrasi dari file");
    } else {
      result.message = "creds.json tidak ditemukan di folder auth";
      return result;
    }

    // 2. Migrate keys
    const keyCategories = [
      "pre-keys",
      "sender-keys",
      "sessions",
      "app-state-sync-keys",
    ];

    for (const category of keyCategories) {
      const keyDir = path.join(authFolder, category);
      if (!fs.existsSync(keyDir)) continue;

      const files = fs.readdirSync(keyDir).filter((f) => f.endsWith(".json"));
      if (files.length === 0) continue;

      const keyMap = {};
      for (const file of files) {
        try {
          const kid = file.replace(".json", "");
          const data = JSON.parse(
            fs.readFileSync(path.join(keyDir, file), "utf8"),
          );
          keyMap[kid] = data;
        } catch {
          // Skip corrupt files
        }
      }

      if (Object.keys(keyMap).length > 0) {
        await saveKeysToDb(category, keyMap);
        result.keysMigrated += Object.keys(keyMap).length;
        console.log(
          `✅ ${category}: ${Object.keys(keyMap).length} keys dimigrasi`,
        );
      }
    }

    result.success = true;
    result.message = `Migrasi selesai! ${result.keysMigrated} keys dimigrasi.`;
    console.log(`🎉 ${result.message}`);
    return result;
  } catch (error) {
    result.message = `Migrasi gagal: ${error.message}`;
    console.error("❌", result.message);
    return result;
  }
}

/**
 * Export auth state dari MongoDB ke file (backup).
 * Berguna untuk backup atau rollback ke file-based auth.
 *
 * @param {string} outputFolder - Path folder output
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function exportToFile(outputFolder = "./baileys_auth_backup") {
  const fs = require("fs");
  const path = require("path");

  if (!mongoService.isConnected()) {
    await mongoService.connect();
  }

  const result = { success: false, message: "" };

  try {
    // Create output directory
    fs.mkdirSync(outputFolder, { recursive: true });

    // 1. Export creds
    const creds = await loadCreds();
    if (creds) {
      fs.writeFileSync(
        path.join(outputFolder, "creds.json"),
        JSON.stringify(creds, null, 2),
      );
    } else {
      result.message = "Tidak ada credentials di MongoDB";
      return result;
    }

    // 2. Export keys
    const KeyModel = getKeyModel();
    const allKeys = await KeyModel.find({}).lean().exec();

    const grouped = {};
    for (const key of allKeys) {
      if (!grouped[key.category]) grouped[key.category] = [];
      grouped[key.category].push(key);
    }

    let totalKeys = 0;
    for (const [category, keys] of Object.entries(grouped)) {
      const keyDir = path.join(outputFolder, category);
      fs.mkdirSync(keyDir, { recursive: true });

      for (const key of keys) {
        try {
          const data = JSON.parse(key.data);
          fs.writeFileSync(
            path.join(keyDir, `${key.kid}.json`),
            JSON.stringify(data, null, 2),
          );
          totalKeys++;
        } catch {
          // Skip corrupt entries
        }
      }
    }

    result.success = true;
    result.message = `Export selesai: creds + ${totalKeys} keys → ${outputFolder}`;
    console.log(`📦 ${result.message}`);
    return result;
  } catch (error) {
    result.message = `Export gagal: ${error.message}`;
    console.error("❌", result.message);
    return result;
  }
}

/**
 * Hapus semua auth data dari MongoDB (factory reset).
 * Setelah ini, bot perlu scan QR ulang.
 *
 * @returns {Promise<void>}
 */
async function clearAllAuthData() {
  if (!mongoService.isConnected()) {
    await mongoService.connect();
  }

  const CredentialModel = getCredentialModel();
  const KeyModel = getKeyModel();

  await CredentialModel.deleteMany({}).exec();
  const result = await KeyModel.deleteMany({}).exec();

  console.log(`🧹 Auth data cleared (${result.deletedCount || 0} keys + credentials)`);
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  initAuthState,
  migrateFromFile,
  exportToFile,
  clearAllAuthData,
};
