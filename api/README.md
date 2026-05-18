# Lightsail API

This API runs on the Lightsail instance and is the only server-side path to Firebase Realtime Database.

## Environment

Create `/etc/sc-schedule/api.env`:

```bash
PORT=3001
FIREBASE_DATABASE_URL=https://scswimming-schedule-default-rtdb.asia-southeast1.firebasedatabase.app
GOOGLE_APPLICATION_CREDENTIALS=/etc/sc-schedule/firebase-service-account.json
SUPER_ADMIN_EMAIL=your-admin@example.com
```

Put the Firebase service account JSON at:

```bash
/etc/sc-schedule/firebase-service-account.json
```

## systemd

Create `/etc/systemd/system/sc-schedule-api.service`:

```ini
[Unit]
Description=SC Schedule API
After=network.target

[Service]
WorkingDirectory=/var/www/schedule/api
EnvironmentFile=/etc/sc-schedule/api.env
ExecStart=/usr/bin/node /var/www/schedule/api/server.js
Restart=always
RestartSec=5
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

Then run:

```bash
cd /var/www/schedule/api
sudo npm install --omit=dev
sudo systemctl daemon-reload
sudo systemctl enable --now sc-schedule-api
sudo systemctl status sc-schedule-api
```

## nginx

Add this inside the active `server { ... }` block:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3001/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Then run:

```bash
sudo nginx -t
sudo systemctl reload nginx
curl http://127.0.0.1:3001/api/health
curl https://YOUR_DOMAIN/api/health
```
