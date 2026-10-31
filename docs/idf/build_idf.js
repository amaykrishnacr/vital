// Builds the VITAL IDF-B (.docx) in the VIT IPR&TTCELL Invention Disclosure Format (IDF)-B layout.
//   node build_idf.js        -> VITAL_IDF-B.docx
// Validation numbers are read from ../../validation/results_*.json.
const fs = require('fs');
const path = require('path');
const d = require('docx');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, Header, AlignmentType,
  WidthType, BorderStyle, ShadingType, VerticalAlign, LevelFormat, HeightRule,
  Math: OMath, MathRun, MathFraction, MathSubScript, MathSuperScript,
} = d;

const HERE = __dirname;
const img = (f) => fs.readFileSync(path.join(HERE, 'img', f));
const ML = JSON.parse(fs.readFileSync(path.join(HERE, '../../validation/results_ml.json'), 'utf8'));
const SYSF = path.join(HERE, '../../validation/results_system.json');
const SYS = fs.existsSync(SYSF) ? JSON.parse(fs.readFileSync(SYSF, 'utf8')) : null;

const FONT = 'Times New Roman';
const BODY = 21;            // 10.5 pt (half-points), as in the VIT form
const W = 9906;             // text width in DXA (A4 with 1000 DXA side margins)
const pct = (x, dp = 1) => (100 * x).toFixed(dp) + '%';

// ------------------------------------------------------------------ text helpers
const R = (text, o = {}) => new TextRun({ text, font: FONT, size: o.size || BODY, bold: o.bold, italics: o.italics, highlight: o.hl ? 'yellow' : undefined });
const runs = (parts, o = {}) => (Array.isArray(parts) ? parts : [parts]).map((p) => (typeof p === 'string' ? R(p, o) : R(p.t, { ...o, ...p })));
const P = (parts, o = {}) => new Paragraph({
  children: runs(parts, o), alignment: o.align || AlignmentType.JUSTIFIED,
  spacing: { before: o.before ?? 0, after: o.after ?? 100, line: o.line || 240 }, indent: o.indent,
  keepNext: o.keepNext ?? (typeof parts === 'string' && parts.trim().endsWith(':')),
});
const H1 = (t) => new Paragraph({ children: [R(t, { bold: true, size: 22 })], spacing: { before: 200, after: 100 }, keepNext: true });
const H2 = (t) => new Paragraph({ children: [R(t, { bold: true, size: 21 })], spacing: { before: 120, after: 80 }, keepNext: true });
const bullet = (t, o = {}) => new Paragraph({
  children: runs(t, o), numbering: { reference: 'dot', level: 0 },
  spacing: { after: 20, line: 240 }, alignment: AlignmentType.LEFT,
});
let listNo = 0;
const numbered = (items, o = {}) => {
  listNo += 1;
  return items.map((t) => new Paragraph({
    children: runs(t, { bold: o.bold !== false, size: o.size || 20 }),
    numbering: { reference: 'num', level: 0, instance: listNo },
    spacing: { after: 40, line: 240 }, alignment: AlignmentType.LEFT,
  }));
};
const caption = (t) => new Paragraph({ children: [R(t, { italics: true, size: 18 })], alignment: AlignmentType.CENTER, spacing: { before: 60, after: 160 } });
const picture = (file, wIn, wPx, hPx) => {
  const w = Math.round(wIn * 96), h = Math.round(w * hPx / wPx);
  return new Paragraph({ children: [new ImageRun({ data: img(file), type: 'png', transformation: { width: w, height: h } })], alignment: AlignmentType.CENTER, spacing: { before: 120, after: 40 }, keepNext: true });
};

// ------------------------------------------------------------------ math helpers
const mr = (t) => new MathRun(t);
const sub = (base, s) => new MathSubScript({ children: [mr(base)], subScript: [mr(s)] });
const frac = (num, den) => new MathFraction({ numerator: num, denominator: den });
const EQI = (name) => {
  const f = path.join('eq', name + '.png');
  const buf = img(f); const wPx = buf.readUInt32BE(16), hPx = buf.readUInt32BE(20);
  return new Paragraph({ children: [new ImageRun({ data: buf, type: 'png', transformation: { width: Math.round(wPx / 300 * 96 * 0.95), height: Math.round(hPx / 300 * 96 * 0.95) } })], alignment: AlignmentType.CENTER, spacing: { before: 60, after: 100 } });
};
const EQ = (...children) => new Paragraph({ children: [new OMath({ children })], alignment: AlignmentType.CENTER, spacing: { before: 60, after: 100 } });

// ------------------------------------------------------------------ table helpers
const B1 = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const ALLB = { top: B1, bottom: B1, left: B1, right: B1 };
const cell = (content, w, o = {}) => new TableCell({
  width: { size: w, type: WidthType.DXA }, borders: ALLB,
  shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
  verticalAlign: o.v || VerticalAlign.TOP, columnSpan: o.span, rowSpan: o.rowSpan,
  margins: { top: 40, bottom: 40, left: 70, right: 70 },
  children: (Array.isArray(content) ? content : [content]).map((c) => (c instanceof Paragraph ? c :
    new Paragraph({ children: runs(c, { size: o.size || 16, bold: o.bold }), alignment: o.align || AlignmentType.LEFT, spacing: { after: 0, line: 204 } }))),
});
const table = (widths, rows, o = {}) => new Table({
  width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: widths,
  rows: rows.map((r, i) => new TableRow({
    tableHeader: i === 0 && o.header !== false, cantSplit: true,
    height: o.rowH ? { value: o.rowH, rule: HeightRule.ATLEAST } : undefined,
    children: r.map((c, j) => {
      const isHead = i === 0 && o.header !== false;
      if (c && c.cell) return c.cell;
      return cell(c, widths[j], {
        fill: isHead ? (o.headFill || 'E7E6E6') : undefined, bold: isHead || (o.boldFirst && j === 0),
        align: isHead && o.headCenter !== false ? AlignmentType.CENTER : (o.align && o.align[j]) || (o.justify ? AlignmentType.JUSTIFIED : AlignmentType.LEFT),
        size: o.size, v: isHead ? VerticalAlign.CENTER : undefined,
      });
    }),
  })),
});
const spacer = (after = 60) => new Paragraph({ children: [], spacing: { after } });

