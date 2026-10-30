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
  P('Embedded Internet-of-Things systems for continuous physiological monitoring, with emphasis on multi-parameter vital-sign acquisition (heart rate, blood-oxygen saturation and body temperature), signal-quality-aware personal machine-learning anomaly detection, trend-based early warning, severity-tiered emergency alert escalation, and privacy-preserving aggregation of health indicators for smart-city platforms.'));

// ---------------- 3
add(H1('3. Prior Patents and Publications from literature (provide a table summarizing the prior art)'), H2('A. Prior patent literature'));
const PW = [2476, 2477, 2476, 2477];
const PH = ['Reference / citation', 'What the work discloses', 'Relevance to VITAL', 'Technical gap / difference'];
add(table(PW, [PH,
  ['P1. US 8,909,330 B2 — Body-worn device and associated system for alarms/alerts based on vital signs and motion (Sotera Wireless Inc., 2014)',
    'A body-worn monitor measures vital signs while classifying the wearer\'s activity state (resting, walking, falling). Alarms are generated from preset outer limits and inner limits derived from the patient\'s own recent values, and heuristic rules suppress alarms when motion corrupts readings. Data is sent wirelessly to a central nursing station.',
    'This is the closest functional reference because it combines continuous multi-parameter monitoring, motion-aware handling of unreliable readings, alarm generation, and remote viewing by a supervisor.',
    'Limits are preset or derived from a short recent period; the disclosure does not build a long-term personal baseline model trained only on quality-accepted data windows, does not project a trend to a numeric limit with an estimated time-to-threshold, and does not describe guardian messaging or anonymised ward-level aggregation.'],
  ['P2. US 2016/0302671 A1 — Prediction of health status from physiological data (Microsoft Technology Licensing LLC, 2016)',
    'A wearable optical sensor measures heart rate and respiration. Resting values are compared with a baseline formed from the user\'s preceding days; deviations beyond fixed or percentage thresholds trigger classifiers (Gaussian mixture, discriminant analysis, SVM) that estimate health state and the likelihood of an upcoming fever. Results may be shared with caregivers with permission.',
    'This reference is relevant because it uses a personal physiological baseline and machine learning to anticipate illness and can notify caregivers.',
    'The baseline operates on daily-scale resting statistics, and only physiologically impossible values are discarded; no per-reading signal-quality gate controls what enters the baseline. It does not combine SpO₂ and temperature on a shared multi-user device, estimate real-time time-to-threshold, or provide tiered disclosure to a city platform.'],
  ['P3. US 11,922,796 B2 — Predicting critical alarms (Koninklijke Philips N.V., 2024)',
    'After a non-critical alarm persists for a few seconds, a machine-learning model (e.g. boosted decision trees) analyses a 1–3 minute window of heart rate, respiration rate, SpO₂ and heart-rate variability and predicts whether a critical alarm will follow within about one minute; clinicians are alerted accordingly.',
    'This reference is relevant because it predicts deterioration from vital-sign windows before a critical alarm occurs.',
    'Prediction is triggered by an existing alarm and is learned from historical hospital alarm data over a short horizon. It does not use a learned personal baseline, an explainable time-to-threshold projection, or a low-cost home device with guardian and city escalation tiers.'],
  ['P4. US 12,125,597 B2 — Systems and methods for contagious illness surveillance and outbreak detection (Kinsa Health LLC, 2024)',
    'Networked smart thermometers send geolocated temperature readings to a central system that counts fevers per geographic region, detects atypical increases and outbreak signals, and provides aggregated illness indicators to public-health bodies through APIs and dashboards.',
    'This reference is relevant because it aggregates readings from home health devices by region for public-health use, which corresponds to VITAL\'s smart-city layer.',
    'The system stores per-user geolocated readings centrally and works on a single episodic parameter. It does not describe individual emergency escalation, personal anomaly detection, minimum-group merging of small regions, or a disclosure scheme in which identity leaves the local hub only for consented critical alerts.'],
], { size: 16, boldFirst: true, justify: true }));

