// addMinutesToTime — прибавляет minutesToAdd к времени в формате "HH:MM" и
// возвращает результат в том же формате. Используется, чтобы при выборе
// времени начала занятия автоматически подставлять время окончания
// (+105 минут по умолчанию — см. CreateLessonModal/BulkCreateLessonsModal),
// при этом само поле окончания остаётся обычным <input type="time">, так
// что пользователь может его свободно поменять.
//
// Результат ограничен диапазоном одних суток (00:00–23:59) — если сумма
// уходит за полночь, отдаём 23:59, а не время следующего дня, т.к. занятие
// с датой lesson_date не должно "перескакивать" на другие сутки только
// из-за автоподстановки.
export function addMinutesToTime(time, minutesToAdd) {
  if (!time) return time;
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return time;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return time;

  const totalMinutes = Math.min(
    Math.max(hours * 60 + minutes + minutesToAdd, 0),
    23 * 60 + 59
  );
  const hh = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const mm = String(totalMinutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

// Дефолтная длительность занятия для автоподстановки времени окончания.
export const DEFAULT_LESSON_DURATION_MINUTES = 105;
