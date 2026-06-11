// ═══════════════════════════════════════════════════════════════════════════
// DeltaAI Telegram Bot v2.0 — مع المسار الذكي!
// ═══════════════════════════════════════════════════════════════════════════
// الأوامر الجديدة:
// /ملف — ملف دراسي ملون (زي المسار الذكي)
// /ملخص — ملخص محاضرة في PDF
// /اختبار — كويز بأسئلة اختيارية
// /خريطة — خريطة ذهنية
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

// ─── DeltaAI Chat ────────────────────────────────────────────────────────

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
  let pdfUrl = null;
  let smartDocResult = null;
  let quizData = null;
  let imageDataUrl = null;

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
      try {
        const ev = JSON.parse(d);
        if (ev.content) content += ev.content;
        if (ev.fileGenResult?.fileUrl) pdfUrl = ev.fileGenResult.fileUrl;
        if (ev.smartDocResult) smartDocResult = ev.smartDocResult;
        if (ev.quizData) quizData = ev.quizData;
        if (ev.imageDataUrl) imageDataUrl = ev.imageDataUrl;
      } catch {}
    }
  }
  reader.releaseLock();
  return { content: content.trim(), pdfUrl, smartDocResult, quizData, imageDataUrl };
}

// ─── Smart PDF Generation (المسار الذكي) ────────────────────────────────
// Uses /api/ai/hf/document — the SAME engine as المسار الذكي on the website!
// This generates beautiful colored PDFs with quizzes, flashcards, etc.

async function generateSmartPDF(topic, content, mode) {
  const url = DELTA_AI_URL + '/api/ai/hf/document';
  console.log('[SmartPDF] Generating (المسار الذكي):', topic);

  const body = {
    mode: mode || 'local',         // 'local' = local PDF engine (fast + beautiful)
    modelId: 'local-pdf',
    topic: topic,
    language: BOT_LANGUAGE,
    instructions: 'أضف أسئلة مراجعة وبطاقات ذاكرة وخريطة ذهنية. نظم المحتوى بألوان وتصميم احترافي.',
    includeAiImages: false,
    channelName: 'DeltaAI Bot',
  };

  // If we have content, send it as a lecture
  if (content) {
    body.lectures = [{ title: topic, content: content }];
    body.mode = 'batch';
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000), // 3 min — PDF generation takes time
  });

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    console.error('[SmartPDF] Error:', response.status, err);
    throw new Error('SmartPDF error ' + response.status + ': ' + err.substring(0, 200));
  }

  // Check if response is SSE stream or JSON
  const contentType = response.headers.get('content-type') || '';
  
  if (contentType.includes('text/event-stream')) {
    // SSE response — parse stream for progress and result
    let fileUrl = null;
    let fileName = null;
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
        try {
          const ev = JSON.parse(d);
          if (ev.fileUrl) fileUrl = ev.fileUrl;
          if (ev.fileName) fileName = ev.fileName;
          if (ev.stage) console.log('[SmartPDF] Stage:', ev.stage, ev.progress ? ev.progress + '%' : '');
        } catch {}
      }
    }
    reader.releaseLock();

    if (fileUrl) {
      return { success: true, fileUrl, fileName: fileName || topic + '.pdf' };
    }
    throw new Error('SmartPDF: no fileUrl in SSE response');
  }

  // JSON response
  const data = await response.json();
  if (data.success || data.fileUrl) {
    return { success: true, fileUrl: data.fileUrl, fileName: data.fileName || topic + '.pdf' };
  }
  throw new Error('SmartPDF failed: ' + (data.error || 'unknown'));
}

// ─── Simple PDF fallback (أبيض وأسود — للطوارئ فقط) ──────────────────────

async function generateSimplePDF(title, content) {
  const url = DELTA_AI_URL + '/api/pdf/generate';
  const body = {
    title,
    content,
    modelId: DEFAULT_MODEL,
    language: BOT_LANGUAGE,
    documentType: 'lecture',
    topicCategory: 'default',
    useDesignReasoning: true,
    includeImages: true,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) throw new Error('PDF error ' + response.status);
  return await response.json();
}

