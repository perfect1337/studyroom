// Моковые данные для демонстрации интерфейса.
// В боевой версии эти объекты заменяются результатами вызовов API (см. ТЗ, раздел 9).

export const currentStudent = {
  id: 105932,
  name: "Алексей",
  fullName: "Алексей Смирнов",
  classInfo: "Ученик 11-А класса | Физико-математический профиль",
  avatarUrl:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuCbxX-aNUwCfePni5ogdNDnXiwnKg9yy-bcYkYq-qzDCIyzeFOdwEFpfSOYkh5vrIxxZhLh-mwaJhKaw_VoOrf0Msf8Z-NejAXtEpSWsZhjd4-eyLz5szQouRyWApRCFdJqvwTowX5NZe-Rx5K25KR2aN6yG60ILkETKfFHQgFnsYyWtMJ-2xAscJUP5XU-v7u4yfi53xRYXyeu5KGUfE_vQJcLYddofmVYBaaqiEpU2R2M6BTyXmasGI3wLaz9iG-ThSWnUqcO5GY",
  subjects: [
    { name: "Математика", grade: "4.8 / 5", attendance: "4.8 / 5" },
    { name: "Английский язык", grade: "4.5 / 5", attendance: "4.5 / 5" },
  ],
  courses: [
    {
      id: "math-ege",
      icon: "calculate",
      accent: "primary",
      hoursPerWeek: "2ч / нед",
      title: "Математика - Подготовка к ЕГЭ",
      description: "Профильный уровень. Разбор сложных задач второй части.",
      teacher: "Иванов И.И.",
      nextLesson: "Завтра, 16:00",
    },
    {
      id: "english-b2",
      icon: "language",
      accent: "secondary",
      hoursPerWeek: "3ч / нед",
      title: "Английский язык (B2)",
      description: "Практика разговорной речи и подготовка к IELTS.",
      teacher: "Смирнова А.В.",
      nextLesson: "Пт, 18:00",
    },
  ],
  homework: [
    {
      id: "hw-1",
      icon: "edit_document",
      status: "in_progress",
      title: "Эссе по литературе",
      subtitle: "Тема: Образ Обломова",
      dueLabel: "Сдать через 1 день",
    },
    {
      id: "hw-2",
      icon: "warning",
      status: "overdue",
      title: "Тест по физике",
      subtitle: "Кинематика",
      dueLabel: "Сдать через 5 часов",
    },
    {
      id: "hw-3",
      icon: "check_circle",
      status: "submitted",
      title: "Уравнения по математике",
      subtitle: "Вариант 5",
      dueLabel: "Сдать через 4 дня",
    },
  ],
};

export const currentTutor = {
  id: "TUT-55291",
  name: "Иван Петров",
  avatarUrl:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuDV-Mg8037pzJUsMpN67TSCQY1yzt0FSyKQbnVOqEWU0AsWwukKsMfk7RicKxZDolCBXh7yoXvSQZ-TirYG-ExLxue90VSzj7UYwGpdQLVIwApRI5aYuQmx9K7Dllz4ApYzoOfVPPZeLrMw-0YClDGL4rXtKOESoeIUG5_AWVisSF8k0CCoFaJwp-hWMBdBPbnos1cNyMgbnjcUDvx2-KFjxjEFWl5g380jaWJBCtvMvBqOjR5fURk80U5ciHIU9uVkgYi2o57g1zo",
  todaySchedule: [
    {
      id: "l-1",
      time: "10:00",
      endTime: "11:30",
      subject: "Математика",
      statusTag: "Прошедшее",
      title: "Алгебра - Функции",
      isPast: true,
      absentStudent: "Михаил Иванов",
      absentReason: "По болезни (справка предоставлена)",
    },
    {
      id: "l-2",
      time: "15:00",
      endTime: "16:30",
      subject: "Математика",
      statusTag: "Групповое / Дистанционно",
      title: "Подготовка к ОГЭ - Алгебра",
      participants: "Группа 10-А (5 учеников)",
    },
    {
      id: "l-3",
      time: "17:00",
      endTime: "18:00",
      subject: "Физика",
      statusTag: "Индивидуально / Очно",
      title: "Кинематика - Повторение",
      participants: "Анна Смирнова",
      isLast: true,
    },
  ],
  students: [
    { id: "st-1", initials: "АС", name: "Анна Смирнова", subject: "Физика", progress: 85 },
    { id: "st-2", initials: "МИ", name: "Михаил Иванов", subject: "Математика", progress: 40 },
  ],
};

