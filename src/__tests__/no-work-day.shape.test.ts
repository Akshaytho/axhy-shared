/**
 * Shape test for the NoWorkDay Prisma model + NoWorkDayScope enum.
 *
 * Run: npm run build && node --test dist/__tests__/no-work-day.shape.test.js
 *
 * This repo has no runtime @prisma/client dependency, so we verify the
 * schema-level shape by parsing prisma/schema.prisma directly. Red before
 * the model + enum are added; green once the migration + schema update land.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCHEMA_PATH = join(__dirname, "..", "..", "prisma", "schema.prisma");
const schema = readFileSync(SCHEMA_PATH, "utf8");

function extractBlock(kind: "model" | "enum", name: string): string | null {
  const re = new RegExp(`${kind}\\s+${name}\\s+\\{([\\s\\S]*?)\\n\\}`, "m");
  const m = schema.match(re);
  return m ? m[1] : null;
}

test("NoWorkDayScope enum exists with COMPANY, SITE, WORKERS values", () => {
  const body = extractBlock("enum", "NoWorkDayScope");
  assert.ok(body, "enum NoWorkDayScope not found in schema.prisma");
  for (const v of ["COMPANY", "SITE", "WORKERS"]) {
    assert.match(body!, new RegExp(`\\b${v}\\b`), `missing enum value ${v}`);
  }
});

test("NoWorkDay model exists with required fields", () => {
  const body = extractBlock("model", "NoWorkDay");
  assert.ok(body, "model NoWorkDay not found in schema.prisma");
  const required = [
    /\bid\s+String\s+@id/,
    /\bcompanyId\s+String\b/,
    /\bcompany\s+Company\s+@relation/,
    /\bdate\s+DateTime\s+@db\.Date/,
    /\bscope\s+NoWorkDayScope\b/,
    /\bsiteId\s+String\?/,
    /\bsite\s+Site\?\s+@relation/,
    /\bworkerIds\s+String\[\]/,
    /\bname\s+String\b/,
    /\bcreatedBy\s+String\b/,
    /\bcreatedAt\s+DateTime\s+@default\(now\(\)\)/,
  ];
  for (const re of required) {
    assert.match(body!, re, `NoWorkDay missing required field matching ${re}`);
  }
});

test("NoWorkDay has composite unique + date index", () => {
  const body = extractBlock("model", "NoWorkDay");
  assert.ok(body);
  assert.match(
    body!,
    /@@unique\(\s*\[\s*companyId\s*,\s*date\s*,\s*scope\s*,\s*siteId\s*\]\s*\)/,
    "NoWorkDay missing composite unique (companyId,date,scope,siteId)",
  );
  assert.match(
    body!,
    /@@index\(\s*\[\s*companyId\s*,\s*date\s*\]\s*\)/,
    "NoWorkDay missing index on (companyId,date)",
  );
});

test("Company model has noWorkDays back-relation", () => {
  const body = extractBlock("model", "Company");
  assert.ok(body, "model Company not found");
  assert.match(
    body!,
    /\bnoWorkDays\s+NoWorkDay\[\]/,
    "Company missing noWorkDays NoWorkDay[] back-relation",
  );
});

test("Site model has noWorkDays back-relation", () => {
  const body = extractBlock("model", "Site");
  assert.ok(body, "model Site not found");
  assert.match(
    body!,
    /\bnoWorkDays\s+NoWorkDay\[\]/,
    "Site missing noWorkDays NoWorkDay[] back-relation",
  );
});
