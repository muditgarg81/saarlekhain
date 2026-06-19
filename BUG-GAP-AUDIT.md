# Bug & Gap Audit — Saarlekha Stores & Purchase

Date: 2026-06-16
Scope: Full review of app/, lib/, prisma/schema, auth, and IMPL-*.md / GUARDRAILS.md docs vs actual implementation.

## Critical Bugs

1. **`getItemValuation` zeroes out negative stock** ([lib/stock.ts:67](lib/stock.ts:67)) — on a negative-stock excursion it resets `balanceQty/balanceValue` to 0 instead of carrying the negative balance, silently corrupting valuation history with no audit trail.
2. **Stock ledger is hard-deleted, violating append-only rule** — `deleteIssue`, `bulkDeleteIssues`, `updateIssue` in [app/actions/indents.ts](app/actions/indents.ts) and `updateGrn`, `deleteGrn` in [app/actions/grns.ts](app/actions/grns.ts) call `tx.stockLedger.deleteMany(...)`. GUARDRAILS.md mandates reversing entries only, never deletes.
3. **PaymentVoucher immutability not enforced** — `updatePayment`/`deletePayment`/`bulkDeletePayments` in [app/actions/payments.ts](app/actions/payments.ts) mutate/delete posted vouchers with no immutability check (unlike `debitCreditNotes.ts`, which correctly blocks this).
4. **Auto-created advance PaymentVoucher on PO approval** — `approvePO` in [app/actions/purchaseOrders.ts:336](app/actions/purchaseOrders.ts:336) creates an `ADVANCE` payment voucher from heuristic string matching on payment terms, before any money has actually moved — contradicts the "app never moves money, voucher records an external payment" rule.

## Security Gaps

5. No RLS / tenant-isolation backstop — [lib/db.ts](lib/db.ts) is a bare `PrismaClient()`; every tenant boundary depends on manually adding `companyId` to each query, with no DB-level enforcement.
6. Credentials login doesn't scope by company — `auth.ts:168` does `findFirst({ where: { email } })` even though `User.email` is unique only per `(companyId, email)`.
7. Hardcoded fallback tenant `"demo-company-id"` used as JWT/sign-up fallback ([auth.ts:51,150](auth.ts)) — misconfigured logins can land users in a shared demo tenant.
8. No RBAC check on RFQ award/raise-po/propose-award API routes ([app/api/rfqs/[id]/award](app/api/rfqs/%5Bid%5D/award/route.ts), `raise-po`, `propose-award`) — only session existence is checked, any role can award/raise POs.
9. Missing RBAC across many server actions: `requisitions.ts` (createPR/approvePR/createRFQ/awardQuotation), `reorders.ts` (scan/approve/policy), `vendors.ts` (`updateVendorStatus`), `grns.ts` (`postGrn`), `paymentRequests.ts`, `payments.ts` — none enforce the documented role matrix.
10. Cross-tenant vendor injection — `raisePrToRfq` in [app/actions/purchaseFlow.ts](app/actions/purchaseFlow.ts) accepts `vendorIds[]` without verifying each belongs to `companyId`.
11. `raise-po` route re-fetches `quotationLine` by ID with no company/RFQ-membership re-check, trusting the prior award step entirely.
12. OCR mock fallback ([app/api/ocr/grn/route.ts:21](app/api/ocr/grn/route.ts)) silently returns fabricated invoice data when `GEMINI_API_KEY` is unset, with no "MOCK" flag visible to the UI.

## Data Integrity / Transaction Issues

13. Legacy single-vendor `awardQuotation` ([app/actions/requisitions.ts:288](app/actions/requisitions.ts:288)) bypasses the `AwardAllocation` model entirely — if reachable, produces an RFQ marked AWARDED with no allocations, which `raise-po` then rejects.
14. `approveAndConvertSuggestions` re-check ([app/actions/reorders.ts:540](app/actions/reorders.ts:540)) omits `inPipeline` from `netAvailable`, unlike the original scan — can fail to supersede suggestions already covered by an open PR/RFQ, causing duplicate ordering.
15. No verification that `itemId`/`vendorId`/`deptId` foreign keys belong to `companyId` before relation creation in indent/PO/vendor actions — scalar FK fields aren't tenant-checked.
16. MOQ/min-order-value warnings in `raise-po` are computed and returned in the JSON response but never persisted — no durable record of a knowingly-issued sub-MOQ PO.

## Missing Validation

17. No zod validation in `purchaseFlow.ts` (`convertIndentToPR`, `raisePrToRfq`) or the RFQ award route — inconsistent with the zod-everywhere pattern used in `purchaseOrders.ts`/`vendors.ts`/`paymentRequests.ts`.
18. `vendorImportSchema` (bulk import, [app/actions/vendors.ts:260](app/actions/vendors.ts:260)) has no GSTIN/PAN format validation, unlike the single-create `vendorSchema`.

## Code Hygiene / Leftover Artifacts

19. Root contains numerous gitignored-but-present scratch/debug scripts: `inspect_rfq.js`, `scratch-inspect-docs.js`, `scratch/` (11 files including destructive ones — `backfill_rejected.js`, `test_delete_company.js`, `find_or_reset_user.js`), plus `files.zip`, `files1.zip`, `files_extracted/`, `files1_extracted/`, `temp_extracted*/`. Risk of accidental re-execution against production data.
20. `GUARDRAILS.md` — the project's core rules doc referenced by every IMPL-*.md — is missing from the live project root; it only exists inside the gitignored extracted bundles.
21. `.env` is correctly gitignored, no secret leakage confirmed in git history.
22. `proxy.ts` uses a non-standard middleware filename — confirm it's actually wired as Next.js middleware (convention is `middleware.ts`), otherwise edge-layer auth gating may be a no-op.

## Feature Gaps (vs IMPL docs)

23. Three of four mandated partial-fulfilment off-ramps are missing: Re-RFQ from open PR lines, direct/rate-contract PO for open qty, substitute item (only short-close exists).
24. Reminder categories for open sourcing lines need a closer pass to confirm full coverage in `lib/reminders.ts`.
25. No `isEmergency`/`EMERGENCY` field on `PurchaseOrder` — the documented emergency-PO escalation path is unimplemented at the schema level.
26. `ReorderPolicy.secondApprovalAboveValue` is stored and settable but never enforced in `approveAndConvertSuggestions` — functionally inert.
27. Legacy single-vendor award path coexists with the documented split-award model (see #13).

## Performance / Scalability Gaps

28. Unbounded `findMany` with no pagination on user-facing lists — confirmed in PO list ([app/(app)/purchase/po/page.tsx:25](<app/(app)/purchase/po/page.tsx>)) and vendor list ([app/(app)/purchase/vendors/page.tsx:15](<app/(app)/purchase/vendors/page.tsx>)); ~138 `findMany` calls repo-wide with no `take:`.
29. Reorder basket/suggestion data-fetch pattern not fully verified — flagged for follow-up.
30. Documented REST endpoints (`/api/reorder/scan`, `/api/reorder/basket`, etc.) don't exist — only server actions do. Not a bug per se, but breaks any external/cron consumer expecting those routes.

---

### Priority recommendation
Fix in this order: #2/#3 (data-destroying mutations on financial records) → #4 (auto payment voucher) → #8/#9 (missing RBAC on mutating endpoints) → #6/#7 (auth tenant scoping) → #1 (negative stock valuation) → everything else.
