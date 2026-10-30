#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include "secrets.h"

// These pins connect only to compatible motor-controller logic inputs.
constexpr uint8_t DRIVER_ENABLE_PIN = 25;
constexpr uint8_t DRIVER_PWM_PIN = 26;
constexpr uint8_t ESTOP_OK_PIN = 27;
constexpr uint32_t POLL_INTERVAL_MS = 2000;
constexpr uint32_t LOCAL_LEASE_MS = 7000;
constexpr uint32_t PWM_FREQUENCY = 20000;
constexpr uint8_t PWM_RESOLUTION_BITS = 8;

WiFiClientSecure tlsClient;
uint32_t lastPollMs = 0;
uint32_t lastValidResponseMs = 0;
bool estopLatched = false;

void stopDriver() {
  ledcWrite(DRIVER_PWM_PIN, 0);
  digitalWrite(DRIVER_ENABLE_PIN, LOW);
}

void applyCommand(bool enabled, int speed) {
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

  if (!enabled || speed < 1 || speed > 100) {
    stopDriver();
    return;
  }

  digitalWrite(DRIVER_ENABLE_PIN, HIGH);
  ledcWrite(DRIVER_PWM_PIN, map(speed, 0, 100, 0, 255));
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
  if (error || !command["enabled"].is<bool>() || !command["speed"].is<int>()) return false;

  const bool enabled = command["enabled"].as<bool>();
  const int speed = command["speed"].as<int>();
  lastValidResponseMs = millis();
  applyCommand(enabled, speed);
  return true;
}

void setup() {
  pinMode(DRIVER_ENABLE_PIN, OUTPUT);
  pinMode(ESTOP_OK_PIN, INPUT_PULLUP);
  ledcAttach(DRIVER_PWM_PIN, PWM_FREQUENCY, PWM_RESOLUTION_BITS);
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