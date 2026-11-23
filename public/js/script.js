/* =========================================================
   EcoRide — js/script.js (Лабораторна робота № 4)
   Інтерактивність поверх HTML + CSS із ЛР № 1–3.

   Зміст:
   1. Конфігурація та дані (об’єкти)
   2. Стан застосунку
   3. Допоміжні функції (DOM, форматування)
   4. Сповіщення (toast)
   5. Валідація форм (універсальний рушій)
   6. Маршрутизація екранів і «охоронці» переходів
   7. Сценарій поїздки: бронювання → розблокування → поїздка → підсумок
   8. Компонент: історія поїздок (фільтри, чек)
   9. Компонент: гаманець (форма поповнення)
  10. Компонент: абонементи, налаштування, FAQ
  11. Форма звернення в підтримку
  12. Делегування подій та ініціалізація
   ========================================================= */
(() => {
  'use strict';

  /* ---------- 1. КОНФІГУРАЦІЯ ТА ДАНІ ---------- */
  const CONFIG = {
    bookingSeconds: 10 * 60, // бронювання діє 10 хвилин
    unlockMs: 3000,          // має збігатися з тривалістю CSS-анімації розблокування
    rideSpeedup: 10,         // демо: 1 реальна секунда = 10 секунд поїздки
    speedKmH: 15,            // середня швидкість
    drainPerMin: 0.4,        // розряд, % за хвилину
    topup: { min: 20, max: 5000 },
    toastMs: 3200,
  };

  const VEHICLES = {
    2048: { name: 'Самокат №2048', kind: 'scooter', tariff: 1.2, charge: 82 },
    6769: { name: 'Самокат №6769', kind: 'scooter', tariff: 1.2, charge: 69 },
    1912: { name: 'Електробайк №1912', kind: 'bike', tariff: 1.5, charge: 67 },
  };

  const ROUTES = [
    'Золоті ворота → Арсенальна',
    'Хрещатик → Поділ',
    'Либідська → Печерська',
    'Контрактова площа → Оболонь',
    'Палац спорту → Лук’янівська',
  ];

  // Екрани, що належать до сценарію поїздки (на них банер не показуємо)
  const FLOW_SCREENS = ['booking', 'unlock', 'ride', 'summary'];

  /* ---------- 2. СТАН ---------- */
  const state = {
    vehicleId: '2048',
    stage: 'idle',        // idle | booked | unlocking | riding
    bookingEnds: 0,
    unlockAt: 0,
    rideStart: 0,
    lastTrip: null,       // останній завершений запис {…}
    balance: 184.2,
    activePlan: null,     // id обраного абонемента або null
    notifications: true,
    selectedTrip: null,   // <li>, для якого відкривається чек
    currentId: null,      // поточний екран
  };

  /* ---------- 3. ДОПОМІЖНІ ФУНКЦІЇ ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const pad = (n) => String(n).padStart(2, '0');

  const money = (n) =>
    n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₴';
  const km = (n) => n.toFixed(1).replace('.', ',') + ' км';
  const clock = (totalSec) => `${pad(Math.floor(totalSec / 60))}:${pad(totalSec % 60)}`;
  const duration = (sec) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m > 0 && s === 0 ? `${m} хв` : `${m} хв ${s} с`;
  };
  const todayLabel = (d = new Date()) => `Сьогодні, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const vehicle = () => VEHICLES[state.vehicleId];

  const els = {
    app: $('.app'),
    banner: $('#session-banner'),
    toast: $('#toast'),
    bookingTimer: $('#booking-timer'),
    rideTimer: $('#ride-timer'),
    rideDistance: $('#ride-distance'),
    rideCost: $('#ride-cost'),
    rideCharge: $('#ride-charge'),
    balance: $('#wallet-balance'),
    currentPlan: $('#current-plan'),
    trips: $('#trips'),
    tripsEmpty: $('#trips-empty'),
    tripsCount: $('#trips-count'),
    tripTemplate: $('#trip-template'),
    filters: $('#filters'),
    topupDialog: $('#topup-dialog'),
  };
  const vehicleRadios = $$('input[name="vehicle"]');

  /* ---------- 4. СПОВІЩЕННЯ ---------- */
  let toastTimer = 0;
  function showToast(message, type = 'info') {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.dataset.type = type;
    els.toast.hidden = false;
    // перезапуск CSS-анімації появи
    els.toast.classList.remove('toast--show');
    void els.toast.offsetWidth;
    els.toast.classList.add('toast--show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
      els.toast.classList.remove('toast--show');
    }, CONFIG.toastMs);
  }

  /* ---------- 5. ВАЛІДАЦІЯ ФОРМ ---------- */
  /*
    Універсальний рушій. Для кожної форми задається схема:
      { імʼяПоля: (значення, елемент, форма) => 'Текст помилки' | '' }
    Рушій показує помилку під полем, ставить aria-invalid,
    при submit перевіряє все й ставить фокус на перше хибне поле.
  */
  function setFieldError(input, message) {
    const wrap = input.closest('.form__field');
    const box = wrap && $('.form__error', wrap);
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (wrap) wrap.classList.toggle('is-invalid', Boolean(message));
    if (box) box.textContent = message;
  }

  function createValidator(form, schema, onValid) {
    const summary = $('.form__summary', form);
    const fieldOf = (name) => form.elements[name];
    const valueOf = (el) => (el.type === 'checkbox' ? el.checked : el.value.trim());

    function validateField(name) {
      const el = fieldOf(name);
      const message = schema[name](valueOf(el), el, form);
      setFieldError(el, message);
      return message;
    }

    function validateAll() {
      const invalid = Object.keys(schema).filter((name) => validateField(name));
      if (summary) {
        summary.hidden = invalid.length === 0;
        if (invalid.length) {
          summary.textContent =
            invalid.length === 1
              ? 'Виправте помилку у формі, щоб продовжити.'
              : `Виправте помилки у формі (${invalid.length}), щоб продовжити.`;
        }
      }
      if (invalid.length) fieldOf(invalid[0]).focus();
      return invalid.length === 0;
    }

    // Поле перевіряємо після втрати фокусу, а далі — на кожен ввід (миттєвий зворотний звʼязок)
    form.addEventListener('focusout', (e) => {
      if (e.target.name in schema) {
        e.target.dataset.touched = '1';
        validateField(e.target.name);
      }
    });
    const live = (e) => {
      if (e.target.name in schema && e.target.dataset.touched) validateField(e.target.name);
    };
    form.addEventListener('input', live);
    form.addEventListener('change', live);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (validateAll()) onValid(form);
    });

    return {
      reset() {
        form.reset();
        Object.keys(schema).forEach((name) => {
          const el = fieldOf(name);
          delete el.dataset.touched;
          setFieldError(el, '');
        });
        if (summary) summary.hidden = true;
      },
    };
  }

  // Алгоритм Луна для перевірки номера картки
  function luhn(digits) {
    let sum = 0;
    for (let i = 0; i < digits.length; i += 1) {
      let d = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 1) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
    }
    return sum % 10 === 0;
  }

  /* ---------- 6. МАРШРУТИЗАЦІЯ ЕКРАНІВ ---------- */
  /*
    Перемикання екранів виконує CSS (:target) — воно працює і без JS.
    JavaScript додає поверх: перевірку допустимості переходу («охоронці»),
    заголовок вкладки, фокус для скрінрідерів, логіку екрана (enter/leave).
  */
  const known = new Set($$('.screen').map((s) => s.id));

  function routeFromHash() {
    const id = location.hash.slice(1);
    return known.has(id) ? id : 'map';
  }

  // Повертає { to, msg }, якщо перехід заборонений, або null
  const GUARDS = {
    booking() {
      if (state.stage === 'riding') return { to: 'ride', msg: 'Поїздка вже триває.' };
      return null;
    },
    unlock() {
      if (state.stage === 'riding') return { to: 'ride', msg: 'Поїздка вже триває.' };
      if (state.stage === 'idle') return { to: 'map', msg: 'Спершу забронюйте транспорт.' };
      return null;
    },
    ride() {
      if (state.stage === 'riding') return null;
      if (state.stage === 'unlocking') {
        if (Date.now() - state.unlockAt < CONFIG.unlockMs) {
          return { to: 'unlock', msg: 'Зачекайте, транспорт ще розблоковується.' };
        }
        return null;
      }
      return { to: 'map', msg: 'Активної поїздки немає. Оберіть транспорт.' };
    },
    summary() {
      if (state.stage === 'riding' || state.lastTrip) return null;
      return { to: 'map', msg: 'Немає завершеної поїздки.' };
    },
  };

  const SCREEN_HOOKS = {
    booking: {
      enter() {
        if (state.stage === 'idle') {
          state.stage = 'booked';
          state.bookingEnds = Date.now() + CONFIG.bookingSeconds * 1000;
          lockVehicles(true);
          showToast(`${vehicle().name} заброньовано на 10 хвилин.`, 'success');
        } else if (state.stage === 'unlocking') {
          state.stage = 'booked'; // повернулися назад з розблокування
        }
        tick();
      },
    },
    unlock: {
      enter() {
        state.stage = 'unlocking';
        state.unlockAt = Date.now(); // CSS-анімація смужки стартує разом із показом екрана
      },
    },
    ride: {
      enter() {
        if (state.stage === 'unlocking') {
          state.stage = 'riding';
          state.rideStart = Date.now();
          state.lastTrip = null;
          showToast('Поїздка почалася. Гарної дороги!', 'success');
        }
        tick();
      },
    },
    summary: {
      enter() {
        if (state.stage === 'riding') finishRide();
        renderSummary();
      },
    },
    history: { enter: applyFilters },
    receipt: { enter: renderReceipt },
  };

  let routeBusy = false;
  let firstRoute = true;
  function route() {
    const id = routeFromHash();
    const guard = GUARDS[id] && GUARDS[id]();
    if (guard) {
      showToast(guard.msg, 'warn');
      location.replace(`#${guard.to}`); // замінюємо запис в історії, hashchange викличе route() знову
      return;
    }
    if (routeBusy) return;
    routeBusy = true;
    try {
      state.currentId = id;
      const hooks = SCREEN_HOOKS[id];
      if (hooks && hooks.enter) hooks.enter();

      const heading = $(`#${id} .appbar__title`);
      if (heading) {
        document.title = `${heading.textContent} — EcoRide`;
        heading.setAttribute('tabindex', '-1');
        if (!firstRoute) heading.focus({ preventScroll: true }); // фокус для скрінрідерів після переходу
        firstRoute = false;
      }
      const screen = $(`#${id}`);
      if (screen) screen.scrollTop = 0;
      updateTabs(id);
      renderBanner();
    } finally {
      routeBusy = false;
    }
  }

  function updateTabs(id) {
    const tabFor = { receipt: 'history' };
    const active = tabFor[id] || id;
    $$('.tab').forEach((tab) => {
      const on = tab.getAttribute('href') === `#${active}`;
      if (on) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });
  }

  /* ---------- 7. СЦЕНАРІЙ ПОЇЗДКИ ---------- */
  function lockVehicles(locked) {
    vehicleRadios.forEach((r) => { r.disabled = locked; });
  }

  function resetSession() {
    state.stage = 'idle';
    lockVehicles(false);
    renderBanner();
  }

  function rideMetrics() {
    const v = vehicle();
    const simSec = ((Date.now() - state.rideStart) / 1000) * CONFIG.rideSpeedup;
    return {
      sec: Math.floor(simSec),
      cost: Math.round(v.tariff * (simSec / 60) * 100) / 100,
      km: (CONFIG.speedKmH * simSec) / 3600,
      charge: Math.max(0, Math.round(v.charge - CONFIG.drainPerMin * (simSec / 60))),
    };
  }

  function bookingSecondsLeft() {
    return Math.max(0, Math.ceil((state.bookingEnds - Date.now()) / 1000));
  }

  // Викликається двічі на секунду: оновлює таймери та перевіряє завершення бронювання
  function tick() {
    if (state.stage === 'booked') {
      const left = bookingSecondsLeft();
      if (els.bookingTimer) {
        els.bookingTimer.textContent = clock(left);
        els.bookingTimer.classList.toggle('timer--warn', left <= 60);
      }
      if (left <= 0) {
        resetSession();
        showToast('Час бронювання минув. Транспорт знову доступний іншим.', 'warn');
        if (FLOW_SCREENS.includes(state.currentId)) location.replace('#map');
        return;
      }
    }
    if (state.stage === 'riding') {
      const m = rideMetrics();
      els.rideTimer.textContent = clock(m.sec);
      els.rideDistance.textContent = km(m.km);
      els.rideCost.textContent = money(m.cost);
      els.rideCharge.textContent = `${m.charge}%`;
    }
    renderBanner();
  }

  function renderBanner() {
    const b = els.banner;
    const inFlow = FLOW_SCREENS.includes(state.currentId);
    if (state.stage === 'idle' || inFlow) {
      b.hidden = true;
      return;
    }
    const text = {
      booked: [`Бронювання ${vehicle().name} · ${clock(bookingSecondsLeft())}`, '#booking'],
      unlocking: [`Розблокування ${vehicle().name}`, '#unlock'],
      riding: [`Поїздка триває · ${clock(rideMetrics().sec)}`, '#ride'],
    }[state.stage];
    b.textContent = `${text[0]} — відкрити`;
    b.setAttribute('href', text[1]);
    b.hidden = false;
  }

  function finishRide() {
    const v = vehicle();
    const m = rideMetrics();
    const now = new Date();
    const fromWallet = Math.min(state.balance, m.cost);
    const fromCard = Math.round((m.cost - fromWallet) * 100) / 100;
    state.balance = Math.round((state.balance - fromWallet) * 100) / 100;
    renderBalance();

    state.lastTrip = {
      kind: v.kind,
      vehicle: v.name,
      route: ROUTES[Math.floor(Math.random() * ROUTES.length)],
      date: todayLabel(now),
      duration: duration(m.sec),
      distance: km(m.km),
      tariff: `${money(v.tariff).replace(' ₴', '')} ₴/хв`,
      sum: money(m.cost),
      payment: fromCard > 0 ? 'Гаманець + Visa •••• 4242' : 'Гаманець EcoRide',
      rating: 0,
    };
    addTrip(state.lastTrip);
    resetSession();
    if (fromCard > 0) showToast(`Коштів на гаманці не вистачило, ${money(fromCard)} списано з картки.`, 'warn');
  }

  function renderSummary() {
    const t = state.lastTrip;
    if (!t) return;
    $('#sum-vehicle').textContent = t.vehicle;
    $('#sum-when').textContent = t.date.toLowerCase();
    $('#sum-time').textContent = t.duration;
    $('#sum-distance').textContent = t.distance;
    $('#sum-total').textContent = t.sum;
  }

  function saveRating() {
    const t = state.lastTrip;
    const checked = $('input[name="rate"]:checked');
    if (!t || !checked) return;
    t.rating = Number(checked.id.replace('star-', ''));
    const li = els.trips.querySelector(`[data-id="${t.id}"] .trip__meta`);
    if (li && !li.textContent.includes('★')) li.textContent += ` · ★ ${t.rating}`;
    showToast('Дякуємо за оцінку!', 'success');
  }

  /* ---------- 8. ІСТОРІЯ ПОЇЗДОК ---------- */
  let tripSeq = 0;
  function addTrip(t) {
    t.id = `new-${(tripSeq += 1)}`;
    const li = els.tripTemplate.content.firstElementChild.cloneNode(true);
    li.dataset.id = t.id;
    li.dataset.kind = t.kind;
    li.dataset.days = '0';
    ['route', 'date', 'duration', 'distance', 'vehicle', 'tariff', 'sum', 'payment'].forEach((k) => {
      li.dataset[k] = t[k];
    });
    // textContent (а не innerHTML) — дані не інтерпретуються як розмітка
    $('.trip__date', li).textContent = t.date;
    $('.trip__route', li).textContent = t.route;
    $('.trip__meta', li).textContent = `${t.duration} · ${t.distance} · ${t.vehicle}`;
    $('.trip__sum', li).textContent = t.sum;
    li.classList.add('trip--new');
    els.trips.prepend(li);
    applyFilters();
  }

  function applyFilters() {
    const type = els.filters.elements.type.value;
    const period = els.filters.elements.period.value;
    const all = $$('.trip', els.trips);
    let shown = 0;
    all.forEach((li) => {
      const okType = type === 'all' || li.dataset.kind === type;
      const okPeriod = period === 'all' || Number(li.dataset.days) <= Number(period);
      li.hidden = !(okType && okPeriod);
      if (!li.hidden) shown += 1;
    });
    els.tripsEmpty.hidden = shown > 0;
    els.tripsCount.textContent = `Показано ${shown} з ${all.length}`;
  }

  function renderReceipt() {
    const li =
      (state.selectedTrip && state.selectedTrip.isConnected && state.selectedTrip) ||
      $('.trip:not([hidden])', els.trips) ||
      $('.trip', els.trips);
    if (!li) return;
    $('#receipt-route').textContent = li.dataset.route;
    $$('[data-r]', $('#receipt')).forEach((dd) => {
      dd.textContent = li.dataset[dd.dataset.r] || '—';
    });
  }

  /* ---------- 9. ГАМАНЕЦЬ: ФОРМА ПОПОВНЕННЯ ---------- */
  function renderBalance() {
    els.balance.textContent = money(state.balance);
  }

  const topupForm = $('#topup-form');
  const topupValidator = createValidator(
    topupForm,
    {
      amount(v) {
        if (!v) return 'Введіть суму поповнення.';
        if (!/^\d+([.,]\d{1,2})?$/.test(v)) return 'Сума має бути числом, наприклад 100 або 99,50.';
        const n = Number(v.replace(',', '.'));
        if (n < CONFIG.topup.min) return `Мінімальна сума поповнення — ${CONFIG.topup.min} ₴.`;
        if (n > CONFIG.topup.max) return `Максимальна сума одного поповнення — ${CONFIG.topup.max} ₴.`;
        return '';
      },
      card(v) {
        const digits = v.replace(/\s/g, '');
        if (!digits) return 'Введіть номер картки.';
        if (!/^\d+$/.test(digits)) return 'Номер картки може містити лише цифри.';
        if (digits.length !== 16) return `Номер картки має містити 16 цифр (зараз ${digits.length}).`;
        if (!luhn(digits)) return 'Номер картки введено з помилкою. Перевірте цифри.';
        return '';
      },
      exp(v) {
        if (!v) return 'Вкажіть термін дії картки.';
        const m = /^(\d{2})\/(\d{2})$/.exec(v);
        if (!m) return 'Формат терміну дії — ММ/РР, наприклад 08/28.';
        const month = Number(m[1]);
        const year = 2000 + Number(m[2]);
        if (month < 1 || month > 12) return 'Місяць має бути від 01 до 12.';
        const now = new Date();
        if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) {
          return 'Термін дії картки минув.';
        }
        return '';
      },
      cvv(v) {
        if (!v) return 'Введіть CVV-код.';
        if (!/^\d{3}$/.test(v)) return 'CVV — це рівно 3 цифри.';
        return '';
      },
    },
    (form) => {
      const amount = Number(form.elements.amount.value.trim().replace(',', '.'));
      state.balance = Math.round((state.balance + amount) * 100) / 100;
      renderBalance();
      els.topupDialog.close();
      showToast(`Гаманець поповнено на ${money(amount)}.`, 'success');
    }
  );

  function openTopup() {
    topupValidator.reset();
    if (typeof els.topupDialog.showModal === 'function') els.topupDialog.showModal();
    else els.topupDialog.setAttribute('open', '');
    topupForm.elements.amount.focus();
  }

  // Автоформатування полів під час вводу
  topupForm.elements.card.addEventListener('input', (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 16);
    e.target.value = digits.replace(/(.{4})/g, '$1 ').trim();
  });
  topupForm.elements.exp.addEventListener('input', (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
    e.target.value = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
  });
  topupForm.elements.cvv.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 3);
  });

  /* ---------- 10. АБОНЕМЕНТИ, НАЛАШТУВАННЯ, FAQ ---------- */
  function activatePlan() {
    const radio = $('input[name="plan"]:checked');
    if (!radio) {
      showToast('Оберіть абонемент.', 'warn');
      return;
    }
    if (state.activePlan === radio.id) {
      showToast(`Абонемент «${radio.dataset.name}» уже підключено.`, 'info');
      return;
    }
    const price = Number(radio.dataset.price);
    if (state.balance < price) {
      showToast(
        `Недостатньо коштів: потрібно ${money(price)}, на гаманці ${money(state.balance)}. Поповніть гаманець у профілі.`,
        'error'
      );
      return;
    }
    state.balance = Math.round((state.balance - price) * 100) / 100;
    state.activePlan = radio.id;
    els.currentPlan.textContent = `${radio.dataset.name} · ${money(price)}`;
    renderBalance();
    showToast(`Абонемент «${radio.dataset.name}» підключено.`, 'success');
  }

  function handleSetting(item) {
    const kind = item.dataset.setting;
    if (kind === 'notifications') {
      state.notifications = !state.notifications;
      item.setAttribute('aria-pressed', String(state.notifications));
      $('#notif-desc').textContent = state.notifications
        ? 'Увімкнено · бронювання, поїздки та чеки'
        : 'Вимкнено';
      showToast(state.notifications ? 'Сповіщення увімкнено.' : 'Сповіщення вимкнено.', 'info');
    } else {
      const name = $('.settings__name', item).textContent;
      showToast(`Розділ «${name}» буде доступний у повній версії.`, 'info');
    }
  }

  /* ---------- 11. ФОРМА ЗВЕРНЕННЯ В ПІДТРИМКУ ---------- */
  const supportForm = $('#support-form');
  const supportValidator = createValidator(
    supportForm,
    {
      name(v) {
        if (!v) return 'Введіть ваше імʼя.';
        if (v.length < 2) return 'Імʼя має містити щонайменше 2 символи.';
        if (!/^[\p{L}'’ʼ\- ]+$/u.test(v)) return 'Імʼя може містити лише літери, пробіл і дефіс.';
        return '';
      },
      email(v) {
        if (!v) return 'Введіть електронну пошту.';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return 'Вкажіть пошту у форматі name@example.com.';
        return '';
      },
      topic(v) {
        return v ? '' : 'Оберіть тему звернення.';
      },
      message(v) {
        if (!v) return 'Опишіть проблему.';
        if (v.length < 10) return `Опишіть детальніше: щонайменше 10 символів (зараз ${v.length}).`;
        return '';
      },
      consent(checked) {
        return checked ? '' : 'Потрібна згода на обробку даних.';
      },
    },
    (form) => {
      const ticket = `ER-${Date.now().toString().slice(-6)}`;
      const name = form.elements.name.value.trim();
      const box = $('#sup-success');
      box.textContent = `Дякуємо, ${name}! Звернення ${ticket} прийнято. Відповідь надійде на ${form.elements.email.value.trim()}.`;
      box.hidden = false;
      form.hidden = true;
      showToast('Звернення надіслано.', 'success');
    }
  );

  supportForm.elements.message.addEventListener('input', (e) => {
    $('#sup-msg-count').textContent = `${e.target.value.length} / 500`;
  });

  /* ---------- 12. ДЕЛЕГУВАННЯ ПОДІЙ ТА ІНІЦІАЛІЗАЦІЯ ---------- */
  // Один обробник click на весь застосунок замість десятків окремих
  const ACTIONS = {
    'cancel-booking'() {
      if (state.stage === 'booked' || state.stage === 'unlocking') {
        resetSession();
        showToast('Бронювання скасовано.', 'info');
      }
    },
    'finish-ride'() { /* завершення виконує enter() екрана summary */ },
    'done-rating': saveRating,
    'activate-plan': activatePlan,
    'open-topup': openTopup,
    'close-topup'() { els.topupDialog.close(); },
  };

  document.addEventListener('click', (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (actionEl && ACTIONS[actionEl.dataset.action]) ACTIONS[actionEl.dataset.action](actionEl);

    const setting = e.target.closest('[data-setting]');
    if (setting) handleSetting(setting);

    const chip = e.target.closest('[data-amount]');
    if (chip) {
      const input = topupForm.elements.amount;
      input.value = chip.dataset.amount;
      input.dataset.touched = '1';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    }

    // Клік по «Чек» у списку історії — запамʼятовуємо, для якої поїздки
    const receiptLink = e.target.closest('.trip__price a');
    if (receiptLink) state.selectedTrip = receiptLink.closest('.trip');

    // Спроба змінити транспорт під час бронювання/поїздки
    if (state.stage !== 'idle' && e.target.closest('.marker, .vehicle--row')) {
      showToast('Транспорт змінити не можна: завершіть або скасуйте поточне бронювання.', 'warn');
    }

    // Клік по фону модального вікна закриває його
    if (e.target === els.topupDialog) els.topupDialog.close();
  });

  // Вибір транспорту (radio керує CSS, JS зберігає вибір у стані)
  document.addEventListener('change', (e) => {
    if (e.target.name === 'vehicle') {
      state.vehicleId = e.target.id.replace('v-', '');
      showToast(`Обрано: ${vehicle().name}.`, 'info');
    }
  });

  // Фільтри історії
  els.filters.addEventListener('change', applyFilters);
  els.filters.addEventListener('submit', (e) => e.preventDefault());

  // FAQ: відкрита лише одна відповідь. Подія toggle не спливає, тому capture
  document.addEventListener(
    'toggle',
    (e) => {
      if (e.target.matches('details.faq') && e.target.open) {
        $$('details.faq[open]').forEach((d) => { if (d !== e.target) d.open = false; });
      }
    },
    true
  );

  // Старт
  const checked = $('input[name="vehicle"]:checked');
  if (checked) state.vehicleId = checked.id.replace('v-', '');
  document.documentElement.classList.add('js');
  renderBalance();
  applyFilters();
  window.addEventListener('hashchange', route);
  route();
  setInterval(tick, 500);
})();
