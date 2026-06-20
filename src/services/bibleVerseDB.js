/**
 * bibleVerseDB.js — MongoDB service untuk menyimpan seluruh ayat Alkitab TB
 * Collection: bible_verses
 * Schema: { ref, text, pericope, book, chapter, verseStart, verseEnd, scrapedAt }
 */

const mongoService = require('./mongoService');

let VerseModel = null;

/**
 * Inisialisasi Mongoose model (lazy)
 */
function getModel() {
  if (VerseModel) return VerseModel;

  const mongoose = mongoService.getMongoose();
  if (!mongoose) throw new Error('MongoDB belum terkoneksi');

  // Cek apakah model sudah terdaftar
  try {
    VerseModel = mongoose.model('BibleVerse');
  } catch {
    const schema = new mongoose.Schema({
      ref: { type: String, required: true, unique: true },  // "Yohanes 3:16"
      text: { type: String, required: true },                // Teks ayat lengkap
      pericope: { type: String, default: null },             // "Percakapan dengan Nikodemus"
      book: { type: String, required: true },                // "Yohanes"
      chapter: { type: Number, required: true },             // 3
      verseStart: { type: Number, required: true },          // 16
      verseEnd: { type: Number, required: true },            // 16
      scrapedAt: { type: Date, default: Date.now },
    }, {
      collection: 'bible_verses',
      timestamps: true,
    });

    // Index untuk query cepat
    schema.index({ book: 1, chapter: 1, verseStart: 1 });
    schema.index({ book: 1 });
    schema.index({ pericope: 1 });

    VerseModel = mongoose.model('BibleVerse', schema);
  }

  return VerseModel;
}

/**
 * Simpan satu ayat ke MongoDB (upsert)
 */
async function saveVerse(verseData) {
  const Model = getModel();
  return Model.findOneAndUpdate(
    { ref: verseData.ref },
    {
      ...verseData,
      scrapedAt: new Date(),
    },
    { upsert: true, new: true }
  );
}

/**
 * Simpan batch ayat (bulk upsert) — untuk scraping per kitab
 */
async function saveVersesBulk(verses) {
  const Model = getModel();
  const ops = verses.map(v => ({
    updateOne: {
      filter: { ref: v.ref },
      update: { $set: { ...v, scrapedAt: new Date() } },
      upsert: true,
    },
  }));

  // Bulk write dalam batch 500
  const results = [];
  for (let i = 0; i < ops.length; i += 500) {
    const batch = ops.slice(i, i + 500);
    const result = await Model.bulkWrite(batch, { ordered: false });
    results.push(result);
  }

  const totalUpserted = results.reduce((sum, r) => sum + (r.upsertedCount || 0), 0);
  const totalModified = results.reduce((sum, r) => sum + (r.modifiedCount || 0), 0);
  return { totalUpserted, totalModified, total: verses.length };
}

/**
 * Ambil satu ayat berdasarkan ref
 * Support single verse ("Yohanes 3:16") dan range ("Mazmur 139:13-14")
 * @param {string} ref - "Yohanes 3:16" atau "Mazmur 139:13-14"
 * @returns {Promise<{ref, text, pericope, ...}|null>}
 */
async function getVerse(ref) {
  const Model = getModel();

  // Coba exact match dulu
  const exact = await Model.findOne({ ref }).lean();
  if (exact) return exact;

  // Kalau gagal, cek apakah ini range ref (misal "Mazmur 139:13-14")
  const match = ref.match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/);
  if (!match) return null;

  const book = match[1];
  const chapter = parseInt(match[2]);
  const verseStart = parseInt(match[3]);
  const verseEnd = match[4] ? parseInt(match[4]) : verseStart;

  // Kalau bukan range (single verse), tidak ada fallback
  if (verseStart === verseEnd) return null;

  // Query semua ayat individual dalam range ini
  const verses = await Model.find({
    book,
    chapter,
    verseStart: { $gte: verseStart, $lte: verseEnd },
  })
    .sort({ verseStart: 1 })
    .lean();

  if (verses.length === 0) return null;

  // Gabungkan teks dari semua ayat individual
  const combinedText = verses.length === 1
    ? verses[0].text
    : verses.map((v) => `${v.verseStart}. ${v.text}`).join(" ");

  return {
    ref,
    text: combinedText,
    pericope: verses[0].pericope,
    book,
    chapter,
    verseStart,
    verseEnd,
  };
}

/**
 * Ambil semua ayat dari satu pasal
 * @param {string} book - "Yohanes"
 * @param {number} chapter - 3
 */
async function getChapterVerses(book, chapter) {
  const Model = getModel();
  return Model.find({ book, chapter })
    .sort({ verseStart: 1 })
    .lean();
}

/**
 * Ambil semua ayat dari satu kitab
 * @param {string} book - "Yohanes"
 */
async function getBookVerses(book) {
  const Model = getModel();
  return Model.find({ book })
    .sort({ chapter: 1, verseStart: 1 })
    .lean();
}