// ------------------------------------------------------------------ header (same as the VIT form)
const HB = { style: BorderStyle.SINGLE, size: 8, color: '000000' };
const HBALL = { top: HB, bottom: HB, left: HB, right: HB };
const hcell = (children, w, o = {}) => new TableCell({
  width: { size: w, type: WidthType.DXA }, borders: HBALL, rowSpan: o.rowSpan, verticalAlign: VerticalAlign.CENTER,
  margins: { top: 20, bottom: 20, left: 80, right: 60 }, children,
});
const hp = (t, o = {}) => new Paragraph({ children: [new TextRun({ text: t, font: o.font || 'Arial', size: o.size || 16, bold: o.bold })], alignment: o.align || AlignmentType.LEFT, spacing: { after: 0, line: 220 } });
const HW = [2720, 4520, 1300, 1366];
const header = new Header({
  children: [
    new Paragraph({ children: [new TextRun({ text: '©VIT IPR&TTCELL', font: FONT, size: 21 })], spacing: { after: 40 } }),
    new Table({
      width: { size: W, type: WidthType.DXA }, columnWidths: HW,
      rows: [
        new TableRow({ height: { value: 300, rule: HeightRule.ATLEAST }, children: [
          hcell([new Paragraph({ children: [new ImageRun({ data: img('vit_logo.png'), type: 'png', transformation: { width: 152, height: 49 } })], alignment: AlignmentType.CENTER, spacing: { after: 0 } })], HW[0], { rowSpan: 3 }),
          hcell([hp('Invention Disclosure Format (IDF)-B', { font: FONT, size: 25, bold: true, align: AlignmentType.CENTER })], HW[1], { rowSpan: 3 }),
          hcell([hp('Document No.')], HW[2]), hcell([hp('02-IPR-R003')], HW[3]),
        ] }),
        new TableRow({ height: { value: 300, rule: HeightRule.ATLEAST }, children: [hcell([hp('Issue No/Date')], HW[2]), hcell([hp('2/01.02.2024')], HW[3])] }),
        new TableRow({ height: { value: 300, rule: HeightRule.ATLEAST }, children: [hcell([hp('Amd. No/Date')], HW[2]), hcell([hp('0/00.00.0000')], HW[3])] }),
      ],
    }),
  ],
});

// ================================================================== CONTENT
const C = [];
const add = (...x) => x.flat().forEach((e) => C.push(e));

// ---------------- 1-2
add(H1('1. Title of the invention:'),
  P('VITAL — IoT-Enabled Smart Health Monitoring and Emergency Alert System with AI-Based Anomaly Prediction for Smart City Integration', { bold: true, align: AlignmentType.LEFT }),
  H1('2. Field /Area of invention:'),
  P('This invention falls under embedded IoT systems for continuous health monitoring. It measures heart rate, blood-oxygen saturation (SpO₂) and body temperature, checks whether each reading can be trusted, learns what is normal for each person using machine learning, and warns early when a reading is drifting towards danger. Alerts are escalated in steps depending on how serious the situation is, and anonymised area-level health data can be shared with a smart-city platform.'));

// ---------------- 3
add(H1('3. Prior Patents and Publications from literature (provide a table summarizing the prior art)'), H2('A. Prior patent literature'));
const PW = [2476, 2477, 2476, 2477];
const PH = ['Reference / citation', 'What the work discloses', 'Relevance to VITAL', 'Technical gap / difference'];
add(table(PW, [PH,
  ['P1. US 8,909,330 B2 — Body-worn device and associated system for alarms/alerts based on vital signs and motion (Sotera Wireless Inc., 2014)',
    'A monitor worn on the body tracks vital signs and also works out what the wearer is doing (resting, walking, falling). Alarms come from fixed outer limits plus inner limits based on the patient\'s recent values. When movement spoils the readings, rule-based logic holds the alarm back. Data goes wirelessly to a nursing station.',
    'Of all the references we found, this one is closest to VITAL. It also monitors several vitals continuously, handles readings spoiled by motion, raises alarms and lets a supervisor watch remotely.',
    'Its limits are either preset or based on a short recent period. It does not build a long-term personal model from only the good-quality data, it does not estimate how long until a limit is reached, and it has no guardian messages or anonymised ward-level sharing.'],
  ['P2. US 2016/0302671 A1 — Prediction of health status from physiological data (Microsoft Technology Licensing LLC, 2016)',
    'A wearable optical sensor reads heart rate and breathing rate. Resting values are compared with the user\'s baseline from the previous few days. If the change passes a fixed or percentage threshold, classifiers (Gaussian mixture, discriminant analysis, SVM) estimate the health state and the chance of a fever coming on. With permission, results can be shared with caregivers.',
    'Like VITAL, it builds a personal baseline and uses machine learning to spot illness early, and it can tell caregivers.',
    'Its baseline works on day-level resting values, and it only throws away values that are physically impossible. Nothing checks the quality of each reading before it goes into the baseline. It also doesn\'t combine SpO₂ and temperature on one shared device, give a live time-to-threshold, or share data with a city platform in stages.'],
  ['P3. US 11,922,796 B2 — Predicting critical alarms (Koninklijke Philips N.V., 2024)',
    'Once a non-critical alarm has lasted a few seconds, a machine-learning model (for example boosted decision trees) looks at the last 1–3 minutes of heart rate, breathing rate, SpO₂ and heart-rate variability. It predicts whether a critical alarm will follow in roughly the next minute and alerts clinicians if so.',
    'It tries to catch deterioration before the critical alarm happens, which is the same goal as our trend warning.',
    'The prediction only starts after an alarm already exists, and it learns from past hospital alarm data over a very short horizon. There is no personal baseline, no easy-to-explain time-to-threshold, and it is not a low-cost home device with guardian and city alert levels.'],
  ['P4. US 12,125,597 B2 — Systems and methods for contagious illness surveillance and outbreak detection (Kinsa Health LLC, 2024)',
    'Connected smart thermometers send temperature readings with location to a central server. The server counts fevers in each region, looks for unusual rises that may mean an outbreak, and gives the combined figures to public-health bodies through APIs and dashboards.',
    'It groups home-device readings by region for public health, which is basically what our smart-city layer does.',
    'Here each user\'s readings and location are stored centrally, and only one parameter is measured, now and then. It has no emergency escalation for individuals, no personal anomaly detection, no merging of small regions, and no rule that identity leaves the home hub only for a consented critical alert.'],
], { size: 16, boldFirst: true, justify: true }));

