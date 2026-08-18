#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Скрипт наполнения Study Room тестовыми данными по заданным цифрам:

    3 филиала, 1 owner (руководитель), 4 branch_owner (владельцы филиалов),
    5 tutor (учителя), 5 student (ученики), 12 parent (родители).

У КАЖДОГО ученика создаются:
    - курс + запись на курс (enrollment) к "своему" преподавателю;
    - 2 ПРОЙДЕННЫХ занятия (status='completed', даты в прошлом) с отметкой
      посещаемости (present/absent);
    - 1 ЗАПЛАНИРОВАННОЕ занятие (status='scheduled', дата в будущем);
    - 2 домашних задания (одно уже открытое учеником — status='viewed',
      второе только выданное — status='assigned').

Написан по образцу seed_studyroom.py / seed_studyroom2.py / seed_studyroom3.py /
seed_studyroom4.py из этого же репозитория и следует тем же принципам:

  1. Подключается напрямую к postgres-базам Users и Academic Service —
     портам, проброшенным наружу в docker-compose.yml (5433 / 5435).
  2. Owner и branch_owner создаются в обход API напрямую в БД, т.к. по
     api-contracts.md самостоятельная регистрация с этими ролями невозможна
     (единственный публичный self-signup — POST /auth/register для parent).
  3. Каждого созданного пользователя зеркалирует в user_refs Academic
     Service — в норме это делает событие user.created по NATS, но при
     прямой вставке в БД событие не публикуется, поэтому дублируем вручную
     (см. подробное объяснение в шапке seed_studyroom3.py/seed_studyroom4.py).
  4. Владельцев филиалов (branch_owner) — 4 штуки на 3 филиала: у главного
     филиала два совладельца, у остальных двух — по одному.
  5. 12 родителей распределены между 5 учениками неравномерно (3/3/2/2/2),
     чтобы у каждого ученика было больше одного привязанного родителя —
     полностью соответствует условию "12 родителей, подвязанных" без
     "повисших" в воздухе записей.

Скрипт НЕ трогает Contracts/CRM Service — только Users + Academic, как и
просили (пользователи, филиалы, курсы, занятия, ДЗ). Договоры/заявки можно
добавить по образцу seed_studyroom.py (seed_contracts/seed_crm), если
понадобится.

Запуск:
  pip install psycopg2-binary bcrypt
  docker compose up -d postgres-users user-service postgres-academic academic-service
  python3 seed_studyroom5.py

Скрипт идемпотентен: повторный запуск не создаёт дублей (email уникален,
для остальных сущностей — проверка по естественному ключу / ON CONFLICT).

