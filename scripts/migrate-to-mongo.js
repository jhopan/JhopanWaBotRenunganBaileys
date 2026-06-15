#!/usr/bin/env node
/**
 * Migration Script: Local Files → MongoDB
 * 
 * Imports existing local data to MongoDB:
 * - WhatsApp auth state (baileys_auth_info/ → MongoDB)
 * - Verses data (verses_*.json → MongoDB)
 * - Bot config (bot_config.json → MongoDB)
 * 
 * Usage:
 *   node scripts/migrate-to-mongo.js
 * 
 * Requires: MONGODB_URI in .env
 */

require("dotenv").config();
const path = require("path");
const fs = require("fs-extra");

const mongoService = require("../src/services/mongoService");
const { migrateFromFile: migrateAuth } = require("../src/services/mongoAuthState");
const mongoData = require("../src/services/mongoDataService");

async function migrate() {
  console.log("\n╔═══════════════════════════════════════════╗");
  console.log("║   Migrate Local Data → MongoDB            ║");
  console.log("╚═══════════════════════════════════════════╝\n");

  // 1. Connect to MongoDB
  if (!process.env.MONGODB_URI) {
    console.error("❌ MONGODB_URI not set in .env");
    console.error("   Example: MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/jhopanwa-bot");
    process.exit(1);
  }

  console.log("🔌 Connecting to MongoDB...");
  await mongoService.connect();
  const status = mongoService.getStatus();
  if (!status.connected) {
    console.error("❌ Failed to connect to MongoDB");
    process.exit(1);
  }
  console.log(`✅ Connected to: ${status.database}\n`);

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  // 2. Migrate WhatsApp Auth State
  console.log("📱 Migrating WhatsApp auth state...");
  const authPath = path.join(__dirname, "../baileys_auth_info");
  if (await fs.pathExists(authPath)) {
    try {
      await migrateAuth(authPath);
      console.log("   ✅ Auth state migrated to MongoDB\n");
      migrated++;
    } catch (error) {
      console.error(`   ❌ Auth migration failed: ${error.message}\n`);
      failed++;
    }
  } else {
    console.log("   ⏭️  No auth state found (fresh install?)\n");
    skipped++;
  }

  // 3. Migrate Verses Data
  console.log("📖 Migrating verses data...");
  const dataDir = path.join(__dirname, "../src/data");
  const versesFiles = (await fs.readdir(dataDir)).filter(f => f.startsWith("verses_") && f.endsWith(".json"));

  for (const file of versesFiles) {
    try {
      const filePath = path.join(dataDir, file);
      const data = await fs.readJson(filePath);
      const year = parseInt(file.match(/verses_(\d+)/)?.[1]);

      if (year) {
        await mongoData.saveVerses(data, year);
        console.log(`   ✅ ${file} → MongoDB (${data.verses?.length || 0} verses)`);
        migrated++;
      }
    } catch (error) {
      console.error(`   ❌ ${file}: ${error.message}`);
      failed++;
    }
  }
  console.log("");

  // 4. Migrate Bot Config
  console.log("⚙️  Migrating bot config...");
  const configPath = path.join(dataDir, "bot_config.json");
  if (await fs.pathExists(configPath)) {
    try {
      const config = await fs.readJson(configPath);
      await mongoData.saveConfig(config);
      console.log("   ✅ bot_config.json → MongoDB\n");
      migrated++;
    } catch (error) {
      console.error(`   ❌ Config migration failed: ${error.message}\n`);
      failed++;
    }
  } else {
    console.log("   ⏭️  No config file found\n");
    skipped++;
  }

  // Summary
  console.log("═══════════════════════════════════════════");
  console.log(`  ✅ Migrated: ${migrated}`);
  console.log(`  ⏭️  Skipped:  ${skipped}`);
  console.log(`  ❌ Failed:  ${failed}`);
  console.log("═══════════════════════════════════════════\n");

  if (failed === 0) {
    console.log("🎉 All data migrated successfully!");
    console.log("   Bot akan otomatis pakai MongoDB saat restart.\n");
  } else {
    console.log("⚠️  Some migrations failed. Check errors above.\n");
  }

  await mongoService.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

migrate().catch((error) => {
  console.error("❌ Migration error:", error);
  process.exit(1);
});
