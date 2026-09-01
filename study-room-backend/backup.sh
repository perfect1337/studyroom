#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$SCRIPT_DIR"

TEMP_DIR="/tmp/postgres_backup"

RCLONE_REMOTE="gdrive"
RCLONE_PATH="backups/studyroom"
KEEP_DAYS=30

DATE=$(date "+%Y-%m-%d_%H-%M-%S")
BACKUP_FILE="${TEMP_DIR}/studyroom_backup_${DATE}.tar.gz"
mkdir -p "$TEMP_DIR"

if [ -f "${COMPOSE_DIR}/.env.prod" ]; then
    set -a
    source "${COMPOSE_DIR}/.env.prod"
    set +a
else
    echo "❌ Ошибка: файл .env.prod не найден в ${COMPOSE_DIR}"
    exit 1
fi

cd "$COMPOSE_DIR"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

declare -A SERVICES=(
    ["postgres-users"]="study_room_users user_service USERS_DB_PASSWORD"
    ["postgres-notifications"]="study_room_notifications notification_service NOTIFICATIONS_DB_PASSWORD"
    ["postgres-academic"]="study_room_academic academic_service ACADEMIC_DB_PASSWORD"
    ["postgres-contracts"]="study_room_contracts contracts_service CONTRACTS_DB_PASSWORD"
    ["postgres-crm"]="study_room_crm crm_service CRM_DB_PASSWORD"
)

if ! command -v rclone &> /dev/null; then
    log "❌ Ошибка: rclone не найден."
    exit 1
fi

if ! docker info &> /dev/null; then
    log "❌ Ошибка: Docker не запущен."
    exit 1
fi

log "Начинаю создание дампов всех баз..."

DUMP_DIR="${TEMP_DIR}/dumps_${DATE}"
mkdir -p "$DUMP_DIR"

for service in "${!SERVICES[@]}"; do
    IFS=' ' read -r db_name db_user pass_var <<< "${SERVICES[$service]}"
    password="${!pass_var}"

    log "  Дамп базы $db_name из сервиса $service..."

    docker compose -f docker-compose.prod.yml exec -T "$service" \
        pg_dump -U "$db_user" -d "$db_name" | gzip > "${DUMP_DIR}/${db_name}.sql.gz"

    if [ ${PIPESTATUS[0]} -ne 0 ]; then
        log "  ❌ Ошибка дампа для $db_name"
        exit 1
    fi
    log "  ✅ Дамп ${db_name}.sql.gz создан"
done

log "Упаковка всех дампов в $BACKUP_FILE..."
tar -czf "$BACKUP_FILE" -C "$TEMP_DIR" "dumps_${DATE}"
rm -rf "$DUMP_DIR"
log "Архив создан (размер: $(du -h "$BACKUP_FILE" | cut -f1))"

log "Загрузка архива в облако $RCLONE_REMOTE:$RCLONE_PATH..."
rclone copy "$BACKUP_FILE" "$RCLONE_REMOTE:$RCLONE_PATH/"

if [ $? -eq 0 ]; then
    log "✅ Бэкап успешно загружен"
else
    log "❌ Ошибка загрузки в облако"
    exit 1
fi

if [ "$KEEP_DAYS" -gt 0 ]; then
    log "Удаление бэкапов в облаке старше $KEEP_DAYS дней..."
    rclone delete "$RCLONE_REMOTE:$RCLONE_PATH/" --min-age "${KEEP_DAYS}d"
fi

rm -f "$BACKUP_FILE"
log "✅ Всё готово! Локальный архив удалён."
