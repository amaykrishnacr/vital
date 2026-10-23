/*
  VITAL firmware - ESP32 DevKit V1 (Arduino IDE)

  Reads the MAX30102 (heart rate + SpO2) and MLX90614 (temperature),
  shows readings on the 0.96" SSD1306 OLED, and sends one JSON message per
  second to the VITAL server over Wi-Fi.

  Architecture (two FreeRTOS tasks on the two ESP32 cores):
    core 1  loop()        : read sensors over I2C, detect beats, compute SpO2,
                            draw the OLED, pack 1 second of data
    core 0  networkTask() : keep Wi-Fi connected, POST each packet to the
                            server, read back the user name / alert flag
  A FreeRTOS queue passes packets from core 1 to core 0, so slow Wi-Fi never
  makes the sensor miss samples.

  Wiring (all modules share the I2C bus):
    3V3 -> VIN/VCC     GND -> GND     GPIO21 -> SDA     GPIO22 -> SCL

  Libraries (Arduino IDE -> Tools -> Manage Libraries):
    SparkFun MAX3010x Pulse and Proximity Sensor Library
    Adafruit MLX90614 Library
    Adafruit SSD1306 (+ Adafruit GFX Library, Adafruit BusIO)
*/
#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include "MAX30105.h"          // SparkFun library, works with the MAX30102
#include "heartRate.h"         // beat detection (PBA algorithm)
#include "spo2_algorithm.h"    // Maxim reference SpO2 algorithm
#include <Adafruit_MLX90614.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "config.h"

#define FIRMWARE_VERSION "1.0"
#define SAMPLES_PER_SEC  25        // 100 Hz LED sampling, averaged 4x -> 25 samples/s
#define FINGER_IR        50000     // IR below this = no finger on the sensor
#define SPO2_BUF         100       // 4 seconds, what the Maxim algorithm expects

MAX30105 pox;
Adafruit_MLX90614 mlx;
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
bool haveOled = false, havePox = false, haveMlx = false;

// ---------------------------------------------------------------- packets
struct Packet {
  uint32_t wave[SAMPLES_PER_SEC];      // IR waveform (inverted so beats point up)
  uint32_t redWave[SAMPLES_PER_SEC];
  uint8_t  n;
  float    bpm;
  float    spo2;
  float    skin;                       // MLX90614 object temperature
  float    ambient;
  bool     finger;
  uint32_t irRaw, redRaw;              // average raw values over the second
};
QueueHandle_t packetQueue;
Packet cur;
uint64_t irSum = 0, redSum = 0;

// ---------------------------------------------------------------- shared with network task
SemaphoreHandle_t stateMutex;
char serverUser[24] = "";
char serverMsg[24]  = "Connecting...";
bool serverAlert = false;
float serverTemp = NAN;
volatile bool wifiOk = false, serverOk = false;
volatile int  wifiRssi = 0;

// ---------------------------------------------------------------- signal processing state
const uint8_t RATE_SIZE = 4;           // average the last 4 beats
float rates[RATE_SIZE];
uint8_t rateSpot = 0, rateCount = 0;
unsigned long lastBeat = 0;
float beatAvg = 0;

uint32_t irBuf[SPO2_BUF], redBuf[SPO2_BUF];
int bufLen = 0, newSamples = 0;
int32_t spo2Value = 0, hrMaxim = 0;
int8_t spo2Valid = 0, hrValid = 0;
float lastGoodSpo2 = 0;
unsigned long lastGoodSpo2At = 0;

float dcIr = 0, dcRed = 0;             // slow average used to flip the waveform
int16_t graph[128];                    // OLED pulse trace
uint8_t graphPos = 0;
bool finger = false;
float lastSkin = NAN, lastAmbient = NAN;

unsigned long lastPacketAt = 0, lastDrawAt = 0;

void networkTask(void *arg);