add(H2('B. Research publications'));
add(table(PW, [PH,
  ['R1. S. Deshmukh, S. Shah, A. Wahedna and N. Sabnis (2025), "IoT-enabled smart healthcare system with machine learning for real-time vital sign monitoring and anomaly detection," Indonesian Journal of Electrical Engineering and Computer Science, 39(2), 1155–1163. DOI: 10.11591/ijeecs.v39.i2.pp1155-1163.',
    'An IoT system built on the MAX30102 streams vital signs and uses an LSTM network to predict upcoming values and detect anomalies.',
    'Same type of PPG sensor as ours, also with ML-based prediction and anomaly detection.',
    'The LSTM is a general time-series model. There is no robust baseline for each person, no quality check before training, no time-to-threshold and no alert or data-sharing levels.'],
  ['R2. P. Arpaia, F. Crauso, E. De Benedetto, L. Duraccio, G. Improta and F. Serino (2022), "Soft transducer for patient\'s vitals telemonitoring with deep learning-based personalized anomaly detection," Sensors, 22(2), 536. DOI: 10.3390/s22020536.',
    'A wearable telemonitoring platform that trains an LSTM autoencoder separately for each patient to find anomalies. The authors report over 93% accuracy.',
    'It shows that anomaly detection tuned to each patient works on vital signs, which supports our approach.',
    'It needs a deep model per patient. It does not check signal quality before training, has no simple trend projection with time-to-threshold, does not handle several users sharing one device, and has no privacy levels for city data.'],
  ['R3. R. Ahmad et al. (2022), "Development of blood oxygen level, heart rate and temperature monitoring system by using ESP32," Proc. 4th Int. Conf. on Smart Sensors and Application (ICSSA). DOI: 10.1109/ICSSA54161.2022.9870943.',
    'A home-monitoring prototype on the ESP32 with a MAX30102 and an infrared temperature sensor. Its accuracy was checked against a hospital patient monitor.',
    'The hardware is almost the same as ours, so it is a useful baseline for what the sensors can do.',
    'It only measures and shows the data remotely. There is no learning, prediction, emergency escalation or city link.'],
], { size: 16, boldFirst: true, justify: true }));
add(P('Where the prior art stops: Going through these references, we found that most of the individual pieces already exist somewhere. Wearable and IoT vital monitors, threshold alarms, ignoring alarms during motion, personal baselines, ML anomaly detection, short-term alarm prediction, caregiver alerts and regional grouping of home readings have all been done, alone or in partial combinations. What none of them do is link the steps the way VITAL does. In VITAL, every reading first goes through a quality check. Only readings that pass are tagged to whoever is logged in on the shared device and used to train that person\'s model. Each 10-second window is then compared with both the person\'s own per-vital baseline and an Isolation Forest. A steady-trend check estimates how long until a limit is crossed. Finally, the severity decides the alert level, and the amount of data shared grows only as severity grows: from the device itself, to a guardian, to a supervisor, and lastly to an anonymised ward-level city summary.', { before: 100 }));

// ---------------- 4
add(H1('4. Summary and background of the invention (Address the gap / Novelty)'), H2('Background and Gap'),
  P('Most cheap health monitors, and most of the student and research IoT projects we looked at, measure heart rate, SpO₂ and temperature and compare each value with fixed limits meant for the general population, such as heart rate above 100 bpm or SpO₂ below 95%. Everyone gets the same limits. So if someone\'s resting pulse goes from 58 to 80 bpm, that is a big change for them, but the device still calls it "normal". Meanwhile, a person whose usual pulse sits close to a limit keeps getting alarms for nothing.'),
  P('There is a second problem. Optical (PPG) readings get spoiled easily when the finger moves or isn\'t placed properly. Use those readings directly and you get false alarms. Use them to learn someone\'s baseline and the baseline quietly goes wrong. On top of that, most devices only alarm after a value has already crossed the limit, the alert stays on the device, and if the data is shared for public health at all, it usually goes out with the person\'s identity attached.'),
  P('VITAL handles this in stages. Every one-second reading first goes through a signal-quality model. Readings that fail are not shown as valid and are not learned from. The ones that pass are linked to whoever started the session on the shared device and grouped into 10-second windows. Each window is compared with that user\'s own model, which has two parts: a robust baseline for each vital and an Isolation Forest that looks at all features together. At the same time, a trend check estimates when a vital will cross a danger limit, if it keeps going the way it is.'),
  P('These three things (rules for sustained limits, the personal anomaly score and the trend projection) together decide how serious the situation is, and that decides the alert level. Each level tells more people and shares a bit more data. First the local display and the user page, then a Telegram message to a guardian, then the supervisor station. For population health, an anonymised ward-level summary goes to a city platform over MQTT. Small groups are merged, and the person\'s identity goes to emergency services only for a critical alert they have agreed to in advance.'),
  H2('Novelty Statement'),
  P('What is new in VITAL is not any single sensor, model or alert channel. It is the way quality checking, personal learning, trend projection and step-wise data sharing are tied together. Signal quality decides both what is shown and what is learned. Each user gets their own model even though they share one device, because readings are tied to the logged-in session. Anomalies are judged against that user\'s own baseline and pattern. A trend is only projected if it is steady, so a single jump doesn\'t cause a warning. And the same severity value decides both who gets alerted and how much data is shared. The references we cited each cover some of this (monitoring, personal baselines, alarm prediction, regional grouping), but none of them describe the full chain.'),
  P('For our bench-scale proof of concept, we built this with an ESP32 DevKit V1, a MAX30102 pulse-oximetry module, a GY-906 (MLX90614) infrared thermometer, a 0.96-inch SSD1306 OLED, a laptop running the server and a web dashboard. We also wrote a device simulator that sends exactly the same data format as the firmware. This let us test the whole pipeline, including dangerous cases like low oxygen that we obviously can\'t create safely on a person.'));

// ---------------- 5
add(H1('5. Objective(s) of Invention'), numbered([
  'Build a low-cost IoT monitor that keeps measuring heart rate, SpO₂ and body temperature and shows them on the device and on a live web dashboard.',
  'Check the quality of every reading, and keep readings spoiled by movement or bad finger placement out of the display, the alerts and the learning.',
  'Link readings from a shared device to the person logged in, so that each user gets their own personal model.',
  'Catch readings that are unusual for that particular person, using a robust per-vital baseline together with an Isolation Forest.',
  'Warn before a danger limit is crossed, by projecting steady trends and estimating how much time is left.',
  'Escalate step by step (local, guardian, supervisor, city) and share more data only when the situation is more serious.',
  'Give a smart-city platform ward-level health figures without sending anyone\'s identity, except in emergencies the user has agreed to.',
]));

