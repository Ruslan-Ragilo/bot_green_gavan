/**
 * «💅 Услуги и красота» — витрина для жильцов:
 * категории → специалисты → карточка мастера и услуг со слайдером фото + горящие отмены.
 * Запись — напрямую у специалиста (Telegram ЛС с предзаполненным текстом или внешняя ссылка Dikidi/Yclients).
 */
import { Composer, InlineKeyboard } from 'grammy';
import { isAdmin } from '../../config.js';
import {
  getProvider,
  getActiveProviders,
  getCategoryProviderCounts,
  getServiceOffer,
  getProviderOffers,
  getHotSlot,
  getActiveHotSlots,
  getProviderHotSlots,
  isServiceSubscribed,
  subscribeService,
  unsubscribeService,
  getServicesSectionCover,
} from '../db/repositories/servicesCatalog.js';
import {
  SERVICE_SECTION_TITLE,
  SERVICE_CATEGORIES,
  SERVICE_CATEGORY_BY_ID,
  offerButtonLabel,
  contactUrl,
  prefilledContactUrl,
  formatHotSlotWhen,
} from '../services/servicesCatalog.js';
import { logServiceEvent, SERVICE_EVENT } from '../db/repositories/serviceStats.js';
import { rich } from '../utils/richText.js';
import { parseDbUtc } from '../utils/time.js';
import { renderScreen } from '../utils/cleanChat.js';

export const servicesComposer = new Composer();

const CAPTION_LIMIT = 1024;
const MAX_LIST_BUTTONS = 60;

const getPublishedOffers = (providerId) => getProviderOffers(providerId).filter(o => o.published);

function show(ctx, built, keyboard, options = {}) {
  return renderScreen(ctx, built.text, { entities: built.entities, reply_markup: keyboard }, options);
}

function showWithCover(ctx, r, keyboard, cover) {
  if (cover) return show(ctx, r.build(CAPTION_LIMIT), keyboard, { photo: cover });
  return show(ctx, r.build(4096), keyboard);
}

function track(ctx, provider, type, offerId = null) {
  const userId = ctx.from?.id;
  if (!userId || userId === provider.user_id || isAdmin(userId)) return;
  logServiceEvent({ providerId: provider.id, offerId, userId, type });
}

function addContactButtons(keyboard, provider, offerId = 0) {
  const hasDm = Boolean(contactUrl(provider.contact));
  const hasBooking = Boolean(provider.booking_url);
  if (hasDm) keyboard.text('✉️ Написать мастеру', `srv:w:${provider.id}:${offerId}`);
  if (hasBooking) keyboard.text('🗓 Онлайн-запись', `srv:bk:${provider.id}`);
  if (hasDm || hasBooking) keyboard.row();
}

// Заменить нажатую callback-кнопку на URL-кнопку (чтобы учесть переход в аналитике без лишнего экрана)
async function replaceCallbackWithUrl(ctx, label, url) {
  const rows = ctx.callbackQuery.message?.reply_markup?.inline_keyboard;
  if (!rows) return;
  const updated = rows.map(row => row.map(b => (b.callback_data === ctx.callbackQuery.data
    ? { text: label, url }
    : b)));
  await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: updated } }).catch(() => {});
}

// ── Главный экран раздела ─────────────────────────────────

