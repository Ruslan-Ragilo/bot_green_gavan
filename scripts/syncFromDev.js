import process from 'node:process';
import fs from 'node:fs';
import { Bot, InputFile } from 'grammy';
import Database from 'better-sqlite3';

try {
  process.loadEnvFile?.();
} catch (_) {}

const DEV_TOKEN = process.env.DEV_BOT_TOKEN || '8822540853:AAE_wl38IzP77FjcD2qbp9flbMd5u6l9ToI';
const PROD_TOKEN = process.env.BOT_TOKEN || '9104942759:AAHa1Qz4mdNRqIteQItrAavRj50-H-DTPxc';

const DEV_DB_PATH = process.env.DEV_DATABASE_PATH ||
  (fs.existsSync('/root/bot_green_gavan_dev/data/dev_bot.db')
    ? '/root/bot_green_gavan_dev/data/dev_bot.db'
    : './data/dev_bot.db');

const PROD_DB_PATH = process.env.DATABASE_PATH ||
  (fs.existsSync('/root/bot_green_gavan/data/bot.db')
    ? '/root/bot_green_gavan/data/bot.db'
    : './data/bot.db');

const ADMIN_ID = (process.env.ADMIN_IDS || '528985165').split(',')[0].trim();

function parseJson(str, fallback) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