add(H2('B. Research publications'));
add(table(PW, [PH,
  ['R1. S. Deshmukh, S. Shah, A. Wahedna and N. Sabnis (2025), "IoT-enabled smart healthcare system with machine learning for real-time vital sign monitoring and anomaly detection," Indonesian Journal of Electrical Engineering and Computer Science, 39(2), 1155–1163. DOI: 10.11591/ijeecs.v39.i2.pp1155-1163.',
    'A MAX30102-based IoT system streams vital signs and uses an LSTM network for time-series prediction of vital signs and anomaly detection.',
    'This reference is relevant because it combines the same class of PPG sensor with machine-learning prediction and anomaly detection.',
    'The model is a general time-series network; it does not maintain a robust per-person baseline, gate model training by signal quality, estimate time-to-threshold, or define escalation and disclosure tiers.'],
  ['R2. P. Arpaia, F. Crauso, E. De Benedetto, L. Duraccio, G. Improta and F. Serino (2022), "Soft transducer for patient\'s vitals telemonitoring with deep learning-based personalized anomaly detection," Sensors, 22(2), 536. DOI: 10.3390/s22020536.',
    'A wearable telemonitoring platform with an LSTM autoencoder trained per patient for personalised anomaly detection; reported anomaly-detection accuracy above 93%.',
    'This reference is relevant because it demonstrates personalised (per-patient) anomaly detection on vital signs.',
    'It relies on a deep model per patient and does not describe signal-quality-gated training, an explainable steady-trend projection with time-to-threshold, a shared multi-user device, or privacy-tiered city aggregation.'],
  ['R3. R. Ahmad et al. (2022), "Development of blood oxygen level, heart rate and temperature monitoring system by using ESP32," Proc. 4th Int. Conf. on Smart Sensors and Application (ICSSA). DOI: 10.1109/ICSSA54161.2022.9870943.',
    'An ESP32 home-monitoring prototype using a MAX30102 PPG module and an infrared temperature sensor, with accuracy compared against a hospital patient monitor.',
    'This reference is relevant because it uses essentially the same low-cost hardware platform as VITAL.',
    'It provides measurement and remote viewing only; it does not describe learning, prediction, emergency escalation or city-level integration.'],
], { size: 16, boldFirst: true, justify: true }));
add(P('Prior-art boundary: The cited literature shows that wearable and IoT vital-sign monitoring, threshold alarms, motion-aware alarm suppression, personal physiological baselines, machine-learning anomaly detection, short-horizon alarm prediction, caregiver notification and regional aggregation of home-device readings are already known individually or in partial combinations. VITAL differs in the coordinated staged relationship: every reading first passes a signal-quality gate; only quality-accepted readings are attributed to the logged-in user of a shared device and used to build that user\'s personal model; each 10-second window is scored against both a robust per-vital personal baseline and a multivariate Isolation Forest; a steady-trend projection estimates time-to-threshold; and the resulting severity selects an escalation tier whose disclosure scope grows with severity, from the local device to a guardian, a supervisor and finally an anonymised ward-level city summary.', { before: 100 }));