export async function showServicesSection(ctx) {
  const allProviders = getActiveProviders();
  const counts = getCategoryProviderCounts();
  const hotSlots = getActiveHotSlots(30);

  const r = rich()
    .bold(SERVICE_SECTION_TITLE).nl(2)
    .plain('Маникюр, массаж, брови, уход и другие услуги от мастеров и специалистов рядом с домом.').nl()
    .plain('Запись — напрямую у мастера (в личке или через его ссылку онлайн-записи).');

  const kb = new InlineKeyboard();

  if (hotSlots.length > 0) {
    kb.text(`🔥 Горящие окна (отмены) · ${hotSlots.length}`, 'srv:hot').row();
  }

  if (allProviders.length === 0) {
    r.nl(2).italic('Специалисты скоро появятся.');
  } else {
    const activeCats = SERVICE_CATEGORIES.filter(c => (counts[c.id] || 0) > 0);
    if (activeCats.length > 0) {
      for (const cat of activeCats) {
        kb.text(`${cat.title} · ${counts[cat.id]}`, `srv:cat:${cat.id}`).row();
      }
      kb.text(`👥 Все специалисты · ${allProviders.length}`, 'srv:all').row();
    } else {
      for (const p of allProviders.slice(0, MAX_LIST_BUTTONS)) {
        const hot = p.hot_count > 0 ? '🔥 ' : '';
        kb.text(`${hot}${p.name}`, `srv:p:${p.id}:h`).row();
      }
    }
  }

  kb.text('✨ Я мастер — разместить услуги', 'srvp:home').row();
  kb.text('◀️ В главное меню', 'menu:main');
  return showWithCover(ctx, r, kb, getServicesSectionCover());
}

servicesComposer.callbackQuery('srv:home', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showServicesSection(ctx);
});

servicesComposer.command('services', async (ctx) => {
  if (ctx.chat.type !== 'private') return;
  await showServicesSection(ctx);
});

// ── 🔥 Горящие окна (отмены) ──────────────────────────────

async function showHotSlotsList(ctx) {
  const slots = getActiveHotSlots(MAX_LIST_BUTTONS);
  const r = rich().bold('🔥 Горящие окна (отмены)').nl(2);
  const kb = new InlineKeyboard();

  if (slots.length === 0) {
    r.plain('Сейчас свободных горящих окон нет.').nl()
      .plain('Подпишитесь на нужных мастеров — бот сразу пришлёт уведомление, когда у них освободится время.');
  } else {
    r.plain('Специалисты выкладывают сюда внезапно освободившееся время — можно быстро дойти из соседнего дома:').nl(2);
    for (const s of slots) {
      const when = formatHotSlotWhen(s.slot_at);
      r.bold(`🕒 ${when}`).plain(` — ${s.title}`).italic(` (${s.provider_name})`).nl();
      if (s.note) r.plain(`   ${s.note}`).nl();
      if (s.provider_location) r.italic(`   📍 ${s.provider_location}`).nl();
      r.nl();
      kb.text(`🔥 ${when} · ${s.provider_name}`, `srv:hv:${s.id}`).row();
    }
    r.italic('Нажмите на окно, чтобы посмотреть контакты и забрать время.');
  }

  kb.text('◀️ Назад', 'srv:home');
  return showWithCover(ctx, r, kb, getServicesSectionCover());
}

servicesComposer.callbackQuery('srv:hot', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showHotSlotsList(ctx);
});

// Карточка одного горящего окна
servicesComposer.callbackQuery(/^srv:hv:(\d+)$/, async (ctx) => {
  const slot = getHotSlot(Number(ctx.match[1]));
  if (!slot || slot.status !== 'active' || slot.provider_status !== 'active' || parseDbUtc(slot.slot_at) <= new Date()) {
    await ctx.answerCallbackQuery({ text: 'Это окно уже занято или прошло' });
    return showHotSlotsList(ctx);
  }
  await ctx.answerCallbackQuery();

  const when = formatHotSlotWhen(slot.slot_at);
  const r = rich()
    .bold(`🔥 Горящее окно · ${when}`).nl(2)
    .bold(slot.title).nl();
  if (slot.note) r.plain(slot.note).nl();
  r.nl().plain(`👤 ${slot.provider_name}`);
  if (slot.provider_location) r.nl().plain(`📍 ${slot.provider_location}`);
  if (slot.provider_contact && !contactUrl(slot.provider_contact)) {
    r.nl().plain(`📞 Связь: ${slot.provider_contact}`);
  }

  const kb = new InlineKeyboard();
  if (contactUrl(slot.provider_contact)) {
    kb.text('✉️ Забрать окно (написать)', `srv:hw:${slot.id}`);
  }
  if (slot.provider_booking_url) {
    kb.text('🗓 Онлайн-запись', `srv:bk:${slot.provider_id}`);
  }
  if (contactUrl(slot.provider_contact) || slot.provider_booking_url) kb.row();
  kb.text('👤 Профиль и фото работ', `srv:p:${slot.provider_id}:hot`).row();
  kb.text('◀️ К горящим окнам', 'srv:hot');
  return show(ctx, r.build(4096), kb);
});

