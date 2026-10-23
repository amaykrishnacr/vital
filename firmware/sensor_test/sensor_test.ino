/*
  VITAL sensor test - run this FIRST to check the wiring.

  1. Upload, then open Tools -> Serial Monitor at 115200 baud.
  2. It scans the I2C bus and lists every module it finds.
  3. Then it prints live readings every second (and shows them on the OLED).

  Expected I2C addresses:  0x3C = OLED   0x57 = MAX30102   0x5A = MLX90614
*/
#include <Wire.h>
#include "MAX30105.h"
#include "heartRate.h"
#include <Adafruit_MLX90614.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

MAX30105 pox;
Adafruit_MLX90614 mlx;
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
bool haveOled, havePox, haveMlx;

const uint8_t RATE_SIZE = 4;
float rates[RATE_SIZE];
uint8_t rateSpot = 0, rateCount = 0;
unsigned long lastBeat = 0, lastPrint = 0;
float beatAvg = 0;
uint32_t lastIr = 0, lastRed = 0;

const char *nameOf(uint8_t a) {
  switch (a) {
    case 0x3C: case 0x3D: return "OLED display (SSD1306)";
    case 0x57: return "MAX30102 pulse oximeter";
    case 0x5A: return "MLX90614 thermometer (GY-906)";
    default:   return "unknown device";
  }
}

void scanBus() {
  Serial.println("\nScanning I2C bus (SDA=GPIO21, SCL=GPIO22)...");
  int found = 0;
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      Serial.printf("  found 0x%02X  %s\n", a, nameOf(a));
      found++;
    }
  }
  if (found == 0) {
    Serial.println("  Nothing found. Check: 3V3 and GND connected? SDA on GPIO21, SCL on GPIO22?");
    Serial.println("  Are the header pins soldered and pushed fully into the breadboard?");
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Wire.begin(21, 22);
  Wire.setClock(100000);
  scanBus();

  haveOled = oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  havePox  = pox.begin(Wire, I2C_SPEED_STANDARD);
  if (havePox) pox.setup(60, 4, 2, 100, 411, 4096);
  haveMlx  = mlx.begin();

  Serial.printf("\nOLED: %s   MAX30102: %s   MLX90614: %s\n",
                haveOled ? "OK" : "NOT FOUND", havePox ? "OK" : "NOT FOUND", haveMlx ? "OK" : "NOT FOUND");
  if (!havePox) Serial.println("MAX30102 not found: see firmware/README.md, Troubleshooting.");
  Serial.println("\nPlace a fingertip on the MAX30102 (gently, keep still). Readings every second:\n");
}

void loop() {
  if (havePox) {
    pox.check();
    while (pox.available()) {
      lastRed = pox.getFIFORed();
      lastIr  = pox.getFIFOIR();
      pox.nextSample();
      if (lastIr > 50000 && checkForBeat((int32_t)lastIr)) {
        unsigned long now = millis(), dt = now - lastBeat;
        lastBeat = now;
        float bpm = 60.0f / (dt / 1000.0f);
        if (bpm > 30 && bpm < 220) {
          rates[rateSpot] = bpm; rateSpot = (rateSpot + 1) % RATE_SIZE;
          if (rateCount < RATE_SIZE) rateCount++;
          float sum = 0; for (uint8_t i = 0; i < rateCount; i++) sum += rates[i];
          beatAvg = sum / rateCount;
        }
      }
      if (lastIr < 50000) { rateCount = 0; beatAvg = 0; }
    }
  }

  if (millis() - lastPrint >= 1000) {
    lastPrint = millis();
    float obj = haveMlx ? mlx.readObjectTempC() : NAN;
    float amb = haveMlx ? mlx.readAmbientTempC() : NAN;
    bool finger = lastIr > 50000;
    Serial.printf("IR=%6lu  RED=%6lu  finger=%s  HR=%5.1f bpm  |  object=%.2f C  ambient=%.2f C\n",
                  (unsigned long)lastIr, (unsigned long)lastRed, finger ? "YES" : "no ",
                  rateCount >= 2 ? beatAvg : 0.0f, obj, amb);
    if (haveOled) {
      oled.clearDisplay();
      oled.setTextColor(SSD1306_WHITE);
      oled.setTextSize(1);
      oled.setCursor(0, 0);  oled.print("VITAL sensor test");
      oled.setCursor(0, 14); oled.printf("IR  %lu", (unsigned long)lastIr);
      oled.setCursor(0, 24); oled.printf("HR  %s", finger ? (rateCount >= 2 ? String(beatAvg, 0).c_str() : "...") : "no finger");
      oled.setCursor(0, 34); oled.printf("Obj %.2f C", obj);
      oled.setCursor(0, 44); oled.printf("Amb %.2f C", amb);
      oled.setCursor(0, 56); oled.printf("PPG:%s TMP:%s", havePox ? "ok" : "--", haveMlx ? "ok" : "--");
      oled.display();
    }
  }
}