// ---------------- 6
add(H1('6. Working principle of the invent (in brief)'), numbered([
  'The user logs in on the dashboard and starts a session. From then on, the shared device belongs to that user.',
  'The ESP32 reads the red and infrared channels of the MAX30102 (100 Hz, averaged down to 25 samples/s) and the skin temperature from the MLX90614. It works out heart rate and SpO₂ and sends one packet every second over Wi-Fi.',
  'The server gives each reading a quality score. Anything below the cut-off is thrown out.',
  'For readings that pass, skin temperature is turned into body temperature using the user\'s own offset, and the readings are grouped into 10-second windows.',
  'Each window is compared with the user\'s personal model (per-vital baseline plus Isolation Forest), giving an anomaly score from 0 to 1.',
  'A straight line is fitted to the last 10 minutes and extended 15 minutes ahead. If it crosses a danger limit and the rise is steady, the time left is estimated.',
  'The rules, the anomaly score and the projection together give the severity: normal, watch, early warning or critical.',
  'The severity picks the alert level: device and user page, Telegram to a guardian, alert at the supervisor station, and the anonymised ward summary for the city.',
  'Good-quality windows are saved to the user\'s history, and the personal model is retrained from time to time.',
]), P('In our prototype, the server runs on a laptop and anyone on the same network can open the dashboard in a browser. For dangerous conditions, we use the device simulator, which sends the same message format as the ESP32 firmware.', { before: 60 }));

// ---------------- 7
add(H1('7. Description of the invention in detail (Include drawing and or photograph as needed)'),
  P('VITAL works as a chain of stages. A low-cost embedded device takes the readings, the server checks whether they are reliable, learns what is normal for each user, looks for signs of things getting worse and raises alerts based on how serious it is. At each level, only as much personal data is shared as is actually needed.'),
  H2('7.1 System architecture'), P('Our implementation has these parts:'),
  bullet('an ESP32 DevKit V1 microcontroller (dual core, built-in Wi-Fi);'),
  bullet('a MAX30102 red/infrared PPG module for heart rate and SpO₂;'),
  bullet('a GY-906 (MLX90614) infrared thermometer that reads skin temperature without contact;'),
  bullet('a 0.96-inch SSD1306 OLED that shows readings and alerts on the device;'),
  bullet('a server with a database, the signal-quality, personal-model and trend modules, and the alert service;'),
  bullet('a web dashboard with user, supervisor and city views; and'),
  bullet('Telegram (through the Bot API) for messages, and MQTT for sending data to the city platform.'),
  P('The overall flow is: Sensors → Signal-quality gate → User-attributed windows → Personal anomaly score and trend projection → Severity → Escalation tier.', { align: AlignmentType.CENTER, before: 60 }),
  picture('fig1_architecture.png', 5.0, 1700, 1450), caption('Figure 1. Proposed VITAL staged monitoring and escalation architecture.'),
  P('All three modules sit on the same I²C bus of the ESP32 (SDA on GPIO 21, SCL on GPIO 22), each with its own address: MAX30102 at 0x57, MLX90614 at 0x5A and the OLED at 0x3C. They are powered from the 3.3 V pin. We run the bus at 100 kHz because that is the fastest the MLX90614 supports. The firmware uses both cores of the ESP32. Core 1 handles sensor sampling, beat detection and the display. Wi-Fi runs as a separate FreeRTOS task on core 0, and the two talk through a queue. This way, a slow network never makes us lose sensor samples.'),
  picture('cirkit_wiring.png', 4.6, 2670, 2050), caption('Figure 2. Wiring diagram of the VITAL sensing node (Cirkit Designer).'),
  picture('easyeda_schematic.png', 6.0, 3174, 1947), caption('Figure 3. Circuit schematic of the VITAL sensing node (EasyEDA).'));

add(H2('7.2 Vital-sign acquisition'),
  P('With every heartbeat, the amount of blood in the fingertip changes slightly, and so does the amount of light it absorbs. The steady (DC) part of the PPG signal comes from tissue and blood that isn\'t pulsing. The pulsing (AC) part comes from arterial blood. We get heart rate from the average gap between the last four detected beats:'),
  EQI('hr'),
  P('SpO₂ comes from comparing the pulsing part of the red and infrared signals, each divided by its steady part. The ESP32 calculates this with Maxim\'s reference algorithm over a 4-second buffer:'),
  EQI('ratio'),
  P('The MLX90614 measures skin temperature, which is lower than body temperature. To correct this, each user is calibrated once against a normal thermometer, which gives a personal offset δ_u:'),
  EQI('temp'),
  H2('7.3 Signal-quality gate'),
  P('For every reading, we look at the last five seconds of the infrared waveform x and compute three things: the perfusion index (how strong the pulse is), how rough the waveform is, and how much the heart rate jumped since the last reading:'),
  EQI('quality'),
  P('A logistic-regression model turns these three values into a quality score q from 0 to 100. If q is below 40, the reading is rejected. It is not shown as a valid value, cannot cause an alert and is not saved. To train the personal model we are even stricter and only use windows with an average q of 60 or more. That way, moving fingers and bad placement can\'t mess up the baseline.'),
  H2('7.4 User attribution and window features'),
  P('When a user starts a measurement session, the shared device is tied to them, so every accepted reading is saved under that user. Every 10 accepted readings make one window, described by:'),
  EQI('features'));