// ── Список специалистов по категории / все ────────────────

async function showProvidersList(ctx, category = null) {
  const cat = category ? SERVICE_CATEGORY_BY_ID[category] : null;
  const providers = getActiveProviders(cat ? cat.id : null);
  const backCode = cat ? `c_${cat.id}` : 'all';

  const r = rich().bold(cat ? cat.title : '👥 Все специалисты').nl(2);
  const kb = new InlineKeyboard();

  if (providers.length === 0) {
    r.plain('В этом разделе пока нет опубликованных специалистов.');
  } else {
    for (const p of providers.slice(0, MAX_LIST_BUTTONS)) {
      const hotBadge = p.hot_count > 0 ? '🔥 ' : '';
      const loc = p.location ? ` · 📍 ${p.location}` : '';
      r.bold(`${hotBadge}${p.name}`).plain(loc).nl();
      kb.text(`${hotBadge}${p.name}${p.offers_count ? ` (${p.offers_count})` : ''}`, `srv:p:${p.id}:${backCode}`).row();
    }
    r.nl().italic('Выберите специалиста, чтобы посмотреть услуги, фото работ и контакты.');
  }

  kb.text('◀️ Назад', 'srv:home');
  return show(ctx, r.build(4096), kb);
}

servicesComposer.callbackQuery('srv:all', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showProvidersList(ctx, null);
});

servicesComposer.callbackQuery(/^srv:cat:([a-z]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!SERVICE_CATEGORY_BY_ID[ctx.match[1]]) return showServicesSection(ctx);
  await showProvidersList(ctx, ctx.match[1]);
});

// ── Карточка специалиста ──────────────────────────────────

function backToListTarget(back) {
  if (back === 'hot') return 'srv:hot';
  if (back === 'all') return 'srv:all';
  if (back && back.startsWith('c_')) return `srv:cat:${back.slice(2)}`;
  return 'srv:home';
}

export async function showProviderCard(ctx, providerId, back = 'h') {
  const provider = getProvider(providerId);
  if (!provider || provider.status !== 'active') {
    await ctx.answerCallbackQuery?.({ text: 'Специалист сейчас недоступен' }).catch(() => {});
    return showServicesSection(ctx);
  }

  const offers = getPublishedOffers(provider.id);
  const hotSlots = getProviderHotSlots(provider.id);

  const r = rich().bold(`✨ ${provider.name}`).nl();
  if (provider.location) r.plain(`📍 ${provider.location}`).nl();
  r.nl();
  if (provider.about) r.rich(provider.about, provider.about_entities).nl(2);
  if (provider.contact && !contactUrl(provider.contact)) {
    r.plain(`📞 Связь: ${provider.contact}`).nl(2);
  }

  const kb = new InlineKeyboard();

  if (hotSlots.length > 0) {
    r.bold('🔥 Горящие окна сейчас:').nl();
    for (const s of hotSlots.slice(0, 5)) {
      const when = formatHotSlotWhen(s.slot_at);
      r.plain(`• ${when} — ${s.title}${s.note ? ` (${s.note})` : ''}`).nl();
      kb.text(`🔥 ${when} · ${s.title}`, `srv:hv:${s.id}`).row();
    }
    r.nl();
  }

  if (offers.length > 0) {
    r.bold('📋 Услуги и работы:').nl()
      .italic('Нажмите на услугу, чтобы увидеть фото работ и подробный прайс.');
    for (const o of offers.slice(0, MAX_LIST_BUTTONS)) {
      kb.text(offerButtonLabel(o), `srv:o:${o.id}:0:${back}`).row();
    }
  } else {
    r.italic('Подробный прайс уточняйте у специалиста.');
  }

  addContactButtons(kb, provider, 0);

  const subscribed = isServiceSubscribed(ctx.from.id, provider.id);
  kb.text(
    subscribed ? '🔕 Отписаться от горящих окон' : '🔔 Подписаться на горящие окна',
    `srv:sub:${provider.id}:${back}`
  ).row();
  kb.text('◀️ Назад', backToListTarget(back));

  return show(ctx, r.build(4096), kb);
}

