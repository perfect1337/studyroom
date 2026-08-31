package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"studyroom/academic-service/internal/app"
	"studyroom/academic-service/internal/auth"
	"studyroom/academic-service/internal/config"
	"studyroom/academic-service/internal/db"
	"studyroom/academic-service/internal/events"
	"studyroom/academic-service/internal/migrate"
)

func main() {
	ctx := context.Background()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config error: %v", err)
	}

	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db connection error: %v", err)
	}
	defer pool.Close()

	// Миграции применяются автоматически при каждом старте контейнера.
	if err := migrate.Run(ctx, pool); err != nil {
		log.Fatalf("migration error: %v", err)
	}
	log.Println("migrations up to date")

	tm := auth.NewTokenManager(cfg.JWTSecret)
	deps := app.NewDeps(pool, tm, cfg.UserServiceURL, events.NoopPublisher{})

	// Публикатор событий (lesson.created, attendance.marked_absent) и
	// подписчик (user.*, contract.created) — оба через один NATS-коннекшн.
	// Если NATS не сконфигурирован, сервис всё равно поднимается и
	// работает через HTTP API — просто без событий (тот же паттерн, что в
	// user-service и notification-service).
	if cfg.NATSURL != "" {
		nc, err := events.Connect(cfg.NATSURL)
		if err != nil {
			log.Printf("events: could not connect to NATS at %s: %v (continuing without events)", cfg.NATSURL, err)
		} else {
			defer nc.Close()
			deps.Events = events.NewNATSPublisher(nc)

			sub := events.NewSubscriber(nc, deps.UserRefs, deps.Enrollments, deps.Courses, deps.Lessons, deps.Homework, deps.Tests, deps.Subgroups)
			if err := sub.Start(ctx); err != nil {
				log.Printf("events: subscribe failed: %v", err)
			}
		}
	} else {
		log.Println("events: NATS_URL not set, skipping event subscription")
	}

	r := app.NewRouter(deps)
	srv := app.NewServer(":"+cfg.Port, r)

	stopAutoComplete := startAutoCompleteJob(ctx, deps)
	defer stopAutoComplete()

	stopDailyDigest := startDailyDigestJob(ctx, deps)
	defer stopDailyDigest()

	go func() {
		log.Printf("academic-service listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	// Graceful shutdown — чтобы docker compose down не рвал соединения грубо.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	log.Println("shutting down...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(shutdownCtx)
}

// autoCompleteInterval — как часто фоновая джоба проверяет, не закончились
// ли по времени ещё не отменённые занятия. Раз в минуту — занятие не должно
// висеть "запланированным" (и не учитываться в прогрессе) дольше минуты
// после фактического окончания, но и не создаёт заметной нагрузки на БД
// при масштабе этого проекта.
const autoCompleteInterval = time.Minute

// startAutoCompleteJob — фоновая замена ручной кнопки "Отметить проведённым":
// раз в минуту переводит в status='completed' все занятия, которые уже
// закончились по дате/времени (см. LessonRepository.AutoCompletePast) и не
// были отменены, и пересчитывает progress_pct задетых пар ученик/курс (см.
// EnrollmentRepository.RecalculateProgress) — именно так прогресс из задачи
// "4 занятия, 1 прошло → 25%" двигается сам, без действий тьютора.
func startAutoCompleteJob(ctx context.Context, deps *app.Deps) func() {
	ticker := time.NewTicker(autoCompleteInterval)
	done := make(chan struct{})

	run := func() {
		pairs, err := deps.Lessons.AutoCompletePast(ctx)
		if err != nil {
			log.Printf("[auto-complete-job] AutoCompletePast error: %v", err)
			return
		}
		for _, p := range pairs {
			if _, err := deps.Enrollments.RecalculateProgress(ctx, p.StudentID, p.CourseID); err != nil {
				log.Printf("[auto-complete-job] recalc progress student=%d course=%d error: %v", p.StudentID, p.CourseID, err)
			}
		}
		if len(pairs) > 0 {
			log.Printf("[auto-complete-job] auto-completed lessons, recalculated progress for %d student/course pair(s)", len(pairs))
		}
	}

	go func() {
		run()
		for {
			select {
			case <-ticker.C:
				run()
			case <-done:
				return
			}
		}
	}()

	return func() {
		ticker.Stop()
		close(done)
	}
}

// mskLocation — фиксированный часовой пояс МСК (UTC+3, без перехода на
// летнее время с 2014 года). Используется FixedZone, а не
// time.LoadLocation("Europe/Moscow"), потому что финальный образ
// собирается на alpine (см. Dockerfile) без пакета tzdata — LoadLocation
// там просто упал бы с "unknown time zone". FixedZone работает без базы
// часовых поясов на диске вообще.
var mskLocation = time.FixedZone("MSK", 3*60*60)

// dailyDigestHour — в котором часу по МСК уходит ежедневный дайджест
// занятий на сегодня.
const dailyDigestHour = 9

// startDailyDigestJob — раз в сутки в dailyDigestHour:00 МСК собирает по
// каждому ученику список ещё не отменённых занятий на сегодняшний день (по
// МСК) и публикует по одному событию lesson.daily_digest на ученика — но
// только если у него сегодня есть хотя бы одно занятие (см.
// events.NATSPublisher.DailyLessonsDigest). В отличие от
// startAutoCompleteJob, первый запуск НЕ происходит сразу при старте
// процесса — иначе при каждом перезапуске контейнера (деплой, рестарт)
// дайджест улетал бы в случайное время суток; вместо этого высчитывается
// точное время до ближайших dailyDigestHour:00 МСК и джоба ждёт именно до
// него, а дальше срабатывает каждые 24 часа.
func startDailyDigestJob(ctx context.Context, deps *app.Deps) func() {
	done := make(chan struct{})

	run := func() {
		today := time.Now().In(mskLocation).Format("2006-01-02")
		byStudent, err := deps.Lessons.ListTodayByStudent(ctx, today)
		if err != nil {
			log.Printf("[daily-digest-job] ListTodayByStudent error: %v", err)
			return
		}
		for studentID, items := range byStudent {
			deps.Events.DailyLessonsDigest(studentID, items)
		}
		if len(byStudent) > 0 {
			log.Printf("[daily-digest-job] sent digest for %d student(s)", len(byStudent))
		}
	}

	nextRun := func() time.Duration {
		now := time.Now().In(mskLocation)
		next := time.Date(now.Year(), now.Month(), now.Day(), dailyDigestHour, 0, 0, 0, mskLocation)
		if !next.After(now) {
			next = next.AddDate(0, 0, 1)
		}
		return next.Sub(now)
	}

	go func() {
		for {
			select {
			case <-time.After(nextRun()):
				run()
			case <-done:
				return
			}
		}
	}()

	return func() {
		close(done)
	}
}
