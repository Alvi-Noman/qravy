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
2. **Beep every second while `alert` is `true`** — not just one beep when it turns on (a beep can be missed in a busy kitchen).
3. **Reconnect Wi-Fi** by itself when it drops, and blink an LED while offline so staff can see it.
4. **Restart itself** if it hangs (a watchdog).

## The sketch (Arduino IDE, ESP32)

**[`hardware/qravy_buzzer/qravy_buzzer.ino`](../hardware/qravy_buzzer/qravy_buzzer.ino)** — open it in the Arduino IDE
(keep it in its `qravy_buzzer` folder), board **ESP32 Dev Module** — no libraries to install.

Change the lines under `YOUR SETTINGS`: the restaurant's **Wi-Fi name** and **password**, and the **API link**
(`https://admin.qravy.com/waiter/alert?tenant=<SUBDOMAIN>&device=1`, plus `&branch=<branch>` for one branch).
Set `PASSIVE_BUZZER = true` if the buzzer only clicks (a passive buzzer needs a tone).

What it does:

- **one beep every second** while Qravy says `alert: true` — any new order (dine-in, online delivery, pickup) or a
  table calling for a waiter — until a staff member taps **Silence buzzer** on the dashboard;
- asks Qravy every 2 s, in its own task, so a slow network never delays a beep; reconnects Wi-Fi by itself;
- LED **on** = connected · **blinking** = no Wi-Fi / can't reach Qravy (and after a minute without an answer it stops
  beeping — nobody could silence it);
- restarts itself if anything hangs for 30 s (works on ESP32 board package 2.x and 3.x).

## Checking it

1. Plug it in — one short beep ("I'm on"), the LED stops blinking once it's connected.
2. Place a test order on the restaurant's site → it rings within ~2 s; the dashboard shows "Counter buzzer is
   ringing — a new order came in". Tap **Silence buzzer** → it stops.
3. Tap "Call waiter" on a dine-in table page → it beeps every second again until silenced.
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