add(H2('7.5 Personal anomaly scoring'),
  P('Each user\'s model is trained only on their own good-quality windows. It needs at least 30 windows (about five minutes) to start, and it is retrained after every 60 new windows. The model has two parts that cover for each other. The first is a simple but robust baseline for each vital. For heart rate, SpO₂ and temperature, we take the median and the scaled median absolute deviation (MAD). We also set a minimum spread so the model doesn\'t get too jumpy for very steady users. This tells us how far a value is from the person\'s normal, in their own units:'),
  EQI('z'),
  P('The second part is an Isolation Forest with 200 trees that looks at all five window features together. It is good at noticing when several vitals have each changed a little at the same time. Its raw score r is scaled using the user\'s own training scores:'),
  EQI('sif'),
  P('Here σ is the logistic function, and r₉₉ and r₅₀ are the 99th and 50th percentiles of the user\'s training scores. The final anomaly score for a window is the highest of the three:'),
  EQI('s'),
  P('s_pop is a score based on population limits, so a reading outside the general safe range is always treated as unusual, whatever the personal model says. A new user who doesn\'t have enough data yet is scored on s_pop alone. We picked the constants using a separate calibration data set, before running the held-out tests in Section 8.'),
  H2('7.6 Steady-trend projection'),
  P('For heart rate, SpO₂ and temperature, we average the last 10 minutes into 10-second points and fit a straight line y = a + b·t (t in minutes, t = 0 is now). We only consider a warning when three conditions hold. There must be at least two minutes of data. The change projected over the next 15 minutes must be more than a small minimum. And the trend must be steady, which means the older half and the newer half of the window both move the same way, each at least half as fast as the overall slope:'),
  EQI('steady'),
  P('d is +1 for a limit that is reached by rising (temperature 38.0 °C, heart rate 120 bpm) and −1 for one reached by falling (SpO₂ 92%). If the 15-minute projection crosses the limit L but the current fitted value hasn\'t yet, the estimated time left is:'),
  EQI('cross'),
  P('We added the steadiness check after our first version kept raising false warnings. Without it, a single jump, like the temperature changing when someone walks in from outside, was being stretched into a fake early warning.'));

add(H2('7.7 Severity decision and escalation'),
  P('The rules, the anomaly score and the projection are checked together. A limit rule only counts if the value stays past the limit for 10 seconds, and the same kind of alert is not repeated within five minutes.'),
  table([2700, 1700, 5506], [
    ['Condition', 'Severity', 'Escalation and disclosure'],
    ['All vitals within personal and population ranges', 'Normal', 'Local display and user page only'],
    ['Anomaly score ≥ 0.6, or a vital moderately outside range (e.g. SpO₂ < 95%, HR > 100)', 'Watch', 'Plain-language guidance on the user page; no data leaves the hub'],
    ['Steady trend projected to cross a limit within 15 minutes', 'Early warning', 'Guardian Telegram message with estimated time-to-threshold; supervisor log'],
    ['SpO₂ < 90%, HR > 120 or < 45 bpm, or temperature ≥ 38.5 °C for 10 s; or anomaly ≥ 0.7 in three consecutive windows (not during exertion)', 'Critical', 'OLED and user-page alarm, guardian Telegram message, red supervisor tile; with prior consent, name, location and the last five minutes of readings to 108 / hospital'],
    ['Signal quality q < 40 or no finger detected', 'Inconclusive', 'Reading rejected; user asked to reposition the finger; nothing learned'],
  ], { size: 16, align: [AlignmentType.LEFT, AlignmentType.CENTER, AlignmentType.LEFT] }),
  P('So the severity decides two things at once: what the system does, and how much personal data goes out.', { before: 80 }));

add(H2('7.8 Privacy-preserving smart-city integration'),
  P('This part is a design that we have implemented in software but not connected to a real city system. Every VITAL hub (a home, hostel or clinic) sends an hourly summary for its ward to the city platform over MQTT, on the topic city/<city>/health/<ward>/summary. The summary has only counts and averages:'),
  bullet('how many people and readings there were in the ward;'),
  bullet('how many people had a fever (window temperature ≥ 37.8 °C) and how many critical alerts there were; and'),
  bullet('the average heart rate, SpO₂ and temperature.'),
  P('If a ward has fewer than 10 people, it is merged into the city total so nobody can be picked out. The city platform marks a ward as a possible outbreak cluster when more than 10% of its people have a fever. Names, device IDs and raw signals stay inside the hub. The only exception is a critical emergency the user has agreed to beforehand (Section 7.7). We based this on the consent, purpose-limitation and data-minimisation ideas in India\'s Digital Personal Data Protection Act, 2023.'),
  picture('ui_city.png', 5.6, 1440, 1004), caption('Figure 4. City view: ward fever map and the anonymised MQTT message published for a ward.'),
  H2('7.9 User interfaces'),
  P('The user page shows the live pulse waveform, the three vitals and short plain-English notes comparing them with the user\'s own normal. A Simple/Detailed switch opens a detailed view with the raw signals, signal quality, anomaly score, health state and trend projection. The supervisor station shows every user as a live tile. If someone has a critical alert, their tile turns red and shows the reason.'),
  picture('ui_user_alert.png', 5.6, 1440, 900), caption('Figure 5. User page during a critical low-SpO₂ alert.'),
  picture('ui_admin_station.png', 5.6, 1440, 918), caption('Figure 6. Supervisor station: the affected user\'s tile turns red with the alert reason.'));

add(H2('7.10 Measurement safeguards'), P('To keep the readings and alerts trustworthy, we added these safeguards:'),
  bullet('the infrared level is checked first to make sure a finger is actually on the sensor;'),
  bullet('heart rates that are physically impossible (below 30 or above 220 bpm) are thrown out, and the rest are averaged over four beats;'),
  bullet('the signal-quality gate controls display, alerts and learning;'),
  bullet('a critical condition has to last 10 seconds before it raises an alert;'),
  bullet('anomaly alerts are switched off while the user is exerting themselves (state "Elevated");'),
  bullet('the same kind of alert waits five minutes before it can repeat;'),
  bullet('temperature is calibrated for each user; and'),
  bullet('personal scoring only starts once there is enough personal data.'),
  H2('7.11 Simplified experimental proof of concept'),
  P('The idea can be shown with a small bench setup: the ESP32, MAX30102, MLX90614 and OLED on a breadboard, plus a laptop running the server. With this setup:'),
  bullet('the firmware measures heart rate, SpO₂ and skin temperature and sends one packet per second;'),
  bullet('the server works out signal quality, the personal anomaly score, the trend projection and the severity;'),
  bullet('alerts appear on the OLED, the user page and the supervisor station, and go to a guardian on Telegram; and'),
  bullet('the device simulator, using the same message format, plays out situations like falling oxygen that can\'t be safely created in a real person.'),
  H2('7.12 Distinguishing technical mechanism'),
  P('Put simply, the core of VITAL is one chain that connects reliability, personalisation, prediction and data sharing:'),
  P('Quality-gated reading  →  Personal anomaly + steady-trend projection  →  Severity  →  Disclosure-scoped escalation', { bold: true, align: AlignmentType.CENTER }),
  P('Signal quality controls both the alerts and the learning. Anomalies are judged against the person\'s own model, not a general one. Only steady trends are projected. And the severity decides both who is told and how much personal data is shared.'));