export const currentParent = {
  id: 482910,
  name: "Елена Смирнова",
  email: "elena.smirnova@example.com",
  childrenCount: 2,
  avatarUrl:
    "https://lh3.googleusercontent.com/aida-public/AB6AXuBQvVsFBdktvyBuUKxakF0Tjr7BSdTxJevIfGqM7RIUsS7HutyG3vhuZcem-kEKUdLpJ1skNCE38hRx0XeY5yOxQOWwC-dN99csUAJhtRVK7-HqAUSeA5XTYUs2uqc9jFeq6Ack21ny4ITrWKJJ7bNKQLfbBbGZuKm-lQh4KtxkKhukcz2DqX8WlLCJ7AspJO7a1nVf7w_4UrlUMwGN4ortMOWNZs47RsPcWMa2o2dKhmg9g0TMvC9y_kqXWlKD3dshmw0dCT64vDU",
  children: [
    {
      id: "4588201",
      name: "Алексей Смирнов",
      classInfo: "4 Класс, Школа №1502",
      avatarUrl:
        "https://lh3.googleusercontent.com/aida-public/AB6AXuAbhvu1xfKma70jSne1Vp1BrkbCIIbICHds7StoOUFepXFtD1HR9sZH16osJtTZOMWgyk5AuyEg8R97AGnLMzK-tC2aMo7n16UiYwRWzaqotUY6RY7OshGfUG411Sn0ZcXzH_poKwY7mfzO0eCPwtRfdKrb41q4MB6zK9bnqZVqN-0cSi10aIVC249uBpOumiQNhZx70_gVNdp2iTUoT3ItbmoUWQO2k0GWcE6eNq55_-zFXSagBbhXUxl4LsKm7zD5XXbRxX5MmWg",
      photoUrl:
        "https://lh3.googleusercontent.com/aida-public/AB6AXuB17p5pxK-VJGlr4FOb7_nGJECreIyvh00ANYm4PhO5_IuDB8Q4PyfRg9_hFS0iYqGQiwpzfpQjpvzb82B1Fu3fxiA9lXtQdd44MJBWiW8nSKp6_whNCXpInZw2u5G8htcBXR16ZFYJ6XuONYpdLW_I4PZw3xRL7nsvFWF2aqTjauLIWmRjPVV7PU5ShE7SS1_sn4JVEGSVQKbzAAVmwUC4fg5d6jMEhGnGGcsCuMVGTlxOQK5kIrTXnD8_-BbiDpgN1Ci9oEa1Fqk",
      performance: "4.8/5",
      attendance: "98%",
      performancePct: 92,
      attendancePct: 95,
      courseTags: ["Математика - Подготовка к ЕГЭ", "Английский язык"],
      teachers: [
        { name: "Иван Петров", subject: "Математика" },
        { name: "Анна Смирнова", subject: "Английский язык" },
      ],
      courses: [
        {
          id: "olymp-math",
          icon: "calculate",
          title: "Олимпиадная Математика",
          teacher: "И. С. Петров",
          progress: 75,
          status: "Активен",
        },
        {
          id: "english-b1",
          icon: "language",
          title: "Английский язык (Level B1)",
          teacher: "Mary Poppins",
          progress: 40,
          status: "Активен",
        },
      ],
      homeworkTable: [
        {
          subject: "Математика",
          icon: "calculate",
          title: "Задачи на логику №45-52, подготовка к тесту",
          status: "В процессе",
          statusColor: "orange",
          due: "08.06.2024",
        },
        {
          subject: "Английский",
          icon: "language",
          title: "Present Perfect vs Past Simple Exercise Book",
          status: "Выполнено",
          statusColor: "green",
          due: "05.06.2024",
        },
        {
          subject: "Математика",
          icon: "calculate",
          title: "Геометрические фигуры: построение проекций",
          status: "Просрочено",
          statusColor: "error",
          due: "01.06.2024",
        },
      ],
      calendarMonth: "Июнь 2024",
      calendarDays: [
        { day: 27, muted: true },
        { day: 28, muted: true },
        { day: 29, muted: true },
        { day: 30, muted: true },
        { day: 31, muted: true },
        { day: 1 },
        { day: 2 },
        { day: 3, dot: "primary" },
        { day: 4 },
        { day: 5, dot: "secondary" },
        { day: 6, active: true },
        { day: 7 },
        { day: 8 },
        { day: 9 },
      ],
      dailySchedule: [
        { date: "06", title: "16:00 - Математика (И. С. Петров)", location: "Вебинар в Zoom", accent: "primary" },
        { date: "07", title: "14:30 - Английский (Mary Poppins)", location: "Класс №304", accent: "secondary" },
      ],
    },
  ],
  upcomingLessons: [
    { id: "up-1", title: "Математика (Алексей)", time: "Завтра, 15:00 - 16:30" },
    { id: "up-2", title: "Английский язык (Алексей)", time: "Пятница, 17:00 - 18:00" },
  ],
  contracts: [
    {
      id: "284-M",
      subject: "Математика (Алексей)",
      period: "15.01.2024 — 15.06.2024",
      amount: "4 500 ₽",
      status: "Активен",
    },
    {
      id: "112-A",
      subject: "Английский язык (Алексей)",
      period: "01.02.2024 — 01.07.2024",
      amount: "3 800 ₽",
      status: "Активен",
    },
  ],
  notificationSettings: { email: true, sms: false, messenger: true },
};