async function sync() {
  console.log('🔄 Запуск полной синхронизации мастера Надежды из DEV в PROD...');
  console.log(`📂 DEV база:  ${DEV_DB_PATH}`);
  console.log(`📂 PROD база: ${PROD_DB_PATH}`);
  console.log(`👤 ID чата для генерации file_id (админ): ${ADMIN_ID}\n`);

  if (!fs.existsSync(DEV_DB_PATH)) {
    throw new Error(`Файл dev базы не найден: ${DEV_DB_PATH}`);
  }
  if (!fs.existsSync(PROD_DB_PATH)) {
    throw new Error(`Файл prod базы не найден: ${PROD_DB_PATH}`);
  }

  const devDb = new Database(DEV_DB_PATH, { readonly: true });
  const prodDb = new Database(PROD_DB_PATH);

  const devBot = new Bot(DEV_TOKEN);
  const prodBot = new Bot(PROD_TOKEN);

  // 1. Ищем Надежду в DEV
  const maker = devDb.prepare("SELECT * FROM makers WHERE name LIKE '%Надежда%' OR id = 3").get();
  if (!maker) {
    throw new Error('Мастер «Надежда» не найден в dev базе!');
  }
  console.log(`👩‍🍳 Найден мастер: ID ${maker.id} — «${maker.name}» (user_id: ${maker.user_id})`);

  // 2. Синхронизируем пользователя (users)
  const user = devDb.prepare('SELECT * FROM users WHERE telegram_id = ?').get(maker.user_id);
  if (user) {
    prodDb.prepare(`
      INSERT INTO users (telegram_id, first_name, last_name, username, phone, consent_given_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        username = excluded.username,
        phone = excluded.phone
    `).run(
      user.telegram_id,
      user.first_name,
      user.last_name,
      user.username,
      user.phone,
      user.consent_given_at,
      user.created_at
    );
    console.log(`👤 Пользователь @${user.username || user.telegram_id} синхронизирован.`);
  }

  // 3. Синхронизируем карточку мастера (makers)
  prodDb.prepare(`
    INSERT INTO makers (
      id, user_id, name, about, about_entities, contact, status, cover_photo, stock_updated_at, last_notified_at, notified_stock, created_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      name = excluded.name,
      about = excluded.about,
      about_entities = excluded.about_entities,
      contact = excluded.contact,
      status = excluded.status,
      cover_photo = excluded.cover_photo,
      stock_updated_at = datetime('now'),
      last_notified_at = excluded.last_notified_at,
      notified_stock = excluded.notified_stock
  `).run(
    maker.id,
    maker.user_id,
    maker.name,
    maker.about,
    maker.about_entities,
    maker.contact,
    maker.status,
    maker.cover_photo,
    maker.last_notified_at,
    maker.notified_stock,
    maker.created_at
  );
  console.log(`👩‍🍳 Карточка мастера «${maker.name}» синхронизирована (наличие обновлено на текущее время).`);

  // 4. Синхронизируем позиции и их фотографии
  const devItems = devDb.prepare('SELECT * FROM maker_items WHERE maker_id = ? ORDER BY id ASC').all(maker.id);
  console.log(`\n📦 Всего позиций в DEV: ${devItems.length}\n`);

  const devItemIds = new Set(devItems.map(i => i.id));
  let uploadedPhotosCount = 0;

  for (const item of devItems) {
    const rawPhotos = parseJson(item.photos, []);
    const prodPhotos = [];

    for (const fileId of rawPhotos) {
      // Проверяем: может это фото уже привязано к прод-боту?
      let alreadyValidInProd = false;
      try {
        await prodBot.api.getFile(fileId);
        alreadyValidInProd = true;
      } catch (_) {
        alreadyValidInProd = false;
      }

      if (alreadyValidInProd) {
        prodPhotos.push(fileId);
        continue;
      }

      // Фото из дев-бота: скачиваем бинарный файл и заливаем в прод-бот
      try {
        const file = await devBot.api.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${DEV_TOKEN}/${file.file_path}`;

        const res = await fetch(fileUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const buf = Buffer.from(await res.arrayBuffer());

        const inputFile = new InputFile(buf, 'dish.jpg');
        const msg = await prodBot.api.sendPhoto(ADMIN_ID, inputFile);
        const newFileId = msg.photo[msg.photo.length - 1].file_id;
        prodPhotos.push(newFileId);

        await prodBot.api.deleteMessage(ADMIN_ID, msg.message_id).catch(() => {});
        uploadedPhotosCount++;
        console.log(`  📸 [${item.title}] Фото успешно скачано из DEV и загружено в PROD!`);
      } catch (err) {
        console.error(`  ⚠️ [${item.title}] Не удалось перенести фото:`, err.message);
        prodPhotos.push(fileId);
      }
    }

    prodDb.prepare(`
      INSERT INTO maker_items (
        id, maker_id, title, price_text, category, body, body_entities, photos, variants, in_stock, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        price_text = excluded.price_text,
        category = excluded.category,
        body = excluded.body,
        body_entities = excluded.body_entities,
        photos = excluded.photos,
        variants = excluded.variants,
        in_stock = excluded.in_stock,
        updated_at = excluded.updated_at
    `).run(
      item.id,
      item.maker_id,
      item.title,
      item.price_text,
      item.category,
      item.body,
      item.body_entities,
      JSON.stringify(prodPhotos),
      item.variants,
      item.in_stock,
      item.created_at,
      item.updated_at
    );

    console.log(`✅ [ID ${item.id}] «${item.title}» сохранено в прод.`);
  }

  // 5. Удаляем в проде позиции, которые Надежда удалила в деве
  const prodItems = prodDb.prepare('SELECT id, title FROM maker_items WHERE maker_id = ?').all(maker.id);
  for (const pi of prodItems) {
    if (!devItemIds.has(pi.id)) {
      prodDb.prepare('DELETE FROM maker_items WHERE id = ?').run(pi.id);
      console.log(`🗑 Удалена снятая с продажи позиция: ID ${pi.id} «${pi.title}»`);
    }
  }

  console.log(`\n🎉 Синхронизация завершена успешно!`);
  console.log(`📊 Всего актуальных позиций в прод-боте: ${devItems.length}`);
  console.log(`🖼 Перенесено новых фото: ${uploadedPhotosCount}`);
}

sync().catch((err) => {
  console.error('\n❌ Ошибка при синхронизации:', err);
  process.exit(1);
});
