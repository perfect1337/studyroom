#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Скрипт наполнения Study Room тестовыми данными для проверки всего функционала фронта.

Что делает:
  1. Подключается напрямую к 4 postgres-базам (users, academic, contracts, crm) —
     тем же портам, что проброшены наружу в docker-compose.yml (5433/5435/5437/5436).
  2. Создаёт 2 филиала.
  3. Создаёт пользователей всех ролей (owner, branch_owner, tutor x2, parent x2,
     student x3) — включая привязку parent->student и профили tutor/student.
     Owner и branch_owner создаются напрямую в БД, т.к. по API (api-contracts.md)
     самостоятельная регистрация с этими ролями невозможна (только parent через
     /auth/register, а owner/branch_owner — только вручную/по данным сидинга).
  4. Зеркалирует нужных пользователей в user_refs каждого из трёх остальных
     сервисов (academic/contracts/crm) — обычно это делает NATS-событие
     user.created, но при прямой вставке в БД событие не публикуется.
  5. Создаёт курсы, назначает на них преподавателей (course_tutors), записывает
     учеников (enrollments), создаёт занятия с участниками и посещаемостью,
     выдаёт домашние задания.
  6. Создаёт договоры (contracts) для части учеников.
  7. Создаёт заявки в CRM (и с сайта/tilda, и внутренние).

Запуск:
  pip install psycopg2-binary bcrypt
  # сервисы и их БД должны быть подняты и промигрированы:
  #   docker compose up -d postgres-users postgres-academic postgres-contracts postgres-crm
  #   (миграции применяются самими Go-сервисами при старте — подними их тоже:
  #   docker compose up -d user-service academic-service contracts-service crm-service)
  python3 seed_studyroom.py

Скрипт идемпотентен: повторный запуск не создаёт дублей (email/номера
договоров уникальны, для остальных сущностей используется ON CONFLICT/проверка
существования по понятному "естественному" ключу).