// ---------------- 4
add(H1('4. Summary and background of the invention (Address the gap / Novelty)'), H2('Background and Gap'),
  P('Low-cost health monitors and most student and research IoT prototypes measure heart rate, SpO₂ and temperature and compare each value against fixed population limits (for example, heart rate above 100 bpm or SpO₂ below 95%). The same limits are applied to every person. A change that is large for one individual — a resting pulse rising from 58 to 80 bpm — remains "normal", while a person whose usual resting pulse is close to a limit receives repeated alarms.'),
  P('Optical (PPG) readings are also easily corrupted by finger movement or poor placement. If such readings are used directly, they create false alarms; if they are used to learn a person\'s baseline, they silently distort it. In addition, alarms are usually raised only after a value has already crossed a limit, the alert stays on the device, and when data is shared for public-health purposes it is either not shared at all or shared with personal identity attached.'),
  P('VITAL addresses this gap through a staged monitoring procedure. Each one-second reading is first assessed by a signal-quality model; rejected readings are neither displayed as valid nor learned from. Accepted readings are attributed to the user who started a session on the shared device and are grouped into 10-second windows. Each window is scored against that user\'s own learned model, which combines a robust per-vital baseline with a multivariate Isolation Forest. In parallel, a steady-trend projection estimates when a vital sign will cross a danger limit.'),
  P('The severity determined from sustained-limit rules, the personal anomaly score and the trend projection then selects an escalation tier. Each tier widens the circle of people informed and the amount of data disclosed: the local display and user page; a guardian through a Telegram message; a supervisor station; and, for population health, an anonymised ward-level summary published to a city platform over MQTT, in which small groups are merged and identity is released to emergency services only for consented critical alerts.'),
  H2('Novelty Statement'),
  P('The distinguishing aspect of VITAL is the coordinated relationship between signal-quality gating, personal learning, trend projection and severity-tiered disclosure rather than any individual sensor, model or alert channel. Signal quality decides both what is shown and what is learned; personal models are learned per user on a shared device through session binding; anomaly is scored relative to that user\'s own robust baseline and multivariate pattern; a steady-trend condition prevents one-off jumps from being extrapolated; and the computed severity simultaneously determines the escalation tier and the scope of data disclosed. The cited approaches address monitoring, personal baselines, alarm prediction and regional aggregation in different forms, but the selected references do not disclose this complete coordinated relationship.'),
  P('For a bench-scale proof of concept, the same principle is implemented using an ESP32 DevKit V1, a MAX30102 pulse-oximetry module, a GY-906 (MLX90614) infrared thermometer, a 0.96-inch SSD1306 OLED display, a laptop server and a web dashboard. A device simulator that sends the same data format as the firmware allows the complete pipeline, including dangerous scenarios that cannot be produced safely on a person, to be validated without clinical risk.'));

// ---------------- 5
add(H1('5. Objective(s) of Invention'), numbered([
  'To develop a low-cost IoT monitor that continuously measures heart rate, SpO₂ and body temperature and displays them locally and on a live web dashboard.',
  'To assess the signal quality of every reading and exclude motion-corrupted or poorly placed readings from display, alerting and learning.',
  'To attribute readings from a shared device to the logged-in user so that a separate personal model is learned for each user.',
  'To detect readings that are unusual for the individual by combining a robust per-vital personal baseline with a multivariate Isolation Forest.',
  'To predict deterioration before a danger limit is crossed by projecting a steady trend and estimating the time remaining.',
  'To escalate according to severity through local, guardian, supervisor and city tiers, increasing the scope of disclosure only as severity increases.',
  'To provide privacy-preserving, ward-level health indicators to a smart-city platform without transmitting personal identity, except for consented emergencies.',
]));

// ---------------- 6
add(H1('6. Working principle of the invent (in brief)'), numbered([
  'A user logs in on the web dashboard and starts a session; the shared device is bound to that user.',
  'The ESP32 samples the MAX30102 red and infrared channels (100 Hz, averaged to 25 samples/s) and the MLX90614 skin temperature, computes heart rate and SpO₂, and sends one packet per second over Wi-Fi.',
  'The server computes a signal-quality score for each reading; readings below the acceptance level are rejected.',
  'Accepted readings are converted to body temperature using the user\'s calibrated offset and grouped into 10-second windows of features.',
  'Each window is scored against the user\'s personal model (robust per-vital baseline and Isolation Forest) to give an anomaly score between 0 and 1.',
  'A linear trend fitted to the last 10 minutes is projected 15 minutes ahead; if it crosses a danger limit while rising steadily, the time-to-threshold is estimated.',
  'Sustained-limit rules, the anomaly score and the projection determine the severity: normal, watch, early warning or critical.',
  'The severity selects the escalation tier: local display and user page, guardian Telegram message, supervisor station alert, and anonymised ward-level city summary.',
  'Quality-accepted windows are added to the user\'s history, and the personal model is periodically retrained.',
]), P('In the bench-scale proof-of-concept implementation, the server runs on a laptop and the dashboard is opened in a browser on any device on the same network. Dangerous physiological conditions are reproduced with a device simulator that sends the same message format as the ESP32 firmware.', { before: 60 }));

