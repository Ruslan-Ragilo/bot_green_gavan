 /**
 * Утилиты для работы со временем в часовом поясе Минска (Europe/Minsk, UTC+3)
 */

export const MINSK_TIMEZONE = 'Europe/Minsk';

/**
 * Получить текущие компоненты времени в Минске
 */
export function getMinskNowParts() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MINSK_TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});

  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    hour: parseInt(parts.hour, 10),
    minute: parseInt(parts.minute, 10),
    second: parseInt(parts.second, 10),
  };
}

/**
 * Форматирование даты в строку времени ЧЧ:ММ (Минск)
 */
export function formatMinskTime(date = new Date()) {
  return date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: MINSK_TIMEZONE,
  });
}

/**
 * Валидация и парсинг точного времени самовывоза, введенного пользователем
 */
export function parseCustomTimeInput(inputStr) {
  if (!inputStr || typeof inputStr !== 'string') {
    return { ok: false, error: 'empty' };
  }

  const trimmed = inputStr.trim().replace(/^к\s*/i, '');
  const match = trimmed.match(/^(\d{1,2})[:.\-\s](\d{2})$/);
  if (!match) {
    return { ok: false, error: 'invalid_format' };
  }

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return { ok: false, error: 'invalid_range' };
  }

  const { hour: curHour, minute: curMinute } = getMinskNowParts();
  const nowTotalMinutes = curHour * 60 + curMinute;
  const targetTotalMinutes = hours * 60 + minutes;
  const diffMinutes = targetTotalMinutes - nowTotalMinutes;

  const currentStr = `${String(curHour).padStart(2, '0')}:${String(curMinute).padStart(2, '0')}`;
  const minAllowedMinutes = nowTotalMinutes + 15;
  const minAllowedHour = Math.floor(minAllowedMinutes / 60) % 24;
  const minAllowedMin = minAllowedMinutes % 60;
  const minAllowedStr = `${String(minAllowedHour).padStart(2, '0')}:${String(minAllowedMin).padStart(2, '0')}`;

  if (diffMinutes < 15) {
    return {
      ok: false,
      error: 'too_soon_or_past',
      currentStr,
      minAllowedStr,
      diffMinutes,
    };
  }

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const timeStr = `${hh}:${mm}`;
  const timeKey = `custom_${hh}_${mm}`;
  const label = `К ${timeStr}`;

  return {
    ok: true,
    hours,
    minutes,
    diffMinutes,
    timeStr,
    timeKey,
    label,
  };
}

/**
 * SQLite datetime('now') хранит UTC в виде «YYYY-MM-DD HH:MM:SS» без зоны.
 * new Date() читает такую строку как локальное время сервера — явно помечаем её как UTC.
 */
export function parseDbUtc(value) {
  if (value instanceof Date) return value;
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(str)) {
    return new Date(`${str.replace(' ', 'T')}Z`);
  }
  return new Date(str);
}

/**
 * Преобразование timeKey в человекопонятный лейбл
 */
export function getDesiredTimeLabel(timeKey) {
  const PRESET_LABELS = {
    asap: 'Как можно скорее (~15–20 мин)',
    '30m': 'Через 30 минут',
    '45m': 'Через 45 минут',
    '60m': 'Через 1 час',
  };

  // Для относительных слотов сразу фиксируем точное время (от момента выбора),
  // чтобы кухня и жилец видели одно и то же время и при редактировании отсчёт шёл от «сейчас»
  const RELATIVE_MINUTES = { '30m': 30, '45m': 45, '60m': 60 };
  if (RELATIVE_MINUTES[timeKey]) {
    const target = formatMinskTime(new Date(Date.now() + RELATIVE_MINUTES[timeKey] * 60 * 1000));
    return `${PRESET_LABELS[timeKey]} (к ${target})`;
  }

  if (PRESET_LABELS[timeKey]) {
    return PRESET_LABELS[timeKey];
  }

  const customMatch = timeKey.match(/^custom_(\d{2})_(\d{2})$/);
  if (customMatch) {
    return `К ${customMatch[1]}:${customMatch[2]}`;
  }

  return timeKey;
}

/**
 * Парсинг желаемого времени заказа для сотрудников кухни
 */
export function parseDesiredTime(desiredTime, orderCreatedAt = null) {
  if (!desiredTime) {
    return { isAsap: true, targetTimeStr: null, minutes: 20 };
  }

  if (desiredTime.includes('скорее') || desiredTime.toLowerCase().includes('asap')) {
    return { isAsap: true, targetTimeStr: null, minutes: 20 };
  }

  // Точное время жильца вида «К 18:30»
  const customMatch = desiredTime.match(/К\s*(\d{1,2}):(\d{2})/i);
  if (customMatch) {
    const hh = customMatch[1].padStart(2, '0');
    const mm = customMatch[2];
    return { isAsap: false, targetTimeStr: `${hh}:${mm}`, isExact: true };
  }

  // Относительные интервалы: «Через 30 минут», «Через 45 минут», «Через 1 час»
  let minutes = 30;
  if (desiredTime.includes('30')) minutes = 30;
  else if (desiredTime.includes('45')) minutes = 45;
  else if (desiredTime.includes('1 час') || desiredTime.includes('60')) minutes = 60;

  // Старые заказы без точного времени в подписи: считаем от момента создания
  const base = orderCreatedAt ? parseDbUtc(orderCreatedAt) : new Date();
  const targetDate = new Date(base.getTime() + minutes * 60 * 1000);
  const targetTimeStr = formatMinskTime(targetDate);

  return { isAsap: false, targetTimeStr, minutes, isExact: false };
}
