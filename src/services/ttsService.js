/**
 * TTS Service - Text-to-Speech dengan Smart Preprocessing
 * 
 * Features:
 * - Smart preprocessing (kutipan ayat tidak diubah, renungan dipreprocess)
 * - Voice rotation (Ganjil = Gadis, Genap = Ardi)
 * - Edge TTS integration
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');

const execAsync = promisify(exec);
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
  
  if (override === process.env.TTS_VOICE_FEMALE) {
    return process.env.TTS_VOICE_FEMALE;
  } else if (override === process.env.TTS_VOICE_MALE) {
    return process.env.TTS_VOICE_MALE;
  }
  
  // Auto rotation based on date (odd/even)
  const date = moment().tz(process.env.TIMEZONE || 'Asia/Makassar').date(); // 1-31
  
  if (date % 2 === 1) {
    // Ganjil: 1, 3, 5, 7, ...
    return process.env.TTS_VOICE_FEMALE || 'id-ID-GadisNeural';
  } else {
    // Genap: 2, 4, 6, 8, ...
    return process.env.TTS_VOICE_MALE || 'id-ID-ArdiNeural';
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
    
    if (char === '"' || char === '"') {
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
      return cleanFormattingOnly(seg.text);
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
  cleaned = cleaned.replace(
    /(\w+(?:\s+\w+)?)\s+(\d+):(\d+)-(\d+)/g,
    (m, book, ch, v1, v2) => 
      `${book} pasal ${numberToWords(+ch)} ayat ${numberToWords(+v1)} sampai ${numberToWords(+v2)}`
  );
  
  cleaned = cleaned.replace(
    /(\w+(?:\s+\w+)?)\s+(\d+):(\d+)/g,
    (m, book, ch, v) => 
      `${book} pasal ${numberToWords(+ch)} ayat ${numberToWords(+v)}`
  );
  
  // Pronouns: "-Mu" → "mu", "-Nya" → "nya" (lowercase, attached)
  cleaned = cleaned.replace(/-(Mu)\b/gi, 'mu');
  cleaned = cleaned.replace(/-(Nya)\b/gi, 'nya');
  cleaned = cleaned.replace(/-(Ku)\b/gi, 'ku');
  
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
  return num.toString();
}

/**
 * Generate TTS audio
 * @param {string} text - Renungan text (original)
 * @param {Object} options - { voice, rate, pitch }
 * @returns {Promise<string>} - Path to generated audio file
 */
async function generateTTS(text, options = {}) {
  const voice = options.voice || getVoiceForToday();
  const rate = options.rate || process.env.TTS_RATE || '-0%';
  const pitch = options.pitch || process.env.TTS_PITCH || '+0Hz';
  
  const timestamp = Date.now();
  const outputPath = path.join(TEMP_DIR, `renungan_${timestamp}.mp3`);
  
  // Preprocess text
  const preprocessedText = smartPreprocessForTTS(text);
  
  console.log('🎙️ Generating TTS audio...');
  console.log(`   Voice: ${voice} (${getVoiceName(voice)})`);
  console.log(`   Rate: ${rate}`);
  console.log(`   Date: ${moment().tz(process.env.TIMEZONE || 'Asia/Makassar').format('DD MMMM YYYY')} (Tanggal ${moment().date()})`);
  
  try {
    // Escape text for shell
    const escapedText = preprocessedText.replace(/"/g, '\\"');
    
    // Write text to temp file to avoid shell escaping issues
    const textFilePath = path.join(TEMP_DIR, `text_${timestamp}.txt`);
    fs.writeFileSync(textFilePath, preprocessedText, 'utf-8');
    
    await execAsync(
      `edge-tts --voice "${voice}" --rate="${rate}" --pitch="${pitch}" --text "$(cat '${textFilePath}')" --write-media "${outputPath}"`,
      { timeout: 120000, shell: '/bin/bash' } // 2 minute timeout
    );
    
    // Cleanup text file
    fs.unlinkSync(textFilePath);
    
    console.log(`✅ TTS audio generated: ${outputPath}`);
    return outputPath;
    
  } catch (error) {
    console.error('❌ TTS generation failed:', error.message);
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
