#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Скрипт наполнения Study Room тестовыми данными: 1 owner, 2 branch_owner,
12 tutor, 12 parent и 12 student.

Написан по образцу seed_studyroom.py / seed_studyroom2.py / seed_studyroom3.py
из этого же репозитория и следует тем же принципам:

  1. Подключается напрямую к 5 postgres-базам (users, academic, contracts,
     crm, notifications) — тем же портам, что проброшены наружу в
     docker-compose.yml (5433 / 5435 / 5437 / 5436 / 5434).
  2. Создаёт 2 филиала (по одному на branch_owner).
  3. Создаёт пользователей напрямую в БД User Service:
       - 1 owner            (без филиала)
       - 2 branch_owner      (по одному на филиал)
       - 12 tutor            (по 6 на филиал, с tutor_profiles)
       - 12 parent           (без филиала, как и в seed_studyroom.py)
       - 12 student          (по 6 на филиал, с student_profiles)
     и связывает каждого parent с одним student через parent_student
     (parent[i] <-> student[i], первые 6 пар — филиал 1, вторые 6 — филиал 2).
     Owner/branch_owner создаются в обход API, т.к. по api-contracts.md
     самостоятельная регистрация с этими ролями невозможна.
  4. Зеркалирует ВСЕХ созданных пользователей в user_refs Academic/Contracts/
     CRM Service и в users_ref Notification Service — в норме это делает
     событие user.created по NATS, но при прямой вставке в БД событие не
     публикуется, поэтому дублируем вручную (см. подробное объяснение,
     почему это обязательно, в шапке seed_studyroom3.py).
     Для student'ов в users_ref дополнительно проставляется parent_id
     (см. 0002_users_ref_parent_id.up.sql и event-schema.md,
     v1.user.created) — иначе Notification Service не резолвит
     student_id -> parent_id в attendance.marked_absent.

Скрипт НЕ создаёт курсы/договоры/заявки — только пользователей и связи
parent-student, чтобы не плодить в Academic/Contracts/CRM данные, которые
потом «наследуются» новыми пользователями при пересоздании БД.

Запуск:
  pip install psycopg2-binary bcrypt
  # сервисы и их БД должны быть подняты и промигрированы:
  #   docker compose up -d postgres-users user-service \
  #       postgres-academic academic-service \
  #       postgres-contracts contracts-service \
  #       postgres-crm crm-service \
  #       postgres-notifications notification-service
  python3 seed_studyroom4.py

Скрипт идемпотентен: повторный запуск не создаёт дублей (email уникален,
для филиала — проверка по имени; parent_student/user_refs/users_ref —
через ON CONFLICT DO NOTHING/DO UPDATE).

