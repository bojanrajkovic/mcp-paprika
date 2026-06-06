import type { AisleUid } from "../../../../src/domains/aisle/ids.js";
import type { Aisle } from "../../../../src/domains/aisle/types.js";

let aisleCounter = 0;

export function makeAisle(overrides?: Partial<Aisle>): Aisle {
  aisleCounter += 1;
  const uid = `aisle-${aisleCounter.toString()}` as AisleUid;
  return {
    uid,
    name: `Test Aisle ${aisleCounter.toString()}`,
    orderFlag: aisleCounter,
    deleted: false,
    ...overrides,
  };
}
