'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');
const { run, get, all, initDb } = require('./db');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

const ROUTES_LIST = [
  'Золоті ворота → Арсенальна',
  'Хрещатик → Поділ',
  'Либідська → Печерська',
  'Контрактова площа → Оболонь',
  'Палац спорту → Лук’янівська',
];

const PLANS = {
  'plan-day': { id: 'plan-day', name: 'Еко День', price: 149 },
  'plan-30': { id: 'plan-30', name: '30 хвилин', price: 89 },
  'plan-month': { id: 'plan-month', name: 'Еко Місяць', price: 349 },
};

const pad = (n) => String(n).padStart(2, '0');
const formatMoney = (n) =>
  Number(n).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₴';
const formatKm = (n) => Number(n).toFixed(1).replace('.', ',') + ' км';
const formatDuration = (sec) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m > 0 && s === 0 ? `${m} хв` : `${m} хв ${s} с`;
};

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/vehicles', async (req, res, next) => {
  try {
    const vehicles = await all('SELECT * FROM vehicles ORDER BY id ASC');
    res.json({ vehicles });
  } catch (err) {
    next(err);
  }
});

app.post('/api/bookings', async (req, res, next) => {
  try {
    const vehicleId = String(req.body.vehicleId || '').trim();
    const vehicle = await get('SELECT * FROM vehicles WHERE id = ?', [vehicleId]);
    if (!vehicle) {
      return res.status(404).json({ error: 'Транспорт не знайдено.' });
    }
    if (vehicle.status !== 'available') {
      return res.status(409).json({ error: 'Транспорт уже зайнятий або заброньований.' });
    }
    const expiresAt = Date.now() + 10 * 60 * 1000;
    await run("UPDATE bookings SET status = 'cancelled' WHERE vehicle_id = ? AND status = 'active'", [vehicleId]);
    await run("UPDATE vehicles SET status = 'booked' WHERE id = ?", [vehicleId]);
    const created = await run(
      "INSERT INTO bookings (vehicle_id, status, expires_at) VALUES (?, 'active', ?)",
      [vehicleId, expiresAt]
    );
    res.status(201).json({
      booking: { id: created.lastID, vehicleId, status: 'active', expiresAt },
    });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/bookings/:id/unlock', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Некоректний ID бронювання.' });
    }
    const booking = await get('SELECT * FROM bookings WHERE id = ?', [id]);
    if (!booking) {
      return res.status(404).json({ error: 'Бронювання не знайдено.' });
    }
    await run("UPDATE bookings SET status = 'completed' WHERE id = ?", [id]);
    await run("UPDATE vehicles SET status = 'riding' WHERE id = ?", [booking.vehicle_id]);
    res.json({ bookingId: id, status: 'riding' });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/bookings/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Некоректний ID бронювання.' });
    }
    const booking = await get('SELECT * FROM bookings WHERE id = ?', [id]);
    if (!booking) {
      return res.status(404).json({ error: 'Бронювання не знайдено.' });
    }
    await run("UPDATE bookings SET status = 'cancelled' WHERE id = ?", [id]);
    await run("UPDATE vehicles SET status = 'available' WHERE id = ?", [booking.vehicle_id]);
    res.json({ deletedId: id, status: 'cancelled' });
  } catch (err) {
    next(err);
  }
});