export const adminOverview = {
  admin: { name: "Администратор" },
  stats: [
    { label: "Всего учеников", value: "1,248", icon: "school" },
    { label: "Активных учителей", value: "84", icon: "person_pin" },
    { label: "Выручка (мес.)", value: "₽4.2M", icon: "trending_up" },
    { label: "Заявки на обучение", value: "24", icon: "assignment_ind" },
  ],
  tutors: [
    { id: "T-4402", initials: "ИВ", name: "Игорь Волков", specialty: "Математика, ЕГЭ", status: "Активен" },
    { id: "T-3921", initials: "АС", name: "Анна Степанова", specialty: "Английский, IELTS", status: "В отпуске" },
    { id: "T-5011", initials: "ДП", name: "Дмитрий Петров", specialty: "Информатика, Python", status: "На больничном" },
  ],
  applications: [
    { id: "app-1", name: "Кирилл Д.", age: 7, course: "Английский с нуля", timeAgo: "10 мин назад", parent: "Елена Д." },
    { id: "app-2", name: "Софья Р.", age: 15, course: "Подготовка к ОГЭ (Матем)", timeAgo: "1 час назад", parent: "Игорь Р." },
  ],
};

export const adminStudentsPage = {
  stats: [
    { label: "Всего учеников", value: "1,284", trend: "+12%" },
    { label: "Всего учителей", value: "48", trend: "Стабильно" },
    { label: "Ср. успеваемость", value: "4.2", stars: 4 },
    { label: "Активные курсы", value: "15" },
  ],
  students: [
    { id: 10293, initials: "АС", name: "Александр Смирнов", courses: ["Python Basics", "Web Design"], contractPeriod: "01.09.23 — 31.05.24", attendance: "96%", avgGrade: "4.8", status: "Активен" },
    { id: 10452, initials: "МП", name: "Мария Петрова", courses: ["History"], contractPeriod: "15.01.24 — 15.07.24", attendance: "88%", avgGrade: "3.9", status: "Активен" },
    { id: 10118, initials: "ДК", name: "Дарья Ковалёва", courses: ["Математика - ЕГЭ"], contractPeriod: "01.10.23 — 30.06.24", attendance: "72%", avgGrade: "3.4", status: "Риск" },
    { id: 10577, initials: "НС", name: "Никита Соколов", courses: ["Английский B2", "IELTS"], contractPeriod: "01.11.23 — 01.11.24", attendance: "94%", avgGrade: "4.5", status: "Активен" },
  ],
  teachers: [
    {
      id: "t1",
      name: "Дмитрий Волков",
      specialty: "Старший разработчик / Python",
      status: "Активен",
      statusColor: "green",
      students: 24,
      experience: "8 лет",
      rating: "4.9",
      avatarUrl:
        "https://lh3.googleusercontent.com/aida-public/AB6AXuDQlhflvE7SnmeD-LvWTcw-NQyLm5PF6jwO02WrYZv3YO6oxI9bhQnYxwmg1AAmzQR37-hPyJwpKpukCCW-qcSqbpQdsPmPCe9a_okoYRr3rqMI40Zf_pKEuFfrNvtJ2yizmAemPkJl9yGWgCj__Ty9uWCCITmg_6Eeom4xbaeQkqEl0TUOnwVzY9nsZoHOb8dD-4CET0GYew07PTPCUwyGdpcSrPVjH3s73MRgEVgrg2oDJ8SJ6D6ipBiUrLzdzu7323EJViUQq14",
    },
    {
      id: "t2",
      name: "Анна Кузнецова",
      specialty: "Искусство и Дизайн",
      status: "В отпуске",
      statusColor: "amber",
      students: 18,
      experience: "5 лет",
      rating: "4.7",
      avatarUrl:
        "https://lh3.googleusercontent.com/aida-public/AB6AXuCYDmv66j1EmdNBh-6Bxa3PL_mUcBeUe6ndMYHqDt3ecxXtZ8uDxGgWK9rhMQ0FYM8q2g_j1uJHUTgr7GZFcEvayOfz7dQjJQdclyK7D7ChTRD8blF-AtniAXeUvYiTQXD5P3-5Bv-Oi7YyFeDtTImoUiaGnGvhH4hh0b99fFg8-R_JjZCo0XosiGWactxY2d8wWoYbimKb9oc9fQke2u4dxxr9Sos7He3YLINfTAbe9R9tMwUwv16eNcDJuioMSZ54SqNjCb9_MaA",
    },
    {
      id: "t3",
      name: "Сергей Орлов",
      specialty: "История и Философия",
      status: "На больничном",
      statusColor: "red",
      students: 32,
      experience: "20 лет",
      rating: "5.0",
      avatarUrl:
        "https://lh3.googleusercontent.com/aida-public/AB6AXuBwUqZmib4zqhagb1NtyjqvueRa8UxGdc6Cys9Y6F-KrCPTIYAotOEgR2awiUuZifVmhNk3yZn5cb1YJq5CpVTvKwKsyAkoaKjZNw4zCKDxFhEAKIQrIMT0tOjD2DMOV5nAyADGbzwVQFMtsqAp04qvUyM-R9SH6gGkTqQr9HIEosRyay3o8NrCFSchiJACdpthopI6LJIzawnqpgjwJASz3N4sWaA_sMUS1YpkCIVNlI81XT2IY9-mW5otM1ykNiJFIlfYqw3ma0w",
    },
  ],
};