// ---------------- 7
add(H1('7. Description of the invention in detail (Include drawing and or photograph as needed)'),
  P('VITAL is a staged health-monitoring architecture that acquires vital signs on a low-cost embedded device, assesses their reliability, learns each user\'s normal behaviour, predicts deterioration and escalates according to severity, while limiting the personal data disclosed at each level.'),
  H2('7.1 System architecture'), P('The preferred implementation includes:'),
  bullet('an ESP32 DevKit V1 microcontroller (dual core, integrated Wi-Fi);'),
  bullet('a MAX30102 red/infrared PPG module for heart rate and SpO₂;'),
  bullet('a GY-906 (MLX90614) non-contact infrared thermometer for skin temperature;'),
  bullet('a 0.96-inch SSD1306 OLED display for local readings and alerts;'),
  bullet('a server with a database, the signal-quality, personal-model and trend-projection modules, and the alert service;'),
  bullet('a web dashboard with user, supervisor and city views; and'),
  bullet('a messaging interface (Telegram Bot API) and an MQTT publishing interface for the city platform.'),
  P('The monitoring chain is: Sensors → Signal-quality gate → User-attributed windows → Personal anomaly score and trend projection → Severity → Escalation tier.', { align: AlignmentType.CENTER, before: 60 }),
  picture('fig1_architecture.png', 5.0, 1700, 1450), caption('Figure 1. Proposed VITAL staged monitoring and escalation architecture.'),
  P('All three peripherals share the ESP32 I²C bus (SDA on GPIO 21, SCL on GPIO 22) at distinct addresses (MAX30102 at 0x57, MLX90614 at 0x5A, OLED at 0x3C) and are powered from the 3.3 V rail. The bus runs at 100 kHz, the maximum supported by the MLX90614. The firmware uses both processor cores: sensor sampling, beat detection and the display run on core 1, while Wi-Fi communication runs as a separate FreeRTOS task on core 0, connected by a queue so that network delays never cause lost sensor samples.'),
  picture('cirkit_wiring.png', 4.6, 2670, 2050), caption('Figure 2. Wiring diagram of the VITAL sensing node (Cirkit Designer).'),
  picture('easyeda_schematic.png', 6.0, 3174, 1947), caption('Figure 3. Circuit schematic of the VITAL sensing node (EasyEDA).'));

add(H2('7.2 Vital-sign acquisition'),
  P('Each heartbeat changes the volume of blood in the fingertip and therefore the light absorbed. The steady (DC) part of the PPG signal comes from tissue and non-pulsating blood, and the pulsating (AC) part from arterial blood. Heart rate is obtained from the average interval between detected beats over the last four beats:'),
  EQI('hr'),
  P('Blood-oxygen saturation is derived from the ratio of the normalised pulsatile components of the red and infrared channels, computed on the device using the Maxim reference algorithm over a 4-second buffer:'),
  EQI('ratio'),
  P('Body temperature is obtained from the MLX90614 skin (object) temperature and a per-user offset δ_u determined once against a reference thermometer:'),
  EQI('temp'),
  H2('7.3 Signal-quality gate'),
  P('For each reading, three features are computed from the most recent five seconds of the infrared waveform x: the perfusion index, the waveform roughness and the jump in heart rate since the previous reading:'),
  EQI('quality'),
  P('A logistic-regression model converts these features into a quality score q between 0 and 100. Readings with q < 40 are rejected; they are not displayed as valid measurements, do not trigger alerts and are not stored. Only windows with an average quality q ≥ 60 are used to train the personal model, so movement and poor finger placement cannot distort the learned baseline.'),
  H2('7.4 User attribution and window features'),
  P('A measurement session binds the shared device to the user who started it, so every accepted reading is attributed to that user. Every 10 accepted readings form a window described by the feature vector:'),
  EQI('features'));