Все тестовые пользователи получают пароль:  Test1234!
"""

import datetime as dt
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

TEST_PASSWORD = "Test1234!"
PASSWORD_HASH = bcrypt.hashpw(TEST_PASSWORD.encode(), bcrypt.gensalt(12)).decode()

TODAY = dt.date.today()


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

    tutor1 = u("tutor1", email="tutor@test.local", phone="+70000000003", role="tutor",
               last_name="Кузнецов", first_name="Иван", patronymic="Сергеевич", branch_id=branch1)
    upsert_tutor_profile(cur, tutor1, "Математика, ЕГЭ", 6, 4.8, "active")

    tutor2 = u("tutor2", email="tutor2@test.local", phone="+70000000006", role="tutor",
               last_name="Иванова", first_name="Светлана", patronymic="Петровна", branch_id=branch1)
    upsert_tutor_profile(cur, tutor2, "Английский язык", 3, 4.6, "vacation")

    tutor3 = u("tutor3", email="tutor3@test.local", phone="+70000000007", role="tutor",
               last_name="Петров", first_name="Дмитрий", patronymic="Олегович", branch_id=branch2)
    upsert_tutor_profile(cur, tutor3, "Физика", 8, 4.9, "active")

    parent1 = u("parent1", email="parent@test.local", phone="+70000000004", role="parent",
                last_name="Смирнова", first_name="Елена", patronymic="Владимировна", branch_id=None)

    parent2 = u("parent2", email="parent2@test.local", phone="+70000000008", role="parent",
                last_name="Морозов", first_name="Артём", patronymic="Николаевич", branch_id=None)

    student1 = u("student1", email="student@test.local", phone="+70000000005", role="student",
                 last_name="Смирнов", first_name="Алексей", patronymic="Ильич", branch_id=branch1)
    upsert_student_profile(cur, student1, "9А", "Школа №1", 4.5, 92.0)
    link_parent_student(cur, parent1, student1)

    student2 = u("student2", email="student2@test.local", phone="+70000000009", role="student",
                 last_name="Смирнова", first_name="Ольга", patronymic="Ильинична", branch_id=branch1)
    upsert_student_profile(cur, student2, "6Б", "Школа №1", 4.1, 88.0)
    link_parent_student(cur, parent1, student2)

    student3 = u("student3", email="student3@test.local", phone="+70000000010", role="student",
                 last_name="Морозов", first_name="Кирилл", patronymic="Артёмович", branch_id=branch2)
    upsert_student_profile(cur, student3, "4 класс", "Школа №5", 4.9, 97.5)
    link_parent_student(cur, parent2, student3)

    cur.close()
    users["_branch1"] = branch1
    users["_branch2"] = branch2
    return users


# --------------------------------------------------------------------------
# Зеркалирование в user_refs остальных сервисов (обычно приходит по NATS
# событием user.created/user.updated; при прямой вставке в БД дублируем сами)
# --------------------------------------------------------------------------

def mirror_user_refs(conn, users):
    cur = conn.cursor()
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
    cur.close()


# --------------------------------------------------------------------------
# Academic Service
# --------------------------------------------------------------------------

def upsert_course(cur, title, subject, fmt, description, branch_id):
    cur.execute("SELECT id FROM courses WHERE title = %s AND branch_id = %s", (title, branch_id))
    row = cur.fetchone()
    if row:
        return row[0]
    cur.execute(
        """INSERT INTO courses (title, subject, format, description, branch_id)
           VALUES (%s, %s, %s, %s, %s) RETURNING id""",
        (title, subject, fmt, description, branch_id),
    )
    return cur.fetchone()[0]


def assign_course_tutor(cur, course_id, tutor_id):
    cur.execute(
        "INSERT INTO course_tutors (course_id, tutor_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
        (course_id, tutor_id),
    )


def upsert_enrollment(cur, student_id, course_id, tutor_id, progress_pct, status):
    cur.execute(
        "SELECT id FROM enrollments WHERE student_id = %s AND course_id = %s",
        (student_id, course_id),
    )
    row = cur.fetchone()
    if row:
        return row[0]
    cur.execute(
        """INSERT INTO enrollments (student_id, course_id, tutor_id, progress_pct, status,
                                     start_date, end_date)
           VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id""",
        (student_id, course_id, tutor_id, progress_pct, status,
         TODAY - dt.timedelta(days=30), TODAY + dt.timedelta(days=150)),
    )
    return cur.fetchone()[0]


def upsert_lesson(cur, course_id, tutor_id, created_by, topic, lesson_date,
                   start_time, end_time, location_type, group_type, status, comment,
                   participant_ids):
    cur.execute(
        "SELECT id FROM lessons WHERE course_id=%s AND tutor_id=%s AND lesson_date=%s AND topic=%s",
        (course_id, tutor_id, lesson_date, topic),
    )
    row = cur.fetchone()
    if row:
        return row[0]
    cur.execute(
        """INSERT INTO lessons (course_id, tutor_id, created_by, topic, lesson_date,
                                 start_time, end_time, location_type, group_type, status, comment)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
        (course_id, tutor_id, created_by, topic, lesson_date, start_time, end_time,
         location_type, group_type, status, comment),
    )
    lesson_id = cur.fetchone()[0]
    for sid in participant_ids:
        cur.execute(
            "INSERT INTO lesson_participants (lesson_id, student_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (lesson_id, sid),
        )
    return lesson_id


def upsert_attendance(cur, lesson_id, student_id, status, reason=None):
    cur.execute(
        """INSERT INTO attendance (lesson_id, student_id, status, absence_reason)
           VALUES (%s, %s, %s, %s)
           ON CONFLICT (lesson_id, student_id) DO NOTHING""",
        (lesson_id, student_id, status, reason),
    )


def upsert_homework(cur, student_id, created_by, link_url, status="assigned", viewed_at=None):
    cur.execute(
        "SELECT id FROM homework WHERE student_id=%s AND link_url=%s",
        (student_id, link_url),
    )
    if cur.fetchone():
        return
    cur.execute(
        """INSERT INTO homework (student_id, created_by, link_url, status, viewed_at)
           VALUES (%s, %s, %s, %s, %s)""",
        (student_id, created_by, link_url, status, viewed_at),
    )