// Полный список домашних заданий ученика — для страницы /student/homework.
// Первые 3 совпадают с блоком "Домашние задания" на обзоре (currentStudent.homework),
// остальное — история за прошлые недели.
export const studentHomeworkFull = [
  { id: "hw-1", subject: "Литература", icon: "edit_document", title: "Эссе по литературе", subtitle: "Тема: Образ Обломова", status: "В процессе", statusColor: "orange", due: "13.07.2026" },
  { id: "hw-2", subject: "Физика", icon: "warning", title: "Тест по физике", subtitle: "Кинематика", status: "Просрочено", statusColor: "error", due: "12.07.2026" },
  { id: "hw-3", subject: "Математика", icon: "calculate", title: "Уравнения по математике", subtitle: "Вариант 5", status: "Выполнено", statusColor: "green", due: "10.07.2026" },
  { id: "hw-4", subject: "Английский язык", icon: "language", title: "Present Perfect vs Past Simple", subtitle: "Exercise Book, стр. 24-26", status: "Выполнено", statusColor: "green", due: "05.07.2026" },
  { id: "hw-5", subject: "Математика", icon: "calculate", title: "Геометрические фигуры", subtitle: "Построение проекций", status: "Выполнено", statusColor: "green", due: "01.07.2026" },
  { id: "hw-6", subject: "Физика", icon: "science", title: "Лабораторная работа №4", subtitle: "Закон сохранения импульса", status: "Выполнено", statusColor: "green", due: "24.06.2026" },
  { id: "hw-7", subject: "Английский язык", icon: "language", title: "Эссе Opinion Essay", subtitle: "Тема: Technology in education", status: "Выполнено", statusColor: "green", due: "18.06.2026" },
];

