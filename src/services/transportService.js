import fs from 'node:fs';
import path from 'node:path';

const DATA_FILE = path.resolve(process.cwd(), 'data', 'transport_schedule.json');

// Базовое расписание по умолчанию (проверено и актуально)
export const DEFAULT_SCHEDULE = {
  routes: {
    '200c': {
      id: '200c',
      number: '200С',
      title: 'Автобус № 200С',
      type: 'bus',
      badge: '🚌',
      routeDescription: 'Бульвар Зелёная Гавань ↔ ДС Уручье-2 (через ст. м. «Уручье»)',
      operator: 'ГП «Минсктранс» (городской скоростной)',
      fare: 'Обычный городской тариф (талон / проездной / «Оплати»)',
      yandexMapsUrl: 'https://yandex.by/maps/157/minsk/?mode=routes&rtext=53.945353%2C27.687823~53.868778%2C27.756285&rtt=mt',
      directions: {
        to_minsk: {
          id: 'to_minsk',
          title: '🏙 В Минск (к ст. м. Уручье)',
          fromStation: 'Бульвар Зелёная Гавань',
          toStation: 'ст. м. Уручье / ДС Уручье-2',
          weekdays: [
            '06:33', '10:16', '11:44', '14:12', '15:12',
            '16:08', '17:37', '19:19', '21:00', '22:15', '23:30',
          ],
          weekends: [
            '06:33', '07:49', '09:17', '11:05', '12:19',
            '13:34', '14:53', '16:08', '17:38', '19:29',
            '20:48', '22:03', '23:18',
          ],
        },
        to_gavan: {
          id: 'to_gavan',
          title: '🏡 В Зелёную Гавань (из Минска)',
          fromStation: 'ст. м. Уручье',
          toStation: 'Бульвар Зелёная Гавань',
          note: 'Отправление от ДС Уручье-2 на ~7 мин раньше времени у метро',
          weekdays: [
            '06:01', '07:25', '09:45', '11:13', '12:40',
            '17:07', '20:29', '21:44', '22:59',
          ],
          weekends: [
            '06:01', '07:16', '08:46', '10:34', '11:48',
            '13:03', '14:23', '15:37', '17:07', '18:57',
            '20:17', '21:32', '22:47',
          ],
        },
      },
    },
    '200dc': {
      id: '200dc',
      number: '200дС',
      title: 'Автобус № 200дС (через Колодищи-2)',
      type: 'bus',
      badge: '🚌',
      routeDescription: 'Бульвар Зелёная Гавань ↔ Колодищи-2 ↔ ст. м. «Уручье»',
      operator: 'ГП «Минсктранс» (с заездом в Колодищи-2, только будни)',
      fare: 'Обычный городской тариф (талон / проездной / «Оплати»)',
      yandexMapsUrl: 'https://yandex.by/maps/157/minsk/?mode=routes&rtext=53.945353%2C27.687823~53.868778%2C27.756285&rtt=mt',
      directions: {
        to_minsk: {
          id: 'to_minsk',
          title: '🏙 В Минск (к ст. м. Уручье)',
          fromStation: 'Бульвар Зелёная Гавань',
          toStation: 'ст. м. Уручье / ДС Уручье-2',
          note: 'Маршрут следует с заездом в Колодищи-2',
          weekdays: ['07:58', '13:13'],
          weekends: [],
        },
        to_gavan: {
          id: 'to_gavan',
          title: '🏡 В Зелёную Гавань (из Минска)',
          fromStation: 'ст. м. Уручье',
          toStation: 'Бульвар Зелёная Гавань',
          note: 'Отправление от ДС Уручье-2 на ~7 мин раньше времени у метро',
          weekdays: ['13:12', '14:12', '15:12', '18:21'],
          weekends: [],
        },
      },
    },
    '1222tk': {
      id: '1222tk',
      number: '1222-ТК',
      title: 'Маршрутка № 1222-ТК',
      type: 'minibus',
      badge: '🚐',
      routeDescription: 'ст. м. Восток ↔ ст. м. Могилёвская ↔ Бульвар Зелёная Гавань',
      operator: 'ООО «Удобный транспорт» (коммерческая маршрутка)',
      fare: '3,00 BYN (оплата водителю наличными)',
      yandexMapsUrl: 'https://yandex.by/maps/157/minsk/?mode=routes&rtext=53.934484%2C27.651347~53.868778%2C27.756285&rtt=mt',
      directions: {
        to_minsk: {
          id: 'to_minsk',
          title: '🏙 В Минск (к ст. м. Могилёвская / Восток)',
          fromStation: 'Бульвар Зелёная Гавань',
          toStation: 'ст. м. Могилёвская / ст. м. Восток (Dana Mall)',
          note: 'Остановки по требованию: Б. Стиклево, Байкальская, Борисовский тракт',
          intervalInfoWeekday: 'С 06:40 до 19:30 (каждые 20–30 мин в пик, до 40 мин днем)',
          intervalInfoWeekend: 'С 08:30 до 18:30 (примерно каждый час)',
          weekdays: [
            '06:40', '07:10', '07:40', '08:10', '08:40',
            '09:15', '09:50', '10:30', '11:15', '12:00',
            '12:45', '13:30', '14:15', '15:00', '15:40',
            '16:15', '16:50', '17:25', '18:00', '18:40', '19:30',
          ],
          weekends: [
            '08:30', '09:30', '10:30', '11:30', '13:30',
            '14:30', '16:30', '17:30', '18:30',
          ],
        },
        to_gavan: {
          id: 'to_gavan',
          title: '🏡 В Зелёную Гавань (от ст. м. Восток / Могилёвская)',
          fromStation: 'ст. м. Восток (Dana Mall) / ст. м. Могилёвская',
          toStation: 'Бульвар Зелёная Гавань',
          note: 'Посадка: у ст. м. Восток (около ТРЦ Dana Mall) и ст. м. Могилёвская (съезд МКАД/Ангарская)',
          intervalInfoWeekday: 'С 07:15 до 19:00 (каждые 20–30 мин в пик, до 40 мин днем)',
          intervalInfoWeekend: 'С 09:00 до 19:00 (примерно раз в час)',
          weekdays: [
            '07:15', '07:45', '08:15', '08:45', '09:20',
            '10:00', '10:45', '11:30', '12:15', '13:00',
            '13:45', '14:30', '15:15', '15:55', '16:30',
            '17:05', '17:40', '18:15', '18:50', '19:30',
          ],
          weekends: [
            '09:00', '10:00', '11:00', '12:00', '14:00',
            '15:00', '17:00', '18:00', '19:00',
          ],
        },
      },
    },
  },
  lastUpdated: new Date().toISOString(),
};

