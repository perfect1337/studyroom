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

Никаких tutor/parent/student, курсов, договоров и заявок скрипт больше не
создаёт и не трогает academic/contracts/crm базы — это осознанно, чтобы не
плодить в Academic Service данные (course_tutors/enrollments), которые
потом «наследуются» новыми пользователями при пересоздании БД (см. разбор
ID-коллизии между сервисами).

Запуск:
  pip install psycopg2-binary bcrypt
  # сервис и его БД должны быть подняты и промигрированы:
  #   docker compose up -d postgres-users user-service
  python3 seed_studyroom.py

Скрипт идемпотентен: повторный запуск не создаёт дублей (email уникален,
для филиала — проверка по имени).

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

def main():
    conn_users = connect(DSN_USERS, "user-service DB")

    print("\n== Users Service: филиал, owner, branch_owner ==")
    users = seed_users(conn_users)

    conn_users.close()

    print("\nГотово! Тестовые аккаунты (пароль для всех: {}):".format(TEST_PASSWORD))
    print("-" * 70)
    for key, data in users.items():
        if key.startswith("_"):
            continue
        print(f"  {data['role']:<13} {data['email']:<28} {data['last_name']} {data['first_name']}")
    print("-" * 70)


if __name__ == "__main__":
    main()
