import { randomBytes } from "node:crypto";

export function reference(prefix: string) {
  return `${prefix}-${randomBytes(6).toString("hex").toUpperCase()}`;
}

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
