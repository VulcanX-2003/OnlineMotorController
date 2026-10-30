#pragma once

const char *WIFI_SSID = "replace-me";
const char *WIFI_PASSWORD = "replace-me";
const char *DEVICE_TOKEN = "replace-with-the-DEVICE_TOKEN-from-server-env";
const char *SERVER_URL = "https://your-public-hostname.example";

// Paste the CA certificate that issued the HTTPS certificate for SERVER_URL.
// Do not use setInsecure(); it disables server identity verification.
static const char ROOT_CA[] PROGMEM = R"EOF(
-----BEGIN CERTIFICATE-----
PASTE_THE_TRUSTED_CA_CERTIFICATE_HERE
-----END CERTIFICATE-----
)EOF";