// ---------------- 8
const A = ML.A, Bv = ML.B, Cq = ML.C, Dq = ML.D;
const row = (k) => A.rows.find((r) => r.case.startsWith(k));
const nNormal = row('Healthy held-out').n;
add(H1('8. Experimental validation results:'), H2('8.1 Software simulation and system-level validation'),
  P(`We tested the actual VITAL code in three ways. First, we tested the machine-learning modules offline on simulated users, using fixed random seeds and the exact same model code that the server runs. Second, we ran the full system end to end: the server, database, alert service and dashboard API all handled live data coming from the device simulator. Third, we checked the ESP32 firmware and the device message format. We tuned the constants on a separate calibration set, so every result below is on data the models had not seen.`, { size: 20 }),
  P('Summary of the software tests', { bold: true, after: 40, keepNext: true }));
const sysSummary = (() => {
  if (!SYS) return 'Pending';
  const by = (sc) => SYS.filter((r) => r.scenario === sc);
  const crit = [...by('low_oxygen'), ...by('high_hr')];
  const fev = by('fever');
  const calm = [...by('normal'), ...by('exercise')];
  return `${SYS.length} real-time runs over 7 scenarios: ${crit.filter((r) => r.first_critical_s != null).length}/${crit.length} expected critical alerts raised; ${fev.filter((r) => r.first_warning_s != null).length}/${fev.length} fever early warnings; ${calm.reduce((x, r) => x + r.critical_alerts, 0)} critical alerts in ${calm.length} normal/exercise runs.`;
})();
const tBlue = { size: 15, headFill: 'DEEAF6', headCenter: false };
add(table([3100, 1500, 5306], [
  ['Evidence layer', 'Status', 'Result'],
  ['Personal anomaly detection (offline)', 'PASS', `${A.people} simulated users, ${A.train_windows_per_person} training windows each; ${nNormal.toLocaleString('en-US')} held-out healthy windows plus 7,360 abnormal windows.`],
  ['Trend prediction (offline)', 'PASS', `${Bv.temp.trajectories + Bv.spo2.trajectories} deteriorating and ${Bv.no_rise.stable.trajectories + Bv.no_rise.step.trajectories} non-deteriorating trajectories; all deteriorations warned before crossing; 0 false warnings.`],
  ['Signal-quality gate (offline)', 'PASS', `${Cq.clean.n * 3} held-out waveforms (clean, motion, poor placement).`],
  ['Health-state classifier (offline)', 'PASS', `${Dq.n.toLocaleString('en-US')} held-out windows, 4 states.`],
  ['End-to-end system runs (simulator)', SYS ? 'PASS' : 'Pending', sysSummary],
  ['ESP32 firmware', 'PASS (host check)', 'Both sketches checked against the actual SparkFun MAX3010x and Adafruit MLX90614 / SSD1306 / GFX / BusIO library headers with no errors or warnings. Compilation for the ESP32 target is part of the bench test (8.2).'],
  ['Device message contract', 'PASS', 'Firmware-format packets accepted; wrong device key rejected (HTTP 403); missing temperature sensor handled without failure.'],
], tBlue));

add(P('Personal anomaly detection compared with fixed population thresholds (flag at score ≥ 0.7)', { bold: true, before: 140, after: 40, keepNext: true }));
add(table([3900, 900, 1270, 1270, 1270, 1296], [
  ['Held-out case', 'Windows', 'Fixed limits', 'Isolation Forest only', 'Personal baseline only', 'VITAL combined'],
  ...A.rows.map((r) => [r.case.replace(' (detected)', '').replace(' (false alarms)', ''), r.n.toLocaleString('en-US'),
    pct(r.fixed), pct(r.if_only), pct(r.base_only), pct(r.vital)]),
], { ...tBlue, align: [0, 2, 2, 2, 2, 2].map((a) => (a ? AlignmentType.CENTER : AlignmentType.LEFT)) }));
add(P('The first two rows show false alarms on healthy windows (lower is better). The rest show how often the problem was caught (higher is better). "Fixed limits" means HR outside 50–100 bpm, SpO₂ below 95% or temperature of 37.5 °C or more.', { size: 18, italics: true, before: 40 }));

add(P('Trend-prediction results', { bold: true, before: 120, after: 40, keepNext: true }));
const f1 = (x) => (x == null ? '-' : x.toFixed(1) + ' min');
add(table([4700, 2600, 2606], [
  ['Measure', 'Temperature → 38.0 °C', 'SpO₂ → 92%'],
  ['Deteriorating trajectories', String(Bv.temp.trajectories), String(Bv.spo2.trajectories)],
  ['Warned before the limit was crossed', `${Bv.temp.warned_before_crossing} (${pct(Bv.temp.warned_before_crossing / Bv.temp.trajectories, 0)})`, `${Bv.spo2.warned_before_crossing} (${pct(Bv.spo2.warned_before_crossing / Bv.spo2.trajectories, 0)})`],
  ['Median warning lead time', f1(Bv.temp.lead_median_min), f1(Bv.spo2.lead_median_min)],
  ['Lead time exceeded in 90% of cases', f1(Bv.temp.lead_p10_min), f1(Bv.spo2.lead_p10_min)],
  ['Median error of estimated time-to-threshold', f1(Bv.temp.eta_abs_error_median_min), f1(Bv.spo2.eta_abs_error_median_min)],
  ['False warnings: stable temperature', `${Bv.no_rise.stable.false_warnings} / ${Bv.no_rise.stable.trajectories}`, '-'],
  ['False warnings: one-off temperature jump (+0.3 to +0.6 °C)', `${Bv.no_rise.step.false_warnings} / ${Bv.no_rise.step.trajectories}`, '-'],
], { ...tBlue, align: [AlignmentType.LEFT, AlignmentType.CENTER, AlignmentType.CENTER] }));

add(P('Signal-quality gate and health-state classifier', { bold: true, before: 120, after: 40, keepNext: true }));
add(table([4700, 2600, 2606], [
  ['Held-out waveform type', 'Waveforms', 'Accepted (q ≥ 40)'],
  ['Clean pulse', String(Cq.clean.n), `${Cq.clean.accepted} (${pct(Cq.clean.accepted / Cq.clean.n)})`],
  ['Moving finger (motion artefacts)', String(Cq.motion.n), `${Cq.motion.accepted} (${pct(Cq.motion.accepted / Cq.motion.n)})`],
  ['Poor placement (weak pulse)', String(Cq['poor placement'].n), `${Cq['poor placement'].accepted} (${pct(Cq['poor placement'].accepted / Cq['poor placement'].n)})`],
  ['Health-state classifier, held-out windows', Dq.n.toLocaleString('en-US'), `accuracy ${pct(Dq.accuracy)}`],
], { ...tBlue, align: [AlignmentType.LEFT, AlignmentType.CENTER, AlignmentType.CENTER] }));