// =====================================================================
void showBoot(const char *line1, const char *line2) {
  if (!haveOled) return;
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(2); oled.setCursor(28, 8); oled.print("VITAL");
  oled.setTextSize(1); oled.setCursor(0, 36); oled.print(line1);
  oled.setCursor(0, 48); oled.print(line2);
  oled.display();
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\nVITAL firmware " FIRMWARE_VERSION);

  Wire.begin(21, 22);                 // SDA, SCL
  Wire.setClock(100000);              // 100 kHz: the MLX90614 supports at most 100 kHz

  haveOled = oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  showBoot("Starting sensors...", "");

  havePox = pox.begin(Wire, I2C_SPEED_STANDARD);        // 0x57
  if (havePox) pox.setup(60, 4, 2, 100, 411, 4096);    // LED power, avg 4, red+IR, 100 Hz, 411 us, 4096 nA
  haveMlx = mlx.begin();                                // 0x5A

  Serial.printf("OLED %s | MAX30102 %s | MLX90614 %s\n",
                haveOled ? "OK" : "MISSING", havePox ? "OK" : "MISSING", haveMlx ? "OK" : "MISSING");
  char status[32];
  snprintf(status, sizeof status, "PPG:%s  Temp:%s", havePox ? "ok" : "--", haveMlx ? "ok" : "--");
  showBoot(status, "Joining Wi-Fi...");

  stateMutex  = xSemaphoreCreateMutex();
  packetQueue = xQueueCreate(3, sizeof(Packet));
  xTaskCreatePinnedToCore(networkTask, "network", 8192, NULL, 1, NULL, 0);   // core 0
  memset(&cur, 0, sizeof cur);
  lastPacketAt = millis();
}

// =====================================================================
//  Sensor side (core 1)
// =====================================================================
void onSample(uint32_t ir, uint32_t red) {
  finger = ir > FINGER_IR;

  // slow-moving average (DC) so the waveform can be flipped: more blood = less light back
  if (dcIr == 0) { dcIr = ir; dcRed = red; }
  dcIr  += (ir  - dcIr)  * 0.02f;
  dcRed += (red - dcRed) * 0.02f;
  float wIr  = 2 * dcIr  - (float)ir;
  float wRed = 2 * dcRed - (float)red;

  if (cur.n < SAMPLES_PER_SEC) {
    cur.wave[cur.n]    = wIr  > 0 ? (uint32_t)wIr  : 0;
    cur.redWave[cur.n] = wRed > 0 ? (uint32_t)wRed : 0;
    cur.n++;
  }
  irSum += ir; redSum += red;

  graph[graphPos] = (int16_t)constrain(wIr - dcIr, -2000.0f, 2000.0f);
  graphPos = (graphPos + 1) % 128;

  if (!finger) {                       // reset everything when the finger is lifted
    rateCount = 0; beatAvg = 0; bufLen = 0; newSamples = 0;
    return;
  }

  // ---- heart rate: time between beats, averaged over the last 4 beats
  if (checkForBeat((int32_t)ir)) {
    unsigned long now = millis();
    unsigned long dt = now - lastBeat;
    lastBeat = now;
    float bpm = 60.0f / (dt / 1000.0f);
    if (bpm > 30 && bpm < 220) {       // ignore impossible values
      rates[rateSpot] = bpm;
      rateSpot = (rateSpot + 1) % RATE_SIZE;
      if (rateCount < RATE_SIZE) rateCount++;
      float sum = 0;
      for (uint8_t i = 0; i < rateCount; i++) sum += rates[i];
      beatAvg = sum / rateCount;
    }
  }

  // ---- SpO2: Maxim algorithm on the last 4 seconds, recomputed every second
  if (bufLen < SPO2_BUF) {
    irBuf[bufLen] = ir; redBuf[bufLen] = red; bufLen++;
  } else {
    memmove(irBuf, irBuf + 1, (SPO2_BUF - 1) * sizeof(uint32_t));
    memmove(redBuf, redBuf + 1, (SPO2_BUF - 1) * sizeof(uint32_t));
    irBuf[SPO2_BUF - 1] = ir; redBuf[SPO2_BUF - 1] = red;
  }
  if (bufLen == SPO2_BUF && ++newSamples >= SAMPLES_PER_SEC) {
    newSamples = 0;
    maxim_heart_rate_and_oxygen_saturation(irBuf, SPO2_BUF, redBuf, &spo2Value, &spo2Valid, &hrMaxim, &hrValid);
    if (spo2Valid && spo2Value >= 70 && spo2Value <= 100) {
      lastGoodSpo2 = spo2Value;
      lastGoodSpo2At = millis();
    }
  }
}

