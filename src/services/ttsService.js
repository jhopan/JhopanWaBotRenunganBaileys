/**
 * TTS Service - Text-to-Speech dengan Smart Preprocessing
 * 
 * Features:
 * - Smart preprocessing (kutipan ayat tidak diubah, renungan dipreprocess)
 * - Voice rotation (Ganjil = Gadis, Genap = Ardi)
 * - msedge-tts (Node.js native, NO Python needed!)
 */

const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

const TEMP_DIR = path.join(__dirname, '../../temp/tts_audio');

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Get voice for today based on date rotation
 * Ganjil (1, 3, 5, ...) → GadisNeural (Wanita)
 * Genap (2, 4, 6, ...) → ArdiNeural (Pria)
 */
function getVoiceForToday() {
  // Check if admin forced a specific voice
  const override = process.env.TTS_VOICE_OVERRIDE;
  const femaleVoice = process.env.TTS_VOICE_FEMALE || 'id-ID-GadisNeural';
  const maleVoice = process.env.TTS_VOICE_MALE || 'id-ID-ArdiNeural';
  
  if (override && override === femaleVoice) {
    return femaleVoice;
  } else if (override && override === maleVoice) {
    return maleVoice;
  }
  
  // Auto rotation based on date (odd/even)
  const date = moment().tz(process.env.TIMEZONE || 'Asia/Makassar').date(); // 1-31
  
  if (date % 2 === 1) {
    return femaleVoice;
  } else {
    return maleVoice;
  }
}

/**
 * Get voice name for display
 */
function getVoiceName(voice) {
  if (voice === 'id-ID-GadisNeural') {
    return '🚺 GadisNeural (Wanita, Warm)';
  } else if (voice === 'id-ID-ArdiNeural') {
    return '🚹 ArdiNeural (Pria, Tegas)';
  }
  return voice;
}

/**
 * Convert rate string to msedge-tts format
 * "-0%" → "-0%" (SSML percentage format, same as before)
 * "0%" → "0%"
 * Can also accept numbers like 0.5, 1.0, 2.0
 */
function convertRate(rate) {
  if (!rate || rate === '-0%' || rate === '0%') return '-0%';
  // Already in SSML format (+X% or -X%), pass through
  if (typeof rate === 'string' && rate.includes('%')) return rate;
  // Numeric format
  return rate;
}

/**
 * Convert pitch string to msedge-tts format
 * "+0Hz" → "+0Hz" (SSML Hz format, same as before)
 */
function convertPitch(pitch) {
  if (!pitch || pitch === '+0Hz' || pitch === '0Hz') return '+0Hz';
  // Already in SSML format (+XHz or -XHz), pass through
  if (typeof pitch === 'string' && pitch.includes('Hz')) return pitch;
  return pitch;
}

/**
 * Smart preprocessing untuk TTS
 * - Kutipan ayat (dalam " ") = TIDAK diubah (sakral)
 * - Renungan text = "-Mu" → "-mu", "-Nya" → "-nya" (lowercase, attached)
 */
function smartPreprocessForTTS(text) {
  const segments = [];
  let current = '';
  let inQuote = false;
  
  // Split by quotes
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    
    if (char === '"' || char === '\u201C' || char === '\u201D') {
      if (inQuote) {
        current += char;
        segments.push({ text: current, isQuote: true });
        current = '';
        inQuote = false;
      } else {
        if (current) segments.push({ text: current, isQuote: false });
        current = char;
        inQuote = true;
      }
    } else {
      current += char;
    }
  }
  
  if (current) segments.push({ text: current, isQuote: inQuote });
  
  // Process each segment
  return segments.map(seg => {
    if (seg.isQuote) {
      // Quote (sacred): clean formatting + fix pronunciation ONLY (no word changes)
      let text = cleanFormattingOnly(seg.text);
      // Pronouns must be fixed even in quotes — TTS reads "umat-Mu" as "umat emyu" without this
      text = text.replace(/([a-z])-(Mu)\b/gi, '$1mu');
      text = text.replace(/([a-z])-(Nya)\b/gi, '$1nya');
      text = text.replace(/([a-z])-(Ku)\b/gi, '$1ku');
      return text;
    } else {
      return fullPreprocess(seg.text);
    }
  }).join('');
}

/**
 * Clean formatting only (for quoted verse text)
 */
