/**
 * «🔔 Сигнал Гавани (сообщить всем)» — важные объявления, потеряшки и срочная помощь соседей.
 * Житель присылает 1 сообщение (текст и/или фото) → админ одобряет в 1 клик →
 * сообщение уходит в личку всем жильцам района (кроме отключивших уведомления).
 */
import { Composer, InlineKeyboard } from 'grammy';
import { config, isAdmin } from '../../config.js';
import {
  createSignal,
  getSignal,
  getActiveSignals,
  getPendingSignals,
  hasPendingSignal,
  approveSignal,
  rejectSignal,
  closeSignal,
  isSignalsMuted,
  setSignalsMuted,
  getSignalRecipientIds,
  getSignalSubscribersCount,
} from '../db/repositories/signals.js';
import { formatWhen } from '../services/makers.js';
import { rich, cleanEntities } from '../utils/richText.js';
import { renderScreen } from '../utils/cleanChat.js';
import { setPendingInput, getPendingInput, clearPendingInput } from '../utils/pendingInput.js';

export const signalsComposer = new Composer();

const CAPTION_LIMIT = 1024;
const MAX_LIST_BUTTONS = 15;
const SEND_DELAY_MS = 35;

function show(ctx, built, keyboard, options = {}) {
  return renderScreen(ctx, built.text, { entities: built.entities, reply_markup: keyboard }, options);
}

function authorDisplayName(from) {
  return [from?.first_name, from?.last_name].filter(Boolean).join(' ') || 'Сосед';
}

function signalPreviewTitle(text) {
  const firstLine = String(text || '').split('\n').map(s => s.trim()).find(Boolean) || 'Объявление';
  return firstLine.length > 36 ? `${firstLine.slice(0, 35).trim()}…` : firstLine;
}

function buildSignalPushContent(signal) {
  const r = rich()
    .bold('🔔 Сигнал Гавани').nl(2)
    .rich(signal.text, signal.entities).nl(2)
    .italic(`👤 ${signal.author_name || 'Сосед'}`);
  const limit = signal.photo ? CAPTION_LIMIT : 4096;
  return r.build(limit);
}

function buildSignalPushKeyboard(signal) {
  const kb = new InlineKeyboard();
  if (signal.author_username) {
    kb.url('✉️ Написать автору', `https://t.me/${signal.author_username}`).row();
  }
  kb.text('🔕 Отключить «Сигнал Гавани»', 'sig:mute_push');
  return kb;
}

async function sendSignalMessage(api, chatId, signal, kb, header = null) {
  let built;
  if (header) {
    const r = rich()
      .bold(header).nl(2)
      .rich(signal.text, signal.entities);
    built = r.build(signal.photo ? CAPTION_LIMIT : 4096);
  } else {
    built = buildSignalPushContent(signal);
  }

  if (signal.photo) {
    try {
      return await api.sendPhoto(chatId, signal.photo, {
        caption: built.text,
        caption_entities: built.entities,
        reply_markup: kb,
      });
    } catch (err) {
      // Если фото не удалось отправить — отправляем текстом
      return await api.sendMessage(chatId, built.text, {
        entities: built.entities,
        reply_markup: kb,
      });
    }
  }
  return await api.sendMessage(chatId, built.text, {
    entities: built.entities,
    reply_markup: kb,
  });
}

// Массовая отправка одобренного сигнала всем подписанным жильцам
async function broadcastSignal(api, signal) {
  const recipients = getSignalRecipientIds(signal.user_id);
  const kb = buildSignalPushKeyboard(signal);
  let sent = 0;
  let failed = 0;

  for (const recipientId of recipients) {
    try {
      await sendSignalMessage(api, recipientId, signal, kb);
      sent += 1;
    } catch (_) {
      failed += 1;
    }
    if (SEND_DELAY_MS > 0) {
      await new Promise(resolve => setTimeout(resolve, SEND_DELAY_MS));
    }
  }

  console.log(`🔔 [Signal #${signal.id}] Рассылка завершена: доставлено ${sent}/${recipients.length} (ошибок: ${failed})`);
  return { sent, failed, total: recipients.length };
}

// Отправка карточки модерации всем администраторам
async function notifyAdminsForModeration(api, signal) {
  const authorLine = signal.author_username
    ? `${signal.author_name} (@${signal.author_username}, id ${signal.user_id})`
    : `${signal.author_name} (нет username, id ${signal.user_id})`;

  const r = rich()
    .bold(`🔔 Сигнал Гавани #${signal.id} — на проверку`).nl()
    .plain(`👤 От: ${authorLine}`).nl(2)
    .rich(signal.text, signal.entities);

  const built = r.build(signal.photo ? CAPTION_LIMIT : 4096);
  const kb = new InlineKeyboard()
    .text('✅ Опубликовать и разослать', `siga:ok:${signal.id}`).row()
    .text('❌ Отклонить', `siga:no:${signal.id}`);

  for (const adminId of config.adminIds) {
    try {
      if (signal.photo) {
        await api.sendPhoto(adminId, signal.photo, {
          caption: built.text,
          caption_entities: built.entities,
          reply_markup: kb,
        });
      } else {
        await api.sendMessage(adminId, built.text, {
          entities: built.entities,
          reply_markup: kb,
        });
      }
    } catch (err) {
      console.error('[Signals] Не удалось отправить на модерацию админу:', err.message);
    }
  }
}

