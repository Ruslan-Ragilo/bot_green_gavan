import { Composer } from 'grammy';
import { getActivePlaces, getPlaceById, getPlaceItems, getItemById } from '../db/repositories/places.js';
import { addToCart, getCart } from '../db/repositories/cart.js';
import { placesKeyboard, placeMenuKeyboard, itemDetailKeyboard } from '../keyboards/client.js';

export const catalogComposer = new Composer();

// Просмотр списка заведений ЖК
catalogComposer.callbackQuery('catalog:places', async (ctx) => {
  await ctx.answerCallbackQuery();
  const places = getActivePlaces();

  if (places.length === 0) {
    return ctx.editMessageText('К сожалению, сейчас нет доступных заведений для заказа.', {
      parse_mode: 'Markdown',
    });
  }

  const text = (
    `🍽 *Заведения ЖК «Зелёная Гавань»*\n\n` +
    `Выберите заведение, чтобы посмотреть меню и оформить предзаказ на самовывоз:`
  );

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: placesKeyboard(places),
  });
});

// Просмотр меню выбранного заведения
catalogComposer.callbackQuery(/^place:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const placeId = Number(ctx.match[1]);
  const place = getPlaceById(placeId);

  if (!place || !place.is_active) {
    return ctx.editMessageText('Заведение временно недоступно.', {
      reply_markup: placesKeyboard(getActivePlaces()),
    });
  }

  const items = getPlaceItems(placeId, { onlyAvailable: true });
  const cart = getCart(ctx.from.id);
  const cartTotalQty = (cart.place && cart.place.id === placeId) ? cart.totalQuantity : 0;

  const text = (
    `🏪 *${place.name}*\n` +
    (place.description ? `_${place.description}_\n\n` : '\n') +
    `📍 *Точка самовывоза:* ${place.pickup_point}\n\n` +
    `Выберите блюдо из меню:`
  );

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: placeMenuKeyboard(placeId, items, cartTotalQty),
  });
});

// Просмотр карточки конкретного блюда
catalogComposer.callbackQuery(/^item:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const itemId = Number(ctx.match[1]);
  const item = getItemById(itemId);

  if (!item) {
    return ctx.answerCallbackQuery({ text: 'Позиция не найдена', show_alert: true });
  }

  const cart = getCart(ctx.from.id);
  const cartItem = cart.items.find(i => i.item_id === itemId);
  const currentQuantityInCart = cartItem ? cartItem.quantity : 0;

  const text = (
    `🍴 *${item.name}*\n\n` +
    (item.description ? `${item.description}\n\n` : '') +
    `💰 *Цена:* ${item.price} ₽\n` +
    `🏪 *Заведение:* ${item.place_name}\n` +
    `📍 *Точка выдачи:* ${item.pickup_point}`
  );

  await ctx.editMessageText(text, {
    parse_mode: 'Markdown',
    reply_markup: itemDetailKeyboard(item, currentQuantityInCart),
  });
});

// Добавление позиции в корзину
catalogComposer.callbackQuery(/^cart:add:(\d+):(\d+)$/, async (ctx) => {
  const itemId = Number(ctx.match[1]);
  const delta = Number(ctx.match[2]) || 1;
  const item = getItemById(itemId);

  if (!item || !item.is_available) {
    return ctx.answerCallbackQuery({ text: 'К сожалению, эта позиция сейчас недоступна', show_alert: true });
  }

  const cart = addToCart(ctx.from.id, item.place_id, itemId, delta);
  const cartItem = cart.items.find(i => i.item_id === itemId);
  const currentQuantityInCart = cartItem ? cartItem.quantity : 0;

  await ctx.answerCallbackQuery({ text: `Добавлено: ${item.name} (+${delta})` });

  // Обновляем клавиатуру у карточки товара
  try {
    await ctx.editMessageReplyMarkup({
      reply_markup: itemDetailKeyboard(item, currentQuantityInCart),
    });
  } catch {
    // Игнорируем ошибку Telegram если разметка не изменилась
  }
});
