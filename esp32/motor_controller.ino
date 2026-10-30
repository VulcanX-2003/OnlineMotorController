#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include "secrets.h"

// Connect this output only to a compatible motor-controller enable input.
constexpr uint8_t DRIVER_ENABLE_PIN = 25;
constexpr uint8_t ESTOP_OK_PIN = 27;
constexpr uint32_t POLL_INTERVAL_MS = 2000;
constexpr uint32_t LOCAL_LEASE_MS = 7000;

uint32_t lastPollMs = 0;
uint32_t lastValidResponseMs = 0;
bool estopLatched = false;

void stopDriver() {
  digitalWrite(DRIVER_ENABLE_PIN, LOW);
}

void applyCommand(bool enabled) {
  if (digitalRead(ESTOP_OK_PIN) != LOW) {
    estopLatched = true;
    stopDriver();
    return;
  }

  if (estopLatched) {
    stopDriver();
    if (!enabled) estopLatched = false;
    return;
  }

  if (!enabled) {
    stopDriver();
    return;
  }

  digitalWrite(DRIVER_ENABLE_PIN, HIGH);
}

bool pollCommand() {
  WiFiClientSecure client;
  client.setCACert(ROOT_CA);
  HTTPClient http;
  const String url = String(SERVER_URL) + "/api/device/command";
  if (!http.begin(client, url)) return false;
  http.addHeader("Authorization", String("Bearer ") + DEVICE_TOKEN);
  http.setTimeout(3000);

  const int status = http.GET();
  if (status != HTTP_CODE_OK) {
    http.end();
    return false;
  }

  JsonDocument command;
  const DeserializationError error = deserializeJson(command, http.getString());
  http.end();
  if (error || !command["enabled"].is<bool>()) return false;

  const bool enabled = command["enabled"].as<bool>();
  lastValidResponseMs = millis();
  applyCommand(enabled);
  return true;
}

void setup() {
  pinMode(DRIVER_ENABLE_PIN, OUTPUT);
  pinMode(ESTOP_OK_PIN, INPUT_PULLUP);
  stopDriver();

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void loop() {
  const uint32_t now = millis();
  if (WiFi.status() == WL_CONNECTED && now - lastPollMs >= POLL_INTERVAL_MS) {
    lastPollMs = now;
    if (!pollCommand()) stopDriver();
  }

  if (WiFi.status() != WL_CONNECTED || lastValidResponseMs == 0 || now - lastValidResponseMs > LOCAL_LEASE_MS) {
    stopDriver();
  }

  if (digitalRead(ESTOP_OK_PIN) != LOW) {
    estopLatched = true;
    stopDriver();
  }
}