// ─── Quiz Generation ─────────────────────────────────────────────────────

async function generateQuiz(topic, content, questionCount, difficulty) {
  const url = DELTA_AI_URL + '/api/ai/quiz';
  console.log('[Quiz] Generating for:', topic);

  const body = {
    topic,
    questionCount: questionCount || 10,
    difficulty: difficulty || 'medium',
    types: ['mcq', 'true-false'],
  };
  if (content) body.content = content;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error('Quiz error ' + response.status + ': ' + err);
  }

  return await response.json();
}

// ─── Mind Map Generation ─────────────────────────────────────────────────

async function generateMindMap(topic, content) {
  const url = DELTA_AI_URL + '/api/ai/mindmap';
  console.log('[MindMap] Generating for:', topic);

  const body = { topic, language: BOT_LANGUAGE };
  if (content) body.content = content;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error('MindMap error ' + response.status + ': ' + err);
  }

  return await response.json();
}

// ─── Download PDF from DeltaAI ───────────────────────────────────────────

async function downloadPDF(path) {
  const fullUrl = path.startsWith('http') ? path : DELTA_AI_URL + path;
  const response = await fetch(fullUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error('Download failed: ' + response.status);
  return Buffer.from(await response.arrayBuffer());
}

// ─── Helpers ─────────────────────────────────────────────────────────────

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

function formatQuiz(quizData) {
  if (!quizData || !quizData.questions) return 'مفيش أسئلة';
  let text = '📝 ' + (quizData.title || 'كويز') + '\n\n';
  quizData.questions.forEach((q, i) => {
    text += (i + 1) + '. ' + q.question + '\n';
    if (q.options) {
      q.options.forEach((opt, j) => {
        text += '   ' + String.fromCharCode(65 + j) + ') ' + opt + '\n';
      });
    }
    text += '   ✅ ' + q.correctAnswer + '\n';
    if (q.explanation) text += '   💡 ' + q.explanation + '\n';
    text += '\n';
  });
  return text;
}

function formatMindMap(data, indent = 0) {
  if (!data) return '';
  let text = '  '.repeat(indent) + (indent === 0 ? '🧠 ' : '• ') + data.text + '\n';
  if (data.children) {
    for (const child of data.children) {
      text += formatMindMap(child, indent + 1);
    }
  }
  return text;
}

// ─── HTTP health server ──────────────────────────────────────────────────

import { createServer } from 'http';
createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', bot: 'DeltaAI', model: DEFAULT_MODEL, version: '2.0' }));
}).listen(PORT, '0.0.0.0', () => {
  console.log('[HTTP] Health on port ' + PORT);
});

// ═══════════════════════════════════════════════════════════════════════════
// Start Bot!
// ═══════════════════════════════════════════════════════════════════════════

const bot = new TelegramBot(BOT_TOKEN, { polling: true, request: { timeout: 60000 } });

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  DeltaAI Telegram Bot v2.0 — مع المسار الذكي!');
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
    '💬 اكتب أي حاجة وهرد عليك\n\n' +
    '📚 الأوامر الخاصة:\n' +
    '/ملف موضوع — ملف دراسي ملون PDF\n' +
    '/ملخص موضوع — ملخص محاضرة PDF\n' +
    '/اختبار موضوع — كويز بأسئلة\n' +
    '/خريطة موضوع — خريطة ذهنية\n' +
    '/نموذج — تغيير النموذج\n' +
    '/مسح — مسح المحادثة\n' +
    '/مساعدة — المساعدة'
  );
});

// ─── /مساعدة ────────────────────────────────────────────────────────────
bot.onText(/\/مساعدة|\/help/, msg => {
  bot.sendMessage(msg.chat.id,
    '🤖 DeltaAI Telegram Bot v2.0\n\n' +
    '📚 أوامر المسار الذكي:\n' +
    '/ملف موضوع — ملف دراسي ملون (PDF فيه ملخص + أسئلة + بطاقات)\n' +
    '/ملخص موضوع — ملخص محاضرة في PDF\n' +
    '/اختبار موضوع — كويز بأسئلة اختيارية وصح/غلط\n' +
    '/خريطة موضوع — خريطة ذهنية\n\n' +
    '⚙️ إعدادات:\n' +
    '/نموذج — تغيير النموذج\n' +
    '/لغة — تغيير اللغة\n' +
    '/مسح — مسح المحادثة\n\n' +
    '💡 أو اكتب عادي وهرد عليك!'
  );
});

