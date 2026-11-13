#!/bin/sh
# One-time setup. Run with:  sudo sh setup.sh
# Creates the MariaDB database, three roles and four users with random
# passwords, and writes every setting to .env.local (git ignores it).
# MongoDB needs no setup beyond running: the reset script creates its collections.
set -e
cd "$(dirname "$0")"
pw() { head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20; }
OWNER_PW=$(pw); CUST_PW=$(pw); ADMIN_PW=$(pw); RO_PW=$(pw); SECRET=$(pw)$(pw)

mariadb <<SQL
CREATE DATABASE IF NOT EXISTS inkpow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- owner: builds the schema (DDL). Used by the reset script only.
CREATE USER IF NOT EXISTS 'inkpow'@'localhost';
ALTER USER 'inkpow'@'localhost' IDENTIFIED BY '$OWNER_PW';
GRANT ALL PRIVILEGES ON inkpow.* TO 'inkpow'@'localhost' WITH GRANT OPTION;

-- roles: what each one may do is in db/security.sql
CREATE ROLE IF NOT EXISTS inkpow_customer;
CREATE ROLE IF NOT EXISTS inkpow_admin;
CREATE ROLE IF NOT EXISTS inkpow_readonly;
GRANT inkpow_customer TO 'inkpow'@'localhost' WITH ADMIN OPTION;
GRANT inkpow_admin    TO 'inkpow'@'localhost' WITH ADMIN OPTION;
GRANT inkpow_readonly TO 'inkpow'@'localhost' WITH ADMIN OPTION;

-- one login per role, used by the web app
CREATE USER IF NOT EXISTS 'inkpow_web'@'localhost';
ALTER USER 'inkpow_web'@'localhost' IDENTIFIED BY '$CUST_PW';
GRANT inkpow_customer TO 'inkpow_web'@'localhost';
SET DEFAULT ROLE inkpow_customer FOR 'inkpow_web'@'localhost';

CREATE USER IF NOT EXISTS 'inkpow_staff'@'localhost';
ALTER USER 'inkpow_staff'@'localhost' IDENTIFIED BY '$ADMIN_PW';
GRANT inkpow_admin TO 'inkpow_staff'@'localhost';
SET DEFAULT ROLE inkpow_admin FOR 'inkpow_staff'@'localhost';

CREATE USER IF NOT EXISTS 'inkpow_ro'@'localhost';
ALTER USER 'inkpow_ro'@'localhost' IDENTIFIED BY '$RO_PW';
GRANT inkpow_readonly TO 'inkpow_ro'@'localhost';
SET DEFAULT ROLE inkpow_readonly FOR 'inkpow_ro'@'localhost';
FLUSH PRIVILEGES;
SQL

cat > .env.local <<ENV
# MariaDB (MySQL compatible)
DB_HOST=localhost
DB_PORT=3306
DB_NAME=inkpow
DB_OWNER_USER=inkpow
DB_OWNER_PASSWORD=$OWNER_PW
DB_CUSTOMER_USER=inkpow_web
DB_CUSTOMER_PASSWORD=$CUST_PW
DB_ADMIN_USER=inkpow_staff
DB_ADMIN_PASSWORD=$ADMIN_PW
DB_READONLY_USER=inkpow_ro
DB_READONLY_PASSWORD=$RO_PW

# MongoDB
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=inkpow

# Signs the login cookie
SESSION_SECRET=$SECRET
ENV
[ -n "$SUDO_USER" ] && chown "$SUDO_USER" .env.local
chmod 600 .env.local
echo "Done. Next: npm install && npm run db:reset && npm run dev"
