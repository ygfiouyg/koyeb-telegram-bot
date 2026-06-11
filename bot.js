// ═══════════════════════════════════════════════════════════════════════════
// DeltaAI Telegram Bot — Runs on Koyeb (FREE, no credit card, 24/7)
// ═══════════════════════════════════════════════════════════════════════════
// Uses long polling (works on Koyeb unlike HF Spaces)
// Calls DeltaAI directly — simple, no relay needed
// ═══════════════════════════════════════════════════════════════════════════

import TelegramBot from 'node-telegram-bot-api';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const BOT_TOKEN = process.env.BOT_TOKEN;
const DELTA_AI_URL = process.env.DELTA_AI_URL || 'https://kopabdo-delta-ai.hf.space';
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'deepseek-v3';
const BOT_LANGUAGE = process.env.BOT_LANGUAGE || 'ar';
const PORT = process.env.PORT || 8000;

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN missing!');
  process.exit(1);
}

// ─── Sessions ────────────────────────────────────────────────────────────
const DATA_DIR = './data';
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

let sessions = {};
try {
  if (existsSync(join(DATA_DIR, 'sessions.json'))) {
    sessions = JSON.parse(readFileSync(join(DATA_DIR, 'sessions.json'), 'utf-8'));
  }
} catch {}

function getSession(id) {
  if (!sessions[id]) sessions[id] = { model: null, language: BOT_LANGUAGE, msgCount: 0 };
  return sessions[id];
}

function saveSessions() {
  try { writeFileSync(join(DATA_DIR, 'sessions.json'), JSON.stringify(sessions, null, 2)); } catch {}
}

// ─── DeltaAI ─────────────────────────────────────────────────────────────

async function askDeltaAI(message, model, language) {
  const url = DELTA_AI_URL + '/api/chat/stream';
  const body = { message, model: model || DEFAULT_MODEL };
  if (language) body.language = language;

  console.log('[AI] model=' + body.model + ' msg=' + message.substring(0, 40));

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error('DeltaAI ' + response.status + ': ' + err);
  }

  let content = '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t || !t.startsWith('data:')) continue;
      const d = t.slice(5).trim();
      if (d === '[DONE]') continue;
      try { const ev = JSON.parse(d); if (ev.content) content += ev.content; } catch {}
    }
  }
  reader.releaseLock();
  return content.trim();
}

function splitMsg(text, max = 4096) {
  if (text.length <= max) return [text];
  const chunks = [];
  const lines = text.split('\n');
  let cur = '';
  for (const l of lines) {
    if (cur.length + l.length + 1 > max) { if (cur) chunks.push(cur); cur = l; }
    else cur = cur ? cur + '\n' + l : l;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// ─── HTTP server (Koyeb needs a port open) ──────────────────────────────

import { createServer } from 'http';
createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', bot: 'DeltaAI', model: DEFAULT_MODEL }));
}).listen(PORT, '0.0.0.0', () => {
  console.log('[HTTP] Health on port ' + PORT);
});

// ═══════════════════════════════════════════════════════════════════════════
// Start Bot!
// ═══════════════════════════════════════════════════════════════════════════

const bot = new TelegramBot(BOT_TOKEN, { polling: true, request: { timeout: 60000 } });

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  DeltaAI Telegram Bot — شغال 24/7 على Koyeb!');
console.log('═══════════════════════════════════════════════════════════════\n');

bot.getMe().then(info => {
  console.log('✅ @' + info.username);
}).catch(err => {
  console.error('❌ getMe failed:', err.message);
});

// ─── /start ──────────────────────────────────────────────────────────────
bot.onText(/\/start/, msg => {
  const name = msg.from.first_name || 'صديقي';
  getSession(msg.chat.id);
  bot.sendMessage(msg.chat.id,
    'أهلاً ' + name + '! 👋\n\n' +
    'أنا بوت DeltaAI — أساعدك في أي سؤال!\n\n' +
    'اكتب أي حاجة وهرد عليك 💡\n\n' +
    '/نموذج — تغيير النموذج\n' +
    '/مسح — مسح المحادثة\n' +
    '/مساعدة — المساعدة'
  );
});

// ─── /مساعدة ────────────────────────────────────────────────────────────
bot.onText(/\/مساعدة|\/help/, msg => {
  bot.sendMessage(msg.chat.id,
    'DeltaAI Telegram Bot\n\n' +
    '/نموذج — تغيير النموذج\n' +
    '/مسح — مسح المحادثة\n' +
    '/لغة — تغيير اللغة\n' +
    '/مساعدة — المساعدة\n\n' +
    'اكتب أي سؤال وهرد عليك!'
  );
});

// ─── /نموذج ──────────────────────────────────────────────────────────────
bot.onText(/\/نموذج(.*)|\/model(.*)/, (msg, match) => {
  const session = getSession(msg.chat.id);
  const arg = match[1].trim() || match[2].trim();
  if (!arg) {
    bot.sendMessage(msg.chat.id,
      'النموذج: ' + (session.model || DEFAULT_MODEL) + '\n\n' +
      'النماذج:\n• deepseek-v3 (سريع)\n• qwen-2-5 (سريع)\n• delta-pro (خبير)\n• delta-ultra (الأقوى)\n\n/نموذج deepseek-v3'
    );
  } else {
    session.model = arg;
    saveSessions();
    bot.sendMessage(msg.chat.id, 'تم تغيير النموذج إلى: ' + arg);
  }
});

// ─── /مسح ────────────────────────────────────────────────────────────────
bot.onText(/\/مسح|\/clear/, msg => {
  delete sessions[msg.chat.id];
  saveSessions();
  bot.sendMessage(msg.chat.id, 'تم مسح المحادثة! 🔄');
});

// ─── /لغة ────────────────────────────────────────────────────────────────
bot.onText(/\/لغة(.*)|\/lang(.*)/, (msg, match) => {
  const session = getSession(msg.chat.id);
  const arg = (match[1].trim() || match[2].trim());
  if (!arg || !['ar', 'en'].includes(arg)) {
    bot.sendMessage(msg.chat.id, '/لغة ar أو /لغة en');
  } else {
    session.language = arg;
    saveSessions();
    bot.sendMessage(msg.chat.id, arg === 'ar' ? 'تم تغيير اللغة ✅' : 'Language changed ✅');
  }
});

// ─── All text messages ───────────────────────────────────────────────────
bot.on('message', async msg => {
  const text = msg.text;
  if (!text || text.startsWith('/')) return;

  const chatId = msg.chat.id;
  const session = getSession(chatId);

  bot.sendChatAction(chatId, 'typing');

  try {
    const content = await askDeltaAI(text, session.model || DEFAULT_MODEL, session.language);
    session.msgCount++;
    saveSessions();

    if (content) {
      const chunks = splitMsg(content);
      for (const chunk of chunks) {
        await bot.sendMessage(chatId, chunk);
      }
    }
  } catch (error) {
    console.error('[Bot] Error:', error.message);
    bot.sendMessage(chatId, '❌ حصل خطأ. جرب تاني.');
  }
});

bot.on('polling_error', err => console.error('[Polling]', err.message));
setInterval(saveSessions, 5 * 60_000);
process.on('uncaughtException', e => console.error('[FATAL]', e.message));
process.on('unhandledRejection', e => console.error('[WARN]', e));
