'use strict';

const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = process.env.DB_PATH || path.join(__dirname, 'ecoride.sqlite');
const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('scooter', 'bike')),
      tariff REAL NOT NULL CHECK(tariff > 0),
      charge INTEGER NOT NULL CHECK(charge BETWEEN 0 AND 100),
      distance_m INTEGER NOT NULL DEFAULT 120,
      range_km INTEGER NOT NULL DEFAULT 20,
      zone TEXT NOT NULL DEFAULT 'парк Шевченка',
      status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'booked', 'riding'))
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'cancelled', 'completed', 'expired')),
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
      vehicle_name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('scooter', 'bike')),
      route TEXT NOT NULL,
      date_label TEXT NOT NULL,
      days_ago INTEGER NOT NULL DEFAULT 0,
      duration_sec INTEGER NOT NULL DEFAULT 60,
      duration_label TEXT NOT NULL,
      distance_km REAL NOT NULL DEFAULT 0,
      distance_label TEXT NOT NULL,
      tariff_label TEXT NOT NULL,
      cost REAL NOT NULL DEFAULT 0,
      sum_label TEXT NOT NULL,
      payment_label TEXT NOT NULL DEFAULT 'Гаманець EcoRide',
      rating INTEGER CHECK(rating IS NULL OR (rating BETWEEN 1 AND 5)),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS wallet_profile (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 184.20,
      active_plan_id TEXT,
      active_plan_label TEXT NOT NULL DEFAULT 'Оплата за хвилину · 1,20 ₴',
      notifications INTEGER NOT NULL DEFAULT 1
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      topic TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const profile = await get('SELECT id FROM wallet_profile WHERE id = 1');
  if (!profile) {
    await run(
      `INSERT INTO wallet_profile (id, full_name, phone, balance, active_plan_label, notifications)
       VALUES (1, 'Данило Шапоренко', '+380 67 204 48 19', 184.20, 'Оплата за хвилину · 1,20 ₴', 1)`
    );
  }

  const vehiclesCount = await get('SELECT COUNT(*) AS cnt FROM vehicles');
  if (!vehiclesCount || vehiclesCount.cnt === 0) {
    await run(
      `INSERT INTO vehicles (id, name, kind, tariff, charge, distance_m, range_km, zone, status) VALUES
        ('2048', 'Самокат №2048', 'scooter', 1.2, 82, 120, 22, 'парк Шевченка', 'available'),
        ('6769', 'Самокат №6769', 'scooter', 1.2, 69, 120, 18, 'парк Шевченка', 'available'),
        ('1912', 'Електробайк №1912', 'bike', 1.5, 67, 260, 22, 'парк Шевченка', 'available')`
    );
  }

  const tripsCount = await get('SELECT COUNT(*) AS cnt FROM trips');
  if (!tripsCount || tripsCount.cnt === 0) {
    await run(
      `INSERT INTO trips (
        vehicle_id, vehicle_name, kind, route, date_label, days_ago,
        duration_sec, duration_label, distance_km, distance_label,
        tariff_label, cost, sum_label, payment_label, rating
      ) VALUES
        ('2048', 'Самокат №2048', 'scooter', 'Золоті ворота → Арсенальна', 'Сьогодні, 09:53', 0, 496, '8 хв 16 с', 2.4, '2,4 км', '1,20 ₴/хв', 48.20, '48,20 ₴', 'Visa •••• 4242', NULL),
        ('1912', 'Електробайк №1912', 'bike', 'Поділ → Контрактова площа', '18 вересня, 08:14', 12, 1140, '19 хв', 5.8, '5,8 км', '1,50 ₴/хв', 129.00, '129,00 ₴', 'Visa •••• 4242', NULL),
        ('2371', 'Самокат №2371', 'scooter', 'Олімпійська → Палац спорту', '14 вересня, 19:05', 16, 660, '11 хв', 3.1, '3,1 км', '1,20 ₴/хв', 61.50, '61,50 ₴', 'Visa •••• 4242', NULL),
        ('3305', 'Самокат №3305', 'scooter', 'Лук’янівська → Центральний залізничний вокзал', '3 липня, 18:40', 95, 840, '14 хв', 3.9, '3,9 км', '1,20 ₴/хв', 76.80, '76,80 ₴', 'Visa •••• 4242', NULL)`
    );
  }
}

module.exports = { db, run, get, all, initDb };