if (SYS) {
  add(P('End-to-end system runs (server + device simulator, real time)', { bold: true, before: 120, after: 40, keepNext: true }));
  const names = { normal: 'Normal resting', exercise: 'After exercise (HR ≈ 112)', low_oxygen: 'Oxygen dropping', high_hr: 'High HR at rest (≈ 134)', fever: 'Developing fever', noisy: 'Moving finger', no_finger: 'No finger' };
  const order = ['normal', 'exercise', 'low_oxygen', 'high_hr', 'fever', 'noisy', 'no_finger'];
  const mean = (xs) => xs.reduce((x, y) => x + y, 0) / xs.length;
  const rowsS = order.map((sc) => {
    const rs = SYS.filter((r) => r.scenario === sc);
    const crit = rs.filter((r) => r.first_critical_s != null);
    const warn = rs.filter((r) => r.first_warning_s != null);
    const stored = mean(rs.map((r) => Math.min(1, r.readings_stored / r.seconds)));
    const nWarn = rs.reduce((a, r) => a + r.warnings, 0), nCrit = rs.reduce((a, r) => a + r.critical_alerts, 0);
    let outcome;
    if (sc === 'low_oxygen') outcome = `${crit.length}/${rs.length} critical; first alert after mean ${mean(crit.map((r) => r.first_critical_s)).toFixed(0)} s, raised by the personal-anomaly path before SpO₂ fell below 90% in every run`;
    else if (sc === 'high_hr') outcome = `${crit.length}/${rs.length} critical (heart-rate rule); mean ${mean(crit.map((r) => r.first_critical_s)).toFixed(0)} s after onset`;
    else if (sc === 'fever') outcome = `${warn.length}/${rs.length} early warning, mean ${mean(warn.map((r) => r.first_warning_s)).toFixed(0)} s; ${crit.length}/${rs.length} critical from the personal-anomaly path (mean ${mean(crit.map((r) => r.first_critical_s)).toFixed(0)} s) while temperature was below 38 °C`;
    else if (sc === 'exercise') outcome = `${nCrit} critical alerts (anomaly suppressed during exertion); ${nWarn} heart-rate trend warning in ${rs.length} runs`;
    else outcome = `${nCrit} critical alerts; ${nWarn} warnings`;
    return [names[sc], String(rs.length), rs[0].expected, outcome, pct(stored, 0)];
  });
  add(table([2150, 700, 2000, 3756, 1300], [['Scenario', 'Runs', 'Expected', 'Observed', 'Readings accepted'], ...rowsS],
    { ...tBlue, align: [AlignmentType.LEFT, AlignmentType.CENTER, AlignmentType.LEFT, AlignmentType.LEFT, AlignmentType.CENTER] }));
}
add(P('What the results mean: We ran the whole pipeline on simulated users, both healthy ones and ones getting worse. In the offline tests, the personal baseline caught every personal change that still looked "normal" to fixed limits, and the combined score kept false alarms on healthy windows well under one percent. On its own, the Isolation Forest was poor at catching one vital drifting far away, but it helped with several vitals changing a little together, which is why we kept both parts. The steadiness check got rid of false warnings from one-off jumps, and every steady decline was still warned several minutes early. In the live system runs, the personal-anomaly path raised the first alert in the oxygen-drop and fever cases before any population limit was crossed. The quality gate threw out almost all moving-finger readings, and there were no critical alerts in the normal or exercise runs. There was one heart-rate trend warning during exercise, so long periods of exertion can still trigger a trend warning. These are simulation results under our own models, not clinical accuracy. We are aware of some limitations: the users and waveforms are simulated, the health-state classifier was trained and tested on generated examples (its 100% just means the synthetic classes are easy to separate), and real finger readings will be noisier than the simulator.', { size: 19, before: 100 }));

add(H2('8.2 Physical laboratory bench validation'),
  P([{ t: '[To be completed after the bench test.] ', hl: true }, 'Our physical prototype has an ESP32 DevKit V1, a MAX30102 module, a GY-906 MLX90614 module and a 0.96-inch SSD1306 OLED on a breadboard. I²C runs on GPIO 21 (SDA) and GPIO 22 (SCL) at 100 kHz, and the board talks to the laptop server over Wi-Fi. We first run a sensor-test sketch to confirm all three I²C devices are found, then load the VITAL firmware, which sends one packet per second. We compare the readings with a regular fingertip pulse oximeter and a clinical thermometer.']),
  table([4950, 4956], [
    [{ cell: new TableCell({ width: { size: 4950, type: WidthType.DXA }, borders: ALLB, verticalAlign: VerticalAlign.CENTER, children: [new Paragraph({ children: [R('[Insert photograph of the bench prototype]', { hl: true, size: 18 })], alignment: AlignmentType.CENTER, spacing: { before: 1400, after: 1400 } })] }) },
      { cell: new TableCell({ width: { size: 4956, type: WidthType.DXA }, borders: ALLB, verticalAlign: VerticalAlign.CENTER, children: [new Paragraph({ children: [R('[Insert close-up of the ESP32, sensors and OLED]', { hl: true, size: 18 })], alignment: AlignmentType.CENTER, spacing: { before: 1400, after: 1400 } })] }) }],
  ], { header: false }),
  new Paragraph({ children: [R('Figure 7. Physical bench setup of the VITAL prototype.', { italics: true, size: 18 }), R('                              '), R('Figure 8. Close-up of the sensing node.', { italics: true, size: 18 })], alignment: AlignmentType.CENTER, spacing: { before: 60, after: 120 } }),
  table([3300, 2200, 2200, 2206], [
    ['Observed parameter', 'Reference device', 'VITAL', 'Difference'],
    ['I²C devices detected (0x3C, 0x57, 0x5A)', '-', [R('[ ]', { hl: true, size: 16 })], '-'],
    ['Heart rate at rest (bpm)', [R('[ ]', { hl: true, size: 16 })], [R('[ ]', { hl: true, size: 16 })], [R('[ ]', { hl: true, size: 16 })]],
    ['SpO₂ at rest (%)', [R('[ ]', { hl: true, size: 16 })], [R('[ ]', { hl: true, size: 16 })], [R('[ ]', { hl: true, size: 16 })]],
    ['Temperature after calibration (°C)', [R('[ ]', { hl: true, size: 16 })], [R('[ ]', { hl: true, size: 16 })], [R('[ ]', { hl: true, size: 16 })]],
    ['Packet delivery to server (packets / min)', '60', [R('[ ]', { hl: true, size: 16 })], [R('[ ]', { hl: true, size: 16 })]],
    ['OLED shows readings and ALERT from server', '-', [R('[ ]', { hl: true, size: 16 })], '-'],
  ].map((r, i) => (i === 0 ? r : r.map((c) => (Array.isArray(c) ? [new Paragraph({ children: c, spacing: { after: 0 } })] : c)))), tBlue),
  P('Scope of the physical test: we do not create dangerous conditions (low SpO₂, fever, very high heart rate) in any person. Those cases are tested with the simulator in 8.1, which sends exactly the same message format as the real device.', { size: 20, before: 80 }),
  H2('8.3 Combined validation conclusion'),
  P('Putting it together, we have held-out tests of the anomaly detection, trend prediction, signal-quality and health-state modules; live end-to-end runs of the full server, alert and dashboard pipeline using the simulator; and a check of the ESP32 firmware against the real sensor libraries. The software tests show how the full monitoring and alert logic behaves under our models, and the bench test in 8.2 checks the sensing side on real hardware. For now, we place the invention at TRL 3 (Experimental proof of concept). Once the bench test in 8.2 is done, it can move up to TRL 4 (Technology validated in a lab).'));

