import process from 'node:process';
import { Bot, InputFile } from 'grammy';
import Database from 'better-sqlite3';

try {
  process.loadEnvFile?.();
} catch (_) {}

const DEV_TOKEN = process.argv[2] || '8822540853:AAE_wl38IzP77FjcD2qbp9flbMd5u6l9ToI';
const PROD_TOKEN = process.argv[3] || process.env.BOT_TOKEN || '9104942759:AAHa1Qz4mdNRqIteQItrAavRj50-H-DTPxc';
const DB_PATH = process.env.DATABASE_PATH || './data/bot.db';
const ADMIN_ID = (process.env.ADMIN_IDS || '528985165').split(',')[0].trim();

async function migrate() {
  console.log('🔄 Запуск переноса фото через скачивание и прямую загрузку...');
  console.log(`📡 Dev Bot Token: ${DEV_TOKEN.slice(0, 10)}...`);
  console.log(`📡 Prod Bot Token: ${PROD_TOKEN.slice(0, 10)}...`);
  console.log(`💾 База: ${DB_PATH}`);
  console.log(`👤 Чат для перепривязки (ID админа): ${ADMIN_ID}\n`);

  const devBot = new Bot(DEV_TOKEN);
  const prodBot = new Bot(PROD_TOKEN);
  const db = new Database(DB_PATH);

  const items = db.prepare("SELECT id, title, photos FROM maker_items WHERE photos != '[]' AND photos IS NOT NULL").all();
  console.log(`📦 Найдено позиций с фото: ${items.length}\n`);

  for (const item of items) {
    let photos = [];
    try {
      photos = JSON.parse(item.photos);
    } catch {
      continue;
    }
    if (!photos.length) continue;

    const newPhotos = [];
    for (const oldFileId of photos) {
      try {
        // 1. Получаем путь к оригинальному файлу через дев-бота
        const file = await devBot.api.getFile(oldFileId);
        const fileUrl = `https://api.telegram.org/file/bot${DEV_TOKEN}/${file.file_path}`;

        // 2. Скачиваем байты фото напрямую на сервер
        const res = await fetch(fileUrl);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} при скачивании файла: ${res.statusText}`);
        }
        const arrayBuf = await res.arrayBuffer();
        const buf = Buffer.from(arrayBuf);

        // 3. Отправляем прод-боту как бинарный файл (InputFile)
        const inputFile = new InputFile(buf, 'dish.jpg');
        const msg = await prodBot.api.sendPhoto(ADMIN_ID, inputFile);
        const newFileId = msg.photo[msg.photo.length - 1].file_id;
        newPhotos.push(newFileId);

        // 4. Сразу удаляем сервисное сообщение из чата админа
        await prodBot.api.deleteMessage(ADMIN_ID, msg.message_id).catch(() => {});
        console.log(`  📸 Фото для «${item.title}» скачано и загружено в прод-бота!`);
      } catch (err) {
        console.error(`⚠️ Ошибка для позиции "${item.title}":`, err.message);
        newPhotos.push(oldFileId);
      }
    }

    db.prepare('UPDATE maker_items SET photos = ? WHERE id = ?').run(JSON.stringify(newPhotos), item.id);
    console.log(`✅ [ID ${item.id}] «${item.title}»: готово!\n`);
  }

  console.log('🎉 Все фотографии успешно перепривязаны к боевому боту!');
}

migrate().catch(console.error);