def seed_academic(conn, users):
    cur = conn.cursor()
    b1, b2 = users["_branch1"], users["_branch2"]
    tutor1, tutor2, tutor3 = users["tutor1"]["id"], users["tutor2"]["id"], users["tutor3"]["id"]
    s1, s2, s3 = users["student1"]["id"], users["student2"]["id"], users["student3"]["id"]

    course_math = upsert_course(cur, "Математика - Подготовка к ЕГЭ", "Математика", "individual",
                                 "Индивидуальная подготовка к ЕГЭ по математике (профиль)", b1)
    course_eng = upsert_course(cur, "Английский язык (B2)", "Английский", "group",
                                "Групповые занятия английским, уровень B2", b1)
    course_phys = upsert_course(cur, "Физика - Олимпиадная подготовка", "Физика", "individual",
                                 "Подготовка к олимпиадам по физике", b2)

    assign_course_tutor(cur, course_math, tutor1)
    assign_course_tutor(cur, course_eng, tutor2)
    assign_course_tutor(cur, course_phys, tutor3)

    e1 = upsert_enrollment(cur, s1, course_math, tutor1, 75, "active")
    e2 = upsert_enrollment(cur, s2, course_eng, tutor2, 40, "active")
    e3 = upsert_enrollment(cur, s3, course_phys, tutor3, 90, "active")
    upsert_enrollment(cur, s1, course_eng, tutor2, 20, "paused")

    l1 = upsert_lesson(cur, course_math, tutor1, tutor1, "Алгебра - Функции",
                        TODAY - dt.timedelta(days=3), "16:00", "17:30", "remote", "individual",
                        "completed", "Разобрали производные", [s1])
    upsert_attendance(cur, l1, s1, "present")

    l2 = upsert_lesson(cur, course_math, tutor1, tutor1, "Геометрия - Стереометрия",
                        TODAY + dt.timedelta(days=2), "16:00", "17:30", "remote", "individual",
                        "scheduled", None, [s1])

    l3 = upsert_lesson(cur, course_eng, tutor2, tutor2, "Present Perfect vs Past Simple",
                        TODAY - dt.timedelta(days=1), "10:00", "11:30", "onsite", "group",
                        "completed", "Групповое занятие", [s2])
    upsert_attendance(cur, l3, s2, "absent", "По болезни (справка предоставлена)")

    l4 = upsert_lesson(cur, course_phys, tutor3, tutor3, "Механика - Кинематика",
                        TODAY + dt.timedelta(days=1), "14:00", "15:30", "onsite", "individual",
                        "scheduled", None, [s3])

    upsert_homework(cur, s1, tutor1, "https://example.com/hw/algebra-1", "viewed",
                     dt.datetime.now() - dt.timedelta(hours=5))
    upsert_homework(cur, s2, tutor2, "https://example.com/hw/english-grammar-2", "assigned")
    upsert_homework(cur, s3, tutor3, "https://example.com/hw/physics-kinematics", "assigned")

    cur.close()
    return {"course_math": course_math, "course_eng": course_eng, "course_phys": course_phys,
            "e1": e1, "e2": e2, "e3": e3}


# --------------------------------------------------------------------------
# Contracts Service
# --------------------------------------------------------------------------

