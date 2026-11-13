#!/bin/sh
# One-time MariaDB setup. Run with:  sudo sh setup.sh
# Creates the inkpow database, an app user and a read-only user, and writes
# their passwords to db_config.ini (which git ignores).
set -e
cd "$(dirname "$0")"
APP_PW=$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)
RO_PW=$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)

mariadb <<SQL
CREATE DATABASE IF NOT EXISTS inkpow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'inkpow'@'localhost';
ALTER USER 'inkpow'@'localhost' IDENTIFIED BY '$APP_PW';
GRANT ALL PRIVILEGES ON inkpow.* TO 'inkpow'@'localhost' WITH GRANT OPTION;
CREATE USER IF NOT EXISTS 'inkpow_ro'@'localhost';
ALTER USER 'inkpow_ro'@'localhost' IDENTIFIED BY '$RO_PW';
FLUSH PRIVILEGES;
SQL

cat > db_config.ini <<INI
[database]
host = localhost
name = inkpow
user = inkpow
password = $APP_PW
readonly_user = inkpow_ro
readonly_password = $RO_PW
INI
[ -n "$SUDO_USER" ] && chown "$SUDO_USER" db_config.ini
chmod 600 db_config.ini
echo "MariaDB is ready. Now run: python3 app.py"
