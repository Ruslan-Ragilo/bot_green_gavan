/**
 * Отчёты об ошибках в отдельный лог-бот.
 *
 * Основной бот шлёт сообщения через второго бота (LOG_BOT_TOKEN) в чат администратора (LOG_CHAT_ID,
 * по умолчанию — ADMIN_IDS). Администратор должен один раз нажать /start у лог-бота.
 *
 * Одинаковые ошибки присылаются не чаще раза в ERROR_REPORT_WINDOW_MINUTES со счётчиком повторов.
 * Счётчик хранится в базе, поэтому цикл перезапусков не превращается в поток сообщений.
 * Отчёт никогда не бросает исключение и не ломает основной бот.
 */
import { Api } from 'grammy';
import { config } from '../../config.js';
import { db } from '../db/index.js';

const originalConsoleError = console.error.bind(console);
const api = config.logBotToken
  ? new Api(config.logBotToken, config.telegramApiRoot ? { apiRoot: config.telegramApiRoot } : undefined)
  : null;
const chatIds = () => (config.logChatIds.length ? config.logChatIds : config.adminIds);

let botName = config.botLabel;
export function setReporterBotName(username) {
  if (!config.botLabel && username) botName = `@${username}`;
}

const getStmt = db.prepare('SELECT last_sent_at, suppressed FROM error_reports WHERE key = ?');
const sentStmt = db.prepare(`
  INSERT INTO error_reports (key, last_sent_at, suppressed) VALUES (?, ?, 0)
  ON CONFLICT(key) DO UPDATE SET last_sent_at = excluded.last_sent_at, suppressed = 0
`);
const suppressStmt = db.prepare('UPDATE error_reports SET suppressed = suppressed + 1 WHERE key = ?');

/**
 * Можно ли отправить отчёт с этим ключом сейчас. Возвращает { send, repeated } —
 * repeated: сколько раз то же самое случилось с прошлой отправки.
 */
function throttle(key) {
  const now = Date.now();
  const windowMs = config.errorReportWindowMinutes * 60 * 1000;
  try {
    const row = getStmt.get(key);
    if (row && now - row.last_sent_at < windowMs) {
      suppressStmt.run(key);
      return { send: false };
    }
    sentStmt.run(key, now);
    return { send: true, repeated: row?.suppressed || 0 };
  } catch {
    return { send: true, repeated: 0 };
  }
}

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Ключ группировки: без чисел (id пользователей, сообщений, таймингов), чтобы похожие ошибки склеивались
const normalize = (text) => String(text).replace(/\d+/g, '#').slice(0, 200);

async function send(html) {
  if (!api) return;
  for (const chatId of chatIds()) {
    try {
      await api.sendMessage(chatId, html.slice(0, 4000), { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    } catch (err) {
      originalConsoleError('[ErrorReporter] Не удалось отправить отчёт:', err.message);
    }
  }
}

function describeUpdate(ctx) {
  if (!ctx) return '';
  const from = ctx.from ? `${ctx.from.first_name || ''}${ctx.from.username ? ` @${ctx.from.username}` : ''} (id ${ctx.from.id})` : '—';
  const action = ctx.callbackQuery?.data
    ? `кнопка <code>${esc(ctx.callbackQuery.data)}</code>`
    : ctx.message?.text
      ? `текст «${esc(ctx.message.text.slice(0, 80))}»`
      : ctx.message?.photo ? 'фото' : Object.keys(ctx.update || {}).filter(k => k !== 'update_id').join(', ');
  return `👤 ${esc(from)}\n🔘 ${action}\n`;
}

function stackTop(err) {
  const lines = String(err?.stack || '').split('\n').slice(1)
    .filter(l => !l.includes('node_modules') && !l.includes('node:internal'))
    .slice(0, 4).map(l => l.trim());
  return lines.length ? `<pre>${esc(lines.join('\n'))}</pre>` : '';
}

/**
 * Сообщить об ошибке. where — откуда (bot.catch, uncaughtException, запуск…), ctx — апдейт grammY, если есть.
 */
export async function reportError(err, { where = 'ошибка', ctx = null } = {}) {
  try {
    const message = err?.description || err?.message || String(err);
    const { send: ok, repeated } = throttle(`err:${where}:${normalize(message)}`);
    if (!ok) return;
    const html =
      `🔴 <b>${esc(where)}</b> · ${esc(botName || 'бот')}\n` +
      describeUpdate(ctx) +
      `💬 ${esc(message)}\n` +
      (repeated ? `🔁 С прошлого отчёта повторилась ещё <b>${repeated}</b> раз\n` : '') +
      stackTop(err);
    await send(html);
  } catch (e) {
    originalConsoleError('[ErrorReporter] Сбой отчёта:', e.message);
  }
}

/**
 * Служебное событие (запуск, остановка). key — для защиты от повторов: частые запуски склеиваются,
 * и счётчик «перезапусков за N минут» сразу показывает цикл падений.
 */
export async function reportEvent(text, { key = null } = {}) {
  try {
    let suffix = '';
    if (key) {
      const { send: ok, repeated } = throttle(`event:${key}`);
      if (!ok) return;
      if (repeated) suffix = `\n⚠️ Ещё <b>${repeated}</b> раз с прошлого сообщения — похоже на цикл перезапусков`;
    }
    await send(`${text} · ${esc(botName || 'бот')}${suffix}`);
  } catch (e) {
    originalConsoleError('[ErrorReporter] Сбой отчёта:', e.message);
  }
}

/**
 * Пересылать в лог-бот всё, что код пишет через console.error (ошибки фоновых задач, рассылок и т. п.),
 * не трогая каждый обработчик. Вывод в консоль/pm2 остаётся как был.
 */
export function hookConsoleErrors() {
  console.error = (...args) => {
    originalConsoleError(...args);
    const err = args.find(a => a instanceof Error);
    const text = args.map(a => (a instanceof Error ? a.message : typeof a === 'string' ? a : '')).filter(Boolean).join(' ');
    if (!text) return;
    // Эти места уже отправляют отчёт сами, с подробностями апдейта — не дублируем
    if (/^(\[Bot Error\]|❌ Критическая ошибка)/.test(text)) return;
    const where = (text.match(/^\[([^\]]+)\]/)?.[1]) || 'console.error';
    reportError(err || new Error(text), { where }).catch(() => {});
  };
}

export const reporterEnabled = Boolean(api);
export const reporterApi = api; // для тестов
