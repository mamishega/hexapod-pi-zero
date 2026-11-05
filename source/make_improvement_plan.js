// Builds "Live View Improvement Plan.docx" for the hexapod project.
// Usage (in source/): node make_improvement_plan.js "../Live View Improvement Plan.docx"
const fs = require('fs');
const docxPath = process.env.DOCX_MODULE || 'docx';
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  LevelFormat, AlignmentType, Header, Footer, PageNumber, PositionalTab, PositionalTabAlignment, PositionalTabRelativeTo,
  PositionalTabLeader, VerticalAlign, TableOfContents,
} = require(docxPath);

const out = process.argv[2];
const FONT = 'Arial', INK = '1A2B30', MUTED = '5F6F75', ACCENT = '0D7A69', RULE = 'C9D2D6';
const CONTENT = 9026; // A4 minus 2 x 1440 margins

// **bold** inline
const runs = (text, base = {}) => String(text).split(/(\*\*[^*]+\*\*)/).filter(Boolean)
  .map(p => p.startsWith('**') ? new TextRun({text: p.slice(2, -2), bold: true, font: FONT, ...base}) : new TextRun({text: p, font: FONT, ...base}));
const para = (text, opts = {}) => new Paragraph({children: runs(text), spacing: {after: 120, line: 276}, ...opts});
const bullet = text => new Paragraph({numbering: {reference: 'bullets', level: 0}, children: runs(text), spacing: {after: 60, line: 264}});
const h1 = (text, pageBreakBefore = true) => new Paragraph({heading: HeadingLevel.HEADING_1, pageBreakBefore, children: [new TextRun(text)]});
const h2 = text => new Paragraph({heading: HeadingLevel.HEADING_2, children: [new TextRun(text)]});
const label = text => new Paragraph({keepNext: true, spacing: {before: 140, after: 60}, children: [new TextRun({text, bold: true, font: FONT, size: 20, color: ACCENT})]});

const border = {style: BorderStyle.SINGLE, size: 4, color: RULE};
const borders = {top: border, bottom: border, left: border, right: border};
let tableNo = 0;
function table(caption, head, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0), cols = widths.map(w => Math.round(w * CONTENT / total));
  cols[cols.length - 1] += CONTENT - cols.reduce((a, b) => a + b, 0);
  const cell = (text, i, header, shade) => new TableCell({
    borders, width: {size: cols[i], type: WidthType.DXA}, verticalAlign: VerticalAlign.CENTER, margins: {top: 80, bottom: 80, left: 120, right: 120},
    shading: header ? {fill: ACCENT, type: ShadingType.CLEAR, color: 'auto'} : shade ? {fill: 'F5F8F9', type: ShadingType.CLEAR, color: 'auto'} : undefined,
    children: [new Paragraph({children: runs(text, header ? {bold: true, color: 'FFFFFF', size: 19} : {size: 19})})],
  });
  return [
    new Paragraph({keepNext: true, spacing: {before: 160, after: 80}, children: [
      new TextRun({text: `Table ${++tableNo}`, bold: true, font: FONT, size: 18, color: ACCENT}), new TextRun({text: `   ${caption}`, font: FONT, size: 18, color: MUTED})]}),
    new Table({width: {size: CONTENT, type: WidthType.DXA}, columnWidths: cols, rows: [
      new TableRow({tableHeader: true, cantSplit: true, children: head.map((t, i) => cell(t, i, true))}),
      ...rows.map((r, k) => new TableRow({cantSplit: true, children: r.map((t, i) => cell(t, i, false, k % 2 === 1))})),
    ]}),
    new Paragraph({children: [], spacing: {after: 120}}),
  ];
}
function callout(title, text, color = '1565C0', fill = 'EAF2FC') {
  const side = {style: BorderStyle.SINGLE, size: 4, color: fill};
  return [new Table({width: {size: CONTENT, type: WidthType.DXA}, columnWidths: [CONTENT], rows: [new TableRow({cantSplit: true, children: [new TableCell({
    width: {size: CONTENT, type: WidthType.DXA}, borders: {left: {style: BorderStyle.SINGLE, size: 36, color}, top: side, bottom: side, right: side},
    shading: {fill, type: ShadingType.CLEAR, color: 'auto'}, margins: {top: 110, bottom: 110, left: 200, right: 160},
    children: [new Paragraph({spacing: {after: 40}, children: [new TextRun({text: title, bold: true, font: FONT, size: 20, color})]}), new Paragraph({children: runs(text, {size: 20})})],
  })]})]}), new Paragraph({children: [], spacing: {after: 100}})];
}