// ─── /ملف — Smart Study PDF (المسار الذكي — ملون ومتorganize!) ────────
bot.onText(/\/ملف(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const topic = match[1].trim();

  if (!topic) {
    bot.sendMessage(chatId, 'اكتب الموضوع بعد /ملف\n\nمثال: /ملف الذكاء الاصطناعي');
    return;
  }

  bot.sendChatAction(chatId, 'typing');
  bot.sendMessage(chatId, '📚 بعملك ملف دراسي ملون عن: ' + topic + '\n⏳ ممكن ياخد 1-2 دقيقة...');

  try {
    // Use المسار الذكي engine directly — same as website!
    const pdfResult = await generateSmartPDF(topic, null, 'local');

    if (pdfResult.success && pdfResult.fileUrl) {
      const pdfBuffer = await downloadPDF(pdfResult.fileUrl);
      bot.sendDocument(chatId, pdfBuffer, {
        caption: '📚 ' + topic,
        filename: pdfResult.fileName || topic.replace(/\s+/g, '_') + '.pdf',
      });
    } else {
      bot.sendMessage(chatId, '⚠️ حصلت مشكلة في الملف. جرب تاني.');
    }
  } catch (error) {
    console.error('[ملف] Error:', error.message);
    bot.sendMessage(chatId, '❌ حصل خطأ في عمل الملف: ' + error.message.substring(0, 100));
  }
});

// ─── /ملخص — Summary PDF (مسار ذكي — ملون!) ─────────────────────────────
bot.onText(/\/ملخص(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const topic = match[1].trim();

  if (!topic) {
    bot.sendMessage(chatId, 'اكتب الموضوع بعد /ملخص\n\nمثال: /ملخص محاضرة الأحياء');
    return;
  }

  bot.sendChatAction(chatId, 'typing');
  bot.sendMessage(chatId, '📝 بعملك ملخص ملون عن: ' + topic + '\n⏳ ممكن ياخد 1-2 دقيقة...');

  try {
    const pdfResult = await generateSmartPDF('ملخص: ' + topic, null, 'local');

    if (pdfResult.success && pdfResult.fileUrl) {
      const pdfBuffer = await downloadPDF(pdfResult.fileUrl);
      bot.sendDocument(chatId, pdfBuffer, {
        caption: '📝 ملخص: ' + topic,
        filename: pdfResult.fileName || 'ملخص_' + topic.replace(/\s+/g, '_') + '.pdf',
      });
    } else {
      bot.sendMessage(chatId, '⚠️ حصلت مشكلة. جرب تاني.');
    }
  } catch (error) {
    console.error('[ملخص] Error:', error.message);
    bot.sendMessage(chatId, '❌ حصل خطأ. جرب تاني.');
  }
});

// ─── /اختبار — Quiz ─────────────────────────────────────────────────────
bot.onText(/\/اختبار(.*)|\/quiz(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const topic = (match[1].trim() || match[2].trim());

  if (!topic) {
    bot.sendMessage(chatId, 'اكتب الموضوع بعد /اختبار\n\nمثال: /اختبار الفيزياء');
    return;
  }

  bot.sendChatAction(chatId, 'typing');
  bot.sendMessage(chatId, '📝 بعملك كويز عن: ' + topic + '\n⏳ استنى...');

  try {
    const quizData = await generateQuiz(topic, null, 10, 'medium');
    const text = formatQuiz(quizData);

    const chunks = splitMsg(text);
    for (const chunk of chunks) {
      await bot.sendMessage(chatId, chunk);
    }
  } catch (error) {
    console.error('[اختبار] Error:', error.message);
    // Fallback: ask AI to generate quiz
    try {
      const aiResult = await askDeltaAI(
        'اعمل كويز 10 أسئلة اختيارية عن: ' + topic + '\nمع الإجابات الصحيحة والشرح',
        DEFAULT_MODEL,
        BOT_LANGUAGE
      );
      const chunks = splitMsg(aiResult.content);
      for (const chunk of chunks) {
        await bot.sendMessage(chatId, chunk);
      }
    } catch {
      bot.sendMessage(chatId, '❌ حصل خطأ. جرب تاني.');
    }
  }
});