servicesComposer.callbackQuery(/^srv:p:(\d+):([a-z0-9_]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const provider = getProvider(Number(ctx.match[1]));
  if (provider?.status === 'active') track(ctx, provider, SERVICE_EVENT.VIEW_PROVIDER);
  await showProviderCard(ctx, Number(ctx.match[1]), ctx.match[2]);
});

// ── Переходы в ЛС и онлайн-запись с учётом статистики ─────

servicesComposer.callbackQuery(/^srv:w:(\d+):(\d+)$/, async (ctx) => {
  const provider = getProvider(Number(ctx.match[1]));
  const offerId = Number(ctx.match[2]) || null;
  const offer = offerId ? getServiceOffer(offerId) : null;
  const msg = offer
    ? `Здравствуйте! Пишу из бота Зелёной Гавани по поводу услуги «${offer.title}». Подскажите, пожалуйста, ближайшее свободное время.`
    : `Здравствуйте! Пишу из бота Зелёной Гавани. Хочу уточнить по записи.`;
  const url = provider && provider.status === 'active' ? prefilledContactUrl(provider.contact, msg) : null;
  if (!url) {
    await ctx.answerCallbackQuery({ text: 'Контакт специалиста недоступен' });
    return;
  }
  track(ctx, provider, SERVICE_EVENT.CONTACT, offerId);
  await ctx.answerCallbackQuery({ text: '👇 Нажмите «Открыть чат» — откроется личка с готовым текстом' });
  await replaceCallbackWithUrl(ctx, '💬 Открыть чат с мастером', url);
});

servicesComposer.callbackQuery(/^srv:hw:(\d+)$/, async (ctx) => {
  const slot = getHotSlot(Number(ctx.match[1]));
  const provider = slot && getProvider(slot.provider_id);
  const when = slot ? formatHotSlotWhen(slot.slot_at) : '';
  const msg = slot
    ? `Здравствуйте! Хочу забрать горящее окно (${when} — ${slot.title}) из бота Зелёной Гавани. Оно ещё свободно?`
    : '';
  const url = provider && provider.status === 'active' ? prefilledContactUrl(provider.contact, msg) : null;
  if (!url) {
    await ctx.answerCallbackQuery({ text: 'Контакт специалиста недоступен' });
    return;
  }
  track(ctx, provider, SERVICE_EVENT.CONTACT, slot.offer_id || null);
  await ctx.answerCallbackQuery({ text: '👇 Нажмите «Открыть чат» — текст про окно уже подставлен' });
  await replaceCallbackWithUrl(ctx, '💬 Написать в ЛС', url);
});

servicesComposer.callbackQuery(/^srv:bk:(\d+)$/, async (ctx) => {
  const provider = getProvider(Number(ctx.match[1]));
  if (!provider || provider.status !== 'active' || !provider.booking_url) {
    await ctx.answerCallbackQuery({ text: 'Ссылка на онлайн-запись недоступна' });
    return;
  }
  track(ctx, provider, SERVICE_EVENT.BOOKING_LINK);
  await ctx.answerCallbackQuery({ text: '👇 Нажмите «Открыть запись» для перехода к календарю' });
  await replaceCallbackWithUrl(ctx, '🗓 Открыть онлайн-запись', provider.booking_url);
});

// ── Подписки на горящие окна ──────────────────────────────

servicesComposer.callbackQuery(/^srv:sub:(\d+):([a-z0-9_]+)$/, async (ctx) => {
  const providerId = Number(ctx.match[1]);
  const provider = getProvider(providerId);
  if (!provider || provider.status !== 'active') {
    await ctx.answerCallbackQuery({ text: 'Специалист сейчас недоступен' });
    return;
  }
  if (isServiceSubscribed(ctx.from.id, providerId)) {
    unsubscribeService(ctx.from.id, providerId);
    await ctx.answerCallbackQuery({ text: 'Вы отписались от горящих окон' });
  } else {
    subscribeService(ctx.from.id, providerId);
    await ctx.answerCallbackQuery({
      text: `🔔 Вы подписаны на «${provider.name}». Пришлю уведомление, если освободится горящее окно.`,
      show_alert: true,
    });
  }
  await showProviderCard(ctx, providerId, ctx.match[2]);
});