add(H2('7.5 Personal anomaly scoring'),
  P('Each user\'s model is trained only on that user\'s quality-accepted windows (at least 30 windows, about five minutes) and retrained after every 60 new windows. It has two complementary parts. The first is a robust per-vital baseline: for heart rate, SpO₂ and temperature, the median and the scaled median absolute deviation (with a minimum spread to avoid over-sensitivity) give a deviation in personal standard units:'),
  EQI('z'),
  P('The second is an Isolation Forest (200 trees) over the five window features, which detects unusual combinations of moderately changed vitals. Its raw score r is normalised by the user\'s own training distribution:'),
  EQI('sif'),
  P('where σ is the logistic function and r₉₉ and r₅₀ are the 99th and 50th percentiles of the user\'s training scores. The anomaly score of the window is:'),
  EQI('s'),
  P('where s_pop is a population-limit score that ensures a reading outside general safe limits is always treated as unusual. Until a user has enough data, only s_pop is used. The calibration constants were selected on a separate calibration data set before the held-out validation in Section 8.'),
  H2('7.6 Steady-trend projection'),
  P('For heart rate, SpO₂ and temperature, the readings of the last 10 minutes are averaged into 10-second points and a straight line y = a + b·t is fitted (t in minutes, t = 0 now). A warning is considered only when at least two minutes of data exist, the projected change over the 15-minute horizon exceeds a minimum, and the trend is steady, i.e. the older half and the newer half of the window both move in the same direction at no less than half the overall rate:'),
  EQI('steady'),
  P('where d = +1 for a rising limit (temperature 38.0 °C, heart rate 120 bpm) and d = −1 for a falling limit (SpO₂ 92%). If the 15-minute projection crosses limit L while the present fitted value has not, the estimated time-to-threshold is:'),
  EQI('cross'),
  P('The steadiness condition prevents a one-off jump, such as a temperature change after the user moves from outdoors, from being extrapolated into a false early warning.'));

add(H2('7.7 Severity decision and escalation'),
  P('Rules, anomaly score and projection are evaluated together. Sustained conditions require the value to persist for 10 seconds, and a repeated alert of the same kind is suppressed for five minutes.'),
  table([2700, 1700, 5506], [
    ['Condition', 'Severity', 'Escalation and disclosure'],
    ['All vitals within personal and population ranges', 'Normal', 'Local display and user page only'],
    ['Anomaly score ≥ 0.6, or a vital moderately outside range (e.g. SpO₂ < 95%, HR > 100)', 'Watch', 'Plain-language guidance on the user page; no data leaves the hub'],
    ['Steady trend projected to cross a limit within 15 minutes', 'Early warning', 'Guardian Telegram message with estimated time-to-threshold; supervisor log'],
    ['SpO₂ < 90%, HR > 120 or < 45 bpm, or temperature ≥ 38.5 °C for 10 s; or anomaly ≥ 0.7 in three consecutive windows (not during exertion)', 'Critical', 'OLED and user-page alarm, guardian Telegram message, red supervisor tile; with prior consent, name, location and the last five minutes of readings to 108 / hospital'],
    ['Signal quality q < 40 or no finger detected', 'Inconclusive', 'Reading rejected; user asked to reposition the finger; nothing learned'],
  ], { size: 16, align: [AlignmentType.LEFT, AlignmentType.CENTER, AlignmentType.LEFT] }),
  P('The severity therefore determines both the response and the scope of personal data released.', { before: 80 }));

add(H2('7.8 Privacy-preserving smart-city integration'),
  P('Each VITAL hub (home, hostel or clinic) publishes an hourly ward-level summary to the city platform over MQTT on the topic city/<city>/health/<ward>/summary. The summary contains only counts and averages:'),
  bullet('number of people and readings in the ward;'),
  bullet('number of people with fever (window temperature ≥ 37.8 °C) and number of critical alerts; and'),
  bullet('average heart rate, SpO₂ and temperature.'),
  P('Wards with fewer than 10 people are merged into the city total so that no individual can be singled out. The city platform flags a ward whose fever rate exceeds 10% as a possible outbreak cluster. Names, device identifiers and raw signals never leave the hub, except in a consented critical emergency as described in Section 7.7. The design follows the consent, purpose-limitation and data-minimisation principles of India\'s Digital Personal Data Protection Act, 2023.'),
  picture('ui_city.png', 5.6, 1440, 1004), caption('Figure 4. City view: ward fever map and the anonymised MQTT message published for a ward.'),
  H2('7.9 User interfaces'),
  P('The user page presents the live pulse waveform, the three vital signs and plain-language explanations relative to the user\'s own baseline, with a switch to a detailed view showing the raw signals, signal quality, anomaly score, health state and trend projection. The supervisor station shows every user as a live tile that turns red with the reason when a critical alert occurs.'),
  picture('ui_user_alert.png', 5.6, 1440, 900), caption('Figure 5. User page during a critical low-SpO₂ alert.'),
  picture('ui_admin_station.png', 5.6, 1440, 918), caption('Figure 6. Supervisor station: the affected user\'s tile turns red with the alert reason.'));