Все тестовые аккаунты получают пароль:  Test1234!
"""

import datetime as dt
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
# Подключения. Порты соответствуют docker-compose.yml, можно переопределить
# через переменные окружения, если сервисы подняты иначе.
# --------------------------------------------------------------------------
DSN_USERS = os.environ.get(
    "USERS_DSN", "postgresql://user_service:devpassword123@localhost:5433/study_room_users"
)
DSN_ACADEMIC = os.environ.get(
    "ACADEMIC_DSN", "postgresql://academic_service:devpassword123@localhost:5435/study_room_academic"
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
# Генератор тестовых ФИО — чтобы не плодить однотипных "Иванов Иванов".
# 27 человек нужно (1+4+5+5+12) — пул на 40 имён с запасом.
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
    pool = []
    for i in range(20):
        pool.append((FIRST_NAMES_M[i], LAST_NAME_STEMS[i], PATRONYMIC_M[i]))
        f_stem = LAST_NAME_STEMS[(i + 7) % 20]
        pool.append((FIRST_NAMES_F[i], _feminine_surname(f_stem), PATRONYMIC_F[i]))
    return pool


NAME_POOL = _build_name_pool()
_name_cursor = 0


def next_name():
    global _name_cursor
    name = NAME_POOL[_name_cursor % len(NAME_POOL)]
    _name_cursor += 1
    return name  # (first_name, last_name, patronymic)


CLASSES = ["3А", "5Б", "7В", "9А", "11Б"]
SCHOOLS = ["Школа №1", "Школа №5", "Гимназия №3", "Лицей №8", "Школа №12"]


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


# Подобрано так, чтобы 5 предметов = 5 tutor'ов, каждый предмет привязан к
# "своему" филиалу (branch_index: 0/1/2), т.к. учителя и ученики этого
# филиала учатся именно по нему.
TUTOR_SPECS = [
    # (subject,                 branch_index, experience, rating, status)
    ("Математика, ЕГЭ",         0, 6,  4.8, "active"),
    ("Английский язык",         0, 3,  4.6, "active"),
    ("Физика",                  1, 8,  4.9, "active"),
    ("Русский язык, ОГЭ",       1, 5,  4.7, "vacation"),
    ("Химия",                   2, 4,  4.5, "active"),
]

STUDENT_SPECS = [
    # (tutor_index, class, school, avg_grade, attendance_pct, n_parents)
    (0, CLASSES[0], SCHOOLS[0], 4.7, 95.0, 3),
    (1, CLASSES[1], SCHOOLS[0], 4.2, 88.5, 3),
    (2, CLASSES[2], SCHOOLS[1], 4.9, 97.0, 2),
    (3, CLASSES[3], SCHOOLS[2], 3.9, 80.0, 2),
    (4, CLASSES[4], SCHOOLS[3], 4.4, 91.5, 2),
]


def seed_users(conn):
    cur = conn.cursor()

    branches = [
        upsert_branch(cur, "Саратов - Центр", "Саратов", "ул. Московская, 10", "+78452000001"),
        upsert_branch(cur, "Энгельс", "Энгельс", "пр. Ленина, 5", "+78453000002"),
        upsert_branch(cur, "Балаково", "Балаково", "ул. Свердлова, 22", "+78453500003"),
    ]

    users = {}
    phone_seq = [1]

    def next_phone():
        n = phone_seq[0]
        phone_seq[0] += 1
        return f"+7900000{n:04d}"

    def u(key, role, branch_id):
        first, last, patronymic = next_name()
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

    # --- 1 owner (руководитель, без привязки к филиалу) ---
    u("owner", "owner", None)

    # --- 4 branch_owner на 3 филиала: у главного (branch[0]) два
    #     совладельца, у остальных двух — по одному ---
    u("branch_owner1", "branch_owner", branches[0])
    u("branch_owner2", "branch_owner", branches[0])
    u("branch_owner3", "branch_owner", branches[1])
    u("branch_owner4", "branch_owner", branches[2])

    # --- 5 tutor ---
    tutor_ids = []
    for i, (subject, br_idx, exp, rating, status) in enumerate(TUTOR_SPECS, start=1):
        tid = u(f"tutor{i}", "tutor", branches[br_idx])
        upsert_tutor_profile(cur, tid, subject, exp, rating, status)
        tutor_ids.append(tid)

    # --- 12 parent, привязка выполняется вместе со студентами ниже ---
    parent_ids = []
    for i in range(1, 13):
        pid = u(f"parent{i}", "parent", None)
        parent_ids.append(pid)

    # --- 5 student, каждый — в филиале своего tutor'а; на каждого
    #     "вешаем" несколько родителей (3/3/2/2/2 = 12) ---
    student_ids = []
    parent_cursor = 0
    for i, (tutor_idx, class_info, school, avg_grade, att_pct, n_parents) in enumerate(
        STUDENT_SPECS, start=1
    ):
        branch_id = users[f"tutor{tutor_idx + 1}"]["branch_id"]
        sid = u(f"student{i}", "student", branch_id)
        upsert_student_profile(cur, sid, class_info, school, avg_grade, att_pct)
        for _ in range(n_parents):
            link_parent_student(cur, parent_ids[parent_cursor], sid)
            parent_cursor += 1
        student_ids.append(sid)

    cur.close()
    users["_branches"] = branches
    users["_tutor_ids"] = tutor_ids
    users["_student_ids"] = student_ids
    users["_parent_ids"] = parent_ids
    return users


# --------------------------------------------------------------------------
# Зеркалирование в user_refs Academic Service (обычно приходит по NATS
# событием user.created/user.updated; при прямой вставке в БД событие не
# публикуется, поэтому дублируем сами).
# --------------------------------------------------------------------------

def mirror_user_refs(conn, users):
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
    print(f"[ok] user_refs (academic-service) обновлён для {count} пользователь(ей)")


# --------------------------------------------------------------------------
# Academic Service: курсы, преподаватели, записи, занятия, посещаемость, ДЗ
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
         TODAY - dt.timedelta(days=45), TODAY + dt.timedelta(days=135)),
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


# Темы для 2 пройденных + 1 запланированного занятия на каждый предмет,
# и 2 ссылки на ДЗ (по числу учеников/предметов).
LESSON_TOPICS = {
    "Математика, ЕГЭ": ["Алгебра - Функции", "Уравнения и неравенства", "Геометрия - Стереометрия"],
    "Английский язык": ["Present Perfect vs Past Simple", "Топик: Travelling", "Modal Verbs"],
    "Физика": ["Механика - Кинематика", "Динамика - Законы Ньютона", "Электричество - Закон Ома"],
    "Русский язык, ОГЭ": ["Сочинение-рассуждение 9.3", "Синтаксис сложного предложения", "Пробный вариант ОГЭ №1"],
    "Химия": ["Периодический закон", "Химические связи", "Окислительно-восстановительные реакции"],
}

HW_LINKS = {
    "Математика, ЕГЭ": "https://example.com/hw/math",
    "Английский язык": "https://example.com/hw/english",
    "Физика": "https://example.com/hw/physics",
    "Русский язык, ОГЭ": "https://example.com/hw/russian",
    "Химия": "https://example.com/hw/chemistry",
}


def seed_academic(conn, users):
    cur = conn.cursor()
    branches = users["_branches"]

    for i, (student_key, (tutor_idx, *_rest)) in enumerate(
        zip((f"student{i}" for i in range(1, 6)), STUDENT_SPECS), start=1
    ):
        subject, br_idx, *_ = TUTOR_SPECS[tutor_idx]
        tutor_id = users[f"tutor{tutor_idx + 1}"]["id"]
        student_id = users[student_key]["id"]
        branch_id = branches[br_idx]
        topics = LESSON_TOPICS[subject]

        course_id = upsert_course(
            cur, f"{subject} - индивидуальные занятия", subject, "individual",
            f"Индивидуальная подготовка по предмету «{subject}»", branch_id,
        )
        assign_course_tutor(cur, course_id, tutor_id)
        upsert_enrollment(cur, student_id, course_id, tutor_id, progress_pct=30 + i * 8, status="active")

        # 2 ПРОЙДЕННЫХ занятия (в прошлом), с посещаемостью
        l1 = upsert_lesson(
            cur, course_id, tutor_id, tutor_id, topics[0],
            TODAY - dt.timedelta(days=10), "16:00", "17:30",
            "remote", "individual", "completed", "Занятие прошло по плану", [student_id],
        )
        upsert_attendance(cur, l1, student_id, "present")

        l2 = upsert_lesson(
            cur, course_id, tutor_id, tutor_id, topics[1],
            TODAY - dt.timedelta(days=4), "16:00", "17:30",
            "onsite", "individual", "completed",
            "Разобрали домашние ошибки" if i % 2 == 0 else None, [student_id],
        )
        # для разнообразия одно занятие пропущено
        upsert_attendance(
            cur, l2, student_id, "absent" if i == 2 else "present",
            "По болезни (справка предоставлена)" if i == 2 else None,
        )

        # 1 ЗАПЛАНИРОВАННОЕ занятие (в будущем)
        upsert_lesson(
            cur, course_id, tutor_id, tutor_id, topics[2],
            TODAY + dt.timedelta(days=2 + i), "17:00", "18:30",
            "remote", "individual", "scheduled", None, [student_id],
        )

        # 2 домашних задания: одно уже открыто учеником, второе только выдано
        base_link = HW_LINKS[subject]
        upsert_homework(
            cur, student_id, tutor_id, f"{base_link}-1", "viewed",
            dt.datetime.now() - dt.timedelta(hours=6 + i),
        )
        upsert_homework(cur, student_id, tutor_id, f"{base_link}-2", "assigned")

    cur.close()


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def main():
    conn_users = connect(DSN_USERS, "user-service DB")
    conn_academic = connect(DSN_ACADEMIC, "academic-service DB")

    print("\n== Users Service: 3 филиала, 1 owner, 4 branch_owner, "
          "5 tutor, 12 parent, 5 student ==")
    users = seed_users(conn_users)
    conn_users.close()

    print("\n== Зеркалирование user_refs в academic-service ==")
    mirror_user_refs(conn_academic, users)

    print("\n== Academic Service: курсы, занятия (пройденные + запланированные), ДЗ ==")
    seed_academic(conn_academic, users)
    conn_academic.close()

    role_order = {"owner": 0, "branch_owner": 1, "tutor": 2, "parent": 3, "student": 4}
    people = [d for k, d in users.items() if not k.startswith("_")]
    people.sort(key=lambda d: (role_order[d["role"]], d["email"]))

    print("\nГотово! Тестовые аккаунты (пароль для всех: {}):".format(TEST_PASSWORD))
    print("-" * 70)
    for data in people:
        print(f"  {data['role']:<13} {data['email']:<28} {data['last_name']} {data['first_name']}")
    print("-" * 70)
    print("Всего: {} пользователь(ей) "
          "(1 owner, 4 branch_owner, 5 tutor, 12 parent, 5 student)".format(len(people)))
    print("У каждого student: 1 курс/enrollment, 2 пройденных занятия, "
          "1 запланированное занятие, 2 ДЗ.")


if __name__ == "__main__":
    main()
