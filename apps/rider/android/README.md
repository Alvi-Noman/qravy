# Qravy Rider — the Android app

A thin Android wrapper (a Trusted Web Activity, built with Google's Bubblewrap) around the rider web app at
`https://rider.qravy.com`. The app itself is the web app: **every change to `apps/rider` reaches riders without a new
APK.** Rebuild the APK only to change its name, icon, Android version requirements, or once a year when Google Play
raises the required Android target.

Restaurants download it from the admin (Riders → Rider app) and forward it to riders on WhatsApp. The same package and
key can go to Google Play later — installs from the forwarded APK then update from Play, no reinstall.

## One-time setup (keep these safe — losing the key means riders must reinstall)

1. Make the signing key (needs Java's `keytool`; any machine with a JDK):

   ```
   keytool -genkeypair -v -keystore android.keystore -alias qravy-rider -keyalg RSA -keysize 2048 -validity 10000
   ```

   Keep `android.keystore` and its passwords in a password manager. **Never commit it.**

2. In GitHub → Settings → Secrets and variables → Actions:
   - secret `RIDER_KEYSTORE_BASE64` — `base64 -w0 android.keystore`
   - secret `RIDER_KEYSTORE_PASSWORD`, secret `RIDER_KEY_PASSWORD`
   - variable `RIDER_APK_SHA256` — the key's SHA-256 fingerprint
     (`keytool -list -v -keystore android.keystore -alias qravy-rider`, the "SHA256:" line). The rider web app serves
     it at `/.well-known/assetlinks.json`, which is what lets the app open full screen without a browser bar. When the
     app goes on Google Play, add Play's app-signing fingerprint too (comma-separated).

3. DNS: point `rider.qravy.com` at the server (Caddy serves it — see the root `Caddyfile`).

## Building

GitHub → Actions → **Rider APK** → Run workflow (give a version name and a higher version code each time). It builds
`qravy-rider.apk` (to forward) and `qravy-rider.aab` (for Google Play) and puts them on the GitHub release `rider-apk`.
The next release of the rider web app's image picks the APK up and serves it at
`https://rider.qravy.com/download/qravy-rider.apk` — the admin's download button.

## Google Play later

Create the app with package `com.qravy.rider`, and in Play App Signing choose **use my own key** (upload this same key),
so forwarded installs update from Play. Upload `qravy-rider.aab`. You'll need a privacy policy page, the Data safety
form and screenshots.
