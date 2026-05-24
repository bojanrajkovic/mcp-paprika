import type { Aisle, AisleUid } from "../../paprika/types.js";

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
