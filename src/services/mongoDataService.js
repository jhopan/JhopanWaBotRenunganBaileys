/**
 * MongoDB Data Service - Verses & Config data access with auto-fallback
 *
 * Reuses the existing mongoService.js (Mongoose) for the connection,
 * so there is a single shared connection pool with the Baileys auth state.
 *
 * Data domains:
 *   1. Config  – single document { _id: "bot_config", ...settings }
 *   2. Verses  – one document per year { _id: <year>, year, verses[], specialDayVerses{}, metadata{} }
 *
 * Design:
 *   - Try MongoDB first on every operation
 *   - On ANY failure → transparently fall back to local JSON files
 *   - Opportunistic sync: when file is read and MongoDB becomes available later,
 *     data is pushed to MongoDB automatically
 */

const fs = require("fs-extra");
const path = require("path");
const mongoService = require("./mongoService");

// ─── Paths ─────────────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, "../data");
const CONFIG_FILE = path.join(DATA_DIR, "bot_config.json");

// ─── Mongoose Models (lazy-init) ───────────────────────────────────────────────

let ConfigModel = null;
let VersesModel = null;

/**
 * Safe model getter – avoids "Cannot overwrite model" error on hot-reload.
 */
function getModel(name, schemaFactory) {
  const mongoose = mongoService.getMongoose();
  if (!mongoose) throw new Error("MongoDB not connected");

  if (mongoose.models[name]) return mongoose.model(name);
  return mongoose.model(name, schemaFactory());
}

function getConfigModel() {
  if (!ConfigModel) {
    ConfigModel = getModel("BotConfig", () => {
      const mongoose = mongoService.getMongoose();
      return new mongoose.Schema(
        {
          _id: { type: String, default: "bot_config" },
          renunganGroupId: { type: String, default: "" },
          renunganGroupName: { type: String, default: "" },
          renunganTime: { type: String, default: "08:00" },
          hideTagEnabled: { type: Boolean, default: false },
          multiGroupEnabled: { type: Boolean, default: false },
          renunganGroups: { type: Array, default: [] },
          multiGroupDelayMinutes: { type: Number, default: 2 },
          birthdayGroupId: { type: String, default: "" },
          birthdayTime: { type: String, default: "07:00" },
          birthdayDelayMinutes: { type: Number, default: 5 },
          enabled: { type: Boolean, default: true },
          birthdayEnabled: { type: Boolean, default: true },
          lastUpdated: { type: String },
        },
        { timestamps: false, collection: "bot_config" }
      );
    });
  }
  return ConfigModel;
}

function getVersesModel() {
  if (!VersesModel) {
    VersesModel = getModel("Verses", () => {
      const mongoose = mongoService.getMongoose();
      return new mongoose.Schema(
        {
          _id: { type: Number }, // year
          year: { type: Number, required: true },
          verses: { type: Array, default: [] },
          specialDayVerses: { type: Object, default: {} },
          metadata: { type: Object, default: {} },
        },
        { timestamps: false, collection: "verses" }
      );
    });
  }
  return VersesModel;
}

// ─── MongoDB Operations ────────────────────────────────────────────────────────

async function loadConfigFromMongo() {
  if (!mongoService.isConnected()) return null;
  try {
    const Model = getConfigModel();
    const doc = await Model.findById("bot_config").lean().exec();
    if (!doc) return null;
    const { _id, __v, ...config } = doc;
    return config;
  } catch (error) {
    console.warn("⚠️ MongoDB loadConfig failed:", error.message);
    return null;
  }
}

async function saveConfigToMongo(config) {
  if (!mongoService.isConnected()) return false;
  try {
    const Model = getConfigModel();
    await Model.updateOne(
      { _id: "bot_config" },
      { $set: { ...config, _id: "bot_config", lastUpdated: new Date().toISOString() } },
      { upsert: true }
    ).exec();
    return true;
  } catch (error) {
    console.warn("⚠️ MongoDB saveConfig failed:", error.message);
    return false;
  }
}

async function loadVersesFromMongo(year) {
  if (!mongoService.isConnected()) return null;
  try {
    const Model = getVersesModel();
    const doc = await Model.findById(year).lean().exec();
    if (!doc) return null;
    const { _id, __v, ...data } = doc;
    return data;
  } catch (error) {
    console.warn("⚠️ MongoDB loadVerses failed:", error.message);
    return null;
  }
}

async function saveVersesToMongo(data, year) {
  if (!mongoService.isConnected()) return false;
  try {
    const targetYear = year || data.year;
    const Model = getVersesModel();
    const docToSave = {
      ...data,
      _id: targetYear,
      metadata: {
        ...data.metadata,
        lastUpdated: new Date().toISOString(),
        totalVerses: data.verses ? data.verses.length : 0,
      },
    };
    await Model.updateOne(
      { _id: targetYear },
      { $set: docToSave },
      { upsert: true }
    ).exec();
    return true;
  } catch (error) {
    console.warn("⚠️ MongoDB saveVerses failed:", error.message);
    return false;
  }
}

// ─── Local File Fallback ───────────────────────────────────────────────────────

function getVersesFilePath(year) {
  return path.join(DATA_DIR, `verses_${year}.json`);
}

async function loadConfigFromFile() {
  try {
    if (await fs.pathExists(CONFIG_FILE)) {
      return await fs.readJson(CONFIG_FILE);
    }
    return null;
  } catch (error) {
    console.error("❌ File loadConfig error:", error.message);
    return null;
  }
}

