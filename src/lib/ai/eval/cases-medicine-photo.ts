/**
 * Medicine photo (VIS-3): the pure rules that turn a transcription of a strip, box or prescription (or typed
 * text) into reviewed medicine rows. Hand-counted goldens; no network, no keys, no database.
 *
 *   one row per dose of the day; counts appended to the dose; the unit regex; names shown exactly as read;
 *   duplicates by folded name (strength-aware); handwritten / low confidence flagged; more than 12 -> partial_list;
 *   advice text, a doctor's name or a phone number in place of a name dropped; nothing ticked, no time invented.
 */

import { caseOf, type EvalCase } from "@/services/soie/eval/harness";
import { MEDICINE_MAX_ROWS, MEDICINE_SCHEMA, type MedicineModelItem, type MedicineModelRead, type MedicineRowData } from "@/lib/vision/ai-contract";
import {
  coerceMedicineData,
  doseText,
  findDuplicate,
  formatCount,
  mapMedicineItems,
  missingFromPrescription,
  normalizeMedicine,
  normalizeStrength,
  TIME_CHIPS,
} from "@/lib/vision/medicine-map";
import { cleanMedicineName, interpretSig, parseMedicineText } from "@/lib/medicine-parse";
import { MEDICINE_PHOTO_SAFETY } from "@/lib/medicine-format";
import { parseVisionAnswer } from "@/services/vision-ai-service";
import { isStrictCompatible, validate } from "../json";
import type { JsonSchema } from "../types";
import { liveVisionKinds, visionHandler } from "../vision";

const item = (over: Partial<MedicineModelItem> = {}): MedicineModelItem => ({
  brandName: "Telma",
  genericName: null,
  strength: "40mg",
  form: "tablet",
  pattern: { morning: 1, afternoon: 0, evening: null, night: 1 },
  asNeeded: false,
  mealRelation: "after_meal",
  sigText: "1-0-1 after food",
  durationText: "5 days",
  readConfidence: 0.9,
  ...over,
});

const read = (over: Partial<MedicineModelRead> = {}): MedicineModelRead => ({
  imageKind: "prescription_printed",
  legibility: "clear",
  moreVisible: false,
  medicines: [item()],
  ...over,
});

const sig = (r: MedicineRowData) => `${r.name}|${r.dose}|${r.frequency}|${r.slot ?? "-"}|${r.doseNo}/${r.doseOf}`;

const EXISTING = [
  { id: "m1", medicine_name: "Telma 40", dose: "1 tab", active: true },
  { id: "m2", medicine_name: "Metformin", dose: "500 mg", active: true },
  { id: "m3", medicine_name: "Ecosprin", dose: "75 mg", active: false },
  { id: "m4", medicine_name: "Amlong 5", dose: "1 tab", active: true },
];

