// Turns the plain-text draft into a Word (.docx) file, one paragraph per line.

import { Document, Packer, Paragraph, TextRun } from "docx";

// Times New Roman for English; Nirmala UI ships with Windows and covers
// Devanagari and the other Indian scripts.
const FONT = { ascii: "Times New Roman", hAnsi: "Times New Roman", cs: "Nirmala UI" };
const SIZE_HALF_POINTS = 24; // 12 pt
const ONE_INCH = 1440;

export async function textToDocx(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: SIZE_HALF_POINTS, sizeComplexScript: SIZE_HALF_POINTS },
          paragraph: { spacing: { after: 0, line: 300 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: { margin: { top: ONE_INCH, right: ONE_INCH, bottom: ONE_INCH, left: ONE_INCH } },
        },
        children: lines.map((line) => new Paragraph({ children: [new TextRun(line)] })),
      },
    ],
  });

  return Packer.toBuffer(doc);
}
