import fs from 'node:fs';
import path from 'node:path';

const DATA_FILE = path.resolve(process.cwd(), 'data', 'transport_schedule.json');

/**
 * Базовое расписание по умолчанию со всеми остановками из официальной схемы движения
 */
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
      directions: {
        to_minsk: {
          id: 'to_minsk',
          title: '🏙 В Минск (к ст. м. Уручье)',
          fromStation: 'Бульвар Зелёная Гавань',
          toStation: 'ст. м. Уручье / ДС Уручье-2',
          baseStationId: 'zelenaya_gavan',
          weekdays: [
            '06:29', '10:12', '11:40', '14:08', '15:08',
            '16:04', '17:33', '19:15', '20:56', '22:11', '23:26',
          ],
          weekends: [
            '06:29', '07:45', '09:13', '11:01', '12:15',
            '13:30', '14:49', '16:04', '17:34', '19:25',
            '20:44', '21:59', '23:14',
          ],
          stops: [
            { id: 'zelenaya_gavan', name: 'Бульвар «Зелёная Гавань»', offsetMinutes: 0, isDefault: true },
            { id: 'azs', name: 'АЗС', offsetMinutes: 14 },
            { id: 'poligon', name: 'Полигон', offsetMinutes: 16 },
            { id: 'kech', name: 'Героев 120-й дивизии', offsetMinutes: 20 },
            { id: 'sirenevaya', name: 'Сиреневая', offsetMinutes: 21 },
            { id: 'rinok_uruchie', name: 'Рынок «Уручье-3»', offsetMinutes: 25 },
            { id: 'ostroshitskaya', name: 'Острошицкая', offsetMinutes: 27 },
            { id: 'metro_uruchie', name: 'ст. м. «Уручье»', offsetMinutes: 28 },
            { id: 'russiyanova', name: 'Руссиянова', offsetMinutes: 30 },
            { id: 'pervomaiskii', name: 'Универсам «Первомайский»', offsetMinutes: 32 },
            { id: 'tc_uruchie', name: 'ТЦ «Уручье»', offsetMinutes: 33 },
            { id: 'ds_uruchie_2', name: 'ДС «Уручье-2»', offsetMinutes: 35 },
          ],
        },
        to_gavan: {
          id: 'to_gavan',
          title: '🏡 В Зелёную Гавань (из Минска)',
          fromStation: 'ДС Уручье-2 / ст. м. Уручье',
          toStation: 'Бульвар Зелёная Гавань',
          baseStationId: 'ds_uruchie_2',
          baseWeekdays: [
            '05:54', '07:18', '09:38', '11:06', '12:33',
            '17:00', '20:22', '21:37', '22:52',
          ],
          baseWeekends: [
            '05:54', '07:09', '08:39', '10:27', '11:41',
            '12:56', '14:16', '15:30', '17:00', '18:50',
            '20:10', '21:25', '22:40',
          ],
          weekdays: [
            '06:01', '07:25', '09:45', '11:13', '12:40',
            '17:07', '20:29', '21:44', '22:59',
          ],
          weekends: [
            '06:01', '07:16', '08:46', '10:34', '11:48',
            '13:03', '14:23', '15:37', '17:07', '18:57',
            '20:17', '21:32', '22:47',
          ],
          stops: [
            { id: 'ds_uruchie_2', name: 'ДС «Уручье-2»', offsetMinutes: 0 },
            { id: 'tc_uruchie', name: 'ТЦ «Уручье»', offsetMinutes: 3 },
            { id: 'pervomaiskii', name: 'Универсам «Первомайский»', offsetMinutes: 4 },
            { id: 'russiyanova', name: 'Руссиянова', offsetMinutes: 5 },
            { id: 'metro_uruchie', name: 'ст. м. «Уручье»', offsetMinutes: 7, isDefault: true },
            { id: 'ostroshitskaya', name: 'Острошицкая', offsetMinutes: 8 },
            { id: 'rinok_uruchie', name: 'Рынок «Уручье-3»', offsetMinutes: 10 },
            { id: 'sirenevaya', name: 'Сиреневая', offsetMinutes: 14 },
            { id: 'kech', name: 'Героев 120-й дивизии', offsetMinutes: 15 },
            { id: 'poligon', name: 'Полигон', offsetMinutes: 20 },
            { id: 'azs', name: 'АЗС', offsetMinutes: 21 },
            { id: 'zelenaya_gavan', name: 'Бульвар «Зелёная Гавань»', offsetMinutes: 31 },
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
      directions: {
        to_minsk: {
          id: 'to_minsk',
          title: '🏙 В Минск (к ст. м. Уручье)',
          fromStation: 'Бульвар Зелёная Гавань',
          toStation: 'ст. м. Уручье / ДС Уручье-2',
          baseStationId: 'zelenaya_gavan',
          weekdays: ['07:54', '13:09'],
          weekends: [],
          stops: [
            { id: 'zelenaya_gavan', name: 'Бульвар «Зелёная Гавань»', offsetMinutes: 0, isDefault: true },
            { id: 'kolodischi_2', name: 'Колодищи-2 (Ягодная)', offsetMinutes: 6 },
            { id: 'azs', name: 'АЗС', offsetMinutes: 12 },
            { id: 'poligon', name: 'Полигон', offsetMinutes: 14 },
            { id: 'kech', name: 'Героев 120-й дивизии', offsetMinutes: 18 },
            { id: 'metro_uruchie', name: 'ст. м. «Уручье»', offsetMinutes: 26 },
            { id: 'ds_uruchie_2', name: 'ДС «Уручье-2»', offsetMinutes: 34 },
          ],
        },
        to_gavan: {
          id: 'to_gavan',
          title: '🏡 В Зелёную Гавань (из Минска)',
          fromStation: 'ст. м. Уручье',
          toStation: 'Бульвар Зелёная Гавань',
          baseStationId: 'ds_uruchie_2',
          baseWeekdays: ['13:05', '14:05', '15:05', '18:14'],
          baseWeekends: [],
          weekdays: ['13:12', '14:12', '15:12', '18:21'],
          weekends: [],
          stops: [
            { id: 'ds_uruchie_2', name: 'ДС «Уручье-2»', offsetMinutes: 0 },
            { id: 'metro_uruchie', name: 'ст. м. «Уручье»', offsetMinutes: 7, isDefault: true },
            { id: 'kech', name: 'Героев 120-й дивизии', offsetMinutes: 15 },
            { id: 'poligon', name: 'Полигон', offsetMinutes: 20 },
            { id: 'azs', name: 'АЗС', offsetMinutes: 21 },
            { id: 'kolodischi_2', name: 'Колодищи-2 (Ягодная)', offsetMinutes: 27 },
            { id: 'zelenaya_gavan', name: 'Бульвар «Зелёная Гавань»', offsetMinutes: 33 },
          ],
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
      directions: {
        to_minsk: {
          id: 'to_minsk',
          title: '🏙 В Минск (к ст. м. Могилёвская / Восток)',
          fromStation: 'Бульвар Зелёная Гавань',
          toStation: 'ст. м. Могилёвская / ст. м. Восток (Dana Mall)',
          baseStationId: 'zelenaya_gavan',
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
          stops: [
            { id: 'zelenaya_gavan', name: 'Бульвар «Зелёная Гавань»', offsetMinutes: 0, isDefault: true },
            { id: 'baykalskaya', name: 'Байкальская / МКАД', offsetMinutes: 12 },
            { id: 'mogilevskaya', name: 'ст. м. «Могилёвская»', offsetMinutes: 16 },
            { id: 'borisovskiy', name: 'ст. м. «Борисовский тракт»', offsetMinutes: 26 },
            { id: 'vostok', name: 'ст. м. «Восток» (Dana Mall)', offsetMinutes: 30 },
          ],
        },
        to_gavan: {
          id: 'to_gavan',
          title: '🏡 В Зелёную Гавань (от ст. м. Восток / Могилёвская)',
          fromStation: 'ст. м. Восток (Dana Mall) / ст. м. Могилёвская',
          toStation: 'Бульвар Зелёная Гавань',
          baseStationId: 'vostok',
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
          stops: [
            { id: 'vostok', name: 'ст. м. «Восток» (Dana Mall)', offsetMinutes: 0, isDefault: true },
            { id: 'borisovskiy', name: 'ст. м. «Борисовский тракт»', offsetMinutes: 4 },
            { id: 'mogilevskaya', name: 'ст. м. «Могилёвская» (съезд МКАД)', offsetMinutes: 15 },
            { id: 'baykalskaya', name: 'Байкальская / МКАД', offsetMinutes: 18 },
            { id: 'zelenaya_gavan', name: 'Бульвар «Зелёная Гавань»', offsetMinutes: 30 },
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

      // Проверяем наличие секции остановок stops (миграция со старого формата)
      if (cachedSchedule?.routes?.['200c']?.directions?.to_minsk?.stops) {
        return cachedSchedule;
      }
    }
  } catch (err) {
    console.error('[Transport Service] Ошибка чтения transport_schedule.json:', err.message);
  }

  // Если файла нет или старая структура — обновляем до DEFAULT_SCHEDULE
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
 * Прибавление минут к строке 'HH:MM'
 */
export function addMinutesToTime(timeStr, offsetMinutes) {
  if (!offsetMinutes) return timeStr;
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + offsetMinutes;
  const newH = Math.floor(total / 60) % 24;
  const newM = total % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
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
 * Получение списка всех остановок для маршрута и направления
 */
export function getRouteStops(routeId, directionId) {
  const schedule = getTransportSchedule();
  const dir = schedule.routes[routeId]?.directions?.[directionId];
  return dir?.stops || [];
}

/**
 * Получение остановки по умолчанию (или первой)
 */
export function getDefaultStop(routeId, directionId) {
  const stops = getRouteStops(routeId, directionId);
  return stops.find((s) => s.isDefault) || stops[0] || null;
}

/**
 * Расчет поминутного расписания для конкретной остановки посадки
 */
export function getStopSchedule(routeId, directionId, stopId, dayType) {
  const schedule = getTransportSchedule();
  const dir = schedule.routes[routeId]?.directions?.[directionId];
  if (!dir) return { stop: null, times: [] };

  const stops = dir.stops || [];
  const stop = stops.find((s) => s.id === stopId) || getDefaultStop(routeId, directionId);
  if (!stop) return { stop: null, times: [] };

  // 1. Если для конкретной остановки сохранен точный массив времен — используем его напрямую
  if (dayType === 'weekends' && Array.isArray(stop.weekends) && stop.weekends.length > 0) {
    return { stop, times: stop.weekends };
  }
  if (dayType === 'weekdays' && Array.isArray(stop.weekdays) && stop.weekdays.length > 0) {
    return { stop, times: stop.weekdays };
  }

  // 2. Резервный расчет по смещению от базовой станции
  let baseTimes = [];
  if (dir.baseStationId === 'ds_uruchie_2' && dir.baseWeekdays) {
    baseTimes = dayType === 'weekends' ? (dir.baseWeekends || []) : (dir.baseWeekdays || []);
  } else {
    baseTimes = dayType === 'weekends' ? (dir.weekends || []) : (dir.weekdays || []);
  }

  const times = baseTimes.map((t) => addMinutesToTime(t, stop.offsetMinutes || 0));

  return {
    stop,
    times,
  };
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

      const defaultStop = getDefaultStop(routeId, dirId);
      const { times } = getStopSchedule(routeId, dirId, defaultStop?.id, dayKey);
      const next = findNextDepartures(times, now.totalMinutes, 2);

      result[dirId].push({
        routeId: route.id,
        routeNumber: route.number,
        routeBadge: route.badge,
        fromStation: defaultStop?.name || dir.fromStation,
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
