/**
 * Config Manager - Persistent Storage untuk Bot Settings
 * Optimized for Renungan Bot Only (GCP Free Tier)
 *
 * Storage: MongoDB (primary) → Local JSON file (fallback)
 * The mongoDataService handles all the try/catch logic transparently.
 */

const mongoData = require("../services/mongoDataService");

/**
 * Load config dari storage (MongoDB → file → default)
 */
async function loadConfig() {
  try {
    const config = await mongoData.loadConfig();
    return config;
  } catch (error) {
    console.error("❌ Error load config:", error.message);
    return null;
  }
}

/**
 * Save config ke storage (MongoDB → file)
 */
async function saveConfig(config) {
  try {
    config.lastUpdated = new Date().toISOString();
    const ok = await mongoData.saveConfig(config);
    if (ok) console.log("✅ Config tersimpan");
    return ok;
  } catch (error) {
    console.error("❌ Error save config:", error.message);
    return false;
  }
}

/**
 * Update renungan group ID
 */
async function setRenunganGroupId(groupId) {
  const config = await loadConfig();
  config.renunganGroupId = groupId;
  await saveConfig(config);
  return config;
}

/**
 * Update renungan time
 */
async function setRenunganTime(time) {
  const config = await loadConfig();
  config.renunganTime = time;
  await saveConfig(config);
  return config;
}

/**
 * Toggle hide tag setting
 */
async function toggleHideTag() {
  const config = await loadConfig();
  config.hideTagEnabled = !config.hideTagEnabled;
  await saveConfig(config);
  return config;
}

/**
 * Set hide tag value
 */
async function setHideTag(enabled) {
  const config = await loadConfig();
  config.hideTagEnabled = enabled;
  await saveConfig(config);
  return config;
}

/**
 * Toggle multi-group setting
 */
async function toggleMultiGroup() {
  const config = await loadConfig();
  config.multiGroupEnabled = !config.multiGroupEnabled;
  await saveConfig(config);
  return config;
}

/**
 * Set renungan groups (for multi-group feature)
 */
async function setRenunganGroups(groups) {
  const config = await loadConfig();
  config.renunganGroups = groups;
  await saveConfig(config);
  return config;
}

/**
 * Add renungan group
 */
async function addRenunganGroup(groupId, groupName = "") {
  const config = await loadConfig();
  if (!config.renunganGroups) config.renunganGroups = [];

  // Check if already exists
  const exists = config.renunganGroups.some((g) => g.id === groupId);
  if (!exists) {
    config.renunganGroups.push({ id: groupId, name: groupName });
    await saveConfig(config);
  }
  return config;
}

/**
 * Remove renungan group
 */
async function removeRenunganGroup(groupId) {
  const config = await loadConfig();
  if (!config.renunganGroups) config.renunganGroups = [];
  config.renunganGroups = config.renunganGroups.filter((g) => g.id !== groupId);
  await saveConfig(config);
  return config;
}

/**
 * Set multi-group delay in minutes
 */
async function setMultiGroupDelay(minutes) {
  const config = await loadConfig();
  config.multiGroupDelayMinutes = minutes;
  await saveConfig(config);
  return config;
}

/**
 * Get data storage status (MongoDB or file)
 */
function getStorageStatus() {
  return mongoData.getStatus();
}

module.exports = {
  loadConfig,
  saveConfig,
  setRenunganGroupId,
  setRenunganTime,
  toggleHideTag,
  setHideTag,
  toggleMultiGroup,
  setRenunganGroups,
  addRenunganGroup,
  removeRenunganGroup,
  setMultiGroupDelay,
  getStorageStatus,
};
