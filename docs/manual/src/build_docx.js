// Builds user-manual.docx from content.js.  Usage: node build_docx.js <out.docx> <schematic.png>
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType,
  BorderStyle, LevelFormat, AlignmentType, Header, Footer, PageNumber, ImageRun, TableOfContents,
  PositionalTab, PositionalTabAlignment, PositionalTabRelativeTo, PositionalTabLeader, VerticalAlign,
} = require('docx');
const manual = require('./content.js');

const [out, schematicPng] = process.argv.slice(2);
const FONT = 'Arial', MONO = 'Consolas';
const INK = '1A2B30', MUTED = '5F6F75', ACCENT = '0D7A69', RULE = 'C9D2D6';
const CONTENT = 9026; // A4 width (11906) minus 2 x 1440 margins
const CALLOUT = {
  warning: {label: 'WARNING', color: 'C62828', fill: 'FDECEA'},
  caution: {label: 'CAUTION', color: 'B26A00', fill: 'FFF4E0'},
  verify: {label: 'VERIFY', color: 'B26A00', fill: 'FFF4E0'},
  note: {label: 'NOTE', color: '1565C0', fill: 'EAF2FC'},
  planned: {label: 'PLANNED', color: '5E35B1', fill: 'F1ECFA'},
};

// ---------- inline text: **bold** and `code` ----------
function runs(text, base = {}) {
  return String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/).filter(Boolean).map(part => {
    if (part.startsWith('**')) return new TextRun({text: part.slice(2, -2), bold: true, font: FONT, ...base});
    if (part.startsWith('`')) return new TextRun({text: part.slice(1, -1), font: MONO, ...base, size: (base.size || 21) - 1});
    return new TextRun({text: part, font: FONT, ...base});
  });
}
const para = (text, opts = {}, base = {}) => new Paragraph({children: runs(text, base), spacing: {after: 120, line: 276}, ...opts});

// ---------- numbering ----------
const numbering = [
  {reference: 'bullets', levels: [{level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: {paragraph: {indent: {left: 460, hanging: 280}}}}]},
  {reference: 'checks', levels: [{level: 0, format: LevelFormat.BULLET, text: '☐', alignment: AlignmentType.LEFT, style: {paragraph: {indent: {left: 460, hanging: 320}}, run: {font: 'Segoe UI Symbol', size: 24}}}]},
];
let listCount = 0;
function newSteps() {
  const reference = `steps${listCount++}`;
  numbering.push({reference, levels: [{level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
    style: {paragraph: {indent: {left: 460, hanging: 340}}, run: {bold: true, color: ACCENT}}}]});
  return reference;
}

// ---------- tables, captions, callouts ----------
const border = {style: BorderStyle.SINGLE, size: 4, color: RULE};
const cellBorders = {top: border, bottom: border, left: border, right: border};
let tableNo = 0, figureNo = 0;

function caption(kind, n, text) {
  return new Paragraph({keepNext: true, spacing: {before: 160, after: 80}, children: [
    new TextRun({text: `${kind} ${n}`, bold: true, font: FONT, size: 18, color: ACCENT}),
    new TextRun({text: `   ${text}`, font: FONT, size: 18, color: MUTED}),
  ]});
}

function table({caption: title, head, rows, widths}, numbered = true) {
  const total = widths.reduce((a, b) => a + b, 0);
  const scaled = widths.map(w => Math.round(w * CONTENT / total));
  scaled[scaled.length - 1] += CONTENT - scaled.reduce((a, b) => a + b, 0);
  const cell = (text, i, header, shade) => new TableCell({
    borders: cellBorders, width: {size: scaled[i], type: WidthType.DXA}, verticalAlign: VerticalAlign.CENTER,
    shading: header ? {fill: ACCENT, type: ShadingType.CLEAR, color: 'auto'} : shade ? {fill: 'F5F8F9', type: ShadingType.CLEAR, color: 'auto'} : undefined,
    margins: {top: 80, bottom: 80, left: 120, right: 120},
    children: [new Paragraph({children: runs(text, header ? {bold: true, color: 'FFFFFF', size: 19} : {size: 19})})],
  });
  return [
    numbered ? caption('Table', ++tableNo, title) : new Paragraph({keepNext: true, spacing: {before: 160, after: 80}, children: [new TextRun({text: title, bold: true, font: FONT, size: 18, color: ACCENT})]}),
    new Table({width: {size: CONTENT, type: WidthType.DXA}, columnWidths: scaled, rows: [
      new TableRow({tableHeader: true, cantSplit: true, children: head.map((t, i) => cell(t, i, true))}),
      ...rows.map((r, k) => new TableRow({cantSplit: true, children: r.map((t, i) => cell(t, i, false, k % 2 === 1))})),
    ]}),
    new Paragraph({children: [], spacing: {after: 120}}),
  ];
}