async function saveConfigToFile(config) {
  try {
    config.lastUpdated = new Date().toISOString();
    await fs.ensureDir(DATA_DIR);
    await fs.writeJson(CONFIG_FILE, config, { spaces: 2 });
    return true;
  } catch (error) {
    console.error("❌ File saveConfig error:", error.message);
    return false;
  }
}

async function loadVersesFromFile(year) {
  try {
    const filePath = getVersesFilePath(year);
    if (await fs.pathExists(filePath)) {
      return await fs.readJson(filePath);
    }
    return null;
  } catch (error) {
    console.error("❌ File loadVerses error:", error.message);
    return null;
  }
}

async function saveVersesToFile(data, year) {
  try {
    const targetYear = year || data.year;
    const filePath = getVersesFilePath(targetYear);
    data.metadata = data.metadata || {};
    data.metadata.lastUpdated = new Date().toISOString();
    data.metadata.totalVerses = data.verses ? data.verses.length : 0;
    await fs.ensureDir(DATA_DIR);
    await fs.writeJson(filePath, data, { spaces: 2 });
    return true;
  } catch (error) {
    console.error("❌ File saveVerses error:", error.message);
    return false;
  }
}

// ─── Unified API (Mongo-first, file fallback) ─────────────────────────────────

/**
 * Load config: MongoDB → file → default.
 */
async function loadConfig() {
  // 1. Try MongoDB
  let config = await loadConfigFromMongo();
  if (config) {
    console.log("📂 Config loaded from MongoDB");
    return config;
  }

  // 2. Fallback to file
  config = await loadConfigFromFile();
  if (config) {
    console.log("📂 Config loaded from local file (MongoDB fallback)");

    // Opportunistically sync to MongoDB for next time
    saveConfigToMongo(config).catch(() => {});
    return config;
  }

  // 3. Default config
  console.log("📂 Using default config (no data source found)");
  return {
    renunganGroupId: process.env.RENUNGAN_GROUP_ID || "",
    renunganGroupName: "",
    renunganTime: process.env.RENUNGAN_TIME || "08:00",
    hideTagEnabled: false,
    multiGroupEnabled: false,
    renunganGroups: [],
    multiGroupDelayMinutes: 2,
    birthdayGroupId: "",
    birthdayTime: "07:00",
    birthdayDelayMinutes: 5,
    enabled: true,
    birthdayEnabled: true,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Save config: MongoDB → file.
 * Writes to BOTH when MongoDB succeeds (file as backup).
 */
async function saveConfig(config) {
  // 1. Try MongoDB
  const mongoOk = await saveConfigToMongo(config);
  if (mongoOk) {
    console.log("💾 Config saved to MongoDB");
    // Also write to file as backup (silent)
    saveConfigToFile(config).catch(() => {});
    return true;
  }

  // 2. Fallback to file
  console.log("💾 Config saved to local file (MongoDB unavailable)");
  return saveConfigToFile(config);
}

/**
 * Load verses: MongoDB → file → empty.
 */
async function loadVerses(year) {
  const targetYear = year || new Date().getFullYear();

  // 1. Try MongoDB
  let data = await loadVersesFromMongo(targetYear);
  if (data && data.verses) {
    console.log(`📖 Verses ${targetYear} loaded from MongoDB`);
    return data;
  }

  // 2. Fallback to file
  data = await loadVersesFromFile(targetYear);
  if (data) {
    console.log(`📖 Verses ${targetYear} loaded from local file (MongoDB fallback)`);

    // Opportunistically sync to MongoDB
    saveVersesToMongo(data, targetYear).catch(() => {});
    return data;
  }

  // 3. Empty
  console.log(`⚠️ No verses data for year ${targetYear}`);
  return { year: targetYear, verses: [], specialDayVerses: {}, metadata: {} };
}

/**
 * Save verses: MongoDB → file.
 * Writes to BOTH when MongoDB succeeds (file as backup).
 */
async function saveVerses(data, year) {
  const targetYear = year || data.year;

  // 1. Try MongoDB
  const mongoOk = await saveVersesToMongo(data, targetYear);
  if (mongoOk) {
    console.log(`💾 Verses ${targetYear} saved to MongoDB`);
    // Also write to file as backup (silent)
    saveVersesToFile(data, targetYear).catch(() => {});
    return true;
  }

  // 2. Fallback to file
  console.log(`💾 Verses ${targetYear} saved to local file (MongoDB unavailable)`);
  return saveVersesToFile(data, targetYear);
}

// ─── Status ────────────────────────────────────────────────────────────────────

/**
 * Get data storage status.
 */
function getStatus() {
  const mongoStatus = mongoService.getStatus();
  return {
    mongodb: mongoStatus,
    fallback: "local JSON files",
    activeStorage: mongoService.isConnected() ? "MongoDB" : "local files",
  };
}

// ─── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Unified API (mongo-first + fallback)
  loadConfig,
  saveConfig,
  loadVerses,
  saveVerses,

  // Direct MongoDB operations
  loadConfigFromMongo,
  saveConfigToMongo,
  loadVersesFromMongo,
  saveVersesToMongo,

  // Direct file operations
  loadConfigFromFile,
  saveConfigToFile,
  loadVersesFromFile,
  saveVersesToFile,

  // Status
  getStatus,
};