function cleanFormattingOnly(text) {
  return text
    .replace(/\*/g, '')
    .replace(/_/g, '')
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    .replace(/─+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Full preprocessing (for renungan text)
 */
function fullPreprocess(text) {
  let cleaned = text;
  
  // Verse references: "Yohanes 3:16" → "Yohanes pasal tiga ayat enam belas"
  // Support multi-word book names: "1 Korintus", "Kisah Para Rasul", etc.
  cleaned = cleaned.replace(
    /((?:\d\s+)?[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\s+(\d+):(\d+)-(\d+)/g,
    (m, book, ch, v1, v2) => 
      `${book} pasal ${numberToWords(+ch)} ayat ${numberToWords(+v1)} sampai ${numberToWords(+v2)}`
  );
  
  cleaned = cleaned.replace(
    /((?:\d\s+)?[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\s+(\d+):(\d+)/g,
    (m, book, ch, v) => 
      `${book} pasal ${numberToWords(+ch)} ayat ${numberToWords(+v)}`
  );
  
  // Pronouns: "-Mu" → "mu", "-Nya" → "nya" (lowercase, attached)
  // Only match after lowercase letter to avoid false positives
  cleaned = cleaned.replace(/([a-z])-(Mu)\b/gi, '$1mu');
  cleaned = cleaned.replace(/([a-z])-(Nya)\b/gi, '$1nya');
  cleaned = cleaned.replace(/([a-z])-(Ku)\b/gi, '$1ku');
  
  // Formatting
  cleaned = cleanFormattingOnly(cleaned);
  
  // Punctuation
  cleaned = cleaned.replace(/\.{2,}/g, ', ');
  cleaned = cleaned.replace(/—/g, ', ');
  
  return cleaned;
}

/**
 * Convert number to Indonesian words
 */
function numberToWords(num) {
  if (num === 0) return 'nol';
  const units = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan'];
  const teens = ['sepuluh', 'sebelas', 'dua belas', 'tiga belas', 'empat belas', 'lima belas', 'enam belas', 'tujuh belas', 'delapan belas', 'sembilan belas'];
  
  if (num < 10) return units[num];
  if (num < 20) return teens[num - 10];
  if (num < 100) {
    const tens = Math.floor(num / 10);
    const rem = num % 10;
    return units[tens] + ' puluh' + (rem ? ' ' + units[rem] : '');
  }
  if (num < 200) return 'seratus' + (num > 100 ? ' ' + numberToWords(num - 100) : '');
  if (num < 1000) {
    const hundreds = Math.floor(num / 100);
    const rem = num % 100;
    return units[hundreds] + ' ratus' + (rem ? ' ' + numberToWords(rem) : '');
  }
  if (num < 2000) return 'seribu' + (num > 1000 ? ' ' + numberToWords(num - 1000) : '');
  if (num < 1000000) {
    const thousands = Math.floor(num / 1000);
    const rem = num % 1000;
    return numberToWords(thousands) + ' ribu' + (rem ? ' ' + numberToWords(rem) : '');
  }
  // Fallback: return as string for very large numbers
  return num.toString();
}

/**
 * Split text into chunks for TTS (max ~1500 chars per chunk)
 * Splits on paragraph breaks, then sentences, to keep natural pauses
 */
function splitTextIntoChunks(text, maxLen = 1500) {
  if (text.length <= maxLen) return [text];
  
  const chunks = [];
  // Split by double newline (paragraphs) first
  const paragraphs = text.split(/\n\n+/);
  let current = '';
  
  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length <= maxLen) {
      current = current ? current + '\n\n' + para : para;
    } else {
      // Flush current chunk
      if (current) chunks.push(current.trim());
      
      // If single paragraph is still too long, split by sentences
      if (para.length > maxLen) {
        const sentences = para.match(/[^.!?]+[.!?]+[\s]*/g) || [para];
        current = '';
        for (const sent of sentences) {
          if ((current + sent).length <= maxLen) {
            current += sent;
          } else {
            if (current) chunks.push(current.trim());
            current = sent;
          }
        }
      } else {
        current = para;
      }
    }
  }
  
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/**
 * Generate TTS audio using msedge-tts (Node.js native)
 * Supports long text by splitting into chunks and concatenating
 * @param {string} text - Renungan text (original)
 * @param {Object} options - { voice, rate, pitch }
 * @returns {Promise<string>} - Path to generated OGG audio file
 */
async function generateTTS(text, options = {}) {
  const voice = options.voice || getVoiceForToday();
  const rate = convertRate(options.rate || process.env.TTS_RATE || '-0%');
  const pitch = convertPitch(options.pitch || process.env.TTS_PITCH || '+0Hz');
  
  const timestamp = Date.now();
  const oggPath = path.join(TEMP_DIR, `renungan_${timestamp}.ogg`);
  
  // Preprocess text
  const preprocessedText = smartPreprocessForTTS(text);
  
  // Split into chunks
  const chunks = splitTextIntoChunks(preprocessedText);
  
  console.log('🎙️ Generating TTS audio...');
  console.log(`   Voice: ${voice} (${getVoiceName(voice)})`);
  console.log(`   Rate: ${rate}, Pitch: ${pitch}`);
  console.log(`   Text: ${preprocessedText.length} chars → ${chunks.length} chunk(s)`);
  console.log(`   Date: ${moment().tz(process.env.TIMEZONE || 'Asia/Makassar').format('DD MMMM YYYY')} (Tanggal ${moment().date()})`);
  
  const chunkFiles = [];
  
  try {
    // Step 1: Generate MP3 per chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunkPath = path.join(TEMP_DIR, `chunk_${timestamp}_${i}.mp3`);
      chunkFiles.push(chunkPath);
      
      if (chunks.length > 1) {
        console.log(`   📝 Chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)...`);
      }
      
      const tts = new MsEdgeTTS();
      await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      
      const { audioStream } = tts.toStream(chunks[i], { rate, pitch });
      
      await new Promise((resolve, reject) => {
        const writeStream = fs.createWriteStream(chunkPath);
        audioStream.pipe(writeStream);
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        audioStream.on('error', reject);
        setTimeout(() => reject(new Error(`Chunk ${i + 1} timeout (120s)`)), 120000);
      });
      
      tts.close();
    }
    
    // Step 2: Concatenate all chunks + convert to OGG Opus
    if (chunks.length === 1) {
      // Single chunk: just convert to OGG
      console.log('   🔄 Converting to OGG (WhatsApp compatible)...');
      const cmd = `"${ffmpegPath}" -i "${chunkFiles[0]}" -c:a libopus -b:a 48k -ac 1 -ar 48000 "${oggPath}" -y`;
      await execAsync(cmd, { timeout: 60000 });
    } else {
      // Multiple chunks: concat then convert
      console.log(`   🔄 Concatenating ${chunks.length} chunks + converting to OGG...`);
      
      // Create concat file list for ffmpeg
      const listPath = path.join(TEMP_DIR, `concat_${timestamp}.txt`);
      const listContent = chunkFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n');
      fs.writeFileSync(listPath, listContent, 'utf-8');
      
      try {
        const cmd = `"${ffmpegPath}" -f concat -safe 0 -i "${listPath}" -c:a libopus -b:a 48k -ac 1 -ar 48000 "${oggPath}" -y`;
        await execAsync(cmd, { timeout: 120000 });
      } finally {
        try { fs.unlinkSync(listPath); } catch (e) { /* ignore */ }
      }
    }
    
    // Step 3: Cleanup chunk files
    for (const f of chunkFiles) {
      try { fs.unlinkSync(f); } catch (e) { /* ignore */ }
    }
    
    // Verify OGG file
    const stats = fs.statSync(oggPath);
    if (stats.size < 1000) {
      throw new Error(`Audio file too small (${stats.size} bytes) — likely empty`);
    }
    
    console.log(`✅ TTS audio generated: ${oggPath} (${(stats.size / 1024).toFixed(0)} KB)`);
    return oggPath;
    
  } catch (error) {
    console.error('❌ TTS generation failed:', error.message);
    // Cleanup all partial files
    for (const f of chunkFiles) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) { /* ignore */ }
    }
    try { if (fs.existsSync(oggPath)) fs.unlinkSync(oggPath); } catch (e) { /* ignore */ }
    throw error;
  }
}

/**
 * Cleanup temp audio file
 */
function cleanupAudio(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`🧹 Cleaned up: ${filePath}`);
    }
  } catch (error) {
    console.error('⚠️ Cleanup failed:', error.message);
  }
}

module.exports = {
  generateTTS,
  cleanupAudio,
  smartPreprocessForTTS,
  getVoiceForToday,
  getVoiceName
};