// ── Главный экран раздела ─────────────────────────────────

export async function showSignalsHome(ctx) {
  const userId = ctx.from.id;
  const active = getActiveSignals(MAX_LIST_BUTTONS);
  const muted = isSignalsMuted(userId);
  const subsCount = getSignalSubscribersCount();

  const r = rich()
    .bold('🔔 Сигнал Гавани').nl(2)
    .plain('Важные сообщения всем жителям района прямо в личку бота — чтобы их точно увидели и они не утонули в общем чате:').nl()
    .plain('• потеряшки и находки (ключи, карты, питомцы);').nl()
    .plain('• срочная помощь (прикурить авто, перекрыли выезд);').nl()
    .plain('• важные вопросы и объявления по району.').nl(2)
    .italic(`👥 Сейчас получают сигналы: ${subsCount} чел.`);

  const kb = new InlineKeyboard();
  kb.text('📣 Отправить сигнал всем', 'sig:new').row();

  if (active.length > 0) {
    r.nl(2).bold('📋 Актуальные сигналы:');
    for (const s of active) {
      kb.text(`🔔 ${signalPreviewTitle(s.text)}`, `sig:v:${s.id}`).row();
    }
  } else {
    r.nl(2).italic('Активных сигналов за последнюю неделю пока нет.');
  }

  kb.text(muted ? '🔕 Уведомления: ВЫКЛ (включить)' : '🔔 Уведомления: ВКЛ', 'sig:mute').row();
  kb.text('◀️ В главное меню', 'menu:main');

  return show(ctx, r.build(4096), kb);
}

signalsComposer.callbackQuery('sig:home', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showSignalsHome(ctx);
});

// ── Переключение уведомлений ──────────────────────────────

signalsComposer.callbackQuery('sig:mute', async (ctx) => {
  const userId = ctx.from.id;
  const nowMuted = !isSignalsMuted(userId);
  setSignalsMuted(userId, nowMuted);
  await ctx.answerCallbackQuery({
    text: nowMuted
      ? '🔕 Уведомления «Сигнал Гавани» отключены'
      : '🔔 Уведомления «Сигнал Гавани» включены!',
  });
  await showSignalsHome(ctx);
});

signalsComposer.callbackQuery('sig:mute_push', async (ctx) => {
  setSignalsMuted(ctx.from.id, true);
  await ctx.answerCallbackQuery({
    text: '🔕 Уведомления отключены. Включить обратно можно в «Сигнал Гавани».',
    show_alert: true,
  });
  // Убираем кнопку отписки с этого сообщения, оставляя кнопку связи с автором (если была)
  const rows = ctx.callbackQuery.message?.reply_markup?.inline_keyboard;
  if (rows) {
    const filtered = rows
      .map(row => row.filter(b => b.callback_data !== 'sig:mute_push'))
      .filter(row => row.length > 0);
    await ctx.editMessageReplyMarkup({
      reply_markup: filtered.length ? { inline_keyboard: filtered } : undefined,
    }).catch(() => {});
  }
});

// ── Просмотр одного сигнала ───────────────────────────────

signalsComposer.callbackQuery(/^sig:v:(\d+)$/, async (ctx) => {
  const signal = getSignal(Number(ctx.match[1]));
  if (!signal || signal.status !== 'active') {
    await ctx.answerCallbackQuery({ text: 'Объявление уже закрыто или устарело' });
    return showSignalsHome(ctx);
  }
  await ctx.answerCallbackQuery();

  const r = rich()
    .bold('🔔 Сигнал Гавани').nl(2)
    .rich(signal.text, signal.entities).nl(2)
    .plain(`👤 ${signal.author_name || 'Сосед'}`)
    .plain(signal.published_at ? ` · ${formatWhen(signal.published_at)}` : '');

  const kb = new InlineKeyboard();
  if (signal.author_username) {
    kb.url('✉️ Написать автору', `https://t.me/${signal.author_username}`).row();
  }
  if (signal.user_id === ctx.from.id || isAdmin(ctx.from.id)) {
    kb.text('✅ Вопрос решён (закрыть)', `sig:close:${signal.id}`).row();
  }
  kb.text('◀️ К списку сигналов', 'sig:home');

  const limit = signal.photo ? CAPTION_LIMIT : 4096;
  return show(ctx, r.build(limit), kb, signal.photo ? { photo: signal.photo } : {});
});