def upsert_contract(cur, number, student_id, parent_id, course_id, branch_id,
                     amount, start_date, end_date, status="active", payment_status="unpaid"):
    cur.execute("SELECT id FROM contracts WHERE contract_number = %s", (number,))
    row = cur.fetchone()
    if row:
        return row[0]
    cur.execute(
        """INSERT INTO contracts (contract_number, student_id, parent_id, course_id, branch_id,
                                   amount, payment_status, status, start_date, end_date)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
        (number, student_id, parent_id, course_id, branch_id, amount,
         payment_status, status, start_date, end_date),
    )
    return cur.fetchone()[0]


def seed_contracts(conn, users, academic):
    cur = conn.cursor()
    b1 = users["_branch1"]
    parent1, parent2 = users["parent1"]["id"], users["parent2"]["id"]
    s1, s2, s3 = users["student1"]["id"], users["student2"]["id"], users["student3"]["id"]

    upsert_contract(cur, "DOG-2026-0001", s1, parent1, academic["course_math"], b1,
                     4500, TODAY - dt.timedelta(days=30), TODAY + dt.timedelta(days=150),
                     status="active", payment_status="paid")
    upsert_contract(cur, "DOG-2026-0002", s2, parent1, academic["course_eng"], b1,
                     3200, TODAY - dt.timedelta(days=10), TODAY + dt.timedelta(days=15),
                     status="active", payment_status="unpaid")
    upsert_contract(cur, "DOG-2026-0003", s3, parent2, academic["course_phys"],
                     users["_branch2"], 5000, TODAY - dt.timedelta(days=200),
                     TODAY - dt.timedelta(days=20), status="completed", payment_status="paid")

    cur.close()


# --------------------------------------------------------------------------
# CRM Service
# --------------------------------------------------------------------------

def upsert_application(cur, name, age, phone, subject_interest, source, status,
                        parent_name=None, student_id=None, fmt=None, branch_id=None, handled_by=None):
    cur.execute(
        "SELECT id FROM applications WHERE name = %s AND phone = %s AND subject_interest = %s",
        (name, phone, subject_interest),
    )
    row = cur.fetchone()
    if row:
        return row[0]
    cur.execute(
        """INSERT INTO applications (source, status, name, age, phone, subject_interest,
                                      parent_name, student_id, format, branch_id, handled_by)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
        (source, status, name, age, phone, subject_interest, parent_name, student_id,
         fmt, branch_id, handled_by),
    )
    return cur.fetchone()[0]


def seed_crm(conn, users):
    cur = conn.cursor()
    b1 = users["_branch1"]
    owner_id = users["owner"]["id"]
    parent1 = users["parent1"]["id"]
    student2 = users["student2"]["id"]

    # заявки с сайта (webhook Tilda) — ещё не обработаны
    upsert_application(cur, "Кирилл Д.", 7, "+79170000011", "Английский с нуля",
                        "tilda", "new", parent_name="Елена Д.", branch_id=b1)
    upsert_application(cur, "Мария С.", 12, "+79170000012", "Подготовка к ОГЭ по русскому",
                        "tilda", "in_progress", parent_name="Светлана С.", branch_id=b1)
    upsert_application(cur, "Никита В.", 15, "+79170000013", "Программирование Python",
                        "tilda", "converted", parent_name="Игорь В.", branch_id=b1, handled_by=owner_id)
    upsert_application(cur, "Анна Р.", 9, "+79170000014", "Рисование",
                        "tilda", "rejected", parent_name="Ольга Р.", branch_id=b1, handled_by=owner_id)

    # внутренняя заявка от родителя из ЛК ("Записаться на новый курс")
    upsert_application(cur, "Смирнова Ольга", None, None, "Физика", "internal", "new",
                        student_id=student2, fmt="group", branch_id=b1)

    cur.close()


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def main():
    conn_users = connect(DSN_USERS, "user-service DB")
    conn_academic = connect(DSN_ACADEMIC, "academic-service DB")
    conn_contracts = connect(DSN_CONTRACTS, "contracts-service DB")
    conn_crm = connect(DSN_CRM, "crm-service DB")

    print("\n== Users Service: филиалы, пользователи, профили, связи parent-student ==")
    users = seed_users(conn_users)

    print("\n== Зеркалирование user_refs в academic/contracts/crm ==")
    mirror_user_refs(conn_academic, users)
    mirror_user_refs(conn_contracts, users)
    mirror_user_refs(conn_crm, users)

    print("\n== Academic Service: курсы, преподаватели, записи, занятия, ДЗ ==")
    academic = seed_academic(conn_academic, users)

    print("\n== Contracts Service: договоры ==")
    seed_contracts(conn_contracts, users, academic)

    print("\n== CRM Service: заявки ==")
    seed_crm(conn_crm, users)

    for c in (conn_users, conn_academic, conn_contracts, conn_crm):
        c.close()

    print("\nГотово! Тестовые аккаунты (пароль для всех: {}):".format(TEST_PASSWORD))
    print("-" * 70)
    for key, data in users.items():
        if key.startswith("_"):
            continue
        print(f"  {data['role']:<13} {data['email']:<28} {data['last_name']} {data['first_name']}")
    print("-" * 70)


if __name__ == "__main__":
    main()