// ---------------- 9
add(H1('9. What aspect(s) of the invention need(s) protection?'),
  P('We are mainly looking to protect the staged monitoring method and the way its stages depend on each other. The hardware itself (microcontroller, PPG sensor, thermometer, display) is standard and not what we are claiming.', { size: 18 }),
  ...numbered([
    'Quality-gated learning: A quality score for each reading decides whether it is shown, whether it can raise an alert, and whether it is used to train the user\'s personal model.',
    'Personal models on a shared device: Readings from one shared device are linked to whoever is logged in, and each user gets a separate personal model.',
    'Two-part personal scoring: Each window is checked against a robust per-vital baseline (median and MAD with a minimum spread) and an Isolation Forest scaled by the user\'s own scores, with population limits as a safety floor.',
    'Steady-trend time-to-threshold: A trend is only projected when the older and newer halves of the window agree in direction and rate, and the time left before a danger limit is estimated.',
    'Severity-based escalation: The severity picks both the alert level (local, guardian, supervisor, emergency services) and how much personal data is shared at that level.',
    'Privacy-preserving city summaries: Ward-level summaries, with small wards merged, are sent to a smart-city platform, and identity is released only for critical alerts the user has agreed to.',
    'Per-user temperature calibration: Body temperature is calculated from contactless skin temperature using an offset calibrated for each user against a normal thermometer.',
  ], { size: 18 }),
  P('Core protectable relationship:', { bold: true, size: 19, after: 20 }),
  P('A quality decision on every reading controls both alerts and personal-model learning on a device shared by several users. Each window is scored against the user\'s own robust baseline and multivariate model, only steady trends are projected to estimate the time left, and the resulting severity decides both who is alerted and how much personal data is shared, all the way up to anonymised ward-level smart-city reporting.', { italics: true, size: 18 }));

// ---------------- 10
add(H1('10. What is Technology readiness level of your invention? (Tick the appropriate TRL)'));
const TW = Array(9).fill(1100); TW[8] = 1106;
const tc = (t, w, o = {}) => cell(t, w, { size: o.size || 16, bold: o.bold, align: AlignmentType.CENTER, v: VerticalAlign.CENTER, span: o.span });
const TRL_DESC = ['Basic Principles observed', 'Technology concept formulated', 'Experimental proof of concept', 'Technology validated in a lab',
  'Technology validated in a relevant environment (industrially relevant in case of key enabling technologies)',
  'Technology demonstrated in a relevant environment (industrially relevant in case of key enabling technologies)',
  'System prototype demonstration in an operational environment', 'System complete and qualified',
  'Actual system proven in an operational environment (competitive manufacturing in case of key enabling technologies, or in space )'];
const SEL = 3;
add(new Table({
  width: { size: W, type: WidthType.DXA }, columnWidths: TW,
  rows: [
    new TableRow({ height: { value: 520, rule: HeightRule.ATLEAST }, children: [tc('Research', 3300, { bold: true, span: 3 }), tc('Development', 3300, { bold: true, span: 3 }), tc('Deployment', 3306, { bold: true, span: 3 })] }),
    new TableRow({ height: { value: 600, rule: HeightRule.ATLEAST }, children: TW.map((w, i) => tc(`TRL ${i + 1}`, w, { bold: true })) }),
    new TableRow({ height: { value: 3100, rule: HeightRule.ATLEAST }, children: TW.map((w, i) => tc(TRL_DESC[i], w, { size: 15 })) }),
    new TableRow({ height: { value: 480, rule: HeightRule.ATLEAST }, children: TW.map((w, i) => tc(i + 1 === SEL ? '✓' : '', w, { size: 26 })) }),
  ],
}));
add(P('Selected TRL: TRL 3 — Experimental proof of concept.', { bold: true, before: 100, align: AlignmentType.LEFT }),
  P('---------------------END OF THE DOCUMENT----------------------------', { bold: true, size: 17, align: AlignmentType.CENTER }));

// ================================================================== DOCUMENT
const doc = new Document({
  creator: 'Team VITAL', title: 'VITAL – Invention Disclosure Format (IDF)-B',
  styles: { default: { document: { run: { font: FONT, size: BODY } } } },
  numbering: {
    config: [
      { reference: 'dot', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 180 } } } }] },
      { reference: 'num', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.RIGHT, style: { paragraph: { indent: { left: 400, hanging: 260 } }, run: { bold: true } } }] },
    ],
  },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 2620, bottom: 1000, left: 1000, right: 1000, header: 520 } } },
    headers: { default: header },
    children: C,
  }],
});
Packer.toBuffer(doc).then((buf) => {
  const out = path.join(HERE, 'VITAL_IDF-B.docx');
  fs.writeFileSync(out, buf);
  console.log('written', out, SYS ? '(with system results)' : '(system results pending)');
});
