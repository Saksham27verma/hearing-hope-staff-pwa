/** Matches CRM SimplifiedEnquiryForm hearing-aid sale line rounding. */

export const HEARING_AID_SALE_WARRANTY_OPTIONS = [
  '6 Months',
  '12 Months',
  '18 Months',
  '24 Months',
  '30 Months',
  '36 Months',
  '48 Months',
] as const;

export const roundInrRupee = (n: number) => Math.round(Number(n) || 0);

export const roundDiscountPercent = (value: number) =>
  Math.round(Math.max(0, Math.min(100, Number(value) || 0)) * 100) / 100;

/** Matches CRM `products` master: 0% when GST exempt, else catalog % (default 18). */
export function effectiveGstPercentFromCatalogProduct(p: {
  gstApplicable?: boolean;
  gstPercentage?: number;
}): number {
  if (p.gstApplicable === false) return 0;
  const g = Number(p.gstPercentage);
  if (Number.isFinite(g) && g >= 0) return g;
  return 18;
}

/** Uses `gstPercent` / `gstApplicable` from staff available-inventory API. */
export function effectiveGstPercentFromInventoryRow(inv: {
  gstPercent?: number;
  gstApplicable?: boolean;
}): number {
  if (inv.gstApplicable === false) return 0;
  const g = Number(inv.gstPercent);
  if (Number.isFinite(g) && g >= 0) return g;
  return 18;
}

export function lineInclusiveTotal(
  mrp: number,
  sellingPreTax: number,
  gstPercent: number,
  quantity: number
): number {
  const m = roundInrRupee(mrp);
  let sp = roundInrRupee(sellingPreTax);
  if (m > 0 && sp > m) sp = m;
  const q = Math.max(1, Math.floor(Number(quantity) || 1));
  const gst = gstPercent > 0 ? roundInrRupee((sp * gstPercent) / 100) : 0;
  return roundInrRupee((sp + gst) * q);
}

export function derivedDiscountPercentFromMrpSelling(mrp: number, sellingPreTax: number): number {
  const m = roundInrRupee(mrp);
  let sp = roundInrRupee(sellingPreTax);
  if (m > 0 && sp > m) sp = m;
  if (m <= 0) return 0;
  const discountAmount = roundInrRupee(Math.max(0, m - sp));
  return roundDiscountPercent((discountAmount / m) * 100);
}