function callout({kind, title, text}) {
  const c = CALLOUT[kind];
  const side = {style: BorderStyle.SINGLE, size: 4, color: c.fill};
  return [new Table({width: {size: CONTENT, type: WidthType.DXA}, columnWidths: [CONTENT], rows: [new TableRow({cantSplit: true, children: [new TableCell({
    width: {size: CONTENT, type: WidthType.DXA},
    borders: {left: {style: BorderStyle.SINGLE, size: 36, color: c.color}, top: side, bottom: side, right: side},
    shading: {fill: c.fill, type: ShadingType.CLEAR, color: 'auto'},
    margins: {top: 110, bottom: 110, left: 200, right: 160},
    children: [
      new Paragraph({spacing: {after: 40}, children: [
        new TextRun({text: c.label, bold: true, font: FONT, size: 18, color: c.color, characterSpacing: 20}),
        ...(title ? [new TextRun({text: `   ${title}`, bold: true, font: FONT, size: 20, color: INK})] : []),
      ]}),
      new Paragraph({children: runs(text, {size: 20}), spacing: {line: 264}}),
    ],
  })]})]}), new Paragraph({children: [], spacing: {after: 100}})];
}

const codeLine = (line, indent = 460) => new Paragraph({indent: {left: indent}, spacing: {after: 0, line: 240}, keepLines: true,
  shading: {fill: 'EEF2F3', type: ShadingType.CLEAR, color: 'auto'},
  border: {left: {style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 6}},
  children: [new TextRun({text: line, font: MONO, size: 19, color: INK})]});
const codeBlock = (lines, indent) => [...lines.map(l => codeLine(l, indent)), new Paragraph({children: [], spacing: {after: 100}})];

function figure({caption: text}) {
  return [
    new Paragraph({alignment: AlignmentType.CENTER, keepNext: true, spacing: {before: 120, after: 60}, children: [new ImageRun({type: 'png', data: fs.readFileSync(schematicPng),
      transformation: {width: 600, height: Math.round(600 * 1240 / 1700)},
      altText: {title: 'Wiring schematic', description: 'Hexapod Pi Zero 2 W wiring schematic', name: 'schematic'}})]}),
    caption('Figure', ++figureNo, text),
  ];
}

function blocks(list) {
  const outList = [];
  for (const b of list) {
    if (b.p) outList.push(para(b.p));
    else if (b.bullets) b.bullets.forEach(t => outList.push(new Paragraph({numbering: {reference: 'bullets', level: 0}, children: runs(t), spacing: {after: 70, line: 264}})));
    else if (b.checklist) b.checklist.items.forEach(t => outList.push(new Paragraph({numbering: {reference: 'checks', level: 0}, children: runs(t), spacing: {after: 90}})));
    else if (b.steps) {
      const reference = newSteps();
      for (const s of b.steps) {
        const item = typeof s === 'string' ? {text: s} : s;
        outList.push(new Paragraph({numbering: {reference, level: 0}, children: runs(item.text), spacing: {after: item.code ? 60 : 90, line: 264}, keepNext: !!item.code}));
        if (item.code) outList.push(...codeBlock(item.code, 460));
      }
    } else if (b.code) outList.push(...codeBlock(b.code, 0));
    else if (b.table) outList.push(...table(b.table));
    else if (b.callout) outList.push(...callout(b.callout));
    else if (b.figure) outList.push(...figure(b.figure));
  }
  return outList;
}

// ---------- document ----------
const m = manual.meta;
const heading1 = (text, opts = {}) => new Paragraph({heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun(text)], ...opts});
const heading2 = text => new Paragraph({heading: HeadingLevel.HEADING_2, children: [new TextRun(text)]});
const plainHeading = (text, pageBreakBefore = false) => new Paragraph({style: 'FrontHeading', pageBreakBefore, children: [new TextRun(text)]});

const detail = (label, value) => new TableRow({children: [
  new TableCell({width: {size: 2600, type: WidthType.DXA}, borders: {top: border, bottom: border, left: {style: BorderStyle.NONE, size: 0, color: 'FFFFFF'}, right: {style: BorderStyle.NONE, size: 0, color: 'FFFFFF'}},
    margins: {top: 90, bottom: 90, left: 0, right: 120}, children: [new Paragraph({children: [new TextRun({text: label, font: FONT, size: 19, color: MUTED})]})]}),
  new TableCell({width: {size: 4400, type: WidthType.DXA}, borders: {top: border, bottom: border, left: {style: BorderStyle.NONE, size: 0, color: 'FFFFFF'}, right: {style: BorderStyle.NONE, size: 0, color: 'FFFFFF'}},
    margins: {top: 90, bottom: 90, left: 120, right: 0}, children: [new Paragraph({children: [new TextRun({text: value, font: FONT, size: 19, bold: true, color: INK})]})]}),
]});

