import { PrismaClient, Role, ItemType, ValuationMethod, MasterStatus, VendorStatus, PoType } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Starting seeding process...");

  // 1. Create Demo Company
  const company = await prisma.company.upsert({
    where: { id: "demo-company-id" },
    update: {
      address: "Plot No. 45, Industrial Area, Phase 1, New Delhi",
      gstin: "07AAAAA1111A1Z1",
      city: "New Delhi",
      governingPlace: "Delhi, India",
    },
    create: {
      id: "demo-company-id",
      name: "Saarlekha Industries Pvt Ltd",
      address: "Plot No. 45, Industrial Area, Phase 1, New Delhi",
      gstin: "07AAAAA1111A1Z1",
      city: "New Delhi",
      governingPlace: "Delhi, India",
    },
  });
  console.log(`Created Company: ${company.name}`);

  // 2. Create Reminder Configuration
  await prisma.reminderConfig.upsert({
    where: { companyId: company.id },
    update: {},
    create: {
      companyId: company.id,
      deliveryDueDays: 3,
      expiryLeadDays: 30,
      paymentDueDays: 7,
      agingBuckets: [0, 30, 60, 90],
    },
  });

  // 3. Create Departments
  const depts = [
    { code: "PROD", name: "Production Department" },
    { code: "MAINT", name: "Maintenance & Spares" },
    { code: "QA", name: "Quality Assurance" },
    { code: "ACC", name: "Finance & Accounts" },
    { code: "STORES", name: "Stores & Purchase" },
  ];

  const createdDepts: Record<string, any> = {};
  for (const dept of depts) {
    const created = await prisma.department.upsert({
      where: { companyId_code: { companyId: company.id, code: dept.code } },
      update: {},
      create: {
        companyId: company.id,
        code: dept.code,
        name: dept.name,
      },
    });
    createdDepts[dept.code] = created;
  }

  // Seed Subdepartments
  const subdepts = [
    { code: "PROD-MECH", name: "Mechanical Production", parentCode: "PROD" },
    { code: "PROD-ELEC", name: "Electrical Production", parentCode: "PROD" },
    { code: "MAINT-MECH", name: "Mechanical Maintenance", parentCode: "MAINT" },
    { code: "MAINT-ELEC", name: "Electrical & Instrumentation", parentCode: "MAINT" },
  ];

  for (const sub of subdepts) {
    const parent = createdDepts[sub.parentCode];
    if (parent) {
      await prisma.department.upsert({
        where: { companyId_code: { companyId: company.id, code: sub.code } },
        update: {
          parentId: parent.id,
        },
        create: {
          companyId: company.id,
          code: sub.code,
          name: sub.name,
          parentId: parent.id,
        },
      });
    }
  }
  console.log("Seeded Departments & Subdepartments");

  // Fetch one department for mapping
  const storesDept = await prisma.department.findFirst({
    where: { companyId: company.id, code: "STORES" },
  });

  // 4. Create Users (Password: password123)
  const passwordHash = await bcrypt.hash("password123", 10);
  
  const users = [
    { email: "owner@saarlekha.in", name: "Harish Sharma", role: Role.OWNER },
    { email: "admin@saarlekha.in", name: "Ravi Kumar", role: Role.ADMIN },
    { email: "storekeeper@saarlekha.in", name: "Manoj Singh", role: Role.STORE_KEEPER },
    { email: "purchase@saarlekha.in", name: "Sanjay Gupta", role: Role.PURCHASE_MANAGER },
    { email: "qc@saarlekha.in", name: "Anand Verma", role: Role.QC_INSPECTOR },
    { email: "accounts@saarlekha.in", name: "Neeta Patel", role: Role.ACCOUNTS },
    { email: "indenter@saarlekha.in", name: "Vikas Jha", role: Role.INDENTER },
  ];

  for (const u of users) {
    const createdUser = await prisma.user.upsert({
      where: { companyId_email: { companyId: company.id, email: u.email } },
      update: { role: u.role },
      create: {
        companyId: company.id,
        email: u.email,
        name: u.name,
        passwordHash,
        role: u.role,
        deptId: storesDept?.id,
      },
    });

    await prisma.companyMembership.upsert({
      where: {
        companyId_userId: {
          companyId: company.id,
          userId: createdUser.id,
        },
      },
      update: {
        role: u.role,
        status: "ACTIVE",
      },
      create: {
        companyId: company.id,
        userId: createdUser.id,
        role: u.role,
        status: "ACTIVE",
        isPrimary: true,
      },
    });

    await prisma.notificationPref.upsert({
      where: {
        companyId_userId: {
          companyId: company.id,
          userId: createdUser.id,
        },
      },
      update: {},
      create: {
        companyId: company.id,
        userId: createdUser.id,
        inApp: true,
        email: false,
        emailDigest: "DAILY",
      },
    });
  }
  console.log("Seeded Users");

  // 5. Create Stores & Bins
  const mainStore = await prisma.store.upsert({
    where: { companyId_code: { companyId: company.id, code: "MAIN" } },
    update: {},
    create: {
      companyId: company.id,
      code: "MAIN",
      name: "Main Inventory Warehouse",
      status: MasterStatus.ACTIVE,
    },
  });

  const rawStore = await prisma.store.upsert({
    where: { companyId_code: { companyId: company.id, code: "RAW" } },
    update: {},
    create: {
      companyId: company.id,
      code: "RAW",
      name: "Raw Material Yard",
      status: MasterStatus.ACTIVE,
    },
  });

  await prisma.bin.upsert({
    where: { storeId_code: { storeId: mainStore.id, code: "A1-B2" } },
    update: {},
    create: { storeId: mainStore.id, code: "A1-B2" },
  });

  await prisma.bin.upsert({
    where: { storeId_code: { storeId: rawStore.id, code: "YARD-1" } },
    update: {},
    create: { storeId: rawStore.id, code: "YARD-1" },
  });
  console.log("Seeded Stores & Bins");

  // 6. Create Item Code Scheme
  await prisma.itemCodeScheme.upsert({
    where: { companyId: company.id },
    update: {},
    create: {
      companyId: company.id,
      separator: "-",
      segments: [
        { type: "PREFIX" },
        { type: "SERIAL", width: 4 }
      ],
    },
  });

  // 7. Create Item Categories
  const catRaw = await prisma.itemCategory.upsert({
    where: { companyId_code: { companyId: company.id, code: "RM" } },
    update: {},
    create: { companyId: company.id, code: "RM", name: "Raw Materials" },
  });

  const catCons = await prisma.itemCategory.upsert({
    where: { companyId_code: { companyId: company.id, code: "CONS" } },
    update: {},
    create: { companyId: company.id, code: "CONS", name: "Consumables" },
  });
  console.log("Seeded Item Categories");

  // 8. Create Items
  const itemSteel = await prisma.item.upsert({
    where: { companyId_code: { companyId: company.id, code: "RM-0001" } },
    update: {},
    create: {
      companyId: company.id,
      code: "RM-0001",
      name: "Mild Steel Sheet 2.0mm",
      description: "Standard industrial grade MS Sheets, 2.0mm thickness",
      categoryId: catRaw.id,
      type: ItemType.RAW_MATERIAL,
      baseUom: "KG",
      reorderLevel: 200,
      minStock: 100,
      maxStock: 1000,
      qcRequired: true,
      valuation: ValuationMethod.WEIGHTED_AVG,
    },
  });

  const itemBolts = await prisma.item.upsert({
    where: { companyId_code: { companyId: company.id, code: "CONS-0001" } },
    update: {},
    create: {
      companyId: company.id,
      code: "CONS-0001",
      name: "M12 Hex Bolt 50mm",
      description: "High tensile hex head bolts, zinc plated",
      categoryId: catCons.id,
      type: ItemType.CONSUMABLE,
      baseUom: "PCS",
      reorderLevel: 1000,
      minStock: 500,
      maxStock: 5000,
      qcRequired: false,
      valuation: ValuationMethod.WEIGHTED_AVG,
    },
  });
  console.log("Seeded Items");

  // 9. Add Inspection Plan for Steel
  const plan = await prisma.inspectionPlan.upsert({
    where: { itemId: itemSteel.id },
    update: {},
    create: {
      companyId: company.id,
      itemId: itemSteel.id,
      sampleSize: 5,
      acceptRule: "Zero defects allowed",
    },
  });

  await prisma.inspectionParam.createMany({
    data: [
      { planId: plan.id, name: "Thickness (mm)", uom: "mm", specMin: 1.9, specMax: 2.1, specTarget: 2.0 },
      { planId: plan.id, name: "Width (mm)", uom: "mm", specMin: 1195, specMax: 1205, specTarget: 1200 },
      { planId: plan.id, name: "Hardness (HRB)", uom: "HRB", specMin: 55, specMax: 65, specTarget: 60 },
    ],
  });
  console.log("Seeded QC Inspection Parameters for RM-0001");

  // 10. Seed Vendors
  const vendorSharma = await prisma.vendor.upsert({
    where: { companyId_code: { companyId: company.id, code: "VND-00001" } },
    update: {},
    create: {
      companyId: company.id,
      code: "VND-00001",
      name: "Sharma Steel Traders",
      gstin: "03AAAAA1111A1Z1",
      pan: "AAAAA1111A",
      udyamNo: "UDYAM-PB-12-00001",
      category: "RM",
      paymentTerms: "Net 30 Days",
      creditDays: 30,
      bankDetails: {
        bankName: "State Bank of India",
        accountNo: "12345678901",
        ifscCode: "SBIN0001234",
      },
      rating: 4.5,
      status: VendorStatus.APPROVED,
    },
  });

  const vendorSuper = await prisma.vendor.upsert({
    where: { companyId_code: { companyId: company.id, code: "VND-00002" } },
    update: {},
    create: {
      companyId: company.id,
      code: "VND-00002",
      name: "Superfast Fasteners Corp",
      gstin: "07BBBBB2222B2Z2",
      pan: "BBBBB2222B",
      category: "CONSUMABLE",
      paymentTerms: "Net 15 Days",
      creditDays: 15,
      rating: 4.1,
      status: VendorStatus.APPROVED,
    },
  });
  console.log(`Seeded Vendors: ${vendorSharma.name}, ${vendorSuper.name}`);

  // 11. Seed PO Terms Configuration
  const termsConfig = await prisma.poTermsConfig.upsert({
    where: { companyId: company.id },
    update: {},
    create: {
      companyId: company.id,
      inspectionDays: 7,
      replacementDays: 15,
      returnCollectionDays: 30,
      qtyTolerancePct: 0.0,
      warrantyMonths: 24,
      sparesYears: 10,
      ldPctPerDay: 0.5,
      ldCapPct: 10.0, // cap at 10% of PO value by default
      creditDays: 45,
      latentDefectDays: 90,
      fmTerminationDays: 45,
      cureDays: 30,
      arbitrationForum: "Arbitration and Conciliation Act, 1996",
      jurisdictionCity: "New Delhi",
    },
  });
  console.log(`Seeded PO Terms Config for Company: ${company.name}`);

  // 12. Seed PO Terms Presets
  const presets = [
    {
      key: "standard-goods-in",
      name: "Standard — Goods (India/GST)",
      description: "Standard terms for purchase of goods, including GST and delivery compliance.",
      appliesTo: [PoType.REGULAR, PoType.IMPORT],
      isDefault: true,
      tokenDefaults: {
        paymentMode: "NEFT/RTGS",
        deliveryTerms: "FOR Destination",
      },
      bodyMarkdown: `**STANDARD TERMS AND CONDITIONS OF PURCHASE (GOODS)**

These Standard Terms and Conditions of Purchase apply to Purchase Order No. {{PO_NUMBER}} dated {{PO_DATE}} placed by {{COMPANY_NAME}}, {{COMPANY_ADDRESS}}, GSTIN {{COMPANY_GSTIN}} ("Purchaser") on the Supplier named in the Order ("Supplier").

1. **Delivery & Risk**: Time is of the essence. Deliveries shall be made at the designated Delivery Point on or before the Delivery Date. Title and risk pass to the Purchaser on delivery and acceptance at the Delivery Point.
2. **Acceptance & Inspection**: Goods are subject to QC inspection and testing at the Delivery Point. The Purchaser reserves the right to reject non-conforming items within {{INSPECTION_DAYS}} days of receipt.
3. **Replacement & Rework**: On any defect, shortage, transit damage, or non-conformity, the Supplier shall replace the Goods within {{REPLACEMENT_DAYS}} days of intimation at their own cost. Rejected Goods must be collected within {{RETURN_COLLECTION_DAYS}} days, after which they may be returned freight-collect.
4. **Late Delivery Penalty (Liquidated Damages)**: Delay in delivery will attract liquidated damages of {{LD_PCT_PER_DAY}}% per calendar day of delay, subject to a maximum cap of {{LD_CAP_PCT}}% of the total order value.
5. **Warranty**: The Supplier warrants that the Goods are of merchantable quality, fit for their intended purpose, and free from defects. The warranty runs for {{WARRANTY_MONTHS}} months from the Delivery Date.
6. **GST Compliance**: Valid tax invoice with correct GSTIN/HSN and (if applicable) e-invoice/e-way bill must accompany each shipment. The Supplier shall ensure correct GST return filing to allow the Purchaser to avail Input Tax Credit.
7. **Payment**: Undisputed invoices are due {{CREDIT_DAYS}} days from invoice date by {{PAYMENT_MODE}}.
8. **Governing Law & Jurisdiction**: Governed by the laws of {{GOVERNING_PLACE}}. Disputes shall be subject to the jurisdiction of competent courts at {{JURISDICTION_CITY}}.`
    },
    {
      key: "comprehensive-goods-services",
      name: "Comprehensive — Goods & Services",
      description: "Detailed, de-branded corporate GTC covering risk, warranties, late delivery liquidated damages, IP, force majeure, and arbitration.",
      appliesTo: [PoType.REGULAR, PoType.SERVICE, PoType.CAPITAL],
      isDefault: false,
      tokenDefaults: {
        paymentMode: "NEFT/RTGS/IMPS",
        deliveryTerms: "DDP (Incoterms 2020)",
      },
      bodyMarkdown: `**GENERAL TERMS AND CONDITIONS OF PURCHASE**

These General Terms and Conditions ("**GTC**") apply to Purchase Order No. \`{{PO_NUMBER}}\` dated \`{{PO_DATE}}\` placed by **{{COMPANY_NAME}}**, \`{{COMPANY_ADDRESS}}\`, GSTIN \`{{COMPANY_GSTIN}}\` (the "**Purchaser**") on the supplier named in the Order (the "**Supplier**").

**1. Definitions.** "**Order**" means the Purchaser's purchase order, including its appendices, specifications, drawings, and technical documents. "**Confirmation**" means the Supplier's acceptance of the Order, whether by written acknowledgement or by commencing supply. "**Goods**" means the goods and/or services described in the Order together with all documents needed to use them safely (plans, data sheets, test/safety certificates, certificates of conformity). "**Agreement**" means the Order, these GTC, and the Confirmation; where a signed contract exists, that contract and these GTC. "**Delivery Point**" and "**Delivery Date**" are the place and date stated in the Order. "**Price**" is the price in the Order, exclusive of GST. "**Force Majeure**" means an event beyond a party's reasonable control, not foreseeable at the date of the Order and not caused by its fault, that makes performance impossible (for example, natural disaster, fire, flood, war, riot, epidemic or pandemic, or binding governmental action). "**Governing Place**" means the jurisdiction in which the Purchaser is incorporated.

**2. The Agreement.** The Supplier's Confirmation is acceptance of the Order on these GTC. If terms conflict, this order of precedence applies: (i) a signed contract, (ii) the Order, (iii) these GTC, (iv) the Confirmation. Any term the Supplier seeks to add is rejected unless a Purchaser's authorised representative agrees to it in writing. The Agreement is the entire agreement on its subject matter. The Supplier may not sub-contract any part without the Purchaser's prior written consent and remains fully responsible for its sub-contractors.

**3. Delivery & risk.** Delivery shall be made on the Delivery Date at the Delivery Point; **time is of the essence**. If no Incoterm/Delivery Point is stated, delivery is DDP to the Purchaser's premises (latest Incoterms). Title and risk pass to the Purchaser on delivery and acceptance at the Delivery Point. The Supplier shall notify the Purchaser immediately of anything that may affect performance or timing, and shall carry sufficient insurance for its liabilities under the Order, evidenced on request.

**4. Late delivery — liquidated damages.** For delay against the Delivery Date, liquidated damages accrue at \`{{LD_PCT_PER_DAY}}\`% of the Price per calendar day, capped at \`{{LD_CAP_PCT}}\`% of the Price, and apply equally to partial delivery. These are a genuine pre-estimate of loss, are without prejudice to the Purchaser's other rights and remedies (including cancellation and risk purchase), and do not limit recovery of greater losses the Purchaser can document.

**5. Acceptance & inspection.** Goods are subject to inspection and testing at the Delivery Point. The Purchaser may reject Goods that do not conform to the Order, specifications, drawings, data, or the Supplier's warranties, within \`{{INSPECTION_DAYS}}\` days of receipt. Payment for, or inspection of, Goods is not acceptance and does not waive any claim. GST documentation (tax invoice with GSTIN/HSN and, where applicable, a valid IRN/e-invoice and e-way bill) must accompany each consignment so the Purchaser can avail input tax credit; the Purchaser may recover any credit lost through the Supplier's non-compliance.

**6. Replacement & rework.** On any defect, shortage, transit damage, or non-conformity, the Supplier shall — at the Purchaser's election and the Supplier's cost — repair, replace, rework, or scrap the Goods, or authorise the Purchaser to do so at the Supplier's cost. Replacement shall be made within \`{{REPLACEMENT_DAYS}}\` days of intimation, with all freight, taxes, and handling both ways to the Supplier's account; replacement Goods are re-inspected on the same terms. Rejected Goods remain the Supplier's property at the Supplier's risk and, if not collected within \`{{RETURN_COLLECTION_DAYS}}\` days, may be returned freight-to-pay or disposed of at the Supplier's cost. Replacement does not extend the Delivery Date, and liquidated damages continue until conforming Goods are accepted. The Supplier is liable for the Purchaser's resulting costs, including finished-product, raw-material, packaging, freight, sorting, rework, scrap, and any damage to the Purchaser's stocks, equipment, or goods.

**7. Warranty.** The Supplier warrants good title and that the Goods are (i) fit for the intended purpose where known, (ii) of merchantable quality and free from defects in material and workmanship, and (iii) conforming to all specifications, samples, quantities, and data. The warranty runs for the longer of the Goods' shelf life or \`{{WARRANTY_MONTHS}}\` months from the Delivery Date; for defects not reasonably discoverable, for \`{{LATENT_DEFECT_DAYS}}\` days from actual discovery. A fresh \`{{WARRANTY_MONTHS}}\`-month warranty applies to repaired or replaced items. For plant and machinery, the Supplier shall ensure spare-parts availability for \`{{SPARES_YEARS}}\` years from delivery; these GTC apply to any repair or spares supply.

**8. Price & payment.** The Price is firm and includes all customs, duties, and charges applicable to the Goods, and is exclusive of GST, which the Supplier shall show separately. Modifications require a written change order; the Supplier shall make no change without prior written consent. Undisputed invoices are due \`{{CREDIT_DAYS}}\` days from invoice date by \`{{PAYMENT_MODE}}\`. No payment is due for rejected Goods, and the Purchaser may set off amounts owed by the Supplier (liquidated damages, rejection costs, debit notes). The Supplier shall declare its MSME/Udyam status; registered micro and small enterprises are paid per the MSMED Act, 2006.

**9. Intellectual property.** The Supplier grants the Purchaser a worldwide, perpetual, non-exclusive, transferable right to use the Goods. The Supplier warrants that the Goods do not infringe any third-party intellectual property and, if a claim arises, shall promptly secure the Purchaser's right to use them or modify/replace them to end the infringement. The Supplier shall not use the Purchaser's name, trademarks, or logos without prior written consent. Intellectual property in Purchaser-supplied designs, drawings, and tooling remains the Purchaser's.

**10. Force Majeure.** A party prevented or delayed by Force Majeure shall notify the other in writing without delay, stating the cause, expected duration, and remedial steps; it is not in breach for that delay, and the time for performance extends until the event ends. During such a period the Purchaser may buy elsewhere, with those volumes deducted from the Order. If the event continues, or adequate assurance of resumption is not given, for \`{{FM_TERMINATION_DAYS}}\` consecutive days, the Purchaser may terminate without liability.

**11. Suspension & termination.** Without affecting other remedies, the Purchaser may suspend or terminate the Agreement, in whole or part, immediately if the Supplier: (a) commits a material breach and, if remediable, fails to cure it within \`{{CURE_DAYS}}\` days of notice; (b) becomes insolvent, enters receivership/liquidation/arrangement, or suffers a material adverse change in financial standing; or (c) breaches or is reasonably expected to breach the Compliance clause. Termination does not affect accrued rights or any clause intended to survive.

**12. Compliance & sanctions.** Both parties shall comply with all applicable laws, regulations, and the Purchaser's published code of conduct. The Supplier shall not act or omit in a way that exposes the Purchaser to sanctions, asset freezes, or investigation by any relevant authority. The Purchaser need not perform where prevented by trade-control, customs, embargo, or sanctions impediments.

**13. Indemnity.** The Supplier shall indemnify, defend, and hold the Purchaser harmless against all liabilities, losses, damages, costs, and reasonable legal fees arising from (i) actual or alleged third-party IP infringement, (ii) the Supplier's breach of the Agreement, or (iii) any third-party claim arising from the sale, delivery, or use of the Goods. The Purchaser's inspection does not relieve the Supplier of liability.

**14. Governing law & dispute resolution.** The Agreement is governed by the law of the Governing Place (\`{{GOVERNING_PLACE}}\blank\`), excluding its conflict-of-laws rules and the UN Convention on Contracts for the International Sale of Goods. Where both parties are incorporated in the Governing Place, the competent courts at \`{{JURISDICTION_CITY}}\` have jurisdiction. Otherwise, disputes shall be finally resolved by arbitration under \`{{ARBITRATION_FORUM}}\`, seat \`{{JURISDICTION_CITY}}\`, in English, by a sole arbitrator (or three for higher-value disputes as the rules provide). The award is final and binding.

**15. Confidentiality.** The Supplier shall keep all Purchaser information confidential, use it only for the Agreement, and not disclose the relationship or information to third parties. All disclosed information remains the Purchaser's and shall be returned on request after performance.

**16. Other provisions.** (a) If any provision is invalid, it is modified or severed to the minimum extent needed, and the rest stands. (b) The Supplier may not assign or transfer the Agreement without prior written consent and shall promptly notify any change of control. (c) For work at the Purchaser's site, the Supplier ensures its personnel and sub-contractors follow the site's rules and claims no compensation for doing so. (d) The Supplier shall maintain appropriate cyber-security measures and incident procedures and notify the Purchaser promptly of any incident affecting it. (e) Where the Supplier processes personal data received from the Purchaser, it shall ensure protection consistent with applicable data-protection law (including the Digital Personal Data Protection Act, 2023, where it applies). (f) The Agreement may be amended only in writing. (g) No delay in exercising a right is a waiver. (h) Only the parties may enforce the Agreement. (i) Notices shall be in writing; email is valid where addresses are stated in the Order. (j) The Supplier shall give the Purchaser reasonable advance notice of any change to the Goods (including packaging or materials) and obtain agreement that the change keeps the Goods fit for the Purchaser's use before implementing it.`
    },
    {
      key: "capital-equipment",
      name: "Capital Equipment & Machinery",
      description: "Optimized for plant, machinery, and equipment procurement, adding provisional vs final acceptance, commissioning milestones, and performance guarantees.",
      appliesTo: [PoType.CAPITAL],
      isDefault: true,
      tokenDefaults: {
        paymentMode: "Letter of Credit / Wire Transfer",
        deliveryTerms: "FCA Port (Incoterms 2020)",
      },
      bodyMarkdown: `**CAPITAL EQUIPMENT AND MACHINERY PURCHASE TERMS**

These Terms and Conditions apply to Purchase Order No. \`{{PO_NUMBER}}\` dated \`{{PO_DATE}}\` placed by **{{COMPANY_NAME}}**, \`{{COMPANY_ADDRESS}}\`, GSTIN \`{{COMPANY_GSTIN}}\` (the "**Purchaser**") on the supplier named in the Order (the "**Supplier**").

**1. Definitions.** "**Order**" means the Purchaser's purchase order, including its appendices, specifications, drawings, and technical documents. "**Confirmation**" means the Supplier's acceptance of the Order. "**Equipment**" means the machinery, plant, and capital assets described in the Order, together with all operational, engineering, and maintenance manuals. "**Agreement**" means the Order, these GTC, and the Confirmation. "**Delivery Point**" and "**Delivery Date**" are the place and date stated in the Order. "**Price**" is the price in the Order, exclusive of GST. "**Force Majeure**" means natural disaster, war, government embargo, or other binding actions beyond control. "**Governing Place**" means the jurisdiction in which the Purchaser is incorporated.

**2. The Agreement.** Precedence applies: (i) signed contract, (ii) the Order, (iii) these GTC. The Supplier remains fully responsible for any approved sub-contracted work.

**3. Delivery & Risk.** Delivery is time-critical. Title passes to the Purchaser on delivery and provisional acceptance. Risk passes only after final commissioning and acceptance. The Supplier shall carry comprehensive transit, erection, and commissioning insurance.

**4. Late Delivery — Liquidated Damages.** For delay, liquidated damages accrue at \`{{LD_PCT_PER_DAY}}\`% of the Price per calendar day, capped at \`{{LD_CAP_PCT}}\`% of the total equipment price. This applies to delay in delivery of manuals, critical components, or commissioning.

**5. Acceptance & Commissioning.** (a) **Provisional Acceptance** occurs upon successful physical receipt and unpacking at the site. (b) **Final Commissioning Acceptance** occurs only after installation, testing, and successful trials showing meeting of all performance parameters, certified by the Purchaser within \`{{INSPECTION_DAYS}}\` days of trial run. GST IRN/e-invoice must accompany the equipment.

**6. Replacement & Rework.** On any defect, shortage, transit damage, or performance failure during trials, the Supplier shall rectify or replace the affected parts within \`{{REPLACEMENT_DAYS}}\` days at their own expense. Non-remediable equipment will be returned at Supplier's cost and risk.

**7. Warranty & Performance Guarantee.** The Supplier warrants that the Equipment is new, state-of-the-art, and complies with all guaranteed output parameters. The warranty runs for the longer of 18 months from commissioning or \`{{WARRANTY_MONTHS}}\` months from delivery. Repaired/replaced parts get a fresh \`{{WARRANTY_MONTHS}}\`-month warranty. The Supplier guarantees spare-parts availability for a minimum of \`{{SPARES_YEARS}}\` years from delivery at fair market rates.

**8. Price, Payment & Retention.** Price is firm. Payment milestones: 70% against dispatch docs, 20% on provisional acceptance, and 10% retention/performance-bank-guarantee (PBG) amount released only after final commissioning and receipt of a matching PBG valid for the entire warranty period. Milestone payments are due \`{{CREDIT_DAYS}}\` days from invoice date by \`{{PAYMENT_MODE}}\`.

**9. Intellectual Property.** The Supplier grants a perpetual, non-exclusive license to operate the Equipment and software. Supplier warrants non-infringement of third-party IP.

**10. Force Majeure.** Notice must be given immediately. If Force Majeure prevents installation or operation for \`{{FM_TERMINATION_DAYS}}\` consecutive days, the Purchaser may cancel the Order and seek refund of progress payments.

**11. Termination.** Standard termination for material uncured breach with \`{{CURE_DAYS}}\` days notice, insolvency, or regulatory non-compliance.

**12. Compliance.** Compliance with environmental, electrical, and safety standards at the Purchaser's site is mandatory.

**13. Indemnity.** Supplier shall indemnify the Purchaser against any third-party claims, environmental issues, patent infringements, or injury during installation/commissioning.

**14. Governing Law & Dispute Resolution.** The Agreement is governed by the laws of \`{{GOVERNING_PLACE}}\`. Disputes shall be settled by arbitration under the \`{{ARBITRATION_FORUM}}\` in \`{{JURISDICTION_CITY}}\`.

**15. Confidentiality.** Keep all technical parameters and site layouts strictly confidential.

**16. Site Work & Safety.** The Supplier ensures its engineers wear appropriate PPE and strictly follow site safety guidelines. No statutory liabilities of Supplier's personnel shall fall on the Purchaser.`
    },
    {
      key: "services-jobwork",
      name: "Services / Job-work",
      description: "Tailored for job-work and services, adding labor law compliance, site safety requirements, GST job-work challan rules, and strict confidentiality.",
      appliesTo: [PoType.SERVICE],
      isDefault: true,
      tokenDefaults: {
        paymentMode: "NEFT/RTGS",
        deliveryTerms: "N/A - Services",
      },
      bodyMarkdown: `**SERVICES AND JOB-WORK AGREEMENT TERMS**

These Terms and Conditions apply to Service/Job-Work Order No. \`{{PO_NUMBER}}\` dated \`{{PO_DATE}}\` placed by **{{COMPANY_NAME}}**, \`{{COMPANY_ADDRESS}}\`, GSTIN \`{{COMPANY_GSTIN}}\` (the "**Purchaser**") on the service provider named in the Order (the "**Supplier**").

**1. Definitions.** "**Order**" means the Purchaser's service/job-work order. "**Services**" means the work, fabrication, or services described in the Order. "**Deliverables**" means any physical results of services or processed items. "**Force Majeure**" means natural disasters, strikes, war, or epidemic. "**Governing Place**" means the jurisdiction of the Purchaser.

**2. The Agreement.** Governed in priority order: (i) signed contract, (ii) the Order, (iii) these GTC. No sub-contracting without prior written consent.

**3. Performance & Delivery.** Services shall be performed professionally and completed by the Delivery Date at the specified Delivery Point; **time is of the essence**. Title to raw materials supplied by Purchaser remains with the Purchaser.

**4. Delay in Service — Liquidated Damages.** For delay in milestones or deliverables, liquidated damages accrue at \`{{LD_PCT_PER_DAY}}\`% of the service value per day of delay, capped at \`{{LD_CAP_PCT}}\`%.

**5. Service Quality & Audit.** Services must conform to industry standards. Purchaser may inspect, audit, or review services in progress. Any deficient work must be corrected within \`{{INSPECTION_DAYS}}\` days of notice. For job-work, raw material reconciliation and GST job-work challan (under Section 143 of CGST Act) compliance is mandatory.

**6. Defect Rectification.** If deliverables are rejected, Supplier must rectify or reperform the service within \`{{REPLACEMENT_DAYS}}\` days at no extra cost. Any items sent for job-work not processed must be returned within \`{{RETURN_COLLECTION_DAYS}}\` days.

**7. Service Warranty.** Supplier warrants that services are executed by qualified personnel and deliverables are fit for purpose. Service warranty runs for \`{{WARRANTY_MONTHS}}\` months from completion.

**8. Price & Payment.** Price is firm. Invoices are due \`{{CREDIT_DAYS}}\` days from certified milestone/completion date by \`{{PAYMENT_MODE}}\`. Payment is subject to TDS (Income Tax and GST TDS, where applicable) and verification of labor compliance documents.

**9. IP & Work Product.** All intellectual property in work product or deliverables created during performance belongs exclusively to the Purchaser.

**10. Force Majeure.** Parties are excused from performance during Force Majeure. If delay exceeds \`{{FM_TERMINATION_DAYS}}\` days, Purchaser may terminate the Order.

**11. Termination.** Purchaser may terminate for convenience with 15 days notice, or immediately for material breach with a \`{{CURE_DAYS}}\`-day cure period.

**12. Labor Law & Safety Compliance.** The Supplier is solely responsible for compliance with all labor laws (including EPF, ESI, Payment of Wages, Contract Labour Act). Supplier must provide proof of statutory payments for their personnel. Proper PPE must be worn on site.

**13. Indemnity.** Supplier shall indemnify the Purchaser against all claims for worker compensation, third-party liability, or labor non-compliance fines.

**14. Governing Law & Dispute Resolution.** Governed by the laws of \`{{GOVERNING_PLACE}}\`. Disputes referred to arbitration under the \`{{ARBITRATION_FORUM}}\` in \`{{JURISDICTION_CITY}}\`.

**15. Confidentiality.** Strict confidentiality regarding all customer data, pricing, processes, and designs.`
    }
  ];

  for (const preset of presets) {
    const existing = await prisma.poTermsPreset.findFirst({
      where: { companyId: null, key: preset.key }
    });

    if (existing) {
      await prisma.poTermsPreset.update({
        where: { id: existing.id },
        data: {
          name: preset.name,
          description: preset.description,
          appliesTo: preset.appliesTo,
          isDefault: preset.isDefault,
          bodyMarkdown: preset.bodyMarkdown,
          tokenDefaults: preset.tokenDefaults || {},
        }
      });
    } else {
      await prisma.poTermsPreset.create({
        data: {
          companyId: null,
          key: preset.key,
          name: preset.name,
          description: preset.description,
          appliesTo: preset.appliesTo,
          isDefault: preset.isDefault,
          bodyMarkdown: preset.bodyMarkdown,
          tokenDefaults: preset.tokenDefaults || {},
        }
      });
    }
  }
  console.log("Seeded PO Terms Presets (System Global)");

  console.log("Seeding completed successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
