#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Скрипт наполнения Study Room тестовыми данными: только владелец сети
(owner) и владелец филиала (branch_owner).

Что делает:
  1. Подключается напрямую к postgres-users (тот же порт, что проброшен
     наружу в docker-compose.yml: 5433).
  2. Создаёт 1 филиал.
  3. Создаёт owner и branch_owner напрямую в БД, т.к. по API
     (api-contracts.md) самостоятельная регистрация с этими ролями
     невозможна (только parent через /auth/register, а owner/branch_owner —
     только вручную/по данным сидинга).
  4. Дополнительно прописывает owner и branch_owner в "теневые" таблицы
     users_ref/user_refs у Notification Service и CRM Service (см. ниже,
     почему это обязательно, а не опционально).

Почему это нужно (иначе owner молча не получает уведомления):
  Notification Service и CRM Service ничего не знают о пользователях
  User Service напрямую — они наполняют свои локальные "теневые" таблицы
  (`users_ref` у notification-service, `user_refs` у crm-service) только
  через события user.created/user.updated в NATS. Эти события публикует
  сам User Service при создании пользователя через HTTP API. Если создать
  пользователя в обход API — прямой SQL-вставкой, как делает этот скрипт —
  событие никогда не публикуется, и обе "теневые" таблицы остаются пустыми
  для этого пользователя. Практически это означает:
    - CRM Service не может найти получателя уведомления о новой заявке
      (`FindBranchOwner`/`FindAnyOwner` в user_refs) — ни для owner,
      ни для branch_owner.
    - Notification Service не может резолвить email получателя
      (`UserRefRepository.GetByID` в users_ref) — письмо помечается
      failed ещё до похода в SMTP.
  Раньше эта проблема была не видна: если branch_owner когда-то создавался
  или логинился через реальный API/UI (событие user.created/user.updated
  публикуется и там), его запись в users_ref/user_refs уже существовала —
  а owner, если создавался только этим скриптом, в эти таблицы никогда не
  попадал. Отсюда и наблюдение "branch_owner уведомления получает, owner —
  нет", хотя оба созданы одинаково. Теперь скрипт сам кладёт обоих в обе
  теневые таблицы, так что оба резолвятся одинаково, независимо от того,
  логинились они когда-то через API или нет.

Никаких tutor/parent/student, курсов, договоров и заявок скрипт больше не
создаёт и не трогает academic-базу — это осознанно, чтобы не плодить в
Academic Service данные (course_tutors/enrollments), которые потом
«наследуются» новыми пользователями при пересоздании БД (см. разбор
ID-коллизии между сервисами).

Запуск:
  pip install psycopg2-binary bcrypt
  # сервисы и их БД должны быть подняты и промигрированы:
  #   docker compose up -d postgres-users user-service \
  #       postgres-notifications notification-service \
  #       postgres-crm crm-service
  python3 seed_studyroom2.py

Скрипт идемпотентен: повторный запуск не создаёт дублей (email уникален,
для филиала — проверка по имени; записи в users_ref/user_refs — через
INSERT ... ON CONFLICT DO UPDATE).

Тестовые аккаунты получают пароль:  Test1234!
"""

import os
import sys

try:
    import psycopg2
except ImportError:
    sys.exit("Нужен пакет psycopg2-binary: pip install psycopg2-binary")

try:
    import bcrypt
except ImportError:
    sys.exit("Нужен пакет bcrypt: pip install bcrypt")


# --------------------------------------------------------------------------
# Подключение. Порт соответствует docker-compose.yml (проброс наружу для
# локальных контрактных тестов), можно переопределить через переменную
# окружения, если сервис поднят иначе.
# --------------------------------------------------------------------------
DSN_USERS = os.environ.get(
    "USERS_DSN", "postgresql://user_service:devpassword123@localhost:5433/study_room_users"
)

# "Теневые" БД Notification Service и CRM Service (см. пояснение в шапке
# файла) — порты те же, что проброшены наружу в docker-compose.yml.
DSN_NOTIFICATIONS = os.environ.get(
    "NOTIFICATIONS_DSN",
    "postgresql://notification_service:devpassword123@localhost:5434/study_room_notifications",
)
DSN_CRM = os.environ.get(
    "CRM_DSN", "postgresql://crm_service:devpassword123@localhost:5436/study_room_crm"
)

TEST_PASSWORD = "Test1234!"
PASSWORD_HASH = bcrypt.hashpw(TEST_PASSWORD.encode(), bcrypt.gensalt(12)).decode()


def connect(dsn, label):
    try:
        conn = psycopg2.connect(dsn)
        conn.autocommit = True
        print(f"[ok] подключился к {label}")
        return conn
    except Exception as e:
        sys.exit(f"[fail] не удалось подключиться к {label} ({dsn}): {e}")


# --------------------------------------------------------------------------
# Users Service
# --------------------------------------------------------------------------

def upsert_branch(cur, name, city, address, phone):
    cur.execute("SELECT id FROM branches WHERE name = %s", (name,))
    row = cur.fetchone()
    if row:
        return row[0]
    cur.execute(
        """INSERT INTO branches (name, city, address, phone)
           VALUES (%s, %s, %s, %s) RETURNING id""",
        (name, city, address, phone),
    )
    return cur.fetchone()[0]


def upsert_user(cur, email, phone, role, last_name, first_name, patronymic, branch_id):
    cur.execute("SELECT id FROM users WHERE email = %s", (email,))
    row = cur.fetchone()
    if row:
        return row[0], False
    cur.execute(
        """INSERT INTO users
               (email, phone, password_hash, role, last_name, first_name,
                patronymic, branch_id, is_active)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, true)
           RETURNING id""",
        (email, phone, PASSWORD_HASH, role, last_name, first_name, patronymic, branch_id),
    )
    return cur.fetchone()[0], True


def sync_notification_ref(conn, user_id, email, first_name, last_name):
    """Кладёт пользователя в users_ref у Notification Service — без этой
    записи UserRefRepository.GetByID не резолвит email, и любое письмо
    этому пользователю падает в статус failed ещё до похода в SMTP (см.
    notifier.Send и /internal/users/sync, которому этот insert аналогичен).
    """
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO users_ref (id, email, first_name, last_name, updated_at)
           VALUES (%s, %s, %s, %s, now())
           ON CONFLICT (id) DO UPDATE SET
               email = EXCLUDED.email,
               first_name = EXCLUDED.first_name,
               last_name = EXCLUDED.last_name,
               updated_at = now()""",
        (user_id, email, first_name, last_name),
    )
    cur.close()