/**
 * Hitung total ayat di database
 */
async function getTotalVerses() {
  const Model = getModel();
  return Model.countDocuments();
}

/**
 * Hitung ayat per kitab
 */
async function getVerseCountByBook() {
  const Model = getModel();
  return Model.aggregate([
    { $group: { _id: '$book', count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
}

/**
 * Hapus semua ayat dari satu kitab (sebelum re-scrape)
 */
async function deleteBookVerses(book) {
  const Model = getModel();
  const result = await Model.deleteMany({ book });
  return result.deletedCount;
}

/**
 * Hapus semua ayat (full reset)
 */
async function deleteAll() {
  const Model = getModel();
  return Model.deleteMany({});
}

/**
 * Cek apakah kitab sudah ada di database
 */
async function isBookScraped(book) {
  const Model = getModel();
  const count = await Model.countDocuments({ book });
  return count > 0;
}

/**
 * Dapatkan statistik database
 */
async function getStats() {
  const Model = getModel();
  const totalVerses = await Model.countDocuments();
  const bookStats = await Model.aggregate([
    { $group: { _id: '$book', count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  const lastScraped = await Model.findOne().sort({ scrapedAt: -1 }).lean();

  return {
    totalVerses,
    booksInDB: bookStats.length,
    bookStats,
    lastScrapedAt: lastScraped?.scrapedAt || null,
  };
}

/**
 * Dapatkan daftar pasal yang belum ada di database
 * @param {Object} allBooks - { bookName: totalChapters, ... }
 * @returns {Array<{book, chapter}>} — pasal yang missing
 */
async function getMissingChapters(allBooks) {
  const Model = getModel();
  const missing = [];

  for (const [bookName, totalChapters] of Object.entries(allBooks)) {
    // Ambil semua chapter yang ada di DB untuk kitab ini
    const existingChapters = await Model.distinct('chapter', { book: bookName });
    const existingSet = new Set(existingChapters);

    for (let ch = 1; ch <= totalChapters; ch++) {
      if (!existingSet.has(ch)) {
        missing.push({ book: bookName, chapter: ch });
      }
    }
  }

  return missing;
}

/**
 * Get random verse(s) by theme/pericope from bible_verses
 * @param {string} theme - Theme keyword (e.g., "kasih", "iman", "pengharapan")
 * @param {Object} options - { count: 1, excludeRefs: [] }
 * @returns {Promise<Array<{ref, text, pericope, book, chapter, verseStart, verseEnd}>>}
 */
async function getRandomVersesByTheme(theme, options = {}) {
  const Model = getModel();
  const { count = 1, excludeRefs = [] } = options;

  // Build query: search in pericope (case-insensitive)
  const query = {
    pericope: { $regex: theme, $options: 'i' }
  };

  // Exclude already used refs
  if (excludeRefs.length > 0) {
    query.ref = { $nin: excludeRefs };
  }

  // Get total count for random selection
  const totalCount = await Model.countDocuments(query);
  if (totalCount === 0) {
    console.log(`⚠️ No verses found for theme: ${theme}`);
    return [];
  }

  // Random sampling using aggregation
  const verses = await Model.aggregate([
    { $match: query },
    { $sample: { size: Math.min(count, totalCount) } },
    { $project: { _id: 0, ref: 1, text: 1, pericope: 1, book: 1, chapter: 1, verseStart: 1, verseEnd: 1 } }
  ]);

  return verses;
}

/**
 * Get random verse RANGE by theme (multi-ayat dari pasal yang sama)
 * Example: Mazmur 3:3-5 (3 ayat dari pasal yang sama)
 * @param {string} theme - Theme keyword
 * @param {Object} options - { minVerses: 2, maxVerses: 4, excludeRefs: [] }
 * @returns {Promise<{ref, text, pericope, book, chapter, verseStart, verseEnd}|null>}
 */
async function getRandomVerseRangeByTheme(theme, options = {}) {
  const Model = getModel();
  const { minVerses = 2, maxVerses = 4, excludeRefs = [] } = options;

  // Build query: search in pericope (case-insensitive)
  const query = {
    pericope: { $regex: theme, $options: 'i' }
  };

  // Exclude already used refs
  if (excludeRefs.length > 0) {
    query.ref = { $nin: excludeRefs };
  }

  // Get total count
  const totalCount = await Model.countDocuments(query);
  if (totalCount === 0) {
    console.log(`⚠️ No verses found for theme: ${theme}`);
    return null;
  }

  // Random pick 1 verse
  const [startVerse] = await Model.aggregate([
    { $match: query },
    { $sample: { size: 1 } },
    { $project: { _id: 0, ref: 1, book: 1, chapter: 1, verseStart: 1, pericope: 1 } }
  ]);

  if (!startVerse) return null;

  // Random count between minVerses and maxVerses
  const verseCount = Math.floor(Math.random() * (maxVerses - minVerses + 1)) + minVerses;

  // Get consecutive verses from same chapter
  const verses = await Model.find({
    book: startVerse.book,
    chapter: startVerse.chapter,
    verseStart: { $gte: startVerse.verseStart, $lt: startVerse.verseStart + verseCount }
  })
    .sort({ verseStart: 1 })
    .lean();

  if (verses.length === 0) return null;

  // Build range ref
  const firstVerse = verses[0].verseStart;
  const lastVerse = verses[verses.length - 1].verseStart;
  const rangeRef = verses.length === 1
    ? `${startVerse.book} ${startVerse.chapter}:${firstVerse}`
    : `${startVerse.book} ${startVerse.chapter}:${firstVerse}-${lastVerse}`;

  // Combine text
  const combinedText = verses.length === 1
    ? verses[0].text
    : verses.map(v => `${v.verseStart}. ${v.text}`).join(' ');

  return {
    ref: rangeRef,
    text: combinedText,
    pericope: startVerse.pericope,
    book: startVerse.book,
    chapter: startVerse.chapter,
    verseStart: firstVerse,
    verseEnd: lastVerse
  };
}

/**
 * Get random verse(s) from all bible_verses (no theme filter)
 * @param {Object} options - { count: 1, excludeRefs: [] }
 * @returns {Promise<Array<{ref, text, pericope, book, chapter, verseStart, verseEnd}>>}
 */
async function getRandomVerses(options = {}) {
  const Model = getModel();
  const { count = 1, excludeRefs = [] } = options;

  // Build query
  const query = {};

  // Exclude already used refs
  if (excludeRefs.length > 0) {
    query.ref = { $nin: excludeRefs };
  }

  // Get total count for random selection
  const totalCount = await Model.countDocuments(query);
  if (totalCount === 0) {
    console.log(`⚠️ No verses available in bible_verses`);
    return [];
  }

  // Random sampling using aggregation
  const verses = await Model.aggregate([
    { $match: query },
    { $sample: { size: Math.min(count, totalCount) } },
    { $project: { _id: 0, ref: 1, text: 1, pericope: 1, book: 1, chapter: 1, verseStart: 1, verseEnd: 1 } }
  ]);

  return verses;
}

/**
 * Get random verse RANGE (no theme filter, multi-ayat dari pasal yang sama)
 * @param {Object} options - { minVerses: 2, maxVerses: 4, excludeRefs: [] }
 * @returns {Promise<{ref, text, pericope, book, chapter, verseStart, verseEnd}|null>}
 */
async function getRandomVerseRange(options = {}) {
  const Model = getModel();
  const { minVerses = 2, maxVerses = 4, excludeRefs = [] } = options;

  // Build query
  const query = {};

  // Exclude already used refs
  if (excludeRefs.length > 0) {
    query.ref = { $nin: excludeRefs };
  }

  // Get total count
  const totalCount = await Model.countDocuments(query);
  if (totalCount === 0) {
    console.log(`⚠️ No verses available in bible_verses`);
    return null;
  }

  // Random pick 1 verse
  const [startVerse] = await Model.aggregate([
    { $match: query },
    { $sample: { size: 1 } },
    { $project: { _id: 0, ref: 1, book: 1, chapter: 1, verseStart: 1, pericope: 1 } }
  ]);

  if (!startVerse) return null;

  // Random count between minVerses and maxVerses
  const verseCount = Math.floor(Math.random() * (maxVerses - minVerses + 1)) + minVerses;

  // Get consecutive verses from same chapter
  const verses = await Model.find({
    book: startVerse.book,
    chapter: startVerse.chapter,
    verseStart: { $gte: startVerse.verseStart, $lt: startVerse.verseStart + verseCount }
  })
    .sort({ verseStart: 1 })
    .lean();

  if (verses.length === 0) return null;

  // Build range ref
  const firstVerse = verses[0].verseStart;
  const lastVerse = verses[verses.length - 1].verseStart;
  const rangeRef = verses.length === 1
    ? `${startVerse.book} ${startVerse.chapter}:${firstVerse}`
    : `${startVerse.book} ${startVerse.chapter}:${firstVerse}-${lastVerse}`;

  // Combine text
  const combinedText = verses.length === 1
    ? verses[0].text
    : verses.map(v => `${v.verseStart}. ${v.text}`).join(' ');

  return {
    ref: rangeRef,
    text: combinedText,
    pericope: startVerse.pericope,
    book: startVerse.book,
    chapter: startVerse.chapter,
    verseStart: firstVerse,
    verseEnd: lastVerse
  };
}

module.exports = {
  getModel,
  saveVerse,
  saveVersesBulk,
  getVerse,
  getChapterVerses,
  getBookVerses,
  getTotalVerses,
  getVerseCountByBook,
  deleteBookVerses,
  deleteAll,
  isBookScraped,
  getStats,
  getMissingChapters,
  getRandomVersesByTheme,
  getRandomVerseRangeByTheme,
  getRandomVerses,
  getRandomVerseRange,
};
