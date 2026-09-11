// schedule_load_test.js
// Нагрузочный тест для studyroom (k6: https://k6.io).
//
// ПЕРЕД ЗАПУСКОМ:
// 1. Установите k6: https://grafana.com/docs/k6/latest/set-up/install-k6/
// 2. Если гоняете через nginx (study-room-backend/nginx/nginx.conf) —
//    впишите публичный IP машины, с которой запускаете k6, в блок
//    `geo $ratelimit_whitelist` (см. комментарий в начале файла).
//    Без этого вы измерите не производительность приложения, а то, как
//    быстро сработает лимитер (429) — там 20 req/s общий лимит и
//    5 req/s на /auth/* с одного IP.
// 3. Замените BASE_URL / TEST_LOGIN / TEST_PASSWORD на свои — ниже стоит
//    сидовый owner из 0005_seed_owner.up.sql (owner@test.local / qwerty228,
//    подходит только для локального docker-compose, не для прода).
//
// ЗАПУСК:
//   k6 run schedule_load_test.js
//   k6 run --vus 50 --duration 3m schedule_load_test.js   (переопределить stages)
//   BASE_URL=https://mestudyroom64.ru k6 run schedule_load_test.js

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8081"; // при прямом обращении к сервисам см. заметку ниже
const TEST_LOGIN = __ENV.TEST_LOGIN || "owner@test.local";
const TEST_PASSWORD = __ENV.TEST_PASSWORD || "qwerty228";

// Если гоняете БЕЗ nginx (напрямую на docker-compose порты 8081/8082/8083),
// у каждого сервиса свой порт — тогда либо поднимите локально nginx из
// study-room-backend/nginx (рекомендуется, ближе к проду), либо задайте
// отдельные базовые URL здесь:
const USER_SERVICE = __ENV.USER_SERVICE_URL || BASE_URL;
const ACADEMIC_SERVICE = __ENV.ACADEMIC_SERVICE_URL || BASE_URL;
const CONTRACTS_SERVICE = __ENV.CONTRACTS_SERVICE_URL || BASE_URL;

const loginFailRate = new Rate("login_failed");
const scheduleTrend = new Trend("schedule_fetch_duration");

export const options = {
  scenarios: {
    // Реалистичная нагрузка: постепенный разгон, "плато", плавный спад —
    // так проще увидеть, при каком числе одновременных пользователей
    // латентность/ошибки начинают расти, а не просто получить одно число.
    ramping_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 20 },   // разгон
        { duration: "2m", target: 20 },    // плато — типичная нагрузка
        { duration: "30s", target: 80 },   // всплеск (напр. начало учебного дня)
        { duration: "1m", target: 80 },
        { duration: "30s", target: 0 },    // спад
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],       // не больше 1% ошибок
    http_req_duration: ["p(95)<800"],     // 95% запросов быстрее 800мс
    login_failed: ["rate<0.01"],
  },
};

function authHeaders(token) {
  return { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } };
}

export default function () {
  let token;

  group("login", () => {
    const res = http.post(
      `${USER_SERVICE}/api/v1/auth/login`,
      JSON.stringify({ login: TEST_LOGIN, password: TEST_PASSWORD }),
      { headers: { "Content-Type": "application/json" } }
    );
    const ok = check(res, {
      "login 200": (r) => r.status === 200,
      "access_token присутствует": (r) => !!r.json("access_token"),
    });
    loginFailRate.add(!ok);
    if (ok) token = res.json("access_token");
  });

  if (!token) {
    // Не валимся всей VU из-за одного неудачного логина (иначе один сбой
    // auth-сервиса искажает картину по остальным эндпоинтам) — просто
    // пропускаем итерацию.
    sleep(1);
    return;
  }

  group("me", () => {
    const res = http.get(`${USER_SERVICE}/api/v1/users/me`, authHeaders(token));
    check(res, { "me 200": (r) => r.status === 200 });
  });

  group("schedule (месяц)", () => {
    // Текущий месяц — самый частый запрос: страница "Расписание" грузит
    // его при каждом заходе. Год/месяц берём реальные, чтобы задеть тот же
    // путь, что чинили в ScheduleDirectory.jsx (monthGridDateRange).
    const now = new Date();
    const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-28`;
    const res = http.get(
      `${ACADEMIC_SERVICE}/api/v1/academic/lessons?date_from=${from}&date_to=${to}`,
      authHeaders(token)
    );
    scheduleTrend.add(res.timings.duration);
    check(res, { "lessons 200": (r) => r.status === 200 });
  });

  group("contracts (finance)", () => {
    const res = http.get(`${CONTRACTS_SERVICE}/api/v1/contracts`, authHeaders(token));
    check(res, { "contracts 200": (r) => r.status === 200 });
  });

  // Пауза между "действиями" одного пользователя — без неё k6 будет слать
  // запросы так часто, как только может, что не похоже на реальных людей,
  // кликающих по интерфейсу.
  sleep(Math.random() * 2 + 1); // 1–3 сек
}