void finishPacket() {
  if (haveMlx) {
    float s = mlx.readObjectTempC(), a = mlx.readAmbientTempC();
    if (!isnan(s) && s > -40 && s < 125) lastSkin = s;
    if (!isnan(a) && a > -40 && a < 125) lastAmbient = a;
  }
  cur.finger  = finger;
  cur.bpm     = (finger && rateCount >= 2) ? beatAvg : 0;
  cur.spo2    = (finger && millis() - lastGoodSpo2At < 8000) ? lastGoodSpo2 : 0;
  cur.skin    = lastSkin;
  cur.ambient = lastAmbient;
  cur.irRaw   = cur.n ? irSum / cur.n : 0;
  cur.redRaw  = cur.n ? redSum / cur.n : 0;
  xQueueSend(packetQueue, &cur, 0);    // if the queue is full, this second is dropped
  memset(&cur, 0, sizeof cur);
  irSum = redSum = 0;

  Serial.printf("finger=%d  HR=%.1f  SpO2=%.0f  skin=%.2fC  ambient=%.2fC  wifi=%d server=%d\n",
                finger, beatAvg, lastGoodSpo2, lastSkin, lastAmbient, wifiOk, serverOk);
}

void drawOled() {
  if (!haveOled) return;
  char user[24], msg[24]; bool alert; float temp;
  xSemaphoreTake(stateMutex, portMAX_DELAY);
  strcpy(user, serverUser); strcpy(msg, serverMsg); alert = serverAlert; temp = serverTemp;
  xSemaphoreGive(stateMutex);
  if (isnan(temp) && !isnan(lastSkin)) temp = lastSkin + TEMP_OFFSET_DEFAULT;

  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(1);
  oled.setCursor(0, 0); oled.print("VITAL");
  oled.setCursor(36, 0); oled.print(user[0] ? user : "-");
  oled.setCursor(104, 0); oled.print(!wifiOk ? "..." : serverOk ? "WiFi" : "Srv?");
  oled.drawFastHLine(0, 9, 128, SSD1306_WHITE);

  if (!havePox) {
    oled.setCursor(0, 24); oled.print("MAX30102 not found");
    oled.setCursor(0, 36); oled.print("Check SDA/SCL wiring");
  } else if (!finger) {
    oled.setTextSize(2); oled.setCursor(4, 20); oled.print("Place");
    oled.setCursor(4, 38); oled.print("finger");
    oled.setTextSize(1);
    if (!isnan(lastAmbient)) { oled.setCursor(80, 24); oled.printf("Room"); oled.setCursor(80, 36); oled.printf("%.1fC", lastAmbient); }
  } else {
    oled.setTextSize(3); oled.setCursor(0, 13);
    if (rateCount >= 2) oled.printf("%3.0f", beatAvg); else oled.print("--");
    oled.setTextSize(1); oled.setCursor(56, 27); oled.print("bpm");
    oled.setCursor(84, 13); oled.print("SpO2");
    oled.setCursor(84, 23); if (lastGoodSpo2 > 0) oled.printf("%.0f%%", lastGoodSpo2); else oled.print("--");
    oled.setCursor(84, 33); if (!isnan(temp)) oled.printf("%.1fC", temp); else oled.print("--");
    // pulse trace, scaled to the last ~5 seconds
    int16_t lo = 32767, hi = -32768;
    for (int i = 0; i < 128; i++) { lo = min(lo, graph[i]); hi = max(hi, graph[i]); }
    int span = max(1, hi - lo);
    int prevY = -1;
    for (int x = 0; x < 128; x++) {
      int v = graph[(graphPos + x) % 128];
      int y = 53 - (int)((long)(v - lo) * 12 / span);
      if (prevY >= 0) oled.drawLine(x - 1, prevY, x, y, SSD1306_WHITE);
      prevY = y;
    }
  }

  if (alert && (millis() / 400) % 2 == 0) {        // blinking alert bar
    oled.fillRect(0, 55, 128, 9, SSD1306_WHITE);
    oled.setTextColor(SSD1306_BLACK);
  }
  oled.setTextSize(1); oled.setCursor(0, 56); oled.print(msg);
  oled.display();
}

void loop() {
  if (havePox) {
    pox.check();                       // move new samples from the sensor FIFO into the library buffer
    while (pox.available()) {
      uint32_t red = pox.getFIFORed();
      uint32_t ir  = pox.getFIFOIR();
      pox.nextSample();
      onSample(ir, red);
    }
  }
  unsigned long now = millis();
  if (now - lastPacketAt >= 1000) { lastPacketAt += 1000; finishPacket(); }
  if (now - lastDrawAt >= 200)    { lastDrawAt = now;     drawOled(); }
  delay(2);
}

