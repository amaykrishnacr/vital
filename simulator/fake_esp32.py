"""Fake ESP32: sends realistic VITAL readings to the server, once per second.

Use it to develop and demo the website without the hardware.

    python fake_esp32.py                      (follows the scenario chosen on the admin page)
    python fake_esp32.py --scenario fever     (fixed scenario)
    python fake_esp32.py --server http://192.168.1.20:5000

Scenarios: normal, exercise, fever, low_oxygen, high_hr, noisy, no_finger
"""
import argparse
import json
import math
import random
import sys
import time
import urllib.error
import urllib.request

FS = 25                     # waveform samples per second (same as the firmware)
SCENARIOS = ["normal", "exercise", "fever", "low_oxygen", "high_hr", "noisy", "no_finger"]


def post(url, key, payload):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "X-Device-Key": key})
    with urllib.request.urlopen(req, timeout=4) as r:
        return json.loads(r.read())


def get(url, key):
    req = urllib.request.Request(url, headers={"X-Device-Key": key})
    with urllib.request.urlopen(req, timeout=4) as r:
        return json.loads(r.read())


class Body:
    """A simple model of one person's vitals that drifts toward scenario targets."""

    def __init__(self, base_hr=74.0, base_temp=36.7, base_spo2=98.0, offset=2.4):
        self.base_hr, self.base_temp, self.base_spo2, self.offset = base_hr, base_temp, base_spo2, offset
        self.hr, self.temp, self.spo2 = base_hr, base_temp, base_spo2
        self.phase = 0.0
        self.scenario, self.since = "normal", time.time()
        self.wander = 0.0
        self.dc_ir, self.dc_red = 112000.0, 98000.0

    def set(self, scenario):
        if scenario != self.scenario:
            self.scenario, self.since = scenario, time.time()

    def step(self, dt=1.0):
        s, mins = self.scenario, (time.time() - self.since) / 60.0
        self.wander += random.gauss(0, 0.35) - self.wander * 0.08
        hr_t, spo2_t, temp_t = self.base_hr + self.wander, self.base_spo2, self.base_temp
        if s == "exercise":
            hr_t, temp_t, spo2_t = self.base_hr + 38, self.base_temp + 0.2, self.base_spo2 - 1
        elif s == "fever":
            temp_t = min(39.2, max(37.2, self.base_temp + 0.5) + 0.12 * mins)
            hr_t = self.base_hr + 10 + (temp_t - 37) * 8
            spo2_t = self.base_spo2 - 1
        elif s == "low_oxygen":
            spo2_t = max(85.0, self.base_spo2 - 9 * mins)
            hr_t = self.base_hr + 14
        elif s == "high_hr":
            hr_t = 134 + self.wander
        k_hr = 0.25 if s != "high_hr" else 0.15
        self.hr += (hr_t - self.hr) * k_hr
        self.spo2 += (spo2_t - self.spo2) * (0.12 if s == "low_oxygen" else 0.2)
        self.temp += (temp_t - self.temp) * (0.35 if s == "fever" else 0.05)

    def reading(self, device):
        s = self.scenario
        finger = s != "no_finger"
        noisy = s == "noisy"
        bpm = self.hr + random.gauss(0, 1.2) + (random.gauss(0, 14) if noisy else 0)
        # the steady (DC) light level drifts slowly, like a real fingertip
        self.dc_ir += random.gauss(0, 25) + (112000 - self.dc_ir) * 0.02
        self.dc_red += random.gauss(0, 20) + (98000 - self.dc_red) * 0.02
        dc_ir, dc_red = self.dc_ir, self.dc_red
        wave_ir, wave_red = [], []
        for _ in range(FS):
            self.phase = (self.phase + bpm / 60.0 / FS) % 1.0
            p = math.exp(-((self.phase - 0.18) / 0.07) ** 2) + 0.38 * math.exp(-((self.phase - 0.42) / 0.09) ** 2)
            if finger:
                ir = dc_ir * (1 + 0.012 * p) + random.gauss(0, 35)
                red = dc_red * (1 + 0.009 * p) + random.gauss(0, 30)
                if noisy:
                    jolt = random.gauss(0, 1) * 2500 * (random.random() < 0.25)
                    ir += jolt + random.gauss(0, 900)
                    red += jolt * 0.8 + random.gauss(0, 800)
            else:
                ir, red = 900 + random.gauss(0, 40), 700 + random.gauss(0, 40)
            wave_ir.append(round(ir)); wave_red.append(round(red))
        return {
            "device": device, "fw": "sim-1.0", "rate": 100, "rssi": random.randint(-64, -52),
            "finger": finger,
            "bpm": round(bpm, 1) if finger else 0,
            "spo2": round(min(100.0, self.spo2 + random.gauss(0, 0.35)), 1) if finger else 0,
            "temp": round(self.temp - self.offset + random.gauss(0, 0.05), 2) if finger else round(29.4 + random.gauss(0, .05), 2),
            "ambient": round(29.4 + random.gauss(0, 0.05), 2),
            "ir": round(sum(wave_ir) / FS), "red": round(sum(wave_red) / FS),
            "wave": wave_ir, "red_wave": wave_red,
        }


def main():
    ap = argparse.ArgumentParser(description="VITAL fake ESP32")
    ap.add_argument("--server", default="http://localhost:5000")
    ap.add_argument("--key", default="vital-device-key", help="must match DEVICE_KEY in server/config.py")
    ap.add_argument("--device", default="vital-01")
    ap.add_argument("--scenario", choices=SCENARIOS, help="fixed scenario (default: follow the admin page)")
    ap.add_argument("--hr", type=float, default=74.0, help="resting heart rate of the simulated person")
    args = ap.parse_args()

    body = Body(base_hr=args.hr)
    print(f"Fake ESP32 '{args.device}' -> {args.server}   (Ctrl+C to stop)")
    last_check = 0
    while True:
        t0 = time.time()
        try:
            if args.scenario:
                body.set(args.scenario)
            elif t0 - last_check > 2:
                body.set(get(args.server + "/api/demo/scenario", args.key).get("scenario", "normal"))
                last_check = t0
            body.step()
            payload = body.reading(args.device)
            reply = post(args.server + "/api/reading", args.key, payload)
            who = reply.get("user") or "nobody measuring"
            line = (f"[{time.strftime('%H:%M:%S')}] {body.scenario:<10} HR {payload['bpm']:6.1f}  "
                    f"SpO2 {payload['spo2']:5.1f}  skin {payload['temp']:5.2f}C  -> {who:<14} {reply.get('msg', '')}")
            print(line[:120])
        except urllib.error.HTTPError as e:
            print(f"Server said {e.code}: {e.read()[:120]!r}  (is the device key right?)")
        except Exception as e:
            print(f"Can't reach the server at {args.server} ({e}). Retrying...")
        time.sleep(max(0.0, 1.0 - (time.time() - t0)))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
