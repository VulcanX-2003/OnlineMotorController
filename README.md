# Online Motor Controller

This prototype serves the control page and a small SQLite-backed API. The browser authenticates with `CONTROL_PASSWORD`; the ESP32 polls with its separate `DEVICE_TOKEN`. Browser commands carry an 8-second lease renewed every 2 seconds. The API refuses a start unless the ESP32 polled within the last 7 seconds, and the firmware turns its outputs off if a poll fails or its 7-second local lease expires.

## Run locally

1. Install Node.js 20 or later.
2. Copy `.env.example` to `.env`. Set a unique control password (at least 16 characters), a different random device token (at least 32 characters), and a random session secret (at least 32 characters).
3. Run `npm install`, then `npm start`.
4. Open `http://localhost:3000` and sign in with `CONTROL_PASSWORD`.

To generate secrets on Windows PowerShell, run `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` once for each secret. Keep `.env` and `esp32/secrets.h` private.

## Connect an ESP32

1. Deploy this service behind an HTTPS reverse proxy or managed HTTPS host. Do not expose the service over plain HTTP on the public internet. Keep the Node service and its SQLite data on persistent storage.
2. Copy `esp32/secrets.example.h` to `esp32/secrets.h`; set Wi-Fi credentials, the exact `DEVICE_TOKEN`, the HTTPS hostname, and the trusted CA certificate. Never replace certificate validation with `setInsecure()`.
3. Install the ArduinoJson library and use an ESP32 Arduino core 3.x. Upload `esp32/motor_controller.ino`.
4. Connect the ESP32 output pins only to compatible, isolated enable/PWM inputs on a correctly rated motor controller. The example expects an E-stop OK contact that reads LOW when healthy and HIGH when tripped/open.

The E-stop must interrupt the motor controller's enable/safety circuit independently of the ESP32 and internet connection. This prototype is not a safety-rated controller. Test with the motor power stage disconnected first, then validate the entire installation locally with a qualified person before any remote operation. Do not use this design for life-safety, hazardous machinery, or unattended operation.

## Notes

- The control page and API should be served from the same HTTPS origin.
- `/api/status` reports whether the ESP32 has polled recently. Start is rejected when it is offline.
- The ESP32 always starts with outputs off. An E-stop trip latches off until the controller receives a stop command, after which a new start is required.
- This prototype has one shared operator password and one device token. For multiple users/devices, use a proper identity provider and per-device credentials/authorization.