// Полный список учеников репетитора — для страницы /tutor/students.
export const tutorStudentsFull = [
  { id: "st-1", initials: "АС", name: "Анна Смирнова", subject: "Физика", parent: "Ольга Смирнова", progress: 85, attendance: "95%", avgGrade: "4.7", contractStatus: "Активен", nextLesson: "Пт, 17:00" },
  { id: "st-2", initials: "МИ", name: "Михаил Иванов", subject: "Математика", parent: "Елена Иванова", progress: 40, attendance: "68%", avgGrade: "3.6", contractStatus: "Риск", nextLesson: "Сегодня, 15:00" },
  { id: "st-3", initials: "ГП", name: "Group 10-А", subject: "Математика (группа)", parent: "5 учеников", progress: 62, attendance: "89%", avgGrade: "4.1", contractStatus: "Активен", nextLesson: "Пн, 15:00" },
  { id: "st-4", initials: "ВК", name: "Виктор Козлов", subject: "Физика", parent: "Наталья Козлова", progress: 78, attendance: "92%", avgGrade: "4.4", contractStatus: "Активен", nextLesson: "Ср, 16:00" },
];

export const adminFinance = {
  totalRevenue: "₽ 1,240,500",
  overdueCount: 6,
  contracts: [
    { student: "Артем Волков", parent: "Елена Волкова (мать)", period: "01.09.23 — 31.05.24", amount: "₽ 85,000", status: "Оплачено" },
    { student: "София Морозова", parent: "Игорь Морозов (отец)", period: "15.01.24 — 15.06.24", amount: "₽ 120,000", status: "Ожидание" },
    { student: "Даниил Петров", parent: "Анна Петрова (мать)", period: "01.09.23 — 31.12.23", amount: "₽ 45,000", status: "Просрочен" },
    { student: "Мария Кузнецова", parent: "Мария Кузнецова", period: "01.02.24 — 01.02.25", amount: "₽ 240,000", status: "Просрочен" },
  ],
  invoices: [
    { number: "INV-2024-089", date: "От 14 Марта, 2024", amount: "₽ 12,500", client: "Дмитрий С." },
    { number: "INV-2024-088", date: "От 12 Марта, 2024", amount: "₽ 8,000", client: "Ольга К." },
    { number: "INV-2024-087", date: "От 10 Марта, 2024", amount: "₽ 15,200", client: "Константин В." },
  ],
};