// =====================================================================
//  Network side (core 0)
// =====================================================================
// Read a value from the server's small JSON reply, e.g. "user":"Member 1"
String jsonValue(const String &js, const char *key) {
  String k = String("\"") + key + "\"";
  int i = js.indexOf(k);
  if (i < 0) return "";
  i = js.indexOf(':', i + k.length());
  if (i < 0) return "";
  i++;
  while (i < (int)js.length() && js[i] == ' ') i++;
  if (i < (int)js.length() && js[i] == '"') {
    int j = js.indexOf('"', i + 1);
    return j > i ? js.substring(i + 1, j) : "";
  }
  int j = i;
  while (j < (int)js.length() && js[j] != ',' && js[j] != '}') j++;
  String v = js.substring(i, j); v.trim();
  return v;
}

void appendArray(String &s, const uint32_t *a, uint8_t n) {
  s += '[';
  for (uint8_t i = 0; i < n; i++) { if (i) s += ','; s += a[i]; }
  s += ']';
}

String buildJson(const Packet &p) {
  String s; s.reserve(900);
  s += "{\"device\":\"" DEVICE_ID "\",\"fw\":\"" FIRMWARE_VERSION "\",\"rate\":100";
  s += ",\"rssi\":";    s += wifiRssi;
  s += ",\"finger\":";  s += p.finger ? "true" : "false";
  s += ",\"bpm\":";     s += String(p.bpm, 1);
  s += ",\"spo2\":";    s += String(p.spo2, 0);
  s += ",\"temp\":";    if (isnan(p.skin)) s += "null"; else s += String(p.skin, 2);
  s += ",\"ambient\":"; if (isnan(p.ambient)) s += "null"; else s += String(p.ambient, 2);
  s += ",\"ir\":";      s += p.irRaw;
  s += ",\"red\":";     s += p.redRaw;
  s += ",\"wave\":";     appendArray(s, p.wave, p.n);
  s += ",\"red_wave\":"; appendArray(s, p.redWave, p.n);
  s += '}';
  return s;
}

void setMsg(const char *msg) {
  xSemaphoreTake(stateMutex, portMAX_DELAY);
  strncpy(serverMsg, msg, sizeof serverMsg - 1); serverMsg[sizeof serverMsg - 1] = 0;
  xSemaphoreGive(stateMutex);
}

void networkTask(void *arg) {
  WiFi.mode(WIFI_STA);
  unsigned long lastTry = 0;
  Packet p;
  for (;;) {
    if (WiFi.status() != WL_CONNECTED) {
      wifiOk = false; serverOk = false;
      if (millis() - lastTry > 10000 || lastTry == 0) {
        lastTry = millis();
        Serial.printf("Connecting to Wi-Fi '%s'...\n", WIFI_SSID);
        setMsg("Joining Wi-Fi...");
        WiFi.disconnect();
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      }
      xQueueReceive(packetQueue, &p, pdMS_TO_TICKS(500));   // drop data while offline
      continue;
    }
    if (!wifiOk) {
      wifiOk = true;
      Serial.print("Wi-Fi connected, IP "); Serial.println(WiFi.localIP());
      setMsg("Wi-Fi OK");
    }
    wifiRssi = WiFi.RSSI();

    if (xQueueReceive(packetQueue, &p, pdMS_TO_TICKS(2000)) != pdTRUE) continue;

    HTTPClient http;
    http.begin(String(SERVER_URL) + "/api/reading");
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Key", DEVICE_KEY);
    http.setTimeout(1500);
    int code = http.POST(buildJson(p));
    if (code == 200) {
      String reply = http.getString();
      serverOk = true;
      String user = jsonValue(reply, "user"), msg = jsonValue(reply, "msg"), temp = jsonValue(reply, "temp");
      xSemaphoreTake(stateMutex, portMAX_DELAY);
      strncpy(serverUser, (user == "null") ? "" : user.c_str(), sizeof serverUser - 1);
      serverUser[sizeof serverUser - 1] = 0;
      strncpy(serverMsg, msg.c_str(), sizeof serverMsg - 1);
      serverMsg[sizeof serverMsg - 1] = 0;
      serverAlert = jsonValue(reply, "alert") == "true";
      serverTemp = (temp.length() && temp != "null") ? temp.toFloat() : NAN;
      xSemaphoreGive(stateMutex);
    } else {
      serverOk = false;
      Serial.printf("Server error %d (%s). Is SERVER_URL right and the server running?\n",
                    code, http.errorToString(code).c_str());
      setMsg(code == 403 ? "Wrong DEVICE_KEY" : "Server not found");
    }
    http.end();
  }
}