servicesComposer.callbackQuery(/^srv:unsub:(\d+)$/, async (ctx) => {
  unsubscribeService(ctx.from.id, Number(ctx.match[1]));
  await ctx.answerCallbackQuery({ text: 'Вы отписались от горящих окон специалиста' });
  const rows = ctx.callbackQuery.message?.reply_markup?.inline_keyboard;
  if (rows) {
    const filtered = rows
      .map(row => row.filter(b => b.callback_data !== ctx.callbackQuery.data))
      .filter(row => row.length > 0);
    await ctx.editMessageReplyMarkup({
      reply_markup: filtered.length ? { inline_keyboard: filtered } : undefined,
    }).catch(() => {});
  }
});

// ── Карточка услуги со слайдером фото ─────────────────────

export function buildOfferCard(offer, provider, { photoIndex = 0, back = 'h', preview = false } = {}) {
  const photos = offer.photos || [];
  const idx = photos.length ? ((photoIndex % photos.length) + photos.length) % photos.length : 0;

  const r = rich();
  if (offer.body) r.rich(offer.body, offer.body_entities).nl(2);
  else r.bold(offer.title).nl(2);

  if (offer.price_text || offer.duration_text) {
    const meta = [offer.price_text && `💰 ${offer.price_text}`, offer.duration_text && `⏱ ${offer.duration_text}`]
      .filter(Boolean).join(' · ');
    r.plain(meta).nl();
  }
  r.plain(`✨ ${provider.name}`);
  if (provider.location) r.nl().plain(`📍 ${provider.location}`);

  const kb = new InlineKeyboard();
  if (photos.length > 1) {
    const base = preview ? `srvp:pv:${offer.id}` : `srv:o:${offer.id}`;
    const suffix = preview ? '' : `:${back}`;
    kb.text('◀️ фото', `${base}:${idx - 1 < 0 ? photos.length - 1 : idx - 1}${suffix}`)
      .text(`${idx + 1} / ${photos.length}`, 'noop')
      .text('фото ▶️', `${base}:${(idx + 1) % photos.length}${suffix}`)
      .row();
  }

  const photo = photos[idx] || null;
  return {
    built: r.build(photo ? CAPTION_LIMIT : 4096),
    photo,
    keyboard: kb,
  };
}

servicesComposer.callbackQuery(/^srv:o:(\d+):(\d+):([a-z0-9_]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const offer = getServiceOffer(Number(ctx.match[1]));
  const provider = offer && getProvider(offer.provider_id);
  if (!offer || !provider || provider.status !== 'active') {
    return showServicesSection(ctx);
  }
  if (!offer.published) return showProviderCard(ctx, provider.id, ctx.match[3]);
  if (Number(ctx.match[2]) === 0) track(ctx, provider, SERVICE_EVENT.VIEW_OFFER, offer.id);

  const back = ctx.match[3];
  const { built, photo, keyboard } = buildOfferCard(offer, provider, {
    photoIndex: Number(ctx.match[2]),
    back,
  });

  const offers = getPublishedOffers(provider.id);
  const pos = offers.findIndex(o => o.id === offer.id);
  if (pos !== -1 && offers.length > 1) {
    const prev = offers[(pos - 1 + offers.length) % offers.length];
    const next = offers[(pos + 1) % offers.length];
    keyboard
      .text('⬅️ Пред.', `srv:o:${prev.id}:0:${back}`)
      .text(`${pos + 1} из ${offers.length}`, 'noop')
      .text('След. ➡️', `srv:o:${next.id}:0:${back}`)
      .row();
  }

  addContactButtons(keyboard, provider, offer.id);
  keyboard.text('◀️ К специалисту', `srv:p:${provider.id}:${back}`);
  await show(ctx, built, keyboard, photo ? { photo } : {});
});