// ─── /خريطة — Mind Map ──────────────────────────────────────────────────
bot.onText(/\/خريطة(.*)|\/mindmap(.*)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const topic = (match[1].trim() || match[2].trim());

  if (!topic) {
    bot.sendMessage(chatId, 'اكتب الموضوع بعد /خريطة\n\nمثال: /خريطة البرمجة');
    return;
  }

  bot.sendChatAction(chatId, 'typing');
  bot.sendMessage(chatId, '🧠 بعملك خريطة ذهنية عن: ' + topic + '\n⏳ استنى...');

  try {
    const mindmapData = await generateMindMap(topic);
    const text = '🧠 خريطة ذهنية: ' + topic + '\n\n' + formatMindMap(mindmapData.mindmap);
    const chunks = splitMsg(text);
    for (const chunk of chunks) {
      await bot.sendMessage(chatId, chunk);
    }
  } catch (error) {
    console.error('[خريطة] Error:', error.message);
    // Fallback: ask AI to generate mind map text
    try {
      const aiResult = await askDeltaAI(
        'اعمل خريطة ذهنية نصية عن: ' + topic + '\nبشكل شجري منظم',
        DEFAULT_MODEL,
        BOT_LANGUAGE
      );
      const chunks = splitMsg(aiResult.content);
      for (const chunk of chunks) {
        await bot.sendMessage(chatId, chunk);
      }
    } catch {
      bot.sendMessage(chatId, '❌ حصل خطأ. جرب تاني.');
    }
  }
});

// ─── /نموذج ──────────────────────────────────────────────────────────────
bot.onText(/\/نموذج(.*)|\/model(.*)/, (msg, match) => {
  const session = getSession(msg.chat.id);
  const arg = match[1].trim() || match[2].trim();
  if (!arg) {
    bot.sendMessage(msg.chat.id,
      'النموذج: ' + (session.model || DEFAULT_MODEL) + '\n\n' +
      'النماذج:\n• deepseek-v3 (سريع)\n• qwen-2-5 (سريع)\n• delta-pro (خبير — الأحسن للملفات)\n• delta-ultra (الأقوى)\n\n/نموذج delta-pro'
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
    const result = await askDeltaAI(text, session.model || DEFAULT_MODEL, session.language);
    session.msgCount++;
    saveSessions();

    // Send text
    if (result.content) {
      const chunks = splitMsg(result.content);
      for (const chunk of chunks) {
        await bot.sendMessage(chatId, chunk);
      }
    }

    // Send Smart Doc PDF if generated
    if (result.smartDocResult?.success && result.smartDocResult.fileUrl) {
      try {
        const pdfBuffer = await downloadPDF(result.smartDocResult.fileUrl);
        bot.sendDocument(chatId, pdfBuffer, {
          caption: '📄 ' + (result.smartDocResult.fileName || 'مستند'),
          filename: result.smartDocResult.fileName || 'document.pdf',
        });
      } catch {
        bot.sendMessage(chatId, '📄 المستند: ' + DELTA_AI_URL + result.smartDocResult.fileUrl);
      }
    }

    // Send PDF if generated
    if (result.pdfUrl) {
      try {
        const pdfBuffer = await downloadPDF(result.pdfUrl);
        bot.sendDocument(chatId, pdfBuffer, {
          caption: '📄 مستند مولّد',
          filename: 'document.pdf',
        });
      } catch {
        bot.sendMessage(chatId, '📄 المستند: ' + DELTA_AI_URL + result.pdfUrl);
      }
    }

    // Send image if generated
    if (result.imageDataUrl) {
      try {
        const base64 = result.imageDataUrl.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64, 'base64');
        bot.sendPhoto(chatId, buffer);
      } catch {}
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
