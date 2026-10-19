/*
  Qravy counter buzzer — ESP32 (Arduino IDE)

  Beeps once every second while the restaurant has a new order (dine-in, online delivery or pickup) or a table
  calling for a waiter — until a staff member taps "Silence buzzer" on the Qravy dashboard (Orders or Service
  Requests page). Details: docs/buzzer-device.md

  Board:     any ESP32 (e.g. "ESP32 Dev Module"). An Arduino Uno / Nano has no Wi-Fi — it won't work.
  Library:   ArduinoJson (v7, by Benoit Blanchon) — Sketch → Include Library → Manage Libraries…
  Wiring:    buzzer + → GPIO 25 (a big / loud buzzer: through a transistor), buzzer − → GND.
             The on-board LED (GPIO 2) blinks while it can't reach Qravy, and stays on when all is well.
*/
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <esp_task_wdt.h>

// ============================== YOUR SETTINGS ==============================
const char* WIFI_NAME     = "RESTAURANT-WIFI";            // the restaurant's Wi-Fi name (2.4 GHz)
const char* WIFI_PASSWORD = "WIFI-PASSWORD";              // its password

// The restaurant's subdomain — the part before .qravy.com in its link (https://sholoaanabangali.qravy.com)
const char* SUBDOMAIN     = "sholoaanabangali";
// Only one branch should ring this buzzer? Its branch link name (e.g. "gulshan"). Leave "" for every branch.
const char* BRANCH        = "";

const int  BUZZER_PIN        = 25;     // the buzzer
const int  LED_PIN           = 2;      // the on-board LED
const bool PASSIVE_BUZZER    = false;  // false: an "active" buzzer (beeps on its own when powered — most common)
                                       // true:  a "passive" buzzer (needs a tone — it only clicks otherwise)
const int  BEEP_LENGTH_MS    = 300;    // how long each beep is (it repeats every second)
// ===========================================================================

const char* QRAVY = "https://admin.qravy.com";  // Qravy's address (no need to change)
String apiLink;                                 // built from SUBDOMAIN / BRANCH in setup()

const uint32_t BEEP_EVERY_MS   = 1000;  // one beep per second
const uint32_t CHECK_EVERY_MS  = 2000;  // ask Qravy every 2 seconds
const uint32_t HTTP_TIMEOUT_MS = 4000;  // never wait longer than this for an answer
const uint32_t GIVE_UP_MS      = 60000; // no answer for a minute: stop beeping (staff can't silence it from here)

volatile bool ringing = false;          // what Qravy said last: true = beep
volatile uint32_t lastGoodAnswer = 0;   // millis() of the last answer from Qravy

void buzzer(bool on) {
  if (PASSIVE_BUZZER) {
    if (on) tone(BUZZER_PIN, 2700);
    else noTone(BUZZER_PIN);
  } else {
    digitalWrite(BUZZER_PIN, on ? HIGH : LOW);
  }
}

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_NAME, WIFI_PASSWORD);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    vTaskDelay(pdMS_TO_TICKS(250));
  }
}

// Asks Qravy "is anything waiting?" — {"alert": true|false, ...}
void checkQravy() {
  WiFiClientSecure tls;
  tls.setInsecure();  // (encrypted; the certificate isn't checked — fine for a yes/no answer)
  HTTPClient http;
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(tls, apiLink)) return;
  int code = http.GET();
  if (code == 200) {
    JsonDocument doc;
    if (!deserializeJson(doc, http.getString())) {
      ringing = doc["alert"] | false;
      lastGoodAnswer = millis();
    }
  } else {
    Serial.printf("[qravy] HTTP %d\n", code);
  }
  http.end();
}

// Runs on its own (the other core): talking to the internet never delays a beep.
void networkTask(void*) {
  esp_task_wdt_add(NULL);
  for (;;) {
    esp_task_wdt_reset();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[wifi] connecting…");
      connectWifi();
      if (WiFi.status() == WL_CONNECTED) Serial.printf("[wifi] connected, IP %s\n", WiFi.localIP().toString().c_str());
    } else {
      checkQravy();
    }
    vTaskDelay(pdMS_TO_TICKS(CHECK_EVERY_MS));
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  buzzer(false);

  // orders (dine-in, online, pickup) AND waiter calls all come through this one link
  apiLink = String(QRAVY) + "/waiter/alert?tenant=" + SUBDOMAIN + "&device=1";
  if (strlen(BRANCH)) apiLink += String("&branch=") + BRANCH;
  Serial.println("[qravy] checking " + apiLink);

  // restart by itself if anything hangs for 30 seconds
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t wdt = { .timeout_ms = 30000, .idle_core_mask = 0, .trigger_panic = true };
  esp_task_wdt_reconfigure(&wdt);
#else
  esp_task_wdt_init(30, true);
#endif
  esp_task_wdt_add(NULL);

  buzzer(true); delay(150); buzzer(false);   // one short beep: "I'm on"
  xTaskCreatePinnedToCore(networkTask, "qravy", 12288, NULL, 1, NULL, 0);
}

void loop() {
  esp_task_wdt_reset();
  uint32_t now = millis();
  bool online = lastGoodAnswer && now - lastGoodAnswer < 20000;
  bool beep = ringing && lastGoodAnswer && now - lastGoodAnswer < GIVE_UP_MS;

  // one beep every second while there's an order or a call waiting
  buzzer(beep && (now % BEEP_EVERY_MS) < (uint32_t)BEEP_LENGTH_MS);

  // LED: on = connected to Qravy · blinking = no Wi-Fi / can't reach Qravy
  digitalWrite(LED_PIN, online ? HIGH : ((now / 300) % 2));
  delay(10);
}
