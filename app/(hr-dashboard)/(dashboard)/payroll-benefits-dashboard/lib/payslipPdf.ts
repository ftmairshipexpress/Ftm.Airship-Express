import "server-only";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  PDFFont,
  PDFPage,
} from "@cantoo/pdf-lib";
import fs from "fs/promises";
import path from "path";
import { existsSync } from "fs";

export const runtime = "nodejs";

export type PayslipPdfData = {
  periodLabel: string;
  employee: {
    email: string;
    name: string;
    position: string;
    idNumber: string;
    cutOff: string;
    dailyRate: number | null;
  };
  earnings: {
    totalPay: number;
    daysWorked: number;
    overtime: number;
    regularHoliday: number;
    specialHoliday: number;
    incentives: number;
    load: number;
    transpo: number;
    miscellaneous: number;
    gas: number;
    adjustment: number;
  };
  deductions: {
    sss: number;
    pagibig: number;
    philhealth: number;
    sssLoan: number;
    pagibigLoan: number;
    cashAdvanceBalance: number;
    tardiness: number;
    penalty: number;
    employeeSavings: number;
    excess: number;
  };
  grossTotal: number;
  totalDeduction: number;
  netPay: number;
};

function peso(n: number | null | undefined): string {
  if (n === null || n === undefined) return "0.00";
  return Number(n).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function clean(text: string): string {
  return String(text || "")
    .replace(/₱/g, "PHP ")
    .replace(/[^\x20-\x7E]/g, "");
}

async function loadLogo(): Promise<Uint8Array | null> {
  const publicDir = path.join(process.cwd(), "public");
  const candidates = [
    "images/logo-remove-bg.png",
    "images/logo.png",
    "logo-remove-bg.png",
    "logo.png",
  ];
  for (const c of candidates) {
    const p = path.join(publicDir, c);
    if (existsSync(p)) {
      try {
        const buf = await fs.readFile(p);
        return new Uint8Array(buf);
      } catch {
        continue;
      }
    }
  }
  return null;
}

type Ctx = {
  page: PDFPage;
  regular: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
  pink: ReturnType<typeof rgb>;
  pinkLight: ReturnType<typeof rgb>;
  border: ReturnType<typeof rgb>;
  ink: ReturnType<typeof rgb>;
  purple: ReturnType<typeof rgb>;
  green: ReturnType<typeof rgb>;
};

function drawLabelValue(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  label: string,
  value: string,
  align: "left" | "right" = "left"
) {
  const h = 20;
  ctx.page.drawRectangle({
    x,
    y: y - h + 6,
    width: w,
    height: h,
    color: ctx.pinkLight,
    borderColor: ctx.border,
    borderWidth: 0.7,
  });
  const labelW = w * 0.45;
  ctx.page.drawRectangle({
    x,
    y: y - h + 6,
    width: labelW,
    height: h,
    color: ctx.pinkLight,
    borderColor: ctx.border,
    borderWidth: 0.7,
  });
  ctx.page.drawText(clean(label.toUpperCase()), {
    x: x + 5,
    y: y - h / 2 - 2,
    size: 8,
    font: ctx.bold,
    color: ctx.purple,
  });
  const text = clean(value);
  const tw = ctx.regular.widthOfTextAtSize(text, 8);
  ctx.page.drawText(text, {
    x: align === "right" ? x + w - tw - 5 : x + labelW + 5,
    y: y - h / 2 - 2,
    size: 8,
    font: ctx.regular,
    color: ctx.ink,
  });
}

function drawBand(ctx: Ctx, x: number, y: number, w: number, text: string) {
  const h = 16;
  ctx.page.drawRectangle({
    x,
    y: y - h + 6,
    width: w,
    height: h,
    color: ctx.pink,
    borderColor: ctx.border,
    borderWidth: 0.7,
  });
  const tw = ctx.bold.widthOfTextAtSize(text.toUpperCase(), 8);
  ctx.page.drawText(text.toUpperCase(), {
    x: x + (w - tw) / 2,
    y: y - h / 2 - 2,
    size: 8,
    font: ctx.bold,
    color: ctx.purple,
  });
}

function drawRow(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  label: string,
  value: string,
  isMoney = true
) {
  const h = 18;
  ctx.page.drawRectangle({
    x,
    y: y - h + 6,
    width: w,
    height: h,
    color: rgb(1, 1, 1),
    borderColor: ctx.border,
    borderWidth: 0.6,
  });
  ctx.page.drawText(clean(label.toUpperCase()), {
    x: x + 5,
    y: y - h / 2 - 2,
    size: 8,
    font: ctx.bold,
    color: ctx.ink,
  });
  const text = clean(value);
  const f = isMoney ? ctx.mono : ctx.regular;
  const tw = f.widthOfTextAtSize(text, 8);
  ctx.page.drawText(text, {
    x: x + w - tw - 5,
    y: y - h / 2 - 2,
    size: 8,
    font: f,
    color: ctx.ink,
  });
}

export async function buildPayslipPdf(
  data: PayslipPdfData,
  birthdatePassword: string
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Payslip - ${data.periodLabel}`);
  pdfDoc.setAuthor("R.E.T Airship Courier Services");
  pdfDoc.setSubject("Payslip");

  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdfDoc.embedFont(StandardFonts.Courier);

  const page = pdfDoc.addPage([595, 842]);
  const { width, height } = page.getSize();

  const ctx: Ctx = {
    page,
    regular,
    bold,
    mono,
    pink: rgb(0.85, 0.66, 0.76),
    pinkLight: rgb(0.97, 0.93, 0.95),
    border: rgb(0.29, 0.12, 0.22),
    ink: rgb(0.11, 0.11, 0.12),
    purple: rgb(0.29, 0.12, 0.22),
    green: rgb(0.04, 0.56, 0.42),
  };

  const marginX = 32;
  const fullW = width - marginX * 2;

  let y = height - 32;

  const logoBytes = await loadLogo();
  let logoDrawn = false;
  if (logoBytes) {
    try {
      const logo = await pdfDoc.embedPng(logoBytes);
      const logoH = 44;
      const logoW = (logo.width / logo.height) * logoH;
      page.drawImage(logo, {
        x: marginX,
        y: y - logoH,
        width: logoW,
        height: logoH,
      });
      logoDrawn = true;
    } catch {
      logoDrawn = false;
    }
  }

  const titleX = logoDrawn ? marginX + 120 : marginX;
  page.drawText(clean("R.E.T AIRSHIP COURIER SERVICES"), {
    x: titleX,
    y: y - 18,
    size: 15,
    font: bold,
    color: ctx.ink,
  });
  page.drawText(clean("352 Escolta St., Tomas Pinpin, Binondo, Manila."), {
    x: titleX,
    y: y - 34,
    size: 9,
    font: regular,
    color: ctx.ink,
  });

  y -= 60;

  page.drawRectangle({
    x: marginX,
    y: y - 6,
    width: fullW,
    height: 24,
    color: ctx.pink,
    borderColor: ctx.border,
    borderWidth: 0.8,
  });
  const banner = clean(
    `PAYSLIP FOR THE MONTH OF ${data.periodLabel.toUpperCase()}`
  );
  const bannerW = bold.widthOfTextAtSize(banner, 11);
  page.drawText(banner, {
    x: marginX + (fullW - bannerW) / 2,
    y: y + 2,
    size: 11,
    font: bold,
    color: ctx.purple,
  });

  y -= 34;

  const colGap = 6;
  const halfW = (fullW - colGap) / 2;
  const leftX = marginX;
  const rightX = marginX + halfW + colGap;

  const leftHeaderY = y;
  const rightHeaderY = y;

  const headerH = 20;

  page.drawRectangle({
    x: leftX,
    y: leftHeaderY - headerH + 6,
    width: halfW,
    height: headerH,
    color: ctx.pinkLight,
    borderColor: ctx.border,
    borderWidth: 0.7,
  });
  const leftLabelW = halfW * 0.4;
  page.drawText("EMAIL ADDRESS", {
    x: leftX + 5,
    y: leftHeaderY - 6,
    size: 8,
    font: bold,
    color: ctx.purple,
  });
  page.drawText(clean(data.employee.email), {
    x: leftX + leftLabelW + 4,
    y: leftHeaderY - 6,
    size: 8,
    font: regular,
    color: ctx.ink,
  });

  page.drawRectangle({
    x: rightX,
    y: rightHeaderY - headerH + 6,
    width: halfW,
    height: headerH,
    color: ctx.pinkLight,
    borderColor: ctx.border,
    borderWidth: 0.7,
  });
  page.drawText("MONTH OF", {
    x: rightX + 5,
    y: rightHeaderY - 6,
    size: 8,
    font: bold,
    color: ctx.purple,
  });
  page.drawText(clean(data.periodLabel.split(" ")[0].toUpperCase()), {
    x: rightX + halfW - 60,
    y: rightHeaderY - 6,
    size: 8,
    font: bold,
    color: ctx.purple,
  });

  y -= headerH;

  drawLabelValue(ctx, leftX, y, halfW, "NAME", data.employee.name);
  drawLabelValue(ctx, rightX, y, halfW, "CUT OFF PERIOD", data.employee.cutOff);

  y -= 20;

  drawLabelValue(ctx, leftX, y, halfW, "POSITION", data.employee.position);
  drawLabelValue(
    ctx,
    rightX,
    y,
    halfW,
    "DAILY RATE",
    data.employee.dailyRate ? peso(data.employee.dailyRate) : "-"
  );

  y -= 20;

  drawLabelValue(ctx, leftX, y, halfW, "EMPLOYEE ID", data.employee.idNumber);

  y -= 26;

  const earningsTop = y;
  const deductionTop = y;

  drawBand(ctx, leftX, earningsTop, halfW, "Earnings");
  drawBand(ctx, rightX, deductionTop, halfW, "Deduction");

  y -= 16;

  const earningsRows: Array<[string, string]> = [
    ["TOTAL PAY", peso(data.earnings.totalPay)],
    ["DAYS WORKED", String(data.earnings.daysWorked)],
    ["OVERTIME", peso(data.earnings.overtime)],
    ["REGULAR HOLIDAY", peso(data.earnings.regularHoliday)],
    ["SPECIAL HOLIDAY", peso(data.earnings.specialHoliday)],
    ["INCENTIVES", peso(data.earnings.incentives)],
  ];
  const deductionRows: Array<[string, string]> = [
    ["SSS", peso(data.deductions.sss)],
    ["PAG-IBIG", peso(data.deductions.pagibig)],
    ["PHILHEALTH", peso(data.deductions.philhealth)],
  ];

  let ly = y;
  for (let i = 0; i < earningsRows.length; i++) {
    drawRow(ctx, leftX, ly, halfW, earningsRows[i][0], earningsRows[i][1]);
    if (i < deductionRows.length) {
      drawRow(ctx, rightX, ly, halfW, deductionRows[i][0], deductionRows[i][1]);
    }
    ly -= 18;
  }

  const afterEarnings = ly;

  drawBand(ctx, leftX, afterEarnings, halfW, "Allowances");
  drawBand(ctx, rightX, afterEarnings, halfW, "Loans");

  ly -= 16;

  const allowanceRows: Array<[string, string]> = [
    ["LOAD", peso(data.earnings.load)],
    ["TRANSPO", peso(data.earnings.transpo)],
    ["MISCELLANEOUS", peso(data.earnings.miscellaneous)],
    ["GAS", peso(data.earnings.gas)],
    ["ADJUSTMENT", peso(data.earnings.adjustment)],
  ];
  const loanRows: Array<[string, string]> = [
    ["SSS LOAN", peso(data.deductions.sssLoan)],
    ["PAG-IBIG LOAN", peso(data.deductions.pagibigLoan)],
    ["CASH ADVANCE BALANCE", peso(data.deductions.cashAdvanceBalance)],
  ];

  let iy = ly;
  for (let i = 0; i < allowanceRows.length; i++) {
    drawRow(ctx, leftX, iy, halfW, allowanceRows[i][0], allowanceRows[i][1]);
    if (i < loanRows.length) {
      drawRow(ctx, rightX, iy, halfW, loanRows[i][0], loanRows[i][1]);
    }
    iy -= 18;
  }

  const afterAllowances = iy;

  drawBand(ctx, rightX, afterAllowances, halfW, "Other Deduction");

  iy -= 16;

  const otherRows: Array<[string, string]> = [
    ["TARDINESS", peso(data.deductions.tardiness)],
    ["PENALTY DEDUCTION", peso(data.deductions.penalty)],
    ["EMPLOYEE'S SAVINGS", peso(data.deductions.employeeSavings)],
    ["EXCESS", peso(data.deductions.excess)],
  ];

  let oy = iy;
  for (const [label, value] of otherRows) {
    drawRow(ctx, rightX, oy, halfW, label, value);
    oy -= 18;
  }

  const bottomY = Math.min(oy, iy);

  drawBand(ctx, leftX, bottomY, halfW, "Gross Total");
  drawBand(ctx, rightX, bottomY, halfW, "Total Deduction");

  const valueY = bottomY - 16;
  const h18 = 18;
  page.drawRectangle({
    x: leftX,
    y: valueY - h18 + 6,
    width: halfW,
    height: h18,
    color: ctx.pinkLight,
    borderColor: ctx.border,
    borderWidth: 0.7,
  });
  const gtText = clean(peso(data.grossTotal));
  const gtW = mono.widthOfTextAtSize(gtText, 9);
  page.drawText(gtText, {
    x: leftX + halfW - gtW - 5,
    y: valueY - h18 / 2 - 2,
    size: 9,
    font: mono,
    color: ctx.ink,
  });

  page.drawRectangle({
    x: rightX,
    y: valueY - h18 + 6,
    width: halfW,
    height: h18,
    color: ctx.pinkLight,
    borderColor: ctx.border,
    borderWidth: 0.7,
  });
  const tdText = clean(peso(data.totalDeduction));
  const tdW = mono.widthOfTextAtSize(tdText, 9);
  page.drawText(tdText, {
    x: rightX + halfW - tdW - 5,
    y: valueY - h18 / 2 - 2,
    size: 9,
    font: mono,
    color: ctx.ink,
  });

  const netBandY = valueY - h18 - 2;

  drawBand(ctx, leftX, netBandY, halfW, "Net Pay");
  const netH = 30;
  page.drawRectangle({
    x: rightX,
    y: netBandY - netH + 6,
    width: halfW,
    height: netH,
    color: ctx.pinkLight,
    borderColor: ctx.border,
    borderWidth: 0.7,
  });
  const netText = clean(`PHP ${peso(data.netPay)}`);
  const netW = mono.widthOfTextAtSize(netText, 14);
  page.drawText(netText, {
    x: rightX + halfW - netW - 8,
    y: netBandY - netH / 2 - 2,
    size: 14,
    font: mono,
    color: ctx.green,
  });

  page.drawText(
    clean("Generated by R.E.T Airship Courier Services payroll system."),
    {
      x: marginX,
      y: 20,
      size: 7,
      font: regular,
      color: rgb(0.6, 0.6, 0.62),
    }
  );

  await pdfDoc.encrypt({
    userPassword: birthdatePassword,
    ownerPassword: `${birthdatePassword}_owner_${Date.now()}`,
    permissions: {
      printing: "highResolution",
      modifying: false,
      copying: false,
      annotating: false,
      fillingForms: false,
      contentAccessibility: false,
      documentAssembly: false,
    },
  });

  const bytes = await pdfDoc.save();
  return bytes;
}