Все тестовые аккаунты получают пароль:  Test1234!
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
# Подключения. Порты соответствуют docker-compose.yml (проброс наружу для
# локальных контрактных тестов), можно переопределить через переменные
# окружения, если сервисы подняты иначе.
# --------------------------------------------------------------------------
DSN_USERS = os.environ.get(
    "USERS_DSN", "postgresql://user_service:devpassword123@localhost:5433/study_room_users"
)
DSN_ACADEMIC = os.environ.get(
    "ACADEMIC_DSN", "postgresql://academic_service:devpassword123@localhost:5435/study_room_academic"
)
DSN_CONTRACTS = os.environ.get(
    "CONTRACTS_DSN", "postgresql://contracts_service:devpassword123@localhost:5437/study_room_contracts"
)
DSN_CRM = os.environ.get(
    "CRM_DSN", "postgresql://crm_service:devpassword123@localhost:5436/study_room_crm"
)
DSN_NOTIFICATIONS = os.environ.get(
    "NOTIFICATIONS_DSN",
    "postgresql://notification_service:devpassword123@localhost:5434/study_room_notifications",
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
# Генератор тестовых ФИО — чтобы не плодить однотипных "Иванов Иванов".
# Мужские и женские имена/фамилии/отчества согласованы по роду.
# --------------------------------------------------------------------------
FIRST_NAMES_M = [
    "Иван", "Дмитрий", "Алексей", "Николай", "Сергей", "Артём", "Максим",
    "Егор", "Кирилл", "Павел", "Роман", "Владимир", "Игорь", "Олег",
    "Андрей", "Денис", "Виктор", "Григорий", "Тимур", "Ярослав",
]
FIRST_NAMES_F = [
    "Светлана", "Марина", "Елена", "Ольга", "Анна", "Наталья", "Юлия",
    "Татьяна", "Виктория", "Дарья", "Мария", "Ксения", "Полина", "Алина",
    "Екатерина", "Ирина", "Людмила", "Вера", "Софья", "Алёна",
]
LAST_NAME_STEMS = [
    "Кузнецов", "Петров", "Смирнов", "Волков", "Морозов", "Соколов",
    "Попов", "Новиков", "Козлов", "Лебедев", "Семёнов", "Богданов",
    "Никитин", "Захаров", "Егоров", "Павлов", "Фёдоров", "Виноградов",
    "Абрамов", "Тарасов",
]
PATRONYMIC_M = [
    "Сергеевич", "Олегович", "Ильич", "Андреевич", "Николаевич",
    "Викторович", "Дмитриевич", "Александрович", "Игоревич", "Романович",
    "Петрович", "Юрьевич", "Васильевич", "Тимофеевич", "Владимирович",
    "Денисович", "Григорьевич", "Тимурович", "Ярославович", "Максимович",
]
PATRONYMIC_F = [
    "Сергеевна", "Олеговна", "Ильинична", "Андреевна", "Николаевна",
    "Викторовна", "Дмитриевна", "Александровна", "Игоревна", "Романовна",
    "Петровна", "Юрьевна", "Васильевна", "Тимофеевна", "Владимировна",
    "Денисовна", "Григорьевна", "Тимуровна", "Ярославовна", "Максимовна",
]


def _feminine_surname(stem):
    if stem.endswith("ов") or stem.endswith("ев") or stem.endswith("ин"):
        return stem + "а"
    return stem


def _build_name_pool():
    """40 уникальных ФИО (20 мужских + 20 женских), перемешанных М/Ж, чтобы
    хватило на owner+branch_owner+12 tutor+12 parent+12 student (39 чел.)
    без повторов."""
    pool = []
    for i in range(20):
        pool.append((
            FIRST_NAMES_M[i], LAST_NAME_STEMS[i], PATRONYMIC_M[i], "m",
        ))
        f_stem = LAST_NAME_STEMS[(i + 7) % 20]  # сдвиг, чтобы фамилии не совпадали 1-в-1 с мужскими
        pool.append((
            FIRST_NAMES_F[i], _feminine_surname(f_stem), PATRONYMIC_F[i], "f",
        ))
    return pool


NAME_POOL = _build_name_pool()
_name_cursor = 0


def next_name():
    global _name_cursor
    name = NAME_POOL[_name_cursor % len(NAME_POOL)]
    _name_cursor += 1
    return name  # (first_name, last_name, patronymic, gender)


SUBJECTS = [
    "Математика, ЕГЭ", "Английский язык", "Физика", "Русский язык, ОГЭ",
    "Химия", "Биология", "История", "Обществознание", "Информатика",
    "Литература", "Немецкий язык", "География",
]
TUTOR_STATUSES = ["active", "active", "active", "vacation", "active", "sick_leave"]
SCHOOLS = ["Школа №1", "Школа №5", "Школа №12", "Гимназия №3", "Лицей №8"]
CLASSES = ["1А", "2Б", "3В", "4А", "5Б", "6А", "7В", "8Б", "9А", "10Б", "11А", "11Б"]


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


def upsert_tutor_profile(cur, user_id, specialization, experience_years, rating, status="active"):
    cur.execute("SELECT 1 FROM tutor_profiles WHERE user_id = %s", (user_id,))
    if cur.fetchone():
        return
    cur.execute(
        """INSERT INTO tutor_profiles (user_id, specialization, experience_years, rating, status)
           VALUES (%s, %s, %s, %s, %s)""",
        (user_id, specialization, experience_years, rating, status),
    )


def upsert_student_profile(cur, user_id, class_info, school, avg_grade, attendance_pct):
    cur.execute("SELECT 1 FROM student_profiles WHERE user_id = %s", (user_id,))
    if cur.fetchone():
        return
    cur.execute(
        """INSERT INTO student_profiles (user_id, class_info, school, avg_grade, attendance_pct)
           VALUES (%s, %s, %s, %s, %s)""",
        (user_id, class_info, school, avg_grade, attendance_pct),
    )


def link_parent_student(cur, parent_id, student_id):
    cur.execute(
        """INSERT INTO parent_student (parent_id, student_id) VALUES (%s, %s)
           ON CONFLICT DO NOTHING""",
        (parent_id, student_id),
    )


def seed_users(conn):
    cur = conn.cursor()

    branch1 = upsert_branch(cur, "Саратов - Центр", "Саратов", "ул. Московская, 10", "+78452000001")
    branch2 = upsert_branch(cur, "Энгельс", "Энгельс", "пр. Ленина, 5", "+78453000002")

    users = {}
    phone_seq = [1]

    def next_phone():
        n = phone_seq[0]
        phone_seq[0] += 1
        return f"+7900000{n:04d}"

    def u(key, role, branch_id):
        first, last, patronymic, _gender = next_name()
        email = f"{key}@test.local"
        uid, created = upsert_user(
            cur, email=email, phone=next_phone(), role=role,
            last_name=last, first_name=first, patronymic=patronymic,
            branch_id=branch_id,
        )
        users[key] = {
            "id": uid, "email": email, "role": role, "last_name": last,
            "first_name": first, "patronymic": patronymic,
            "branch_id": branch_id, "created": created,
        }
        return uid

    # --- 1 owner ---
    u("owner", "owner", None)

    # --- 2 branch_owner (по одному на филиал) ---
    u("branch_owner1", "branch_owner", branch1)
    u("branch_owner2", "branch_owner", branch2)

    # --- 12 tutor (6 на филиал 1, 6 на филиал 2) ---
    for i in range(1, 13):
        branch_id = branch1 if i <= 6 else branch2
        tid = u(f"tutor{i}", "tutor", branch_id)
        upsert_tutor_profile(
            cur, tid,
            specialization=SUBJECTS[(i - 1) % len(SUBJECTS)],
            experience_years=1 + (i * 7) % 15,
            rating=round(4.0 + ((i * 3) % 10) / 10, 1),
            status=TUTOR_STATUSES[(i - 1) % len(TUTOR_STATUSES)],
        )

    # --- 12 parent (без филиала — как и в seed_studyroom.py) ---
    for i in range(1, 13):
        u(f"parent{i}", "parent", None)

    # --- 12 student (6 на филиал 1, 6 на филиал 2), каждый привязан к
    #     "своему" родителю parent{i} ---
    for i in range(1, 13):
        branch_id = branch1 if i <= 6 else branch2
        sid = u(f"student{i}", "student", branch_id)
        upsert_student_profile(
            cur, sid,
            class_info=CLASSES[(i - 1) % len(CLASSES)],
            school=SCHOOLS[(i - 1) % len(SCHOOLS)],
            avg_grade=round(3.5 + ((i * 4) % 15) / 10, 1),
            attendance_pct=round(75 + ((i * 5) % 25), 1),
        )
        link_parent_student(cur, users[f"parent{i}"]["id"], sid)

    cur.close()
    users["_branch1"] = branch1
    users["_branch2"] = branch2
    return users


# --------------------------------------------------------------------------
# Зеркалирование в user_refs Academic/Contracts/CRM Service (обычно приходит
# по NATS событием user.created/user.updated; при прямой вставке в БД
# дублируем сами — см. пояснение в шапке файла).
# --------------------------------------------------------------------------

def mirror_user_refs(conn, users, label):
    cur = conn.cursor()
    count = 0
    for key, data in users.items():
        if key.startswith("_"):
            continue
        full_name = f"{data['last_name']} {data['first_name']}".strip()
        cur.execute(
            """INSERT INTO user_refs (user_id, full_name, role, branch_id, synced_at)
               VALUES (%s, %s, %s, %s, now())
               ON CONFLICT (user_id) DO UPDATE SET
                   full_name = EXCLUDED.full_name,
                   role = EXCLUDED.role,
                   branch_id = EXCLUDED.branch_id,
                   synced_at = now()""",
            (data["id"], full_name, data["role"], data.get("branch_id")),
        )
        count += 1
    cur.close()
    print(f"[ok] user_refs ({label}) обновлён для {count} пользователь(ей)")


# --------------------------------------------------------------------------
# Зеркалирование в users_ref Notification Service. Для student дополнительно
# проставляем parent_id (см. 0002_users_ref_parent_id.up.sql), иначе
# attendance.marked_absent не резолвит student_id -> parent_id.
# --------------------------------------------------------------------------

def sync_notification_refs(conn, users):
    # student_key -> parent_id, построено из parent_student связей выше:
    # parent{i} <-> student{i}
    cur = conn.cursor()
    count = 0
    for key, data in users.items():
        if key.startswith("_"):
            continue
        parent_id = None
        if data["role"] == "student":
            i = key[len("student"):]
            parent_key = f"parent{i}"
            if parent_key in users:
                parent_id = users[parent_key]["id"]
        cur.execute(
            """INSERT INTO users_ref (id, email, first_name, last_name, updated_at, parent_id)
               VALUES (%s, %s, %s, %s, now(), %s)
               ON CONFLICT (id) DO UPDATE SET
                   email = EXCLUDED.email,
                   first_name = EXCLUDED.first_name,
                   last_name = EXCLUDED.last_name,
                   updated_at = now(),
                   parent_id = EXCLUDED.parent_id""",
            (data["id"], data["email"], data["first_name"], data["last_name"], parent_id),
        )
        count += 1
    cur.close()
    print(f"[ok] users_ref (notification-service) обновлён для {count} пользователь(ей)")


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def main():
    conn_users = connect(DSN_USERS, "user-service DB")
    conn_academic = connect(DSN_ACADEMIC, "academic-service DB")
    conn_contracts = connect(DSN_CONTRACTS, "contracts-service DB")
    conn_crm = connect(DSN_CRM, "crm-service DB")
    conn_notifications = connect(DSN_NOTIFICATIONS, "notification-service DB")

    print("\n== Users Service: 2 филиала, 1 owner, 2 branch_owner, "
          "12 tutor, 12 parent, 12 student ==")
    users = seed_users(conn_users)
    conn_users.close()

    print("\n== Зеркалирование user_refs в academic/contracts/crm ==")
    mirror_user_refs(conn_academic, users, "academic-service")
    mirror_user_refs(conn_contracts, users, "contracts-service")
    mirror_user_refs(conn_crm, users, "crm-service")
    conn_academic.close()
    conn_contracts.close()
    conn_crm.close()

    print("\n== Зеркалирование users_ref в notification-service ==")
    sync_notification_refs(conn_notifications, users)
    conn_notifications.close()

    role_order = {"owner": 0, "branch_owner": 1, "tutor": 2, "parent": 3, "student": 4}
    people = [d for k, d in users.items() if not k.startswith("_")]
    people.sort(key=lambda d: (role_order[d["role"]], d["email"]))

    print("\nГотово! Тестовые аккаунты (пароль для всех: {}):".format(TEST_PASSWORD))
    print("-" * 70)
    for data in people:
        print(f"  {data['role']:<13} {data['email']:<28} {data['last_name']} {data['first_name']}")
    print("-" * 70)
    print(f"Всего: {len(people)} пользователь(ей) "
          f"(1 owner, 2 branch_owner, 12 tutor, 12 parent, 12 student)")


if __name__ == "__main__":
    main()