const cover = [
  new Paragraph({spacing: {before: 1400, after: 120}, children: [new TextRun({text: 'USER MANUAL', font: FONT, size: 22, bold: true, color: ACCENT, characterSpacing: 60})]}),
  new Paragraph({spacing: {after: 120}, children: [new TextRun({text: m.title, font: FONT, size: 64, bold: true, color: INK})]}),
  new Paragraph({spacing: {after: 360}, border: {bottom: {style: BorderStyle.SINGLE, size: 18, color: ACCENT, space: 14}},
    children: [new TextRun({text: m.scope, font: FONT, size: 26, color: MUTED})]}),
  new Paragraph({alignment: AlignmentType.CENTER, spacing: {before: 200, after: 400}, children: [new ImageRun({type: 'png', data: fs.readFileSync(schematicPng),
    transformation: {width: 560, height: Math.round(560 * 1240 / 1700)}, altText: {title: 'Wiring schematic', description: 'Wiring schematic', name: 'cover'}})]}),
  new Table({width: {size: 7000, type: WidthType.DXA}, columnWidths: [2600, 4400], rows: [
    detail('Document number', m.docNo), detail('Revision', m.revision), detail('Date', m.date), detail('Status', m.status),
  ]}),
];

const control = [
  plainHeading('Document control'),
  para(`This manual (${m.docNo}) describes the ${m.scope}. It is revised whenever the wiring, setup or operation changes. Check that you are using the latest revision before working on the robot.`),
  ...table({caption: 'Revision history', head: ['Revision', 'Date', 'Description'], widths: [1300, 2100, 5626], rows: manual.revisions}, false),
  plainHeading('Contents', true),
  new TableOfContents('Contents', {hyperlink: true, headingStyleRange: '1-2'}),
];

const body = [];
let appendix = 0, number = 0;
for (const section of manual.sections) {
  const prefix = section.appendix ? `Appendix ${String.fromCharCode(65 + appendix++)}` : `${++number}`;
  body.push(heading1(`${prefix}   ${section.title}`));
  if (section.blocks) body.push(...blocks(section.blocks));
  (section.subsections || []).forEach((sub, i) => {
    body.push(heading2(`${section.appendix ? prefix.slice(-1) : number}.${i + 1}   ${sub.title}`));
    body.push(...blocks(sub.blocks));
  });
}

const smallRun = (text, extra = {}) => new TextRun({text, font: FONT, size: 16, color: MUTED, ...extra});
const header = new Header({children: [new Paragraph({border: {bottom: {style: BorderStyle.SINGLE, size: 4, color: RULE, space: 6}}, children: [
  smallRun(`${m.title}  ·  ${m.subtitle}`, {bold: true, color: INK}),
  new TextRun({font: FONT, size: 16, color: MUTED, children: [new PositionalTab({alignment: PositionalTabAlignment.RIGHT, relativeTo: PositionalTabRelativeTo.MARGIN, leader: PositionalTabLeader.NONE}), `${m.docNo}  ·  Rev ${m.revision}`]}),
]})]});
const footer = new Footer({children: [new Paragraph({border: {top: {style: BorderStyle.SINGLE, size: 4, color: RULE, space: 6}}, children: [
  smallRun(`${m.status}  ·  ${m.date}`),
  new TextRun({font: FONT, size: 16, color: MUTED, children: [new PositionalTab({alignment: PositionalTabAlignment.RIGHT, relativeTo: PositionalTabRelativeTo.MARGIN, leader: PositionalTabLeader.NONE}),
    'Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES_IN_SECTION]}),
]})]});

const margins = {top: 1440, bottom: 1300, left: 1440, right: 1440, header: 600, footer: 600};
const doc = new Document({
  creator: 'Hexapod project', title: `${m.title} ${m.subtitle}`, subject: m.scope,
  features: {updateFields: true},
  styles: {
    default: {document: {run: {font: FONT, size: 21, color: INK}, paragraph: {spacing: {line: 276}}}},
    paragraphStyles: [
      {id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: {font: FONT, size: 34, bold: true, color: INK},
        paragraph: {spacing: {before: 0, after: 220}, keepNext: true, outlineLevel: 0, border: {bottom: {style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 8}}}},
      {id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: {font: FONT, size: 25, bold: true, color: ACCENT}, paragraph: {spacing: {before: 300, after: 120}, keepNext: true, outlineLevel: 1}},
      {id: 'FrontHeading', name: 'Front Heading', basedOn: 'Normal', next: 'Normal',
        run: {font: FONT, size: 30, bold: true, color: INK}, paragraph: {spacing: {before: 240, after: 200}, keepNext: true}},
    ],
  },
  numbering: {config: numbering},
  sections: [
    {properties: {page: {margin: margins}}, children: cover},
    {properties: {page: {margin: margins, pageNumbers: {start: 1}}}, headers: {default: header}, footers: {default: footer}, children: [...control, ...body]},
  ],
});

Packer.toBuffer(doc).then(buffer => { fs.writeFileSync(out, buffer); console.log('wrote', path.basename(out)); });
