import { fabricSchema, weightSchema } from "./contracts";
import {
  yesNoSchema,
  type CorrectionField,
} from "./contracts/product-corrections";
import { FABRIC_LABELS, WEIGHT_LABELS, YES_NO_LABELS } from "./garment-words";

/**
 * The words a correction's stored value reads as, on the runner's sheet
 * and on the Desk: a select's label, Yes or No, or the text itself.
 */
export function valueWords(field: CorrectionField, value: string): string {
  switch (field) {
    case "weight": {
      return WEIGHT_LABELS[weightSchema.parse(value)];
    }
    case "fabric": {
      return FABRIC_LABELS[fabricSchema.parse(value)];
    }
    case "wind":
    case "water": {
      return YES_NO_LABELS[yesNoSchema.parse(value)];
    }
    default: {
      return value;
    }
  }
}
