#!/usr/bin/env python3
"""
Скрипт создаёт тестовых пользователей со всеми ролями для studyroom
(user-service): owner, branch_owner, tutor, parent, student.

Почему напрямую в БД, а не через API:
- POST /auth/register создаёт только роль "parent".
- POST /users/tutors  доступен только владельцу (owner) и создаёт "tutor".
- POST /users/students доступен owner/parent и создаёт "student".
- Ролей "owner" и "branch_owner" через API создать вообще нельзя —
  их можно завести только напрямую в базе.
Поэтому скрипт пишет всех тестовых пользователей прямо в Postgres
(схема из internal/migrate/sql/0001_init.up.sql), а потом (опционально)
логинится через API, чтобы убедиться, что всё работает.

Запуск (при поднятом docker-compose):
    pip install psycopg2-binary bcrypt requests
    python3 seed_test_users.py

Параметры подключения читаются из переменных окружения и по умолчанию
совпадают со значениями из docker-compose.yml (порт 5433 наружу):
    DB_HOST=localhost
    DB_PORT=5433
    DB_NAME=study_room_users
    DB_USER=user_service
    DB_PASSWORD=devpassword123
    API_BASE_URL=http://localhost:8081/api/v1   (для проверки логина)
"""

import os
import sys

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    sys.exit("Нужен пакет psycopg2-binary: pip install psycopg2-binary")

try:
    import bcrypt
except ImportError:
    sys.exit("Нужен пакет bcrypt: pip install bcrypt")

try:
    import requests
except ImportError:
    requests = None  # проверку логина просто пропустим

# --- Конфигурация подключения к БД (совпадает с docker-compose.yml) -------
DB_HOST = os.environ.get("DB_HOST", "localhost")
DB_PORT = os.environ.get("DB_PORT", "5433")
DB_NAME = os.environ.get("DB_NAME", "study_room_users")
DB_USER = os.environ.get("DB_USER", "user_service")
DB_PASSWORD = os.environ.get("DB_PASSWORD", "devpassword123")

API_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:8081/api/v1")

# --- Общий тестовый пароль для всех аккаунтов ------------------------------
TEST_PASSWORD = "TestPass123!"

TEST_BRANCH = {
    "name": "Test Branch",
    "city": "Moscow",
    "address": "ул. Тестовая, 1",
    "phone": "+70000000000",
}

# Каждый юзер: email, phone, last_name, first_name, role
USERS = [
    dict(email="owner@test.local", phone="+70000000001",
         last_name="Owner", first_name="Test", role="owner",
         branch=False),
    dict(email="branch_owner@test.local", phone="+70000000002",
         last_name="BranchOwner", first_name="Test", role="branch_owner",
         branch=True),
    dict(email="tutor@test.local", phone="+70000000003",
         last_name="Tutor", first_name="Test", role="tutor",
         branch=True, specialization="Математика"),
    dict(email="parent@test.local", phone="+70000000004",
         last_name="Parent", first_name="Test", role="parent",
         branch=False),
    dict(email="student@test.local", phone="+70000000005",
         last_name="Student", first_name="Test", role="student",
         branch=True, class_info="9А", school="Школа №1", parent_email="parent@test.local"),
]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(12)).decode()


def get_or_create_branch(cur) -> int:
    cur.execute("SELECT id FROM branches WHERE name = %s", (TEST_BRANCH["name"],))
    row = cur.fetchone()
    if row:
        return row[0]
    cur.execute(
        """
        INSERT INTO branches (name, city, address, phone)
        VALUES (%s, %s, %s, %s)
        RETURNING id
        """,
        (TEST_BRANCH["name"], TEST_BRANCH["city"], TEST_BRANCH["address"], TEST_BRANCH["phone"]),
    )
    return cur.fetchone()[0]


