/**
 * MongoDB Connection Manager
 * Mengelola koneksi MongoDB dengan auto-reconnect dan health monitoring.
 *
 * Digunakan oleh:
 *   - mongoAuthState.js  → menyimpan auth state Baileys
 *   - (future services) → chat history, analytics, dsb.
 *
 * Config via environment variables:
 *   MONGODB_URI    – Full connection string (priority utama)
 *   MONGO_USER     – Username (fallback jika MONGODB_URI belum di-set)
 *   MONGO_PASS     – Password
 *   MONGO_HOST     – Host (default: localhost:27017)
 *   MONGO_DB       – Database name (default: whatsapp_bot)
 *
 * @example
 *   const mongoService = require('./mongoService');
 *   await mongoService.connect();
 *   console.log(mongoService.isConnected()); // true
 */

const mongoose = require("mongoose");

// ============================================
// CONFIGURATION
// ============================================

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_BASE_DELAY_MS = 2000;
const RECONNECT_MAX_DELAY_MS = 30000;
const DEFAULT_DB_NAME = "whatsapp_bot";
const SERVER_SELECTION_TIMEOUT_MS = 10000;

// ============================================
// STATE
// ============================================

let connectionState = "disconnected"; // disconnected | connecting | connected | error
let reconnectAttempts = 0;
let reconnectTimer = null;
let mongooseInstance = null;

// ============================================
// HELPERS
// ============================================

/**
 * Build MongoDB URI dari environment variables.
 * Priority: MONGODB_URI > compose dari MONGO_USER/PASS/HOST/DB
 */
function getMongoUri() {
  if (process.env.MONGODB_URI) {
    return process.env.MONGODB_URI;
  }

  const user = process.env.MONGO_USER;
  const pass = process.env.MONGO_PASS;
  const host = process.env.MONGO_HOST || "localhost:27017";
  const db = process.env.MONGO_DB || DEFAULT_DB_NAME;

  if (user && pass) {
    return `mongodb+srv://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}/${db}?retryWrites=true&w=majority`;
  }

  return `mongodb://${host}/${db}`;
}

/**
 * Get nama database (untuk health check & logging)
 */
function getDbName() {
  return process.env.MONGO_DB || DEFAULT_DB_NAME;
}

/**
 * Clear reconnect timer jika ada
 */
function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

// ============================================
// MAIN CONNECTION
// ============================================

/**
 * Connect ke MongoDB.
 * Safe dipanggil berkali-kali – return existing connection jika sudah connected.
 *
 * @param {string} [uri] - Custom URI (optional, default dari env)
 * @returns {Promise<typeof mongoose>} Mongoose instance
 */
async function connect(uri) {
  // Already connected – return existing
  if (
    connectionState === "connected" &&
    mongooseInstance?.connection?.readyState === 1
  ) {
    return mongooseInstance;
  }

  // Prevent concurrent connect() calls
  if (connectionState === "connecting") {
    console.log("⏳ MongoDB sedang connect, menunggu...");
    return new Promise((resolve, reject) => {
      const check = setInterval(() => {
        if (connectionState === "connected") {
          clearInterval(check);
          resolve(mongooseInstance);
        } else if (connectionState === "error" || connectionState === "disconnected") {
          clearInterval(check);
          reject(new Error("MongoDB connection failed"));
        }
      }, 200);
    });
  }

  clearReconnectTimer();
  connectionState = "connecting";

  const mongoUri = uri || getMongoUri();
  const dbName = getDbName();

  // Mask password untuk logging
  const maskedUri = mongoUri.replace(
    /\/\/([^:]+):([^@]+)@/,
    "//$1:****@",
  );
  console.log(`🍃 MongoDB connecting to: ${maskedUri}`);

  try {
    mongooseInstance = await mongoose.connect(mongoUri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
      socketTimeoutMS: 45000,
      heartbeatFrequencyMS: 10000,
    });

    connectionState = "connected";
    reconnectAttempts = 0;

    console.log(`✅ MongoDB connected! Database: "${dbName}"`);

    // ---- Connection event handlers ----

    mongoose.connection.on("error", (err) => {
      console.error("❌ MongoDB error:", err.message);
      connectionState = "error";
    });

    mongoose.connection.on("disconnected", () => {
      if (connectionState !== "disconnected") {
        console.warn("⚠️ MongoDB disconnected");
        connectionState = "disconnected";
        scheduleReconnect();
      }
    });

    mongoose.connection.on("reconnected", () => {
      console.log("✅ MongoDB reconnected");
      connectionState = "connected";
      reconnectAttempts = 0;
    });

    mongoose.connection.on("close", () => {
      connectionState = "disconnected";
    });

    return mongooseInstance;
  } catch (error) {
    connectionState = "error";
    console.error("❌ MongoDB connection failed:", error.message);

    if (error.name === "MongoNetworkError" || error.code === "ENOTFOUND") {
      console.error("   Pastikan MongoDB server berjalan dan URI benar.");
    }

    scheduleReconnect();
    throw error;
  }
}

// ============================================
// RECONNECT LOGIC
// ============================================

/**
 * Schedule reconnect dengan exponential backoff.
 * Delay: 2s → 4s → 8s → ... → max 30s
 */
function scheduleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error(
      `❌ MongoDB: ${MAX_RECONNECT_ATTEMPTS}x reconnect gagal. ` +
        `Periksa koneksi atau restart aplikasi.`,
    );
    return;
  }

  reconnectAttempts++;
  const delay = Math.min(
    RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts - 1),
    RECONNECT_MAX_DELAY_MS,
  );

  console.log(
    `🔄 MongoDB reconnect #${reconnectAttempts} dalam ${(delay / 1000).toFixed(1)}s...`,
  );

  clearReconnectTimer();
  reconnectTimer = setTimeout(async () => {
    try {
      await connect();
    } catch {
      // Error sudah di-log di dalam connect()
      // scheduleReconnect() dipanggil otomatis dari event handler
    }
  }, delay);
}

// ============================================
// DISCONNECT
// ============================================

/**
 * Disconnect dari MongoDB secara graceful.
 * Cocok dipanggil saat shutdown (SIGINT/SIGTERM).
 */
async function disconnect() {
  clearReconnectTimer();
  connectionState = "disconnected";

  if (mongooseInstance?.connection?.readyState > 0) {
    try {
      await Promise.race([
        mongooseInstance.disconnect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Disconnect timeout")), 5000),
        ),
      ]);
      console.log("🍃 MongoDB disconnected");
    } catch (error) {
      console.warn("⚠️ MongoDB disconnect error:", error.message);
    }
  }

  mongooseInstance = null;
}

// ============================================
// HEALTH CHECK
// ============================================

/**
 * Cek apakah koneksi MongoDB aktif.
 * @returns {boolean}
 */
function isConnected() {
  return (
    connectionState === "connected" &&
    mongooseInstance?.connection?.readyState === 1
  );
}

/**
 * Get status koneksi detail.
 * @returns {{ state: string, readyState: number, attempts: number }}
 */
function getStatus() {
  return {
    state: connectionState,
    readyState: mongooseInstance?.connection?.readyState || 0,
    reconnectAttempts,
  };
}

/**
 * Get Mongoose instance (untuk advanced usage / external model registration).
 * @returns {typeof mongoose|null}
 */
function getMongoose() {
  return mongooseInstance;
}

/**
 * Get native MongoDB Db object (untuk operasi yang butuh native driver).
 * @returns {import('mongodb').Db|null}
 */
function getDb() {
  return mongooseInstance?.connection?.db || null;
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  connect,
  disconnect,
  isConnected,
  getStatus,
  getMongoose,
  getDb,
};
