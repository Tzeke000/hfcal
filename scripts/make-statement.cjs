// Generates docs/legal/Statement-of-Independent-Creation.docx — the one-page
// signable version of docs/legal/PROVENANCE.md. Keep the two in step.
//   npm install --no-save docx && node scripts/make-statement.cjs
//
// Part of the original work of Cpl Angeles-Gonzalez, Ezekiel S. - USMC.
// Project signature: HFCALC-AG-EZK-USMC-v1
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
        BorderStyle, Table, TableRow, TableCell, WidthType, ShadingType,
        LevelFormat, convertInchesToTwip } = require('docx');
const fs = require('fs');

const SERIF = 'Times New Roman';

function p(text, opts = {}) {
  return new Paragraph({
    alignment: opts.align || AlignmentType.LEFT,
    spacing: { after: opts.after === undefined ? 120 : opts.after, line: opts.line || 240 },
    indent: opts.indent,
    border: opts.border,
    children: [new TextRun({ text, font: SERIF, size: opts.size || 20,
      bold: !!opts.bold, italics: !!opts.italics, allCaps: !!opts.caps,
      color: opts.color })],
  });
}

function runs(children, opts = {}) {
  return new Paragraph({
    alignment: opts.align || AlignmentType.LEFT,
    spacing: { after: opts.after === undefined ? 120 : opts.after, line: opts.line || 240 },
    indent: opts.indent,
    children: children.map(c => new TextRun({ font: SERIF, size: opts.size || 20, ...c })),
  });
}

const rule = new Paragraph({
  spacing: { after: 160 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000', space: 1 } },
  children: [new TextRun({ text: '', font: SERIF, size: 4 })],
});

const numbered = (text) => new Paragraph({
  numbering: { reference: 'facts', level: 0 },
  spacing: { after: 110, line: 240 },
  children: [new TextRun({ text, font: SERIF, size: 20 })],
});

const doc = new Document({
  numbering: {
    config: [{
      reference: 'facts',
      levels: [{
        level: 0, format: LevelFormat.DECIMAL, text: '%1.',
        alignment: AlignmentType.START,
        style: { paragraph: { indent: { left: convertInchesToTwip(0.35), hanging: convertInchesToTwip(0.25) } } },
      }],
    }],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1080, bottom: 900, left: 1080, right: 1080 },
      },
    },
    children: [
      p('STATEMENT OF INDEPENDENT CREATION', { align: AlignmentType.CENTER, bold: true, size: 26, after: 40 }),
      p('HF Field Antenna Calculator', { align: AlignmentType.CENTER, italics: true, size: 20, after: 140 }),
      rule,

      runs([{ text: 'Author: ', bold: true },
            { text: 'Cpl Angeles-Gonzalez, Ezekiel S., USMC — MOS 5954, Air Traffic Control Communications Technician' }],
           { after: 60, size: 19 }),
      runs([{ text: 'Work: ', bold: true },
            { text: 'HF Field Antenna Calculator — https://github.com/Tzeke000/hfcal' }],
           { after: 60, size: 19 }),
      runs([{ text: 'Created: ', bold: true },
            { text: 'first commit 3 May 2026, developed continuously thereafter' }],
           { after: 60, size: 19 }),
      runs([{ text: 'Project signature: ', bold: true },
            { text: 'HFCALC-AG-EZK-USMC-v1' }],
           { after: 200, size: 19 }),

      p('DECLARATION', { bold: true, size: 21, after: 100 }),

      p('I am the sole author of the software application identified above. I make this '
      + 'statement to record the circumstances of its creation, and I declare the following '
      + 'to be true and accurate to the best of my knowledge:', { after: 150 }),

      numbered('The development of this application was never directed, tasked, assigned, or '
      + 'requested by my chain of command. No order, tasker, work request, or performance '
      + 'objective covered it.'),

      numbered('All development was performed off duty, on my own time.'),

      numbered('No government-owned or government-issued computer, phone, or other hardware was '
      + 'used to write, build, test, or publish this work.'),

      numbered('No Department of Defense, government, or otherwise official network was used at '
      + 'any point.'),

      numbered('The work contains no classified information, no Controlled Unclassified '
      + 'Information, no For Official Use Only material, no personally identifiable '
      + 'information, and no non-public government data of any kind.'),

      numbered('The subject matter falls outside my assigned military occupational specialty. '
      + 'MOS 5954 covers installation and maintenance of air traffic control communications '
      + 'systems; the design and validation of HF skywave antenna geometry is not among its '
      + 'duties, and no billet I have held has assigned it. I undertook this work out of '
      + 'personal interest.'),

      numbered('Every technical source used is publicly published: the ARRL Antenna Book; '
      + 'Davies, Ionospheric Radio; the NOAA/NCEI and British Geological Survey World Magnetic '
      + 'Model; VOACAP by way of the open-source voacapl port; and open-source software '
      + 'libraries under permissive licenses. All are cited in the application itself and in '
      + 'the repository.'),

      p('The public commit history of the repository, which is individually timestamped from '
      + '3 May 2026 forward, together with the public build and deployment record, corroborates '
      + 'this account.', { after: 140 }),

      p('The work is released under the Creative Commons Attribution-NonCommercial-NoDerivatives '
      + '4.0 International license. Copyright © 2026 Cpl Angeles-Gonzalez, Ezekiel S. '
      + 'All rights reserved. Any commercial or derivative use requires a separate written '
      + 'license from me.', { after: 260 }),

      rule,

      runs([{ text: 'Signature: ' },
            { text: '                                                                      ',
              underline: { type: 'single' } }], { after: 200, size: 20 }),
      runs([{ text: 'Printed name: ' },
            { text: 'Angeles-Gonzalez, Ezekiel S.                                  ',
              underline: { type: 'single' } }], { after: 200, size: 20 }),
      runs([{ text: 'Date: ' },
            { text: '                                                                             ',
              underline: { type: 'single' } }], { after: 260, size: 20 }),

      p('Retain a signed copy outside the repository. See docs/legal/COPYRIGHT-CHECKLIST.md '
      + 'for the accompanying steps: copyright registration, and a written ethics/SJA opinion.',
        { italics: true, size: 17, after: 0 }),
    ],
  }],
});

Packer.toBuffer(doc).then(b => {
  fs.writeFileSync('/home/user/hfcal/docs/legal/Statement-of-Independent-Creation.docx', b);
  console.log('written');
});
