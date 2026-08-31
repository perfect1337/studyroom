# Study Room — Frontend (личные кабинеты)

React + Tailwind реализация 9 экранов из макетов Stitch: логин, регистрация,
кабинет ученика, кабинет репетитора (+форма занятия), кабинет родителя
(+карточка ребёнка), админ-панель (обзор, ученики/преподаватели, финансы).

## Запуск

```bash
npm install
npm run dev
```

Откроется на http://localhost:5173, стартовая страница — /login.

## Структура

```
src/
  components/
    layout/       Sidebar, TopBar, DashboardShell (общая обвязка кабинетов)
    ui/            Icon, StatusBadge, ProgressBar, PlaceholderPage
  pages/
    auth/          LoginPage, RegisterPage
    student/       StudentOverview
    tutor/         TutorOverview, TutorNewLesson
    parent/        ParentOverview, ParentChildDetail
    admin/         AdminOverview, AdminStudents, AdminFinance
  data/
    mockData.js    Все фейковые данные — единая точка замены на вызовы API
  App.jsx          Роутинг (react-router-dom)
```

## Что дальше (интеграция с backend на Go, см. ТЗ)

1. Замените импорты из `src/data/mockData.js` на реальные запросы к API
   (например через fetch/axios + React Query) — структура объектов уже
   соответствует сущностям из раздела 8 ТЗ (users/students/tutors/...).
2. Добавьте авторизацию: JWT-токен, защищённые роуты (redirect на /login,
   если токена нет), проверку роли на каждый маршрут.
3. Страницы, помеченные `PlaceholderPage` в App.jsx — это разделы, которых
   не было в присланных макетах (Курсы ученика, Ученики репетитора,
   Расписание и т.п.). Дизайн под них ещё не готов — рисуйте по аналогии
   с существующими карточками/таблицами, когда будет макет.
4. Sidebar/TopBar унифицированы в один компонент на роль — в исходных
   макетах шапка сайдбара немного отличалась от страницы к странице,
   здесь она приведена к одному консистентному виду для каждой роли.

## Лендинг (mestudyroom64.ru)

Не включён в этот проект — по договорённости остаётся на Tilda без изменений.