add(H2('7.10 Measurement safeguards'), P('To support reliable operation, the system uses:'),
  bullet('finger detection from the infrared level before any calculation;'),
  bullet('rejection of physiologically impossible heart rates (outside 30–220 bpm) and averaging over four beats;'),
  bullet('the signal-quality gate for display, alerting and learning;'),
  bullet('a 10-second persistence requirement before critical alerts;'),
  bullet('suppression of anomaly alerts during exertion (state "Elevated");'),
  bullet('a five-minute cooldown for repeated alerts of the same kind;'),
  bullet('per-user temperature calibration; and'),
  bullet('a minimum amount of personal data before personal scoring is used.'),
  H2('7.11 Simplified experimental proof of concept'),
  P('The mechanism can be demonstrated with a minimal bench arrangement consisting of the ESP32, MAX30102, MLX90614, OLED, breadboard and a laptop server. In this arrangement:'),
  bullet('the firmware measures heart rate, SpO₂ and skin temperature and sends one packet per second;'),
  bullet('the server computes signal quality, personal anomaly scores, trend projections and severity;'),
  bullet('alerts are shown on the OLED, the user page and the supervisor station and sent to a guardian through Telegram; and'),
  bullet('a device simulator using the identical message format reproduces deterioration scenarios that cannot be induced safely in a person.'),
  H2('7.12 Distinguishing technical mechanism'),
  P('The central technical mechanism links reliability, personalisation, prediction and disclosure in one staged chain:'),
  P('Quality-gated reading  →  Personal anomaly + steady-trend projection  →  Severity  →  Disclosure-scoped escalation', { bold: true, align: AlignmentType.CENTER }),
  P('Signal quality controls both alerting and learning; anomaly is evaluated against the individual\'s own learned model; prediction is restricted to steady trends; and severity determines simultaneously who is informed and how much personal data is released.'));

// ---------------- 8
const A = ML.A, Bv = ML.B, Cq = ML.C, Dq = ML.D;
const row = (k) => A.rows.find((r) => r.case.startsWith(k));
const nNormal = row('Healthy held-out').n;
add(H1('8. Experimental validation results:'), H2('8.1 Software simulation and system-level validation'),
  P(`A software-validation campaign was carried out on the implemented VITAL code. It consisted of (i) offline validation of the machine-learning modules on simulated users with fixed random seeds, using exactly the server's model code; (ii) end-to-end runs of the complete system, in which the server, database, alert service and dashboard API processed real-time data from the device simulator; and (iii) checks of the ESP32 firmware and device message format. Calibration constants were chosen on separate calibration data; all results below are on held-out data.`, { size: 20 }),
  P('Software-validation evidence summary', { bold: true, after: 40, keepNext: true }));
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
add(P('The first two rows are false-alarm rates on healthy windows (lower is better); the remaining rows are detection rates (higher is better). Fixed limits are HR outside 50–100 bpm, SpO₂ < 95% or temperature ≥ 37.5 °C.', { size: 18, italics: true, before: 40 }));

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
add(P('Interpretation of software results: the complete staged pipeline was exercised on simulated healthy and deteriorating users. Offline, the per-vital personal baseline detected every population-normal personal deviation that fixed limits missed, and the combined score kept the false-alarm rate on healthy windows at a fraction of one percent. The Isolation Forest alone was weak for a single vital drifting far from normal but contributed to detecting combined moderate changes, which is why both parts are used. The steady-trend condition removed false early warnings from one-off jumps while every steady deterioration was warned several minutes ahead. In the real-time system runs, the personal-anomaly path raised the first alert in the oxygen-drop and fever scenarios before any population limit was crossed, the signal-quality gate rejected almost all moving-finger readings, and no critical alert occurred in normal or exercise runs; one heart-rate trend warning occurred during exercise, showing that trend warnings can still occur during sustained exertion. These values are simulation results under defined models and are not presented as clinical accuracy. Known limitations: users and waveforms are simulated, the health-state classifier is trained and tested on generated examples (so its perfect accuracy reflects separable synthetic classes), and real finger readings are noisier than the simulator.', { size: 19, before: 100 }));