export function medicinePhotoCases(): EvalCase[] {
  const M = "medicine photo: map";
  const P = "medicine photo: text parser";
  const H = "medicine photo: handler";

  return [
    // ---- one row per dose ------------------------------------------------------------------------
    caseOf(M, "mp-101", "1-0-1 is TWO rows (morning, night), each with no time and a 'twice daily' label", (c) => {
      const n = normalizeMedicine(read());
      c.eq(n.data.medicines.map(sig), ["Telma|40 mg|twice daily|morning|1/2", "Telma|40 mg|twice daily|night|2/2"], "rows");
      c.eq(n.data.medicines.map((r) => r.scheduledTime), ["", ""], "no time is invented");
      c.eq(n.data.medicines.map((r) => r.mealRelation), ["after_meal", "after_meal"], "meal relation");
      c.eq(n.imageKind, "document", "a prescription is a document");
      c.eq(n.reasons, [], "no reason");
    }),
    caseOf(M, "mp-102", "1-1-1 is three rows, 1-0-1-1 three rows (morning, evening, night), 1-1-1-1 four rows", (c) => {
      const three = normalizeMedicine(read({ medicines: [item({ pattern: { morning: 1, afternoon: 1, evening: null, night: 1 } })] }));
      c.eq(three.data.medicines.map((r) => r.slot), ["morning", "afternoon", "night"], "1-1-1");
      c.eq(three.data.medicines[0].frequency, "thrice daily", "label");
      const four = normalizeMedicine(read({ medicines: [item({ pattern: { morning: 1, afternoon: 1, evening: 1, night: 1 } })] }));
      c.eq(four.data.medicines.map((r) => r.slot), ["morning", "afternoon", "evening", "night"], "1-1-1-1");
      const skip = normalizeMedicine(read({ medicines: [item({ pattern: { morning: 1, afternoon: 0, evening: 1, night: 1 } })] }));
      c.eq(skip.data.medicines.map((r) => r.slot), ["morning", "evening", "night"], "a zero is not a row");
    }),
    caseOf(M, "mp-103", "0-0-1 is one 'daily' row for the night; a lone OD with no part of the day is one row with no slot", (c) => {
      const night = normalizeMedicine(read({ medicines: [item({ pattern: { morning: 0, afternoon: 0, evening: null, night: 1 }, sigText: "0-0-1" })] }));
      c.eq(night.data.medicines.map(sig), ["Telma|40 mg|daily|night|0/0"], "night only");
      const od = normalizeMedicine(read({ medicines: [item({ pattern: null, sigText: "OD" })] }));
      c.eq(od.data.medicines.map(sig), ["Telma|40 mg|daily|-|0/0"], "OD");
    }),
    caseOf(M, "mp-104", "BD / TDS / QID in the dosing line become that many rows without a part of the day ('dose 1 of 2')", (c) => {
      const bd = normalizeMedicine(read({ medicines: [item({ pattern: null, sigText: "BD AC", mealRelation: "not_written" })] }));
      c.eq(bd.data.medicines.map(sig), ["Telma|40 mg|twice daily|-|1/2", "Telma|40 mg|twice daily|-|2/2"], "BD");
      c.eq(bd.data.medicines[0].mealRelation, "before_meal", "AC read from the dosing line when the field is empty");
      const tds = normalizeMedicine(read({ medicines: [item({ pattern: { morning: null, afternoon: null, evening: null, night: null }, sigText: "TDS" })] }));
      c.eq(tds.data.medicines.length, 3, "TDS = 3 rows");
      const qid = normalizeMedicine(read({ medicines: [item({ pattern: null, sigText: "QID" })] }));
      c.eq(qid.data.medicines.length, 4, "QID = 4 rows");
    }),
    caseOf(M, "mp-105", "HS is one night row; a dosing line that names parts of the day ('सुबह शाम') gives those rows", (c) => {
      const hs = normalizeMedicine(read({ medicines: [item({ pattern: null, sigText: "HS" })] }));
      c.eq(hs.data.medicines.map((r) => r.slot), ["night"], "HS");
      const hi = normalizeMedicine(read({ medicines: [item({ pattern: null, sigText: "सुबह शाम खाने के बाद", mealRelation: "not_written" })] }));
      c.eq(hi.data.medicines.map((r) => r.slot), ["morning", "evening"], "सुबह शाम");
      c.eq(hi.data.medicines[0].mealRelation, "after_meal", "meal relation from the line");
    }),
    caseOf(M, "mp-106", "the pattern written only in the dosing line ('1-0-1') is used when the pattern field is empty", (c) => {
      const n = normalizeMedicine(read({ medicines: [item({ pattern: null, sigText: "1-0-1 after food" })] }));
      c.eq(n.data.medicines.map((r) => r.slot), ["morning", "night"], "rows from the line");
    }),
    caseOf(M, "mp-107", "as needed: one row, 'as needed', no part of the day, however the pattern is filled", (c) => {
      const n = normalizeMedicine(read({ medicines: [item({ asNeeded: true, pattern: null, sigText: "SOS" })] }));
      c.eq(n.data.medicines.map(sig), ["Telma|40 mg|as needed|-|0/0"], "row");
      c.eq(n.data.medicines[0].check, false, "no conflict");
      const sos = normalizeMedicine(read({ medicines: [item({ pattern: null, sigText: "SOS if pain" })] }));
      c.eq(sos.data.medicines[0].frequency, "as needed", "SOS in the line");
      const both = normalizeMedicine(read({ medicines: [item({ asNeeded: true })] }));
      c.eq(both.data.medicines.length, 1, "as-needed beats a written pattern");
      c.eq(both.data.medicines[0].check, true, "but the contradiction is flagged");
    }),
    caseOf(M, "mp-108", "a count other than 1 is appended to the dose ('40 mg x 2', 'x ½'); 1 is not", (c) => {
      const n = normalizeMedicine(read({ medicines: [item({ pattern: { morning: 2, afternoon: 0, evening: null, night: 0.5 } })] }));
      c.eq(n.data.medicines.map((r) => r.dose), ["40 mg x 2", "40 mg x ½"], "doses");
      c.eq(formatCount(1.5), "1½", "1.5");
      c.eq(doseText("", 2, "tablet"), "2 टैबलेट", "no strength: the count and the form");
      c.eq(doseText("", null, "tablet"), "", "no strength and no count: blank, never invented");
      c.eq(doseText("", 1, "syrup"), "", "no known unit word: blank");
    }),
    caseOf(M, "mp-109", "an impossible count ('1-0-7') discards the whole pattern and asks to compare with the paper", (c) => {
      const n = normalizeMedicine(read({ medicines: [item({ pattern: { morning: 1, afternoon: 0, evening: null, night: 7 }, sigText: null })] }));
      c.eq(n.data.medicines.length, 1, "one row, no slots");
      c.eq(n.data.medicines[0].slot, null, "no part of the day");
      c.eq(n.data.medicines[0].check, true, "flagged");
    }),

    // ---- strength --------------------------------------------------------------------------------
    caseOf(M, "mp-201", "strength is only spaced when a unit follows: mg mcg g ml IU units %; anything else is blank", (c) => {
      c.eq(normalizeStrength("40mg"), "40 mg", "40mg");
      c.eq(normalizeStrength("40 MG"), "40 mg", "40 MG");
      c.eq(normalizeStrength("12.5mg"), "12.5 mg", "decimal");
      c.eq(normalizeStrength("100 mcg"), "100 mcg", "mcg");
      c.eq(normalizeStrength("1g"), "1 g", "g");
      c.eq(normalizeStrength("5ml"), "5 ml", "ml");
      c.eq(normalizeStrength("10 iu"), "10 IU", "IU");
      c.eq(normalizeStrength("30 units"), "30 units", "units");
      c.eq(normalizeStrength("5%"), "5%", "percent");
      c.eq(normalizeStrength("40/5 mg"), "40/5 mg", "combination");
      c.eq(normalizeStrength("500 mg + 150 mg"), "500 mg + 150 mg", "written-out combination");
      c.eq(normalizeStrength("40"), "", "no unit");
      c.eq(normalizeStrength("40 tablets"), "", "not a unit of strength");
      c.eq(normalizeStrength("forty mg"), "", "words");
      c.eq(normalizeStrength("4000000000000000000000 mg"), "", "longer than 24 characters as read");
      c.eq(normalizeStrength(null), "", "null");
    }),
    caseOf(M, "mp-202", "a strength is never converted (g stays g, mcg stays mcg)", (c) => {
      c.eq(normalizeStrength("0.5 g"), "0.5 g", "g");
      c.eq(normalizeStrength("500 mcg"), "500 mcg", "mcg");
    }),

    // ---- names -----------------------------------------------------------------------------------
    caseOf(M, "mp-301", "an invented or misspelt drug name is shown exactly as read (never corrected to a 'known' drug)", (c) => {
      for (const name of ["Zorbacitan 40", "Telmisartin", "Metformine", "ARMLODIPIN", "टेल्मा"]) {
        const n = normalizeMedicine(read({ medicines: [item({ brandName: name, pattern: null, sigText: null })] }));
        c.eq(n.data.medicines.map((r) => r.name), [name], `shown as read: ${name}`);
      }
    }),
    caseOf(M, "mp-306", "a brand the model split ('Dolo' + strength '650') goes back together; a number with a unit stays a strength", (c) => {
      const split = normalizeMedicine(read({ medicines: [item({ brandName: "Dolo", strength: "650", form: "tablet", pattern: null, sigText: null })] }));
      c.eq([split.data.medicines[0].name, split.data.medicines[0].strength, split.data.medicines[0].dose], ["Dolo 650", "", ""], "name regained its number");
      const whole = normalizeMedicine(read({ medicines: [item({ brandName: "Dolo 650", strength: "650", pattern: null, sigText: null })] }));
      c.eq(whole.data.medicines[0].name, "Dolo 650", "not repeated");
      const unit = normalizeMedicine(read({ medicines: [item({ brandName: "Telma", strength: "40 mg", pattern: null, sigText: null })] }));
      c.eq([unit.data.medicines[0].name, unit.data.medicines[0].strength], ["Telma", "40 mg"], "with a unit it is a strength");
      const packs = normalizeMedicine(read({ medicines: [item({ brandName: "Telma", strength: "10 tablets", pattern: null, sigText: null })] }));
      c.eq([packs.data.medicines[0].name, packs.data.medicines[0].strength], ["Telma", ""], "a pack size is not a strength and not a name");
    }),
    caseOf(M, "mp-307", "a brand name that contains an ordinary word passes; the same word in a sentence refuses it", (c) => {
      for (const ok of ["Safe-Cal", "Cure-X", "Helpin D3"]) c.eq(cleanMedicineName(ok), ok, `passes: ${ok}`);
      for (const bad of ["this medicine is safe for you", "helps to lower blood pressure", "Avoid alcohol", "Stop Telma"]) c.eq(cleanMedicineName(bad), "", `refused: ${bad}`);
    }),
    caseOf(M, "mp-308", "a long dosing line is read in full but shown cut with an ellipsis; an over-long advice line is dropped", (c) => {
      const line = "1 tablet twice daily after food for five days, then come for review with reports";
      const n = normalizeMedicine(read({ medicines: [item({ pattern: null, sigText: line, mealRelation: "not_written", durationText: null })] }));
      c.eq(n.data.medicines.length, 2, "twice daily was read from the whole line");
      c.eq(n.data.medicines[0].mealRelation, "after_meal", "after food");
      c.ok(n.data.medicines[0].sigText.endsWith("…") && n.data.medicines[0].sigText.length <= 60, "shown cut");
    }),
    caseOf(M, "mp-302", "brand name wins; the generic name is shown beside it only when it is another word; a missing brand uses the generic", (c) => {
      const both = normalizeMedicine(read({ medicines: [item({ brandName: "Telma", genericName: "Telmisartan", pattern: null, sigText: null })] }));
      c.eq([both.data.medicines[0].name, both.data.medicines[0].genericName], ["Telma", "Telmisartan"], "both");
      const only = normalizeMedicine(read({ medicines: [item({ brandName: null, genericName: "Metformin", pattern: null, sigText: null })] }));
      c.eq([only.data.medicines[0].name, only.data.medicines[0].genericName], ["Metformin", ""], "generic only");
      const same = normalizeMedicine(read({ medicines: [item({ brandName: "Metformin", genericName: "METFORMIN", pattern: null, sigText: null })] }));
      c.eq(same.data.medicines[0].genericName, "", "same word is not repeated");
    }),
    caseOf(M, "mp-303", "advice, a warning or a purpose in place of a name drops the row; in the dosing line it is dropped from the row", (c) => {
      const n = normalizeMedicine(
        read({
          medicines: [
            item({ brandName: "Do not stop this medicine; consult your doctor", genericName: null }),
            item({ brandName: "Amlong", sigText: "avoid alcohol and do not skip a dose", durationText: "used for blood pressure", pattern: null }),
            item({ brandName: "Atorva", pattern: null, sigText: "1-0-1", durationText: "10 days" }),
          ],
        }),
      );
      c.eq(n.data.medicines.map((r) => r.name), ["Amlong", "Atorva", "Atorva"], "advice name dropped");
      c.eq([n.data.medicines[0].sigText, n.data.medicines[0].durationText], ["", ""], "advice text removed from the row");
      c.eq(n.data.medicines[1].durationText, "10 days", "a plain duration is kept");
      c.ok(n.reasons.includes("partial_list"), "the list says it may be incomplete");
    }),
    caseOf(M, "mp-304", "a doctor's name, a patient's name, a phone number, an e-mail or a sentence is never a medicine row", (c) => {
      for (const bad of ["Dr. Sharma", "Dr Anil Gupta MD", "Patient Ramesh Kumar", "9876543210", "+91 98765 43210", "clinic@example.com", "डॉ. शर्मा", "this is a long sentence that is not a name at all really"]) {
        c.eq(cleanMedicineName(bad), "", `refused: ${bad}`);
      }
      c.eq(cleanMedicineName("Dr. Reddy's Telmisartan"), "", "a leading 'Dr.' is a person, whatever follows");
      c.eq(cleanMedicineName("Telma-AM 40/5"), "Telma-AM 40/5", "a real combination name passes");
      c.eq(cleanMedicineName("Pantop D SR"), "Pantop D SR", "short names pass");
      c.eq(cleanMedicineName("टेल्मा 40"), "टेल्मा 40", "Devanagari passes");
    }),
    caseOf(M, "mp-305", "text inside the photo is data: control characters and markup are stripped from names and lines", (c) => {
      const n = normalizeMedicine(read({ medicines: [item({ brandName: "Tel\u0000ma <b>40</b>", pattern: null, sigText: "1-0-1​" })] }));
      c.eq(n.data.medicines[0].name, "Telma b40/b", "markup characters removed");
      c.ok(!/[<>\u0000​]/.test(JSON.stringify(n.data)), "no control or markup characters");
    }),

    // ---- the list, flags and reasons --------------------------------------------------------------
    caseOf(M, "mp-401", "13 medicines: the first 12 are kept and the answer says the list is partial", (c) => {
      const many = Array.from({ length: 13 }, (_, i) => item({ brandName: `Med${String.fromCharCode(65 + i)}x`, pattern: null, sigText: null }));
      const n = normalizeMedicine(read({ medicines: many }));
      c.eq(n.data.medicines.length, MEDICINE_MAX_ROWS, "12 rows");
      c.ok(n.reasons.includes("partial_list"), "partial_list");
      const exact = normalizeMedicine(read({ medicines: many.slice(0, 12) }));
      c.ok(!exact.reasons.includes("partial_list"), "12 is not partial");
      const flagged = normalizeMedicine(read({ medicines: many.slice(0, 3), moreVisible: true }));
      c.ok(flagged.reasons.includes("partial_list"), "the model said more is visible");
    }),
    caseOf(M, "mp-402", "handwritten: every row asks to be compared with the paper, and the reason is returned", (c) => {
      const n = normalizeMedicine(read({ imageKind: "prescription_handwritten", legibility: "partial", medicines: [item({ readConfidence: 0.95 }), item({ brandName: "Amlong", readConfidence: 0.99 })] }));
      c.eq(n.data.handwritten, true, "flag");
      c.ok(n.reasons.includes("handwritten"), "reason");
      c.eq(n.data.medicines.every((r) => r.check), true, "every row flagged");
      const printed = normalizeMedicine(read({ legibility: "clear", medicines: [item({ readConfidence: 0.95 })] }));
      c.eq(printed.data.medicines.some((r) => r.check), false, "a clear printed row is not flagged");
    }),
    caseOf(M, "mp-403", "read confidence under 0.5 is flagged; 0.5 and above is not; a missing confidence counts as 0", (c) => {
      const n = normalizeMedicine(read({ medicines: [item({ brandName: "Alpha", readConfidence: 0.49, pattern: null, sigText: null }), item({ brandName: "Bravo", readConfidence: 0.5, pattern: null, sigText: null }), item({ brandName: "Delta", readConfidence: undefined as unknown as number, pattern: null, sigText: null })] }));
      c.eq(n.data.medicines.map((r) => r.check), [true, false, true], "flags");
      c.eq(n.data.medicines.map((r) => r.readConfidence), [0.49, 0.5, 0], "clamped confidence");
    }),
    caseOf(M, "mp-404", "not a medicine photo / a lab report / unreadable: no rows and a reason, never a guess", (c) => {
      const other = normalizeMedicine(read({ imageKind: "other", medicines: [item()] }));
      c.eq([other.data.medicines.length, other.reasons, other.imageKind], [0, ["not_medicine"], "other"], "other");
      const lab = normalizeMedicine(read({ imageKind: "lab_report", medicines: [item()] }));
      c.eq([lab.data.medicines.length, lab.reasons, lab.imageKind], [0, ["not_medicine"], "document"], "lab report");
      const poor = normalizeMedicine(read({ legibility: "poor" }));
      c.eq([poor.data.medicines.length, poor.reasons], [0, ["unreadable"]], "poor legibility");
      const none = normalizeMedicine(read({ medicines: [] }));
      c.eq([none.data.medicines.length, none.reasons], [0, ["unreadable"]], "empty list");
    }),
    caseOf(M, "mp-405", "a strip or box is a 'medicine' image, a prescription a 'document'; the source says which", (c) => {
      c.eq(normalizeMedicine(read({ imageKind: "medicine_strip" })).imageKind, "medicine", "strip");
      c.eq(normalizeMedicine(read({ imageKind: "medicine_box" })).data.source, "box", "box source");
      c.eq(normalizeMedicine(read({ imageKind: "prescription_printed" })).data.source, "prescription_printed", "printed source");
    }),
    caseOf(M, "mp-406", "duration is carried for display only; the saved fields never include it", (c) => {
      const n = normalizeMedicine(read());
      c.eq(n.data.medicines[0].durationText, "5 days", "shown");
      const saved = ["name", "dose", "mealRelation", "frequency"];
      c.ok(saved.every((k) => k in n.data.medicines[0]), "save fields exist");
      c.eq(n.data.medicines[0].dose, "40 mg", "the duration is not in the dose");
    }),
    caseOf(M, "mp-407", "nothing is ticked and no time is chosen by the data: scheduledTime is '' and duplicateOf is null on every row", (c) => {
      const n = normalizeMedicine(read({ medicines: [item({ pattern: { morning: 1, afternoon: 1, evening: 1, night: 1 } }), item({ brandName: "Zed", asNeeded: true, pattern: null })] }));
      c.eq(n.data.medicines.every((r) => r.scheduledTime === "" && r.duplicateOf === null), true, "blank time, no duplicate");
      c.eq(TIME_CHIPS.map((t) => t.time), ["08:00", "14:00", "18:00", "21:00"], "the four chips a person taps");
    }),

    // ---- duplicates and what is missing ------------------------------------------------------------
    caseOf(M, "mp-501", "duplicates: the same name folded (case, pack words, spacing) is found; a different strength is not", (c) => {
      c.eq(findDuplicate({ name: "TELMA 40", strength: "" }, EXISTING)?.id, "m1", "case");
      c.eq(findDuplicate({ name: "Tab. Telma 40", strength: "" }, EXISTING)?.id, "m1", "Tab. prefix");
      c.eq(findDuplicate({ name: "Telma", strength: "40 mg" }, [{ id: "x", medicine_name: "Telma", dose: "40 mg", active: true }])?.id, "x", "name + strength in the dose");
      c.eq(findDuplicate({ name: "Telma", strength: "80 mg" }, [{ id: "x", medicine_name: "Telma", dose: "40 mg", active: true }]), null, "another strength is another medicine");
      c.eq(findDuplicate({ name: "Telma 80", strength: "" }, EXISTING), null, "Telma 80 is not Telma 40");
      c.eq(findDuplicate({ name: "Amlong5", strength: "" }, EXISTING)?.id, "m4", "digits glued to the name");
    }),
    caseOf(M, "mp-502", "duplicates: a one-letter slip in a long name still matches; short names and different drugs do not", (c) => {
      c.eq(findDuplicate({ name: "Metformine", strength: "500 mg" }, EXISTING)?.id, "m2", "one extra letter");
      c.eq(findDuplicate({ name: "Metformin", strength: "" }, EXISTING)?.id, "m2", "same");
      c.eq(findDuplicate({ name: "Amlodipine", strength: "" }, [{ id: "z", medicine_name: "Amlong", dose: "5", active: true }]), null, "different drugs");
      c.eq(findDuplicate({ name: "Dolo", strength: "" }, [{ id: "z", medicine_name: "Dola", dose: "", active: true }]), null, "short names need to be exact");
      c.eq(findDuplicate({ name: "Telma-AM 40/5", strength: "" }, EXISTING), null, "a combination is not Telma 40");
    }),
    caseOf(M, "mp-503", "an inactive medicine is still found, and says so; an active one wins over an inactive one", (c) => {
      const hit = findDuplicate({ name: "Ecosprin", strength: "75 mg" }, EXISTING);
      c.eq([hit?.id, hit?.active], ["m3", false], "inactive");
      const both = findDuplicate({ name: "Ecosprin", strength: "" }, [...EXISTING, { id: "m9", medicine_name: "Ecosprin 75", dose: "1 tab", active: true }]);
      c.eq([both?.id, both?.active], ["m9", true], "active preferred");
    }),
    caseOf(M, "mp-504", "a medicine missing from a new prescription gets only a neutral tag: listed, never changed", (c) => {
      const rows = [{ name: "Telma", strength: "40 mg" }, { name: "Metformin", strength: "" }];
      const missing = missingFromPrescription(EXISTING, rows);
      c.eq(missing.map((m) => m.id), ["m4"], "the active medicine that the prescription does not list");
      c.eq(missingFromPrescription(EXISTING, []).length, 0, "no rows, no claim");
      c.ok(!missing.some((m) => m.active === false), "inactive ones are not listed");
      c.eq(Object.keys(missing[0]).sort().join(","), "active,dose,id,medicine_name", "the existing row is returned untouched: there is nothing here that could switch it off");
    }),
    caseOf(M, "mp-505", "the browser's second look: advice-like or malformed rows are dropped from an answer, a good row stays", (c) => {
      const answer = {
        source: "prescription_printed",
        handwritten: false,
        medicines: [
          { key: "0-morning", name: "Telma", genericName: "", strength: "40mg", dose: "40 mg", count: 1, form: "tablet", mealRelation: "after_meal", frequency: "twice daily", slot: "morning", doseNo: 1, doseOf: 2, scheduledTime: "", duplicateOf: null, readConfidence: 0.9, check: false, sigText: "1-0-1", durationText: "5 days" },
          { key: "1-x", name: "Take double dose if you miss one", dose: "", frequency: "daily" },
          { key: "2-x", name: "Amlong", dose: "5 mg", frequency: "weird", slot: "midnight", mealRelation: "sometimes", sigText: "do not stop", scheduledTime: "09:00" },
          "not an object",
        ],
      };
      const out = coerceMedicineData(answer);
      c.eq(out?.medicines.map((r) => r.name), ["Telma", "Amlong"], "names");
      c.eq(out?.medicines[0].strength, "40 mg", "strength re-spaced");
      c.eq(out?.medicines[1].frequency, "daily", "unknown frequency falls back to the label");
      c.eq([out?.medicines[1].slot, out?.medicines[1].mealRelation, out?.medicines[1].sigText, out?.medicines[1].scheduledTime], [null, null, "", ""], "unknown values and a time from the wire are dropped");
      c.eq(coerceMedicineData(null), null, "null");
      c.eq(coerceMedicineData({ medicines: "x" }), null, "wrong shape");
    }),
    caseOf(M, "mp-506", "the client service passes a medicine answer through and the browser re-checks it", (c) => {
      const ok = parseVisionAnswer("medicine", { provider: "groq", model: "m", ms: 1, requestId: "r", imageKind: "document", reasons: ["handwritten", "made_up"], data: { source: null, handwritten: true, medicines: [] } });
      c.eq(ok?.provider, "groq", "accepted");
      c.eq(ok?.reasons, ["handwritten"], "unknown reason codes are dropped");
      c.eq(parseVisionAnswer("medicine", { provider: "nobody", data: {} }), null, "unknown provider");
    }),

    // ---- the typed / pasted text parser (works with AI off) ----------------------------------------
    caseOf(P, "mp-601", "'Tab Telma 40 mg 1-0-1 after food x 30 days': name, strength, form, pattern, meal, duration", (c) => {
      const r = parseMedicineText("Tab Telma 40 mg 1-0-1 after food x 30 days");
      c.eq(r.items.length, 1, "one item");
      const i = r.items[0];
      c.eq([i.brandName, i.strength, i.form, i.mealRelation, i.durationText], ["Telma", "40 mg", "tablet", "after_meal", "x 30 days"], "fields");
      c.eq(i.pattern, { morning: 1, afternoon: 0, evening: null, night: 1 }, "pattern");
      const rows = mapMedicineItems(r.items, { source: "typed", handwritten: false, partial: false, truncated: false });
      c.eq(rows.data.medicines.map(sig), ["Telma|40 mg|twice daily|morning|1/2", "Telma|40 mg|twice daily|night|2/2"], "rows");
    }),
    caseOf(P, "mp-602", "OD, BD, TDS, QID, HS, SOS and AC / PC are read; BD is two doses with no part of the day", (c) => {
      const sample = (t: string) => interpretSig(t);
      c.eq(sample("OD").perDay, 1, "OD");
      c.eq(sample("BD").perDay, 2, "BD");
      c.eq(sample("b.d.").perDay, 2, "b.d.");
      c.eq(sample("TDS").perDay, 3, "TDS");
      c.eq(sample("tid").perDay, 3, "TID");
      c.eq(sample("QID").perDay, 4, "QID");
      c.eq(sample("HS").named.night, 1, "HS = night");
      c.eq(sample("SOS").asNeeded, true, "SOS");
      c.eq(sample("PRN").asNeeded, true, "PRN");
      c.eq(sample("AC").meal, "before_meal", "AC");
      c.eq(sample("PC").meal, "after_meal", "PC");
      c.eq(sample("before food").meal, "before_meal", "before food");
      c.eq(sample("with food").meal, "with_meal", "with food");
      c.eq(sample("empty stomach").meal, "empty_stomach", "empty stomach");
      const bd = parseMedicineText("Metformin 500 BD PC");
      const rows = mapMedicineItems(bd.items, { source: "typed", handwritten: false, partial: false, truncated: false });
      c.eq(rows.data.medicines.map((r) => `${r.name}|${r.slot ?? "-"}|${r.doseNo}/${r.doseOf}|${r.mealRelation}`), ["Metformin 500|-|1/2|after_meal", "Metformin 500|-|2/2|after_meal"], "BD PC");
    }),
    caseOf(P, "mp-603", "Hindi and Hinglish: सुबह / दोपहर / शाम / रात, खाने से पहले / बाद, दिन में 2 बार, जरूरत पड़ने पर", (c) => {
      const a = parseMedicineText("टैब टेल्मा 40 सुबह 1 रात 1 खाने के बाद");
      c.eq(a.items[0].brandName, "टेल्मा 40", "name");
      c.eq(a.items[0].form, "tablet", "टैब");
      c.eq(a.items[0].pattern, { morning: 1, afternoon: null, evening: null, night: 1 }, "सुबह 1 रात 1");
      c.eq(a.items[0].mealRelation, "after_meal", "खाने के बाद");
      const b = parseMedicineText("Amlong 5 subah shaam khane se pehle");
      c.eq(b.items[0].pattern, { morning: 1, afternoon: null, evening: 1, night: null }, "subah shaam");
      c.eq(b.items[0].mealRelation, "before_meal", "khane se pehle");
      const d = parseMedicineText("मेटफॉर्मिन 500 दिन में 2 बार खाने के साथ 5 दिन");
      c.eq(d.items[0].brandName, "मेटफॉर्मिन 500", "the 500 is not 500 days");
      c.eq(d.items[0].durationText, "5 दिन", "duration");
      c.eq(interpretSig("जरूरत पड़ने पर").asNeeded, true, "जरूरत पड़ने पर");
    }),
    caseOf(P, "mp-604", "headers, doctor, patient, dates and phone numbers are skipped; a whole prescription gives its medicines", (c) => {
      const r = parseMedicineText(
        ["Rx", "Dr. Sharma MBBS", "Patient: Ramesh Kumar  Age 62", "Date: 12/10/2026", "1. Tab Telma 40 mg 1-0-1 after food", "2) Cap Omez 20 BD AC", "Tab Dolo 650 SOS", "Phone 9876543210"].join("\n"),
      );
      c.eq(r.items.map((i) => i.brandName), ["Telma", "Omez 20", "Dolo 650"], "medicines");
      c.eq(r.items[1].form, "capsule", "Cap");
      c.eq(r.items[2].asNeeded, true, "SOS");
      c.ok(r.skipped >= 4, "headers skipped");
    }),
    caseOf(P, "mp-605", "a dosing line under a medicine belongs to it; a lone count after a number is not part of the name", (c) => {
      const r = parseMedicineText("Tab Telma 40\n1-0-1 after food x 5 days\nTab Ecosprin 75 1 HS");
      c.eq(r.items.length, 2, "two medicines");
      c.eq([r.items[0].brandName, r.items[0].durationText, r.items[0].mealRelation], ["Telma 40", "x 5 days", "after_meal"], "carried");
      c.eq(r.items[1].brandName, "Ecosprin 75", "name without the lone 1");
      c.eq(r.items[1].pattern, { morning: null, afternoon: null, evening: null, night: 1 }, "HS");
    }),
    caseOf(P, "mp-606", "a date, a 40/5 strength and a long number are not a '1-0-1' pattern", (c) => {
      c.eq(interpretSig("12-10-2026").pattern, null, "date");
      c.eq(interpretSig("Telma-AM 40/5").pattern, null, "40/5");
      c.eq(interpretSig("1-0-1").pattern, { morning: 1, afternoon: 0, evening: null, night: 1 }, "1-0-1");
      c.eq(interpretSig("1-0-0-1").pattern, { morning: 1, afternoon: 0, evening: 0, night: 1 }, "four numbers");
      c.eq(interpretSig("1–0–1").pattern?.night, 1, "en dashes");
      c.eq(interpretSig("१-०-१").pattern?.night, 1, "Devanagari digits");
    }),
    caseOf(P, "mp-607", "a sentence of advice is not a medicine; advice written beside a name refuses the name", (c) => {
      c.eq(parseMedicineText("Take rest and drink plenty of water").items.length, 0, "advice sentence");
      c.eq(parseMedicineText("Tab Telma 40 do not stop without asking the doctor 1-0-1").items.length, 0, "advice beside a name");
      c.eq(parseMedicineText("").items.length, 0, "empty");
      c.eq(parseMedicineText("   \n\n ").items.length, 0, "blank");
    }),
    caseOf(P, "mp-608", "a comma-separated list is several medicines; names are kept exactly as typed", (c) => {
      const r = parseMedicineText("Telma 40, Amlong 5, Metformin 500");
      c.eq(r.items.map((i) => i.brandName), ["Telma 40", "Amlong 5", "Metformin 500"], "three");
      const typo = parseMedicineText("Tab Telmisarten 40 mg OD");
      c.eq(typo.items[0].brandName, "Telmisarten", "a misspelling is not corrected");
    }),
    caseOf(P, "mp-609", "more than 12 typed medicines: the first 12 and truncated", (c) => {
      const text = Array.from({ length: 14 }, (_, i) => `Tab Drug${String.fromCharCode(65 + i)}x 10 mg OD`).join("\n");
      const r = parseMedicineText(text);
      c.eq([r.items.length, r.truncated], [MEDICINE_MAX_ROWS, true], "cut at 12");
      const mapped = mapMedicineItems(r.items, { source: "typed", handwritten: false, partial: false, truncated: r.truncated });
      c.eq(mapped.truncated, true, "the map says so too");
    }),
    caseOf(P, "mp-610", "the parser is rules only (text in, items out), and the fixed safety line refers to the doctor and instructs nothing", (c) => {
      c.eq(parseMedicineText("Tab Telma 40 1-0-1").items.length, 1, "works without any AI configuration");
      c.includes(MEDICINE_PHOTO_SAFETY.hi, "डॉक्टर से पूछकर", "the doctor referral");
      c.ok(!/(बढ़ाएँ|घटाएँ|बंद करें|छोड़ दें|दोगुनी|आधी)/.test(MEDICINE_PHOTO_SAFETY.hi), "no dose or start/stop instruction");
      c.ok(!/(increase|decrease|stop taking|skip|double)/i.test(MEDICINE_PHOTO_SAFETY.en), "none in English either");
    }),

    // ---- the handler -----------------------------------------------------------------------------------
    caseOf(H, "mp-701", "the handler is registered as an 'identifying' smart-tier read with its own task name", (c) => {
      const h = visionHandler("medicine");
      c.ok(!!h, "registered");
      c.eq([h?.task, h?.tier, h?.sensitivity, h?.kind], ["vision_medicine", "smart", "identifying", "medicine"], "settings");
      c.eq(h?.maxImageBytes, 1_800_000, "image budget");
      c.ok(liveVisionKinds().includes("medicine"), "listed as a live kind");
    }),
    caseOf(H, "mp-702", "the prompt transcribes only: no advice, no purpose, no names; it forbids copying names and phone numbers", (c) => {
      const h = visionHandler("medicine");
      const text = `${h?.system ?? ""} ${h?.prompt({ hints: [] }) ?? ""}`;
      c.includes(text, "Do not spell-correct", "no correction");
      c.includes(text, "Never copy the patient's name", "no patient data");
      c.includes(text, "never advise", "no advice");
      c.includes(text, "never explain what a medicine is for", "no purpose");
      c.ok(!/(interaction|side effect)s? (are|is|of)/i.test(text.replace(/never mention interactions or side effects/i, "")), "no request for interactions");
      c.ok(text.length < 4_000, "short enough for the 8,000-tokens-a-minute tier");
    }),
    caseOf(H, "mp-703", "the schema is strict-compatible, tolerant of a long list (16) and of a name a little too long, and holds no advice field", (c) => {
      c.eq(isStrictCompatible(MEDICINE_SCHEMA as unknown as JsonSchema), true, "strict");
      const answer = read({ medicines: Array.from({ length: 13 }, (_, i) => item({ brandName: `Medicine${i}` })) });
      c.eq(validate(MEDICINE_SCHEMA as unknown as JsonSchema, answer), [], "13 medicines are a valid answer (cut by code, not a failed attempt)");
      const keys = Object.keys(((MEDICINE_SCHEMA.properties.medicines.items as unknown) as { properties: Record<string, unknown> }).properties);
      c.ok(!keys.some((k) => /purpose|advice|interaction|warning|indication|sideEffect|dose_check/i.test(k)), "no advice-shaped field");
      c.ok(validate(MEDICINE_SCHEMA as unknown as JsonSchema, { imageKind: "poem", legibility: "clear", moreVisible: false, medicines: [] }).length > 0, "an unknown image kind is refused");
    }),
    caseOf(H, "mp-704", "the handler's normaliser is the map: transcription in, rows + reasons out", (c) => {
      const h = visionHandler("medicine");
      const out = h?.normalize(read({ imageKind: "prescription_handwritten" }) as never, { hints: [] }) as { data: { medicines: MedicineRowData[] }; reasons: string[] };
      c.eq(out.data.medicines.length, 2, "rows");
      c.ok(out.reasons.includes("handwritten"), "reason");
    }),
  ];
}