// ── Закрытие сигнала автором или админом ──────────────────

signalsComposer.callbackQuery(/^sig:close:(\d+)$/, async (ctx) => {
  const signal = getSignal(Number(ctx.match[1]));
  if (!signal) return ctx.answerCallbackQuery({ text: 'Не найдено' });
  if (signal.user_id !== ctx.from.id && !isAdmin(ctx.from.id)) {
    return ctx.answerCallbackQuery({ text: 'Закрыть может только автор или администратор', show_alert: true });
  }
  closeSignal(signal.id);
  await ctx.answerCallbackQuery({ text: '✅ Объявление закрыто' });
  return showSignalsHome(ctx);
});

signalsComposer.callbackQuery(/^sig:close_msg:(\d+)$/, async (ctx) => {
  const signal = getSignal(Number(ctx.match[1]));
  if (!signal) return ctx.answerCallbackQuery({ text: 'Не найдено' });
  if (signal.user_id !== ctx.from.id && !isAdmin(ctx.from.id)) {
    return ctx.answerCallbackQuery({ text: 'Закрыть может только автор или администратор', show_alert: true });
  }
  closeSignal(signal.id);
  await ctx.answerCallbackQuery({ text: '✅ Объявление закрыто и убрано из активных' });
  await ctx.editMessageReplyMarkup({
    reply_markup: new InlineKeyboard().text('✅ Вопрос решён (закрыто)', 'noop'),
  }).catch(() => {});
});

// ── Подача нового сигнала ─────────────────────────────────

signalsComposer.callbackQuery('sig:new', async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from.id;

  if (!isAdmin(userId) && hasPendingSignal(userId)) {
    const r = rich()
      .bold('⏳ Предыдущий сигнал ещё на проверке').nl(2)
      .plain('Как только администратор проверит его, вы сможете отправить новый сигнал.');
    return show(ctx, r.build(), new InlineKeyboard().text('◀️ Назад', 'sig:home'));
  }

  setPendingInput(userId, 'signal_create');

  const r = rich()
    .bold('📣 Новый «Сигнал Гавани»').nl(2)
    .plain('Пришлите ').bold('одним сообщением').plain(' текст (можно с фото), который уйдёт всем жителям района в личку.').nl(2)
    .italic('Например: «Найдены ключи с синим брелоком у 3 дома», «Машина 1234 AB-7, перекройте выезд пожалуйста» или «Нужно прикурить авто у шлагбаума».');

  if (!ctx.from.username) {
    r.nl(2).italic('⚠️ У вас в Telegram не указан username — кнопка «Написать автору» не сможет открыть вашу личку. Укажите в тексте телефон или способ связи.');
  }

  if (isAdmin(userId)) {
    r.nl(2).italic('👑 Вы администратор: сигнал уйдёт жильцам сразу без модерации.');
  } else {
    r.nl(2).italic('Перед рассылкой сообщение проходит быструю проверку от спама.');
  }

  return show(ctx, r.build(), new InlineKeyboard().text('✖️ Отмена', 'sig:home'));
});

// ── Приём текста / фото нового сигнала ────────────────────

signalsComposer.on(['message:photo', 'message:text'], async (ctx, next) => {
  if (ctx.chat.type !== 'private') return next();
  const userId = ctx.from.id;
  const state = getPendingInput(userId, 'signal_create');
  if (!state) return next();

  const msg = ctx.message;
  if (msg.text?.startsWith('/')) return next();

  const photo = msg.photo ? msg.photo[msg.photo.length - 1].file_id : null;
  const rawText = (msg.caption || msg.text || '').trim();
  const rawEntities = msg.caption ? msg.caption_entities : msg.entities;
  const entities = cleanEntities(rawEntities);

  if (rawText.length < 5) {
    return show(ctx, rich()
      .bold('📣 Новый «Сигнал Гавани»').nl(2)
      .plain('⚠️ Сообщение слишком короткое. Напишите хотя бы пару слов (минимум 5 символов), можно с фото.')
      .build(), new InlineKeyboard().text('✖️ Отмена', 'sig:home'));
  }

  clearPendingInput(userId);
  const admin = isAdmin(userId);

  const signal = createSignal({
    userId,
    authorName: authorDisplayName(ctx.from),
    authorUsername: ctx.from.username || null,
    text: rawText,
    entities,
    photo,
    autoApprove: admin,
  });

  if (admin) {
    await show(ctx, rich()
      .bold('📣 Рассылка «Сигнала Гавани» запущена…').nl(2)
      .plain('Отправляю сообщение всем подписанным жильцам.')
      .build(), new InlineKeyboard().text('◀️ В «Сигнал Гавани»', 'sig:home'));

    const stats = await broadcastSignal(ctx.api, signal);
    await ctx.api.sendMessage(
      userId,
      `✅ Сигнал #${signal.id} опубликован и доставлен *${stats.sent}* из *${stats.total}* жильцов.`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('✅ Вопрос решён (закрыть)', `sig:close_msg:${signal.id}`).row()
          .text('🔔 Открыть «Сигнал Гавани»', 'sig:home'),
      }
    ).catch(() => {});
    return;
  }

  await notifyAdminsForModeration(ctx.api, signal);

  return show(ctx, rich()
    .bold('⏳ Сигнал отправлен на проверку').nl(2)
    .plain('Как только администратор подтвердит сообщение, оно сразу уйдёт всем жителям района в личку. Я пришлю вам уведомление.')
    .build(), new InlineKeyboard().text('◀️ В «Сигнал Гавани»', 'sig:home'));
});