// One improvement: what it is, what it does, why it matters, how big, what to watch.
function improvement({title, purpose, does, benefit, effort, needs, care}) {
  return [
    h2(title), para(purpose),
    label('What it does'), ...does.map(bullet),
    label('Why it matters'), para(benefit),
    ...table(`${title.replace(/^\d+\.\d+\s+/, '')}: size and requirements`, ['Item', 'Detail'], [
      ['Size of the work', effort], ['Needs', needs], ['Points to watch', care]], [2600, 6426]),
  ];
}

// ---------------------------------------------------------------- content
const cover = [
  new Paragraph({spacing: {before: 2200, after: 120}, children: [new TextRun({text: 'IMPROVEMENT PLAN', font: FONT, size: 22, bold: true, color: ACCENT, characterSpacing: 60})]}),
  new Paragraph({spacing: {after: 160}, children: [new TextRun({text: 'Hexapod Live View', font: FONT, size: 60, bold: true, color: INK})]}),
  new Paragraph({spacing: {after: 480}, border: {bottom: {style: BorderStyle.SINGLE, size: 18, color: ACCENT, space: 14}},
    children: [new TextRun({text: 'Recommended improvements to the web app that shows, explains and checks the hexapod robot', font: FONT, size: 26, color: MUTED})]}),
  ...table('Document details', ['Item', 'Detail'], [
    ['Project', 'Hexapod Pi Zero 2 W (and the Raspberry Pi 5 version)'],
    ['Document', 'Live View improvement plan'],
    ['Date', '5 November 2026'],
    ['Status', 'Draft for discussion: nothing in Section 3 is built yet'],
    ['Related documents', 'User Manual HXP-UM-001 revision L (Pi Zero 2 W); HXP-UM-005 revision A (Pi 5)'],
  ], [2600, 6426]),
];