def upsert_user(cur, email, phone, last_name, first_name, role, branch_id, password_hash):
    cur.execute(
        """
        INSERT INTO users (email, phone, password_hash, role, last_name, first_name, branch_id, is_active)
        VALUES (%s, %s, %s, %s, %s, %s, %s, true)
        ON CONFLICT (email) DO UPDATE SET
            password_hash = EXCLUDED.password_hash,
            role          = EXCLUDED.role,
            last_name     = EXCLUDED.last_name,
            first_name    = EXCLUDED.first_name,
            branch_id     = EXCLUDED.branch_id,
            is_active     = true,
            updated_at    = now()
        RETURNING id
        """,
        (email, phone, password_hash, role, last_name, first_name, branch_id),
    )
    return cur.fetchone()[0]


def upsert_tutor_profile(cur, user_id, specialization):
    cur.execute(
        """
        INSERT INTO tutor_profiles (user_id, specialization, experience_years, rating, status)
        VALUES (%s, %s, 5, 5.0, 'active')
        ON CONFLICT (user_id) DO UPDATE SET
            specialization = EXCLUDED.specialization,
            status = 'active'
        """,
        (user_id, specialization),
    )


def upsert_student_profile(cur, user_id, class_info, school):
    cur.execute(
        """
        INSERT INTO student_profiles (user_id, class_info, school)
        VALUES (%s, %s, %s)
        ON CONFLICT (user_id) DO UPDATE SET
            class_info = EXCLUDED.class_info,
            school = EXCLUDED.school
        """,
        (user_id, class_info, school),
    )


def link_parent_student(cur, parent_id, student_id):
    cur.execute(
        """
        INSERT INTO parent_student (parent_id, student_id)
        VALUES (%s, %s)
        ON CONFLICT DO NOTHING
        """,
        (parent_id, student_id),
    )


def verify_login(email, password):
    if requests is None:
        return None
    try:
        resp = requests.post(
            f"{API_BASE_URL}/auth/login",
            json={"login": email, "password": password},
            timeout=5,
        )
        if resp.status_code == 200:
            data = resp.json()
            return data.get("user", {}).get("role", "OK (no role in payload)")
        return f"HTTP {resp.status_code}: {resp.text[:200]}"
    except Exception as e:
        return f"недоступно ({e})"


def main():
    print(f"Подключение к БД {DB_USER}@{DB_HOST}:{DB_PORT}/{DB_NAME} ...")
    conn = psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD
    )
    conn.autocommit = False
    password_hash = hash_password(TEST_PASSWORD)

    created_ids = {}

    try:
        with conn.cursor() as cur:
            branch_id = get_or_create_branch(cur)
            print(f"Тестовый филиал: id={branch_id} ({TEST_BRANCH['name']})")

            for u in USERS:
                b_id = branch_id if u.get("branch") else None
                uid = upsert_user(
                    cur, u["email"], u["phone"], u["last_name"], u["first_name"],
                    u["role"], b_id, password_hash,
                )
                created_ids[u["email"]] = uid

                if u["role"] == "tutor":
                    upsert_tutor_profile(cur, uid, u.get("specialization", "General"))
                if u["role"] == "student":
                    upsert_student_profile(cur, uid, u.get("class_info"), u.get("school"))

            # Связка parent <-> student
            for u in USERS:
                if u["role"] == "student" and u.get("parent_email"):
                    parent_id = created_ids.get(u["parent_email"])
                    if parent_id:
                        link_parent_student(cur, parent_id, created_ids[u["email"]])

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    print("\nГотово! Тестовые пользователи (пароль у всех одинаковый):\n")
    print(f"{'ROLE':<14} {'EMAIL':<25} {'PASSWORD':<16} {'USER_ID'}")
    for u in USERS:
        print(f"{u['role']:<14} {u['email']:<25} {TEST_PASSWORD:<16} {created_ids[u['email']]}")

    print(f"\nПроверка логина через API ({API_BASE_URL}/auth/login) ...")
    for u in USERS:
        role_result = verify_login(u["email"], TEST_PASSWORD)
        print(f"  {u['email']:<25} -> {role_result}")


if __name__ == "__main__":
    main()