// ── Модерация администратором ─────────────────────────────

signalsComposer.callbackQuery(/^siga:(ok|no):(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery({ text: '⛔ Доступ запрещён', show_alert: true });
  const action = ctx.match[1];
  const id = Number(ctx.match[2]);
  const signal = getSignal(id);

  if (!signal) return ctx.answerCallbackQuery({ text: 'Сигнал не найден' });
  if (signal.status !== 'pending') {
    return ctx.answerCallbackQuery({ text: `Уже обработано (${signal.status})` });
  }

  if (action === 'no') {
    rejectSignal(id);
    await ctx.answerCallbackQuery({ text: '❌ Отклонено' });
    await ctx.editMessageReplyMarkup({
      reply_markup: new InlineKeyboard().text('❌ Отклонено', 'noop'),
    }).catch(() => {});

    await ctx.api.sendMessage(
      signal.user_id,
      'К сожалению, ваше объявление в «Сигнал Гавани» не прошло модерацию.',
      { reply_markup: new InlineKeyboard().text('🔔 Сигнал Гавани', 'sig:home') }
    ).catch(() => {});
    return;
  }

  // Одобрение и рассылка
  const published = approveSignal(id);
  await ctx.answerCallbackQuery({ text: '✅ Одобрено! Запускаю рассылку…' });
  await ctx.editMessageReplyMarkup({
    reply_markup: new InlineKeyboard().text('⏳ Идёт рассылка…', 'noop'),
  }).catch(() => {});

  // Уведомляем автора
  await ctx.api.sendMessage(
    published.user_id,
    '✅ Ваш «Сигнал Гавани» одобрен и отправлен соседям!\n\nКогда вопрос решится, нажмите кнопку ниже — объявление закроется.',
    {
      reply_markup: new InlineKeyboard()
        .text('✅ Вопрос решён (закрыть)', `sig:close_msg:${published.id}`).row()
        .text('🔔 Открыть «Сигнал Гавани»', 'sig:home'),
    }
  ).catch(() => {});

  const stats = await broadcastSignal(ctx.api, published);

  await ctx.editMessageReplyMarkup({
    reply_markup: new InlineKeyboard()
      .text(`✅ Разослано (${stats.sent}/${stats.total})`, 'noop').row()
      .text('🗑 Закрыть объявление', `sig:close_msg:${published.id}`),
  }).catch(() => {});
});

// Список ожидающих сигналов из /admin
signalsComposer.callbackQuery('siga:list', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery({ text: '⛔ Доступ запрещён', show_alert: true });
  await ctx.answerCallbackQuery();

  const pending = getPendingSignals();
  if (pending.length === 0) {
    return show(ctx, rich()
      .bold('🔔 Сигналы на проверке').nl(2)
      .plain('Новых заявок пока нет.')
      .build(), new InlineKeyboard().text('◀️ В админку', 'admin:main'));
  }

  const r = rich()
    .bold(`🔔 Сигналы на проверке (${pending.length})`).nl(2)
    .plain('Нажмите на сигнал, чтобы отправить карточку модерации в чат:');
  const kb = new InlineKeyboard();
  for (const s of pending) {
    kb.text(`#${s.id} · ${signalPreviewTitle(s.text)}`, `siga:resend:${s.id}`).row();
  }
  kb.text('◀️ В админку', 'admin:main');

  return show(ctx, r.build(), kb);
});

signalsComposer.callbackQuery(/^siga:resend:(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCallbackQuery({ text: '⛔ Доступ запрещён', show_alert: true });
  const signal = getSignal(Number(ctx.match[1]));
  if (!signal || signal.status !== 'pending') {
    await ctx.answerCallbackQuery({ text: 'Уже обработано' });
    return;
  }
  await ctx.answerCallbackQuery({ text: 'Отправляю карточку в чат…' });
  await notifyAdminsForModeration(ctx.api, signal);
});
