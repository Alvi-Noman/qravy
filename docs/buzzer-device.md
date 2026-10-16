# The counter buzzer (ESP32)

The buzzer on the counter rings for **every new order** and **every table calling for staff**
(the "Call waiter" button, or a guest asking the AI waiter for the bill, water…). It keeps ringing until a
staff member taps **Silence buzzer** on the dashboard (Orders or Service Requests page).

## How it works

```
guest orders / calls ─▶ Qravy API ─▶ AI waiter service  ◀── the ESP32 asks every 2 s: "anything?"
                        (retries ~30 s)  (remembers it,       └─▶ rings while the answer is "yes"
                                          also across restarts)
staff taps "Silence buzzer" on the dashboard ─▶ the answer becomes "no" ─▶ the ESP32 stops
```

The device never needs a password: it only asks *"is something waiting?"*. Silencing needs a staff login, so it
happens on the dashboard.

## The address the device asks

```
GET https://admin.qravy.com/waiter/alert?tenant=<SUBDOMAIN>&device=1
```

- `<SUBDOMAIN>` — the restaurant's link name, exactly as in `https://<SUBDOMAIN>.qravy.com` (e.g. `sholoaanabangali`).
- `&device=1` — says "this is the buzzer". The dashboard uses it to warn **"The counter buzzer is offline"** when
  the device stops asking (no power / no Wi-Fi) for 30 seconds.
- Restaurants with branches, a buzzer for **one** branch: add `&branch=<branch link name>` (e.g. `&branch=gulshan`).
  Without `branch` it rings for every branch.

### The answer

```json
{ "alert": true, "since": 1792138489.05, "last": 1792138491.24, "kind": "call", "device": 0.0 }
```

| field   | meaning |
|---------|---------|
| `alert` | `true` = ring. Keep ringing until it's `false` (staff silenced it on the dashboard). |
| `last`  | time of the newest ring. **It changes when another order / call comes in while it's already ringing** — beep again then. |
| `kind`  | what rang last: `"order"` (a new order) or `"call"` (a table calling for staff) — use a different sound if you like. |
| `since`, `device` | for the dashboard; the device can ignore them. |

## What the device must do

1. **Ask every 2 seconds**, with a timeout (4 s) — never wait forever on one request.
2. **Ring while `alert` is `true`** — not just one beep when it turns on (a beep can be missed in a busy kitchen).
3. **When `last` changes** while ringing → an extra burst (a second order or call came in).
4. **Reconnect Wi-Fi** by itself when it drops, and blink an LED while offline so staff can see it.
5. **Restart itself** if it hangs (the watchdog below).

## Reference sketch (Arduino IDE, ESP32)

Libraries: **ArduinoJson** (v7, by Benoit Blanchon) — the rest comes with the ESP32 board package.
Change the five lines under `SETTINGS`.

```cpp
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <esp_task_wdt.h>

// ===================== SETTINGS =====================
const char* WIFI_SSID   = "YOUR-WIFI";
const char* WIFI_PASS   = "YOUR-WIFI-PASSWORD";
const char* SUBDOMAIN   = "sholoaanabangali";   // the restaurant's link name
const char* BRANCH      = "";                   // "" = every branch, or e.g. "gulshan"
const int   BUZZER_PIN  = 25;                   // the buzzer (through a transistor if it's a big one)
const int   LED_PIN     = 2;                    // on-board LED: blinks while offline
// ====================================================

const char* HOST = "https://admin.qravy.com";
const uint32_t POLL_MS = 2000;
const uint32_t HTTP_TIMEOUT_MS = 4000;

String url;
bool ringing = false;
double lastRing = 0;          // the "last" we've already beeped for
String kind = "order";
uint32_t lastPoll = 0, lastOkPoll = 0;

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) {
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));   // blink while connecting
    delay(250);
    esp_task_wdt_reset();
  }
}

// one short beep pattern; called again and again while ringing
void ringPattern() {
  if (kind == "call") {           // a table calling: two short beeps
    for (int i = 0; i < 2; i++) { digitalWrite(BUZZER_PIN, HIGH); delay(120); digitalWrite(BUZZER_PIN, LOW); delay(120); }
  } else {                         // a new order: one long beep
    digitalWrite(BUZZER_PIN, HIGH); delay(400); digitalWrite(BUZZER_PIN, LOW);
  }
}

void extraBurst() {                // another order / call came in while ringing
  for (int i = 0; i < 4; i++) { digitalWrite(BUZZER_PIN, HIGH); delay(80); digitalWrite(BUZZER_PIN, LOW); delay(80); }
}

void poll() {
  WiFiClientSecure client;
  client.setInsecure();            // or client.setCACert(<ISRG Root X1>) to check the certificate
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(client, url)) return;
  int code = http.GET();
  if (code == 200) {
    JsonDocument doc;
    if (!deserializeJson(doc, http.getString())) {
      lastOkPoll = millis();
      bool alert = doc["alert"] | false;
      double last = doc["last"] | 0.0;
      kind = String((const char*)(doc["kind"] | "order"));
      if (alert && ringing && last > lastRing) extraBurst();   // a new one while ringing
      if (alert) lastRing = last;
      ringing = alert;
    }
  }
  http.end();
}

void setup() {
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  url = String(HOST) + "/waiter/alert?tenant=" + SUBDOMAIN + "&device=1";
  if (strlen(BRANCH)) url += String("&branch=") + BRANCH;

  // restart by itself if it ever hangs for 30 s
  esp_task_wdt_config_t wdt = { .timeout_ms = 30000, .idle_core_mask = 0, .trigger_panic = true };
  esp_task_wdt_reconfigure(&wdt);
  esp_task_wdt_add(NULL);

  connectWifi();
  digitalWrite(BUZZER_PIN, HIGH); delay(150); digitalWrite(BUZZER_PIN, LOW);   // "I'm on"
}

void loop() {
  esp_task_wdt_reset();
  if (WiFi.status() != WL_CONNECTED) {
    ringing = false;               // can't know — the dashboard shows "buzzer offline"
    connectWifi();
    return;
  }
  if (millis() - lastPoll >= POLL_MS) {
    lastPoll = millis();
    poll();
  }
  // offline (no good answer for 20 s): blink the LED; online: LED on
  digitalWrite(LED_PIN, (millis() - lastOkPoll > 20000) ? ((millis() / 300) % 2) : HIGH);
  if (ringing) ringPattern();
  delay(50);
}
```

> On an older ESP32 board package (2.x) the watchdog lines are
> `esp_task_wdt_init(30, true); esp_task_wdt_add(NULL);` instead of the `esp_task_wdt_config_t` ones.

## Checking it

1. Plug it in — one short beep ("I'm on"), the LED stops blinking once it's connected.
2. Place a test order on the restaurant's site → it rings within ~2 s; the dashboard shows "Counter buzzer is
   ringing — a new order came in". Tap **Silence buzzer** → it stops.
3. Tap "Call waiter" on a dine-in table page → it rings with the two-beep pattern.
4. Unplug it for a minute → the dashboard shows **"The counter buzzer is offline"**.

On the server, every ring is logged:

```bash
docker compose -f compose.production.yml --env-file .env.production logs -f ai-waiter-service | grep "\[alert\]"
# [alert] 🔔 new order for sholoaanabangali — buzzer triggered
# [alert] 🔔 new table call for sholoaanabangali — buzzer triggered
```

If you see `INTERNAL_API_KEY not set` or (in `auth-service`) `refused the ring … HTTP 403`, the two services don't
share the same `INTERNAL_API_KEY` — put the same line in `runtime/auth-service.env` and `runtime/ai-waiter-service.env`
and restart both.
