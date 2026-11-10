/**
 * Доступность заведения для новых заказов: пауза, часы работы, лимит заказов на слот.
 * Единая точка проверки — используется в каталоге, при выборе времени, при подтверждении и при изменении времени.
 */
import { config } from '../../config.js';
import { countActiveOrdersInRange } from '../db/repositories/orders.js';
import { formatMinskTime, minskDateStr, minskMinutesOfDay, minutesToHHMM, timeKeyForDate } from '../utils/time.js';

const HHMM_RE = /^(\d{1,2})[:.](\d{2})$/;

function toMinutes(hhmm) {
  const m = String(hhmm || '').match(HHMM_RE);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Разбор строки часов работы: «9:00-22:00», «09.00–22.00». Возвращает { open, close } в формате ЧЧ:ММ или null.
 */
export function parseHoursInput(input) {
  const m = String(input || '').trim().match(/^(\d{1,2}[:.]\d{2})\s*[-–—]\s*(\d{1,2}[:.]\d{2})$/);
  if (!m) return null;
  const open = toMinutes(m[1]);
  const close = toMinutes(m[2]);
  if (open === null || close === null || open === close) return null;
  return { open: minutesToHHMM(open), close: minutesToHHMM(close) };
}

export function hasHours(place) {
  return toMinutes(place.open_time) !== null && toMinutes(place.close_time) !== null;
}

export function formatHours(place) {
  return hasHours(place) ? `${place.open_time}–${place.close_time}` : 'круглосуточно';
}

/**
 * Открыто ли заведение в указанный момент (часы работы могут переходить через полночь, например 18:00–02:00)
 */
export function isOpenAt(place, date) {
  if (!hasHours(place)) return true;
  const open = toMinutes(place.open_time);
  const close = toMinutes(place.close_time);
  const m = minskMinutesOfDay(date);
  return open < close ? (m >= open && m < close) : (m >= open || m < close);
}

export function getPausedUntil(place, now = new Date()) {
  if (!place.paused_until) return null;
  const until = new Date(place.paused_until);
  return until > now ? until : null;
}

/**
 * Момент «до конца дня» для паузы: ближайшее закрытие по часам работы, иначе 23:59 по Минску
 */
export function endOfWorkday(place, now = new Date()) {
  const nowMin = minskMinutesOfDay(now);
  let targetMin = 23 * 60 + 59;
  if (hasHours(place) && isOpenAt(place, now)) {
    targetMin = toMinutes(place.close_time);
  }
  let diff = targetMin - nowMin;
  if (diff <= 0) diff += 1440;
  return new Date(now.getTime() + diff * 60000);
}

/**
 * Текущее состояние приёма заказов
 */
export function getAcceptanceState(place, now = new Date()) {
  if (!place || !place.is_active) {
    return { accepting: false, reason: 'inactive', text: 'Заведение временно не принимает заказы.' };
  }

  const pausedUntil = getPausedUntil(place, now);
  if (pausedUntil) {
    return {
      accepting: false,
      reason: 'paused',
      until: pausedUntil,
      text: `⏸ Заведение временно приостановило приём заказов до ${formatMinskTime(pausedUntil)}. Корзина сохранится — попробуйте позже.`,
    };
  }

  if (!isOpenAt(place, now)) {
    return {
      accepting: false,
      reason: 'closed',
      text: `🌙 Сейчас заведение закрыто. Часы работы: ${formatHours(place)}. Откроемся в ${place.open_time}.`,
    };
  }

  return { accepting: true, reason: null, text: null };
}

function slotStartFor(date) {
  const slotMs = config.slotMinutes * 60000;
  return new Date(Math.floor(date.getTime() / slotMs) * slotMs);
}

/**
 * Проверка, можно ли оформить (или перенести) заказ на targetAt.
 * Возвращает { ok: true } или { ok: false, message, suggestion?: { timeKey, label } }.
 */
export function checkOrderAllowed(place, { targetAt, isAsap }, { now = new Date(), excludeOrderId = null } = {}) {
  const state = getAcceptanceState(place, now);
  if (!state.accepting) {
    return { ok: false, message: state.text };
  }

  // Время получения должно попадать в часы работы
  if (!isAsap && !isOpenAt(place, targetAt)) {
    return {
      ok: false,
      message: `🕘 Заведение работает ${formatHours(place)}, к ${formatMinskTime(targetAt)} заказ приготовить не получится. Выберите время в часы работы.`,
    };
  }

  // Лимит заказов на слот
  const capacity = Number(place.slot_capacity) || 0;
  if (capacity > 0) {
    const slotMs = config.slotMinutes * 60000;
    const slotStart = slotStartFor(targetAt);
    const taken = countActiveOrdersInRange(place.id, slotStart, new Date(slotStart.getTime() + slotMs), excludeOrderId);

    if (taken >= capacity) {
      // Ищем ближайший свободный слот в пределах 3 часов и в часы работы
      for (let i = 1; i <= 12; i++) {
        const candidate = new Date(slotStart.getTime() + i * slotMs);
        // Подсказка оформляется как «к ЧЧ:ММ сегодня», поэтому не переходим через полночь
        if (!isOpenAt(place, candidate) || minskDateStr(candidate) !== minskDateStr(now)) break;
        const count = countActiveOrdersInRange(place.id, candidate, new Date(candidate.getTime() + slotMs), excludeOrderId);
        if (count < capacity) {
          return {
            ok: false,
            message: `🔥 На ${formatMinskTime(targetAt)} кухня уже загружена. Ближайшее свободное время — *${formatMinskTime(candidate)}*.`,
            suggestion: { timeKey: timeKeyForDate(candidate), label: formatMinskTime(candidate) },
          };
        }
      }
      return { ok: false, message: '🔥 Кухня сейчас полностью загружена. Попробуйте оформить заказ чуть позже.' };
    }
  }

  return { ok: true };
}