app.get('/api/trips', async (req, res, next) => {
  try {
    const kind = req.query.kind || 'all';
    const period = req.query.period || '30';
    const clauses = [];
    const params = [];

    if (kind === 'scooter' || kind === 'bike') {
      clauses.push('kind = ?');
      params.push(kind);
    }
    if (period !== 'all') {
      const days = Number(period);
      if (!Number.isFinite(days) || days < 0) {
        return res.status(400).json({ error: 'Некоректний параметр period.' });
      }
      clauses.push('days_ago <= ?');
      params.push(days);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const trips = await all(`SELECT * FROM trips ${where} ORDER BY id DESC`, params);
    res.json({ trips });
  } catch (err) {
    next(err);
  }
});

app.post('/api/trips', async (req, res, next) => {
  try {
    const vehicleId = String(req.body.vehicleId || '').trim();
    const durationSec = Number(req.body.durationSec);
    const distanceKm = Number(req.body.distanceKm);
    const charge = Number(req.body.charge);

    if (!vehicleId || !Number.isFinite(durationSec) || durationSec < 0 || !Number.isFinite(distanceKm) || distanceKm < 0) {
      return res.status(400).json({ error: 'Некоректні параметри завершення поїздки.' });
    }

    const v = (await get('SELECT * FROM vehicles WHERE id = ?', [vehicleId])) || {
      id: vehicleId,
      name: `Транспорт №${vehicleId}`,
      kind: 'scooter',
      tariff: 1.2,
      charge: 80,
    };

    const rawCost = Math.round(v.tariff * (durationSec / 60) * 100) / 100;
    const cost = Math.max(0, rawCost);
    const profile = await get('SELECT * FROM wallet_profile WHERE id = 1');
    const currentBalance = Number(profile.balance);
    const fromWallet = Math.min(currentBalance, cost);
    const fromCard = Math.round((cost - fromWallet) * 100) / 100;
    const nextBalance = Math.round((currentBalance - fromWallet) * 100) / 100;

    const now = new Date();
    const dateLabel = `Сьогодні, ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const routeName = ROUTES_LIST[Math.floor(Math.random() * ROUTES_LIST.length)];
    const durationLabel = formatDuration(durationSec);
    const distanceLabel = formatKm(distanceKm);
    const tariffLabel = `${Number(v.tariff).toFixed(2).replace('.', ',')} ₴/хв`;
    const sumLabel = formatMoney(cost);
    const paymentLabel = fromCard > 0 ? 'Гаманець + Visa •••• 4242' : 'Гаманець EcoRide';

    const inserted = await run(
      `INSERT INTO trips (
        vehicle_id, vehicle_name, kind, route, date_label, days_ago,
        duration_sec, duration_label, distance_km, distance_label,
        tariff_label, cost, sum_label, payment_label, rating
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        v.id,
        v.name,
        v.kind,
        routeName,
        dateLabel,
        Math.floor(durationSec),
        durationLabel,
        Number(distanceKm.toFixed(2)),
        distanceLabel,
        tariffLabel,
        cost,
        sumLabel,
        paymentLabel,
      ]
    );

    const nextCharge = Number.isFinite(charge)
      ? Math.max(0, Math.min(100, Math.round(charge)))
      : v.charge;
    await run("UPDATE vehicles SET status = 'available', charge = ? WHERE id = ?", [nextCharge, v.id]);
    await run('UPDATE wallet_profile SET balance = ? WHERE id = 1', [nextBalance]);

    const trip = await get('SELECT * FROM trips WHERE id = ?', [inserted.lastID]);
    res.status(201).json({
      trip,
      balance: nextBalance,
      fromCard,
    });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/trips/:id/rating', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const rating = Number(req.body.rating);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Некоректний ID поїздки або оцінка (1..5).' });
    }
    const existing = await get('SELECT id FROM trips WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Поїздку не знайдено.' });
    }
    await run('UPDATE trips SET rating = ? WHERE id = ?', [rating, id]);
    const trip = await get('SELECT * FROM trips WHERE id = ?', [id]);
    res.json({ trip });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/trips/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Некоректний ID поїздки.' });
    }
    const result = await run('DELETE FROM trips WHERE id = ?', [id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Поїздку не знайдено.' });
    }
    res.json({ deletedId: id });
  } catch (err) {
    next(err);
  }
});

app.get('/api/profile', async (req, res, next) => {
  try {
    const profile = await get('SELECT * FROM wallet_profile WHERE id = 1');
    res.json({ profile });
  } catch (err) {
    next(err);
  }
});

app.post('/api/wallet/topup', async (req, res, next) => {
  try {
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount < 20 || amount > 5000) {
      return res.status(400).json({ error: 'Сума поповнення має бути від 20 до 5000 ₴.' });
    }
    const profile = await get('SELECT * FROM wallet_profile WHERE id = 1');
    const nextBalance = Math.round((Number(profile.balance) + amount) * 100) / 100;
    await run('UPDATE wallet_profile SET balance = ? WHERE id = 1', [nextBalance]);
    res.json({ balance: nextBalance, added: amount });
  } catch (err) {
    next(err);
  }
});

app.post('/api/plans/activate', async (req, res, next) => {
  try {
    const planId = String(req.body.planId || '').trim();
    const plan = PLANS[planId];
    if (!plan) {
      return res.status(400).json({ error: 'Невідомий абонемент.' });
    }
    const profile = await get('SELECT * FROM wallet_profile WHERE id = 1');
    if (profile.active_plan_id === plan.id) {
      return res.status(409).json({ error: `Абонемент «${plan.name}» уже підключено.` });
    }
    if (Number(profile.balance) < plan.price) {
      return res.status(400).json({ error: 'Недостатньо коштів на гаманці.' });
    }
    const nextBalance = Math.round((Number(profile.balance) - plan.price) * 100) / 100;
    const planLabel = `${plan.name} · ${formatMoney(plan.price)}`;
    await run(
      'UPDATE wallet_profile SET balance = ?, active_plan_id = ?, active_plan_label = ? WHERE id = 1',
      [nextBalance, plan.id, planLabel]
    );
    res.json({ balance: nextBalance, activePlanId: plan.id, activePlanLabel: planLabel });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/settings/notifications', async (req, res, next) => {
  try {
    const enabled = Boolean(req.body.enabled);
    await run('UPDATE wallet_profile SET notifications = ? WHERE id = 1', [enabled ? 1 : 0]);
    res.json({ notifications: enabled });
  } catch (err) {
    next(err);
  }
});

app.post('/api/support', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim();
    const topic = String(req.body.topic || '').trim();
    const message = String(req.body.message || '').trim();

    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || !topic || message.length < 10) {
      return res.status(400).json({ error: 'Перевірте коректність заповнення полів звернення.' });
    }

    const ticketCode = `ER-${Date.now().toString().slice(-6)}`;
    await run(
      'INSERT INTO support_tickets (ticket_code, name, email, topic, message) VALUES (?, ?, ?, ?, ?)',
      [ticketCode, name, email, topic, message.slice(0, 500)]
    );
    res.status(201).json({ ticketCode });
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Внутрішня помилка сервера.' });
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`EcoRide server listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Database initialization error:', err);
process.exit(1);
  });