const body = [
  new Paragraph({style: 'FrontHeading', children: [new TextRun('Contents')]}),
  new TableOfContents('Contents', {hyperlink: true, headingStyleRange: '1-2'}),

  h1('1   Summary'),
  para('The Live View is the web page the robot’s Raspberry Pi serves to any phone, tablet or laptop on the same Wi-Fi. It already shows the robot in 3D as it walks, explains every controller button, traces each command from the controller to the servos, and (since revision L of the manual) checks the robot’s health and how hard each servo works.'),
  para('This plan recommends what to add next. Each improvement keeps the page **watch-only**: none of them lets the page move the robot, except the last one, which is listed separately because it would need safeguards.'),
  ...table('Recommended improvements at a glance', ['Priority', 'Improvement', 'Main benefit', 'Size'], [
    ['1', 'Session recorder and incident replay', 'Explains faults such as controller drop-outs with evidence; data for student projects', 'Medium'],
    ['2', 'Follow-the-teacher mode and lesson cards', 'Keeps a whole class on the same view; guided activities', 'Medium'],
    ['3', 'Battery runtime estimate', 'No flat battery halfway through a lesson; efficient settings', 'Small'],
    ['4', 'Gait quality score', 'Compares gaits and settings with real numbers', 'Small to medium'],
    ['5', 'Installable app, version display, safe updates, projector mode', 'Faster, easier to look after and to show', 'Small each'],
    ['Later', 'Gyro tilt and LiDAR scan (Pi 5 version)', 'First real sensor data: what the robot actually does', 'Medium each'],
    ['Only with safeguards', 'Changing walk settings from the web page', 'Convenient, but lets the page control the robot', 'Medium'],
  ], [1300, 2900, 3426, 1400]),
  ...callout('Recommendation', 'Install the current update on the robot first and let the Health page collect a few sessions of real data. Then build the **session recorder**, so the next controller drop-out is captured with everything that was happening at the time.', ACCENT, 'E3F2EE'),

  h1('2   Already in place'),
  para('The improvements below build on what the Live View already does. These were added on 4–5 November 2026 and are covered by 53 automated tests.'),
  ...table('Live View pages today', ['Page', 'What it shows'], [
    ['**Live**', 'The robot in 3D, drawn as built (red hip servos, black knee servos, curved red feet, sensor box at the front), with top, front and side views, balance area, footprints, pause and slow-motion replay, gait timing chart, battery graph.'],
    ['**Controller**', 'Sticks and buttons in use, what each one does, and “Try this” activities.'],
    ['**How it works**', 'Controller → Bluetooth → Pi → UART → Servo 2040 → servos, with the real messages on the serial wires.'],
    ['**Servo angles**', 'Every joint angle, and the leg inspector with the inverse-kinematics working.'],
    ['**Health** (new)', 'Battery, Pi power supply and temperature, controller connection and battery, board link reply time, Wi-Fi; a list of events; a warning banner on every page.'],
    ['**Servo care** (new)', 'Each servo’s angle within its usable range, time near the end of travel, total movement and calibration offset; hardest-working servos; lifetime totals saved on the Pi.'],
    ['**Messages**', 'The driving service’s messages, newest first.'],
  ], [2400, 6626]),

  h1('3   Recommended improvements'),
  ...improvement({
    title: '3.1   Session recorder and incident replay',
    purpose: 'Record every run on the Pi so that what happened can be looked at afterwards, especially when something went wrong.',
    does: [
      'Records each session automatically: pose, servo angles, battery voltage and current, controller state, gait and settings, and every Health event.',
      'Keeps the **30 seconds before an incident** (controller dropped, watchdog stop, battery critical, board link lost). Clicking the event on the Health page replays it in the 3D view.',
      'A **Sessions** list: date, length, distance walked, gaits used, lowest battery, incidents.',
      '**Export to CSV** for spreadsheets and student data projects.',
      'Keeps the newest sessions within a fixed size limit (for example 50 MB) so the microSD card never fills up.',
    ],
    benefit: 'The controller has been disconnecting without a clear cause. The Health page now records when it happens; the recorder will show what the robot was doing, the battery level and the Pi’s state at that moment, which is usually enough to find the cause. The same data supports lessons on measurement and analysis.',
    effort: 'Medium', needs: 'Nothing new: uses data the Live View already receives.',
    care: 'Writing to the microSD card often wears it: record in memory and write in batches. Recordings contain no personal data.',
  }),
  ...improvement({
    title: '3.2   Follow-the-teacher mode and lesson cards',
    purpose: 'Make the Live View work like a presentation for a class.',
    does: [
      'The teacher’s device leads: every student device follows to the same page, camera view and replay moment.',
      'Students can step out to explore and return with one tap (“Follow teacher”).',
      '**Lesson cards:** short guided activities shown at the right moment, for example “Watch which legs lift together, then press Menu to change the gait.”',
      '**Quick questions** answered on students’ own devices, with the class results shown on the projector (no names stored).',
    ],
    benefit: 'Keeps a class of up to 40 devices focused on the same thing at the same time, and turns the page from a viewer into a lesson.',
    effort: 'Medium', needs: 'A teacher code, set in a settings file on the Pi (like the hotspot password), so students cannot take over the lead.',
    care: 'Still watch-only: the robot is driven only by the Xbox controller. Answers are anonymous and are not saved after the lesson.',
  }),
  ...improvement({
    title: '3.3   Battery runtime estimate',
    purpose: 'Know how long the robot can keep going.',
    does: [
      'Estimates the **minutes left** from recent current draw and voltage, shown on the battery chip and the Health page.',
      'A warning about 5 minutes before the low-battery level.',
      'Shows what each gait, speed and step height costs, in minutes of running time.',
    ],
    benefit: 'Avoids running out of power halfway through a lesson, and helps choose settings that last longer.',
    effort: 'Small', needs: 'The battery’s capacity in mAh and its type (assumed 2S LiPo until confirmed).',
    care: 'An estimate only: it improves as the robot runs. Battery voltage sags under load, so it is averaged over time.',
  }),
  ...improvement({
    title: '3.4   Gait quality score',
    purpose: 'Compare gaits and settings with numbers instead of impressions.',
    does: [
      'Scores each walk on **stability** (how far the body’s centre stays inside the feet, which the Live View already works out), **smoothness** and **speed**.',
      'A comparison table for ripple, wave and tripod at the settings used.',
      'Highlights settings that bring the robot close to tipping.',
    ],
    benefit: 'A ready-made student investigation, and a quick way to find good settings for a new surface.',
    effort: 'Small to medium', needs: 'Nothing new.',
    care: 'Based on the commanded pose: it cannot see slipping feet until the gyro (Pi 5 version) is fitted.',
  }),
  h2('3.5   Smaller improvements'),
  ...table('Smaller improvements', ['Improvement', 'What it gives', 'Size'], [
    ['**Installable app**', '“Add to home screen” on phones and tablets; the page opens instantly, even on the robot’s own hotspot.', 'Small'],
    ['**Version on the page**', 'Shows which software version the robot runs, so it is obvious when an update is needed.', 'Small'],
    ['**Safe one-command update**', 'Copies new software from the Mac and restarts the service only once the robot is sitting with its motors off.', 'Small'],
    ['**Projector mode**', 'Larger text and higher contrast for the back of a classroom.', 'Small'],
    ['**Calibration reminder**', 'Links the Servo care checks to the existing leg calibration tool, with step-by-step instructions.', 'Small'],
  ], [2600, 5226, 1200]),
  h2('3.6   With the Raspberry Pi 5 version'),
  para('The Pi 5 version adds a BNO085 gyro and an RPLIDAR C1 laser scanner (see manual HXP-UM-005). The Live View is the natural place to show them:'),
  bullet('**Measured tilt** next to the commanded pose: the first time the page shows what the robot actually does, not only what it is told to do. Later, automatic body levelling.'),
  bullet('**LiDAR scan view:** a live 360° picture of the room around the robot, then a warning (and later a stop) before obstacles.'),
  h2('3.7   Only with safeguards: changing settings from the page'),
  para('Changing speed, step height or gait from a web browser is convenient, and is already listed as planned in the user manual. It would, however, be the first time the page could control the robot.'),
  ...callout('Safeguards required', 'A teacher password; changes allowed only while the robot is sitting with its motors off; every change logged on the Messages page; the Xbox controller’s stop buttons always take priority. Without these, this feature should not be built.', 'B26A00', 'FFF4E0'),

  h1('4   Suggested order'),
  ...table('Suggested order of work', ['Step', 'Work', 'Why at this point'], [
    ['1', 'Install the current update on the robot; collect real Health and Servo care data for a few sessions', 'Real data shows which problems matter most'],
    ['2', 'Session recorder and incident replay (3.1)', 'Captures the next controller drop-out with its context'],
    ['3', 'Battery runtime estimate (3.3) and the smaller improvements (3.5)', 'Small, useful in every session'],
    ['4', 'Follow-the-teacher mode and lesson cards (3.2)', 'Biggest gain for classes'],
    ['5', 'Gait quality score (3.4)', 'Builds on the recorder’s data'],
    ['6', 'Gyro and LiDAR views (3.6)', 'When the Pi 5 version is built'],
  ], [900, 4600, 3526]),

  h1('5   Ground rules for every change', false),
  bullet('**Watch-only:** the page never moves the robot (Section 3.7 is the only exception, and only with its safeguards).'),
  bullet('**Never harm the driving service:** a fault in the web page must not stop or slow the robot. Every new part is guarded and tested.'),
  bullet('**Light on the Pi Zero:** up to 40 viewers at once on a small computer; new features must keep updates small and infrequent.'),
  bullet('**Works offline:** everything must work on the robot’s own hotspot with no internet (no outside fonts, libraries or services).'),
  bullet('**Privacy:** no names, photos or passwords stored or published; only generated images in the project repositories.'),
  bullet('**Tested and documented:** automated tests for each feature, and the user manual updated in the same change.'),
];