add(H2('8.2 Physical laboratory bench validation'),
  P([{ t: '[To be completed after the bench test.] ', hl: true }, 'A physical VITAL prototype is assembled using an ESP32 DevKit V1, a MAX30102 module, a GY-906 MLX90614 module and a 0.96-inch SSD1306 OLED on a breadboard, with I²C on GPIO 21 (SDA) and GPIO 22 (SCL) at 100 kHz, communicating with the laptop server over Wi-Fi. The sensor-test firmware first confirms the three I²C devices; the VITAL firmware then sends one packet per second. Readings are compared with a commercial fingertip pulse oximeter and a clinical thermometer.']),
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
  P('Physical-validation scope: dangerous conditions (low SpO₂, fever, tachycardia) are not induced in human participants; their detection, prediction and escalation are validated through the simulator in 8.1, which uses the identical device message format.', { size: 20, before: 80 }),
  H2('8.3 Combined validation conclusion'),
  P('The combined evidence comprises held-out computational validation of the personal anomaly detection, trend prediction, signal-quality and health-state modules; real-time end-to-end runs of the complete server, alerting and dashboard pipeline with a device simulator; and verification of the ESP32 firmware against the actual sensor libraries. The software results establish the behaviour of the complete staged monitoring and escalation logic under defined models, while the bench test in 8.2 verifies the sensing path in hardware. On this basis, the invention is classified in this disclosure as TRL 3 — Experimental proof of concept; on completion of the bench validation in 8.2 it can be reclassified as TRL 4 — Technology validated in a lab.'));

// ---------------- 9
add(H1('9. What aspect(s) of the invention need(s) protection?'),
  P('Protection is sought primarily for the staged monitoring mechanism and the relationship between its stages, rather than for generic hardware such as microcontrollers, PPG sensors, thermometers or displays.', { size: 18 }),
  ...numbered([
    'Quality-gated learning: A signal-quality score computed for each reading decides whether the reading is displayed, can raise an alert, and is used to train the user\'s personal model.',
    'Session-bound personal models on a shared device: Readings from one shared device are attributed to the logged-in user, and a separate personal model is learned for each user.',
    'Dual personal scoring: Each window is scored against both a robust per-vital personal baseline (median and minimum-bounded MAD) and a multivariate Isolation Forest normalised by the user\'s own score distribution, combined with a population-limit floor.',
    'Steady-trend time-to-threshold prediction: A trend is projected only when the older and newer halves of the window agree in direction and rate, and the time remaining before a danger limit is estimated.',
    'Severity-scoped escalation: The computed severity selects both the escalation tier (local, guardian, supervisor, emergency services) and the scope of personal data disclosed at that tier.',
    'Privacy-preserving city aggregation: Ward-level summaries with minimum-group merging are published to a smart-city platform, and identity is released only for consented critical alerts.',
    'Per-user temperature calibration: Body temperature is derived from non-contact skin temperature using an offset calibrated per user against a reference thermometer.',
  ], { size: 18 }),
  P('Core protectable relationship:', { bold: true, size: 19, after: 20 }),
  P('Using a per-reading signal-quality decision to control both alerting and personal-model learning on a shared multi-user device, scoring each window against the user\'s own robust baseline and multivariate model, projecting only steady trends to estimate time-to-threshold, and using the resulting severity to determine both who is alerted and how much personal data is disclosed, up to anonymised ward-level smart-city reporting.', { italics: true, size: 18 }));

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