let cachedSchedule = null;

/**
 * Инициализация и получение актуального расписания из файла или дефолта
 */
export function getTransportSchedule() {
  if (cachedSchedule) return cachedSchedule;

  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      cachedSchedule = JSON.parse(raw);
      return cachedSchedule;
    }
  } catch (err) {
    console.error('[Transport Service] Ошибка чтения transport_schedule.json:', err.message);
  }

  // Если файла нет или ошибка чтения — сохраняем базовый
  cachedSchedule = structuredClone(DEFAULT_SCHEDULE);
  saveTransportSchedule(cachedSchedule);
  return cachedSchedule;
}

/**
 * Сохранение расписания на диск
 */
export function saveTransportSchedule(schedule) {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    schedule.lastUpdated = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(schedule, null, 2), 'utf-8');
    cachedSchedule = schedule;
    return true;
  } catch (err) {
    console.error('[Transport Service] Ошибка записи transport_schedule.json:', err.message);
    return false;
  }
}

/**
 * Получение текущего минского времени (Europe/Minsk, UTC+3)
 */
export function getMinskTime() {
  const now = new Date();
  const minskString = now.toLocaleString('en-US', { timeZone: 'Europe/Minsk' });
  const minskDate = new Date(minskString);

  const hours = minskDate.getHours();
  const minutes = minskDate.getMinutes();
  const dayOfWeek = minskDate.getDay(); // 0 = Sunday, 6 = Saturday
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const pad = (n) => String(n).padStart(2, '0');
  const timeString = `${pad(hours)}:${pad(minutes)}`;

  return {
    date: minskDate,
    hours,
    minutes,
    totalMinutes: hours * 60 + minutes,
    dayOfWeek,
    isWeekend,
    timeString,
    dayName: ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'][dayOfWeek],
  };
}

/**
 * Парсинг строки "HH:MM" в минуты от начала суток
 */
function parseTimeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Поиск ближайших рейсов для заданного списка времен
 */
export function findNextDepartures(timesList, currentTotalMinutes, limit = 3) {
  if (!timesList || timesList.length === 0) return [];

  const parsed = timesList.map((t) => ({
    time: t,
    minutes: parseTimeToMinutes(t),
  })).sort((a, b) => a.minutes - b.minutes);

  // Ищем рейсы, которые будут позже текущего времени
  const upcoming = parsed.filter((item) => item.minutes >= currentTotalMinutes);

  return upcoming.slice(0, limit).map((item) => {
    const diff = item.minutes - currentTotalMinutes;
    let label = '';
    if (diff === 0) {
      label = 'сейчас отправляется';
    } else if (diff < 60) {
      label = `через ${diff} мин`;
    } else {
      const h = Math.floor(diff / 60);
      const m = diff % 60;
      label = m > 0 ? `через ${h} ч ${m} мин` : `через ${h} ч`;
    }

    return {
      time: item.time,
      diffMinutes: diff,
      label,
    };
  });
}

/**
 * Получение сводки ближайших рейсов по всем маршрутам в обе стороны
 */
export function getAllNextDepartures() {
  const schedule = getTransportSchedule();
  const now = getMinskTime();
  const dayKey = now.isWeekend ? 'weekends' : 'weekdays';

  const result = {
    now,
    to_minsk: [],
    to_gavan: [],
  };

  for (const routeId of ['200c', '200dc', '1222tk']) {
    const route = schedule.routes[routeId];
    if (!route) continue;

    for (const dirId of ['to_minsk', 'to_gavan']) {
      const dir = route.directions[dirId];
      if (!dir) continue;

      const times = dir[dayKey] || [];
      const next = findNextDepartures(times, now.totalMinutes, 2);

      result[dirId].push({
        routeId: route.id,
        routeNumber: route.number,
        routeBadge: route.badge,
        fromStation: dir.fromStation,
        toStation: dir.toStation,
        nextDepartures: next,
        hasMoreToday: next.length > 0,
        intervalInfo: now.isWeekend ? dir.intervalInfoWeekend : dir.intervalInfoWeekday,
        allTimesCount: times.length,
      });
    }
  }

  return result;
}