// ---------------------------------------------------------------- document
const small = (text, extra = {}) => new TextRun({text, font: FONT, size: 16, color: MUTED, ...extra});
const tab = () => new PositionalTab({alignment: PositionalTabAlignment.RIGHT, relativeTo: PositionalTabRelativeTo.MARGIN, leader: PositionalTabLeader.NONE});
const header = new Header({children: [new Paragraph({border: {bottom: {style: BorderStyle.SINGLE, size: 4, color: RULE, space: 6}}, children: [
  small('Hexapod Live View  ·  Improvement plan', {bold: true, color: INK}), new TextRun({font: FONT, size: 16, color: MUTED, children: [tab(), '5 November 2026']})]})]});
const footer = new Footer({children: [new Paragraph({border: {top: {style: BorderStyle.SINGLE, size: 4, color: RULE, space: 6}}, children: [
  small('Draft for discussion'), new TextRun({font: FONT, size: 16, color: MUTED, children: [tab(), 'Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES_IN_SECTION]})]})]});
const margins = {top: 1440, bottom: 1300, left: 1440, right: 1440, header: 600, footer: 600};

const doc = new Document({
  creator: 'Hexapod project', title: 'Hexapod Live View improvement plan', features: {updateFields: true},
  styles: {
    default: {document: {run: {font: FONT, size: 21, color: INK}, paragraph: {spacing: {line: 276}}}},
    paragraphStyles: [
      {id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: {font: FONT, size: 34, bold: true, color: INK},
        paragraph: {spacing: {before: 0, after: 220}, keepNext: true, outlineLevel: 0, border: {bottom: {style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 8}}}},
      {id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: {font: FONT, size: 25, bold: true, color: ACCENT},
        paragraph: {spacing: {before: 320, after: 120}, keepNext: true, outlineLevel: 1}},
      {id: 'FrontHeading', name: 'Front Heading', basedOn: 'Normal', next: 'Normal', run: {font: FONT, size: 30, bold: true, color: INK}, paragraph: {spacing: {before: 0, after: 200}, keepNext: true}},
    ],
  },
  numbering: {config: [{reference: 'bullets', levels: [{level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: {paragraph: {indent: {left: 460, hanging: 280}}}}]}]},
  sections: [
    {properties: {page: {margin: margins}}, children: cover},
    {properties: {page: {margin: margins, pageNumbers: {start: 1}}}, headers: {default: header}, footers: {default: footer}, children: body},
  ],
});
Packer.toBuffer(doc).then(buffer => { fs.writeFileSync(out, buffer); console.log('wrote', out); });