def sync_crm_ref(conn, user_id, full_name, role, branch_id):
    """Кладёт пользователя в user_refs у CRM Service — без этой записи
    FindBranchOwner/FindAnyOwner ничего не находят, и уведомление о новой
    заявке (application.received) просто не публикуется (см.
    resolveNotifyTargets в application_handler.go).
    """
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO user_refs (user_id, full_name, role, branch_id, synced_at)
           VALUES (%s, %s, %s, %s, now())
           ON CONFLICT (user_id) DO UPDATE SET
               full_name = EXCLUDED.full_name,
               role = EXCLUDED.role,
               branch_id = EXCLUDED.branch_id,
               synced_at = now()""",
        (user_id, full_name, role, branch_id),
    )
    cur.close()


def seed_users(conn):
    cur = conn.cursor()

    branch1 = upsert_branch(cur, "Саратов - Центр", "Саратов", "ул. Московская, 10", "+78452000001")

    users = {}

    def u(key, **kw):
        uid, created = upsert_user(
            cur,
            email=kw["email"], phone=kw.get("phone"), role=kw["role"],
            last_name=kw["last_name"], first_name=kw["first_name"],
            patronymic=kw.get("patronymic"), branch_id=kw.get("branch_id"),
        )
        users[key] = {"id": uid, **kw, "created": created}
        return uid

    u("owner", email="owner@test.local", phone="+70000000001", role="owner",
      last_name="Владимиров", first_name="Олег", patronymic="Игоревич", branch_id=None)

    u("branch_owner", email="branch_owner@test.local", phone="+70000000002", role="branch_owner",
      last_name="Соколова", first_name="Марина", patronymic="Андреевна", branch_id=branch1)

    cur.close()
    users["_branch1"] = branch1
    return users


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def sync_notification_and_crm_refs(users):
    """Прописывает owner и branch_owner в теневые таблицы Notification/CRM
    Service (см. пояснение в шапке файла) — без этого шага оба сервиса не
    видят этих пользователей вообще, и уведомления (в первую очередь —
    "новая заявка" из CRM) молча никуда не отправляются ни для owner,
    ни для branch_owner, независимо от их роли/прав.
    """
    people = [data for key, data in users.items() if not key.startswith("_")]

    conn_notif = connect(DSN_NOTIFICATIONS, "notification-service DB")
    for p in people:
        full_first_last = (p["first_name"], p["last_name"])
        sync_notification_ref(conn_notif, p["id"], p["email"], *full_first_last)
    conn_notif.close()
    print(f"[ok] users_ref (notification-service) обновлён для {len(people)} пользователь(ей)")

    conn_crm = connect(DSN_CRM, "crm-service DB")
    for p in people:
        full_name = f"{p['first_name']} {p['last_name']}".strip()
        sync_crm_ref(conn_crm, p["id"], full_name, p["role"], p.get("branch_id"))
    conn_crm.close()
    print(f"[ok] user_refs (crm-service) обновлён для {len(people)} пользователь(ей)")


def main():
    conn_users = connect(DSN_USERS, "user-service DB")

    print("\n== Users Service: филиал, owner, branch_owner ==")
    users = seed_users(conn_users)

    conn_users.close()

    print("\n== Notification/CRM Service: синхронизация users_ref/user_refs ==")
    sync_notification_and_crm_refs(users)

    print("\nГотово! Тестовые аккаунты (пароль для всех: {}):".format(TEST_PASSWORD))
    print("-" * 70)
    for key, data in users.items():
        if key.startswith("_"):
            continue
        print(f"  {data['role']:<13} {data['email']:<28} {data['last_name']} {data['first_name']}")
    print("-" * 70)


if __name__ == "__main__":
    main()
