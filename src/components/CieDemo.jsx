import { useState } from "react";

const COLORS = {
  hero: "#16a34a",
  support: "#d97706",
  harvest: "#ea580c",
  kill: "#dc2626",
  gate_pass: "#22c55e",
  gate_fail: "#ef4444",
  gate_pending: "#f59e0b",
  gate_na: "#6b7280",
};

const TIER_META = {
  HERO: { color: COLORS.hero, bg: "#f0fdf4", border: "#bbf7d0", label: "HERO", icon: "★", desc: "Top revenue performer. Full CIE coverage. All 9 intents, full Answer Block, FAQ, JSON-LD." },
  SUPPORT: { color: COLORS.support, bg: "#fffbeb", border: "#fde68a", label: "SUPPORT", icon: "◆", desc: "Revenue supporting, not leading. Primary + max 2 secondary intents. Max 2 hrs/quarter." },
  HARVEST: { color: COLORS.harvest, bg: "#fff7ed", border: "#fed7aa", label: "HARVEST", icon: "▼", desc: "Low margin, limited growth. Specification only + 1 optional intent. Max 30 min/quarter." },
  KILL: { color: COLORS.kill, bg: "#fef2f2", border: "#fecaca", label: "KILL", icon: "✕", desc: "Negative margin or delisting flag. All fields read-only. No time investment permitted." },
};

const GATES = [
  {
    id: "G1", name: "Basic Info", emoji: "📋",
    what: "Checks that the SKU has a title, SKU code, primary cluster assignment, and tier. These are the minimum fields for a product to exist in the system.",
    blocking: true,
    whoEdits: ["CONTENT_EDITOR", "PRODUCT_SPECIALIST", "CHANNEL_MANAGER"],
    fields: ["title", "sku_code", "primary_cluster_id", "tier"],
    failExample: "Title is blank or no cluster is assigned.",
    passExample: "Title: 'Pendant Cable Set for Ceiling Lights', Cluster: CLU-CBL-P-E27",
  },
  {
    id: "G2", name: "Primary Intent", emoji: "🎯",
    what: "Verifies that the SKU has exactly one primary intent assigned from the locked 9-intent taxonomy. Every product must answer a specific user question type.",
    blocking: true,
    whoEdits: ["CONTENT_EDITOR", "PRODUCT_SPECIALIST", "CHANNEL_MANAGER"],
    fields: ["primary_intent"],
    failExample: "No primary intent selected.",
    passExample: "Primary intent: Compatibility",
  },
  {
    id: "G3", name: "Secondary Intents", emoji: "🔗",
    what: "Checks that secondary intents are valid, within the tier's allowed maximum (Hero: 3, Support: 2, Harvest: 1), and do not duplicate the primary intent.",
    blocking: true,
    whoEdits: ["CONTENT_EDITOR", "PRODUCT_SPECIALIST", "CHANNEL_MANAGER"],
    fields: ["secondary_intents"],
    failExample: "Hero SKU has 5 secondary intents (max is 3).",
    passExample: "Secondary intents: [Installation/How-To, Specification] — within Support limit of 2.",
  },
  {
    id: "G4", name: "Answer Block", emoji: "💬",
    what: "Enforces that the AI Answer Block is 250–300 characters, does not start with the brand name, is not marketing copy, and contains the primary intent keyword. This is the text LLMs will cite. Suspended for Harvest tier.",
    blocking: true,
    whoEdits: ["CONTENT_EDITOR", "PRODUCT_SPECIALIST", "CHANNEL_MANAGER"],
    fields: ["ai_answer_block", "ai_answer_block_chars"],
    failExample: "SHD-GLS-CNE-20: ai_answer_block_chars=242, minimum is 250. Submit blocked.",
    passExample: "CBL-BLK-3C-1M: 287 chars, starts with 'A 3-core braided...', contains 'compat' keyword.",
  },
  {
    id: "G5", name: "Technical / Best-For", emoji: "⚙️",
    what: "Two checks in one: (1) All cluster-required specifications are present with standard units. (2) For Hero and Support SKUs: minimum 2 Best-For items and 1 Not-For item must be populated. Harvest and Kill skip the Best-For/Not-For check.",
    blocking: true,
    whoEdits: ["CONTENT_EDITOR", "PRODUCT_SPECIALIST"],
    fields: ["best_for", "not_for", "specifications"],
    failExample: "BLB-LED-B22-8W (Support): not_for is empty. Gate fails, submit blocked.",
    passExample: "CBL-BLK-3C-1M: best_for has 4 items, not_for has 3 items. Pass.",
  },
  {
    id: "G6", name: "Commercial Policy", emoji: "💰",
    what: "Checks commercial viability: price must be present and above zero. Enforces that Kill-tier SKUs are properly flagged. Also validates that the product does not violate channel exclusion rules.",
    blocking: true,
    whoEdits: ["FINANCE", "ADMIN"],
    fields: ["current_price", "contribution_margin_pct", "tier"],
    failExample: "Price is £0.00 or not set on a Hero SKU.",
    passExample: "CBL-BLK-3C-1M: price_gbp=12.99, margin=62%. Pass.",
  },
  {
    id: "G7", name: "Expert Authority", emoji: "🏅",
    what: "Checks that an expert authority statement is present — a named person or body endorsing the product. Blocking only for Hero and Support. Harvest and Kill skip this gate. Typically a safety certification reference (BS 7671, CE, etc.).",
    blocking: "Hero + Support only",
    whoEdits: ["PRODUCT_SPECIALIST"],
    fields: ["expert_authority", "expert_authority_name", "compliance_notes"],
    failExample: "Lampshade Hero SKU with no expert statement. Fails G7, cannot publish.",
    passExample: "CBL-BLK-3C-1M: 'Wiring compliant with BS 7671 (IET Wiring Regulations, 18th Edition).'",
  },
  {
    id: "VECTOR", name: "Vector Similarity", emoji: "🧠",
    what: "Calls the Python worker to embed the long description and check cosine similarity ≥ 0.72 against the cluster centroid. Ensures the product description is semantically relevant to its cluster. If the embedding API is down, this gate returns PENDING (save allowed, publish blocked) and queues a retry.",
    blocking: "Yes (or PENDING if API down)",
    whoEdits: ["CONTENT_EDITOR", "PRODUCT_SPECIALIST", "CHANNEL_MANAGER"],
    fields: ["long_description", "primary_cluster_id"],
    failExample: "Description similarity = 0.61 against cluster CLU-SHD-GLS. Below 0.72 threshold.",
    passExample: "Similarity = 0.89. 'Semantic match confirmed.' Gate passes.",
  },
];

const ROLES = [
  { name: "CONTENT_EDITOR", color: "#3b82f6", can: ["Edit content fields (title, description, answer block, best_for, not_for, FAQ)", "Submit for publish (triggers gate check)", "Cannot change tier", "Cannot edit expert authority"], cannot: ["Change tier", "Edit pricing", "Modify cluster intent", "Override gate failures"] },
  { name: "PRODUCT_SPECIALIST", color: "#8b5cf6", can: ["All content editor abilities", "Edit expert authority & compliance notes", "Edit technical specifications"], cannot: ["Change tier", "Edit pricing", "Modify taxonomy"] },
  { name: "SEO_GOVERNOR", color: "#0891b2", can: ["Assign/change cluster_id", "Modify cluster intent statements", "Propose taxonomy changes", "Approve cluster change requests"], cannot: ["Edit content fields", "Change tier", "Edit pricing"] },
  { name: "CHANNEL_MANAGER", color: "#059669", can: ["Edit content fields", "Submit for publish", "Manage channel mappings"], cannot: ["Change tier", "Edit pricing", "Modify clusters"] },
  { name: "FINANCE", color: "#d97706", can: ["Trigger tier recalculation", "ERP sync", "Approve manual tier changes (dual sign-off)"], cannot: ["Edit content fields", "Edit expert authority"] },
  { name: "CONTENT_LEAD", color: "#dc2626", can: ["Set validation_status (publish/approve)", "Assign briefs", "View effort reports", "Approve tier changes (dual sign-off)"], cannot: ["Edit content fields", "Change tier directly", "Modify clusters"] },
  { name: "AI_OPS", color: "#64748b", can: ["Run AI audit", "View audit results", "Manage golden queries"], cannot: ["Edit SKU content", "Change tier", "Publish SKUs"] },
  { name: "ADMIN", color: "#1e293b", can: ["Full access to all fields and actions", "Modify 9-intent taxonomy", "Manage users and roles"], cannot: [] },
];

const FLOW_STEPS = [
  {
    id: 1, icon: "🏭", title: "ERP Sync",
    who: "FINANCE / SYSTEM",
    what: "The journey begins in your ERP (e.g. Shopify, SAP). Every week, the Finance team triggers POST /erp/sync with a payload of SKU commercial data: contribution margin %, cost-per-paid-click, 90-day velocity, and return rate.",
    detail: "The system computes a commercial score for each SKU and derives cohort percentile thresholds (p80/p30/p10). Score ≥ p80 → HERO. Score ≥ p30 → SUPPORT. Score ≥ p10 → HARVEST. Below p10 or negative margin → KILL. Every tier change writes to sku_tier_history and audit_log.",
    fixture: "FLR-ARC-BLK-175: margin = -4.2% → KILL override. CBL-BLK-3C-1M: margin = 62%, velocity = 847 → HERO.",
    color: "#1e293b",
  },
  {
    id: 2, icon: "✏️", title: "Content Creation",
    who: "CONTENT_EDITOR / PRODUCT_SPECIALIST",
    what: "A content editor opens the SKU in the CMS. The tier banner immediately shows what work is required. For a HERO SKU: 'Full CIE Coverage. Target: ≥85 readiness on all active channels within 30 days.'",
    detail: "The editor fills in: Title (intent first, then attributes, pipe separator), Short/Long Description, AI Answer Block (250–300 chars, intent keyword required), Best-For (min 2 items), Not-For (min 1 item), FAQ data. The Product Specialist adds the Expert Authority statement. Fields not applicable to the tier are hidden with explanatory tooltips.",
    fixture: "CBL-BLK-3C-1M: Answer block = 287 chars starting with 'A 3-core braided pendant cable set...' — starts with product type, not brand name. Contains 'compat' (Compatibility intent keyword).",
    color: "#2563eb",
  },
  {
    id: 3, icon: "🚦", title: "Gate Validation (G1–G7 + Vector)",
    who: "Triggered by CONTENT_EDITOR / any publish attempt",
    what: "When the editor clicks Submit, the system runs all 8 validation checks in sequence. Gates G1–G7 plus the Vector similarity check. ALL blocking gates must pass before validation_status can be set to VALID or PENDING.",
    detail: "GateValidator orchestrates each gate class. Results are written to sku_gate_status (pass/fail/pending/not_applicable). If the embedding API is down, the Vector gate returns PENDING — save is allowed but publish is blocked. Retry queue (validation_retry_queue) is populated and retried every 5 minutes.",
    fixture: "SHD-GLS-CNE-20: G4 fails (242 chars, min 250). submit_enabled = false. BLB-LED-B22-8W: G5 fails (not_for empty). CBL-RED-3C-2M (Harvest): G3/G4/G5/G7 all N/A — not applicable for Harvest tier.",
    color: "#7c3aed",
  },
  {
    id: 4, icon: "📊", title: "Readiness Scoring",
    who: "Automatic — computed on every save",
    what: "A separate 0–100 score is computed per SKU across four channels: own_website, google_sge, amazon, ai_assistants. This is advisory, not a gate. It tells the team where to invest time.",
    detail: "10 components contribute: valid cluster (10pts), primary intent (10pts), secondary intents (10pts), G4 answer block (15pts), best_for/not_for (10pts), expert authority (10pts), JSON-LD renders (10pts), images (10pts), pricing (10pts), category completeness (5pts). Harvest SKUs score only 5 applicable components (max 45 raw). Hero/Support normalised to 0–100.",
    fixture: "CBL-BLK-3C-1M (Hero): expected readiness = 92 (google_sge), 85 (ai_assistants), 95 (own_website). FLR-ARC-BLK-175 (Kill): all channels SKIP, readiness = 0.",
    color: "#0891b2",
  },
  {
    id: 5, icon: "🌐", title: "JSON-LD & Wikidata Output",
    who: "Automatic on every render",
    what: "For published SKUs, JsonLdRenderer outputs Schema.org Product JSON-LD in the page <head>. Hero SKUs get the full treatment including sameAs array pointing to Wikidata entity URIs — the highest-impact AI citation signal.",
    detail: "Hero: Product schema + sameAs (Wikidata Q-ids) + additionalProperty (Expert Authority, Best-For, Not-For) + FAQPage schema (if FAQs present). Support: Product schema + description. Harvest: Product name + price only. Kill: empty string — no schema output at all.",
    fixture: "CBL-BLK-3C-1M has wikidata_entities [{qid:'Q174102'},{qid:'Q193514'}] → sameAs: ['https://www.wikidata.org/wiki/Q174102', 'https://www.wikidata.org/wiki/Q193514']",
    color: "#059669",
  },
  {
    id: 6, icon: "🔍", title: "Weekly AI Audit",
    who: "AI_OPS / ADMIN (manual trigger) or automated cron",
    what: "Every week, 20 locked golden queries per category are sent to 4 AI engines (ChatGPT, Gemini, Perplexity, Google SGE). Each question asks the AI whether it can cite your product. Scores are 0–3 per engine per question.",
    detail: "Quorum rules: 3+ engines responding = COMPLETE, decay advances normally. 2 engines = PARTIAL, decay timer PAUSED. ≤1 engine = FAILED, decay FROZEN. This prevents false decay escalations when audit infrastructure is degraded. Results stored in ai_audit_results with per-question scores and response snippets.",
    fixture: "If CBL-BLK-3C-1M receives score 0 across all engines for all its target questions: decay_consecutive_zeros increments by 1.",
    color: "#d97706",
  },
  {
    id: 7, icon: "📉", title: "Decay Detection",
    who: "SYSTEM — cie:decay-check runs weekly (Monday 06:30)",
    what: "After each quorum-met audit, the decay command checks every Hero SKU. If citation score = 0 for that week, decay_consecutive_zeros increments. Non-zero score resets the counter to 0 and sets decay_status back to 'none'.",
    detail: "Week 1 zero → yellow_flag (notification). Week 2 → alert (escalation warning). Week 3 → auto_brief (ContentBrief record created, brief queued in Python worker, audit_log entry written). Week 4+ → escalated (Portfolio Holder notified). Kill-tier SKUs are excluded from decay processing.",
    fixture: "Hero SKU with 3 consecutive zero-citation weeks: decay_status = 'auto_brief', ContentBrief created with brief_type = 'DECAY_REFRESH', title = 'Auto-brief: 3-week citation decay – [SKU name]'.",
    color: "#ea580c",
  },
  {
    id: 8, icon: "📝", title: "Auto-Brief & Refresh",
    who: "CONTENT_LEAD assigns, CONTENT_EDITOR executes",
    what: "The auto-generated brief appears in the briefs dashboard. It contains: the SKU details, the failing golden queries (score = 0), the current answer block, top competitor response snippets from audit results, a suggested revision direction, a 7-day deadline, and success criteria (score ≥ 1 on next audit).",
    detail: "The Content Lead assigns the brief to an editor. The editor refreshes the answer block, updates best_for/not_for if needed, and re-runs validation. If the next weekly audit returns score > 0, decay_consecutive_zeros resets to 0 and decay_status returns to 'none'. The loop is complete.",
    fixture: "Success: next audit week, CBL-BLK-3C-1M returns citation score 2/3 → decay_consecutive_zeros = 0, decay_status = 'none'. Brief marked COMPLETED.",
    color: "#16a34a",
  },
];

export default function CieDemo() {
  const [activeSection, setActiveSection] = useState("flow");
  const [activeStep, setActiveStep] = useState(null);
  const [activeGate, setActiveGate] = useState(null);
  const [activeRole, setActiveRole] = useState(null);

  return (
    <div style={{ fontFamily: "'Georgia', 'Times New Roman', serif", background: "#0f0f0f", minHeight: "100vh", color: "#e8e0d0" }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #0f0f0f 0%, #1a1a2e 50%, #0f0f0f 100%)", borderBottom: "1px solid #2a2a2a", padding: "40px 48px 32px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 8 }}>
          <span style={{ fontFamily: "monospace", fontSize: 11, color: "#6b6b6b", letterSpacing: 4, textTransform: "uppercase" }}>CIE v2.3.2</span>
          <span style={{ color: "#3a3a3a" }}>|</span>
          <span style={{ fontFamily: "monospace", fontSize: 11, color: "#6b6b6b", letterSpacing: 4, textTransform: "uppercase" }}>Content Intelligence Engine</span>
        </div>
        <h1 style={{ fontSize: 42, fontWeight: 400, margin: "0 0 8px", lineHeight: 1.1, letterSpacing: -1 }}>
          How the System Works
        </h1>
        <p style={{ margin: 0, color: "#9a8f80", fontSize: 16, fontStyle: "italic" }}>
          From ERP data to AI citation — the complete product lifecycle
        </p>
      </div>

      {/* Nav */}
      <div style={{ display: "flex", borderBottom: "1px solid #2a2a2a", background: "#111" }}>
        {[
          { id: "flow", label: "Full Flow", emoji: "→" },
          { id: "gates", label: "Gate System", emoji: "🚦" },
          { id: "rbac", label: "Who Can Do What", emoji: "🔐" },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveSection(tab.id)} style={{
            background: activeSection === tab.id ? "#1a1a1a" : "transparent",
            border: "none", borderBottom: activeSection === tab.id ? "2px solid #c8a96e" : "2px solid transparent",
            color: activeSection === tab.id ? "#c8a96e" : "#6b6b6b",
            padding: "16px 32px", cursor: "pointer", fontSize: 14, fontFamily: "inherit", letterSpacing: 0.5,
            transition: "all 0.2s",
          }}>
            {tab.emoji} {tab.label}
          </button>
        ))}
      </div>

      {/* FLOW SECTION */}
      {activeSection === "flow" && (
        <div style={{ padding: "40px 48px" }}>
          {/* Tier legend */}
          <div style={{ display: "flex", gap: 12, marginBottom: 40, flexWrap: "wrap" }}>
            {Object.entries(TIER_META).map(([t, m]) => (
              <div key={t} style={{ background: m.bg, border: `1px solid ${m.border}`, borderRadius: 8, padding: "10px 16px", flex: 1, minWidth: 180 }}>
                <div style={{ color: m.color, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{m.icon} {m.label}</div>
                <div style={{ color: "#4a4a4a", fontSize: 12, lineHeight: 1.4 }}>{m.desc}</div>
              </div>
            ))}
          </div>

          {/* Steps */}
          <div style={{ position: "relative" }}>
            {/* Connecting line */}
            <div style={{ position: "absolute", left: 31, top: 0, bottom: 0, width: 2, background: "linear-gradient(180deg, #c8a96e22, #c8a96e55, #c8a96e22)", zIndex: 0 }} />

            {FLOW_STEPS.map((step, i) => (
              <div key={step.id} style={{ display: "flex", gap: 24, marginBottom: 12, position: "relative", zIndex: 1 }}>
                {/* Step number bubble */}
                <div style={{
                  width: 64, height: 64, borderRadius: "50%", background: step.color, color: "#fff",
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, fontSize: 20, border: "3px solid #0f0f0f", cursor: "default", boxShadow: `0 0 20px ${step.color}44`
                }}>
                  {step.icon}
                </div>

                {/* Card */}
                <div
                  onClick={() => setActiveStep(activeStep === step.id ? null : step.id)}
                  style={{
                    flex: 1, background: "#1a1a1a", border: `1px solid ${activeStep === step.id ? step.color : "#2a2a2a"}`,
                    borderRadius: 12, padding: "20px 24px", cursor: "pointer",
                    transition: "all 0.2s", marginBottom: 8,
                    boxShadow: activeStep === step.id ? `0 0 24px ${step.color}33` : "none",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: activeStep === step.id ? 16 : 0 }}>
                    <div>
                      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 6 }}>
                        <span style={{ background: step.color, color: "#fff", padding: "2px 10px", borderRadius: 20, fontSize: 11, fontFamily: "monospace", fontWeight: 700 }}>STEP {step.id}</span>
                        <span style={{ color: "#6b6b6b", fontSize: 12, fontFamily: "monospace" }}>WHO: {step.who}</span>
                      </div>
                      <h3 style={{ margin: 0, fontSize: 20, fontWeight: 400, color: "#e8e0d0" }}>{step.title}</h3>
                    </div>
                    <span style={{ color: "#6b6b6b", fontSize: 18, transform: activeStep === step.id ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
                  </div>

                  {activeStep !== step.id && (
                    <p style={{ margin: "8px 0 0", color: "#8a8070", fontSize: 14, lineHeight: 1.5 }}>{step.what.slice(0, 120)}…</p>
                  )}

                  {activeStep === step.id && (
                    <div>
                      <p style={{ margin: "0 0 16px", color: "#b0a090", fontSize: 15, lineHeight: 1.7 }}>{step.what}</p>
                      <div style={{ background: "#111", borderRadius: 8, padding: 16, marginBottom: 12, borderLeft: `3px solid ${step.color}` }}>
                        <div style={{ color: "#6b6b6b", fontSize: 11, fontFamily: "monospace", letterSpacing: 2, marginBottom: 8, textTransform: "uppercase" }}>Mechanics</div>
                        <p style={{ margin: 0, color: "#9a8f80", fontSize: 14, lineHeight: 1.7 }}>{step.detail}</p>
                      </div>
                      <div style={{ background: "#0a1a0a", borderRadius: 8, padding: 16, border: "1px solid #1a3a1a" }}>
                        <div style={{ color: "#4a7a4a", fontSize: 11, fontFamily: "monospace", letterSpacing: 2, marginBottom: 8, textTransform: "uppercase" }}>📦 Fixture Example</div>
                        <p style={{ margin: 0, color: "#7a9a7a", fontSize: 13, fontFamily: "monospace", lineHeight: 1.6 }}>{step.fixture}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* GATES SECTION */}
      {activeSection === "gates" && (
        <div style={{ padding: "40px 48px" }}>
          <div style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 28, fontWeight: 400, margin: "0 0 8px" }}>The Gate System</h2>
            <p style={{ color: "#8a8070", margin: 0, fontSize: 15, lineHeight: 1.6 }}>
              Gates are sequential checks that run before any SKU can be published. All blocking gates must return <code style={{ background: "#1a2a1a", color: "#6acc6a", padding: "1px 6px", borderRadius: 4 }}>pass</code> or <code style={{ background: "#1a2a1a", color: "#6b7280", padding: "1px 6px", borderRadius: 4 }}>not_applicable</code> for a SKU to reach <code style={{ background: "#1a2a1a", color: "#6acc6a", padding: "1px 6px", borderRadius: 4 }}>VALID</code> status. A <code style={{ background: "#2a1a1a", color: "#f87171", padding: "1px 6px", borderRadius: 4 }}>fail</code> or <code style={{ background: "#2a2a0a", color: "#fbbf24", padding: "1px 6px", borderRadius: 4 }}>pending</code> gate blocks publish completely.
            </p>
          </div>

          {/* Gate status legend */}
          <div style={{ display: "flex", gap: 12, marginBottom: 32, flexWrap: "wrap" }}>
            {[
              { status: "pass", color: COLORS.gate_pass, bg: "#0a2a0a", desc: "Gate check passed" },
              { status: "fail", color: COLORS.gate_fail, bg: "#2a0a0a", desc: "Blocking failure — cannot publish" },
              { status: "pending", color: COLORS.gate_pending, bg: "#2a1a00", desc: "API degraded — save allowed, publish blocked" },
              { status: "not_applicable", color: COLORS.gate_na, bg: "#1a1a1a", desc: "Gate skipped for this tier" },
            ].map(s => (
              <div key={s.status} style={{ background: s.bg, border: `1px solid ${s.color}44`, borderRadius: 8, padding: "10px 16px", display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
                <div>
                  <code style={{ color: s.color, fontSize: 12 }}>{s.status}</code>
                  <span style={{ color: "#6b6b6b", fontSize: 12, marginLeft: 8 }}>{s.desc}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Per-tier gate applicability table */}
          <div style={{ background: "#1a1a1a", borderRadius: 12, border: "1px solid #2a2a2a", marginBottom: 32, overflow: "hidden" }}>
            <div style={{ padding: "16px 24px", borderBottom: "1px solid #2a2a2a", background: "#111" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 400, color: "#c8a96e" }}>Gate Applicability by Tier</h3>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#111" }}>
                    <th style={{ padding: "12px 20px", textAlign: "left", color: "#6b6b6b", fontWeight: 400, borderBottom: "1px solid #2a2a2a" }}>Gate</th>
                    {["HERO", "SUPPORT", "HARVEST", "KILL"].map(t => (
                      <th key={t} style={{ padding: "12px 16px", textAlign: "center", color: TIER_META[t].color, fontWeight: 700, borderBottom: "1px solid #2a2a2a", fontSize: 12 }}>{t}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { gate: "G1 Basic Info", hero: "BLOCKING", support: "BLOCKING", harvest: "BLOCKING", kill: "N/A" },
                    { gate: "G2 Primary Intent", hero: "BLOCKING", support: "BLOCKING", harvest: "BLOCKING", kill: "N/A" },
                    { gate: "G3 Secondary Intents", hero: "BLOCKING", support: "BLOCKING", harvest: "N/A", kill: "N/A" },
                    { gate: "G4 Answer Block", hero: "BLOCKING", support: "BLOCKING", harvest: "N/A (suspended)", kill: "N/A" },
                    { gate: "G5 Technical / Best-For", hero: "BLOCKING", support: "BLOCKING", harvest: "Specs only", kill: "N/A" },
                    { gate: "G6 Commercial Policy", hero: "BLOCKING", support: "BLOCKING", harvest: "BLOCKING", kill: "BLOCKING" },
                    { gate: "G7 Expert Authority", hero: "BLOCKING", support: "BLOCKING", harvest: "N/A", kill: "N/A" },
                    { gate: "VECTOR Similarity", hero: "BLOCKING*", support: "BLOCKING*", harvest: "BLOCKING*", kill: "N/A" },
                  ].map((row, i) => (
                    <tr key={row.gate} style={{ background: i % 2 === 0 ? "#161616" : "#1a1a1a" }}>
                      <td style={{ padding: "12px 20px", color: "#c8c0b0", borderBottom: "1px solid #222" }}>{row.gate}</td>
                      {["hero", "support", "harvest", "kill"].map(t => {
                        const v = row[t];
                        const isBlock = v === "BLOCKING" || v === "BLOCKING*";
                        const isNA = v === "N/A";
                        const isPart = v.includes("only") || v.includes("only") || v.includes("suspended");
                        return (
                          <td key={t} style={{ padding: "10px 16px", textAlign: "center", borderBottom: "1px solid #222" }}>
                            <span style={{
                              display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontFamily: "monospace",
                              background: isBlock ? "#1a0a0a" : isNA ? "#111" : "#0a1a0a",
                              color: isBlock ? "#f87171" : isNA ? "#4b5563" : "#fbbf24",
                              border: `1px solid ${isBlock ? "#f8717144" : isNA ? "#33333344" : "#fbbf2444"}`,
                            }}>{v}</span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "10px 20px", borderTop: "1px solid #222", color: "#5a5a5a", fontSize: 12, fontStyle: "italic" }}>
              * BLOCKING when API available. Returns PENDING (save allowed, publish blocked) when embedding API is degraded.
            </div>
          </div>

          {/* Gate detail cards */}
          <h3 style={{ fontSize: 20, fontWeight: 400, marginBottom: 20, color: "#e8e0d0" }}>Gate Details — Click any gate to expand</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {GATES.map(gate => (
              <div
                key={gate.id}
                onClick={() => setActiveGate(activeGate === gate.id ? null : gate.id)}
                style={{
                  background: "#1a1a1a", border: `1px solid ${activeGate === gate.id ? "#c8a96e" : "#2a2a2a"}`,
                  borderRadius: 12, padding: 20, cursor: "pointer", transition: "all 0.2s",
                  boxShadow: activeGate === gate.id ? "0 0 24px #c8a96e22" : "none",
                  gridColumn: activeGate === gate.id ? "span 2" : "span 1",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: activeGate === gate.id ? 16 : 0 }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <span style={{ fontSize: 24 }}>{gate.emoji}</span>
                    <div>
                      <code style={{ color: "#c8a96e", fontSize: 16, fontWeight: 700 }}>{gate.id}</code>
                      <span style={{ color: "#e8e0d0", fontSize: 16, marginLeft: 8 }}>{gate.name}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ background: "#1a0a0a", color: "#f87171", border: "1px solid #f8717144", padding: "2px 10px", borderRadius: 20, fontSize: 11, fontFamily: "monospace" }}>
                      {typeof gate.blocking === "string" ? gate.blocking : "BLOCKING"}
                    </span>
                    <span style={{ color: "#6b6b6b", fontSize: 16 }}>{activeGate === gate.id ? "▲" : "▼"}</span>
                  </div>
                </div>

                {activeGate !== gate.id && (
                  <p style={{ margin: "8px 0 0", color: "#6b6b6b", fontSize: 13, lineHeight: 1.5 }}>{gate.what.slice(0, 100)}…</p>
                )}

                {activeGate === gate.id && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                    <div>
                      <div style={{ background: "#111", borderRadius: 8, padding: 16, marginBottom: 12, borderLeft: "3px solid #c8a96e" }}>
                        <div style={{ color: "#c8a96e", fontSize: 11, fontFamily: "monospace", letterSpacing: 2, marginBottom: 8, textTransform: "uppercase" }}>What it checks</div>
                        <p style={{ margin: 0, color: "#9a8f80", fontSize: 14, lineHeight: 1.7 }}>{gate.what}</p>
                      </div>
                      <div style={{ background: "#111", borderRadius: 8, padding: 16 }}>
                        <div style={{ color: "#6b7280", fontSize: 11, fontFamily: "monospace", letterSpacing: 2, marginBottom: 8, textTransform: "uppercase" }}>Fields checked</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {gate.fields.map(f => (
                            <code key={f} style={{ background: "#1a1a2a", color: "#818cf8", padding: "3px 8px", borderRadius: 4, fontSize: 12 }}>{f}</code>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div>
                      <div style={{ background: "#0a1a0a", borderRadius: 8, padding: 16, marginBottom: 12, border: "1px solid #1a3a1a" }}>
                        <div style={{ color: "#4a7a4a", fontSize: 11, fontFamily: "monospace", letterSpacing: 2, marginBottom: 8, textTransform: "uppercase" }}>✓ Pass Example</div>
                        <p style={{ margin: 0, color: "#7a9a7a", fontSize: 13, fontFamily: "monospace", lineHeight: 1.6 }}>{gate.passExample}</p>
                      </div>
                      <div style={{ background: "#1a0a0a", borderRadius: 8, padding: 16, marginBottom: 12, border: "1px solid #3a1a1a" }}>
                        <div style={{ color: "#7a4a4a", fontSize: 11, fontFamily: "monospace", letterSpacing: 2, marginBottom: 8, textTransform: "uppercase" }}>✕ Fail Example</div>
                        <p style={{ margin: 0, color: "#9a7a7a", fontSize: 13, fontFamily: "monospace", lineHeight: 1.6 }}>{gate.failExample}</p>
                      </div>
                      <div style={{ background: "#111", borderRadius: 8, padding: 16 }}>
                        <div style={{ color: "#6b7280", fontSize: 11, fontFamily: "monospace", letterSpacing: 2, marginBottom: 8, textTransform: "uppercase" }}>Who can fix it</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {gate.whoEdits.map(r => (
                            <span key={r} style={{ background: "#1a1a1a", color: "#c8a96e", border: "1px solid #c8a96e44", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontFamily: "monospace" }}>{r}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* No-bypass note */}
          <div style={{ background: "#1a0a0a", border: "1px solid #7f1d1d", borderRadius: 12, padding: 20, marginTop: 24 }}>
            <div style={{ color: "#f87171", fontWeight: 700, marginBottom: 8 }}>⚠ Critical Rule: No Gate Override</div>
            <p style={{ margin: 0, color: "#9a7a7a", fontSize: 14, lineHeight: 1.7 }}>
              No role — including ADMIN — can override a blocking gate failure to force a publish. <code style={{ background: "#2a0a0a", padding: "1px 6px", borderRadius: 4 }}>canOverrideGateFailures()</code> returns <code style={{ background: "#2a0a0a", padding: "1px 6px", borderRadius: 4 }}>false</code> for every role. The only path to publication is fixing the underlying field that caused the failure. This is a hard architectural constraint, not a permission setting.
            </p>
          </div>
        </div>
      )}

      {/* RBAC SECTION */}
      {activeSection === "rbac" && (
        <div style={{ padding: "40px 48px" }}>
          <div style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 28, fontWeight: 400, margin: "0 0 8px" }}>Who Can Do What</h2>
            <p style={{ color: "#8a8070", margin: 0, fontSize: 15, lineHeight: 1.6 }}>
              The permission matrix is enforced at both the API layer (RBAC middleware + PermissionService) and the frontend (rbac.js). There is no superuser bypass. Click a role to see its full permissions.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 32 }}>
            {ROLES.map(role => (
              <div
                key={role.name}
                onClick={() => setActiveRole(activeRole === role.name ? null : role.name)}
                style={{
                  background: activeRole === role.name ? "#1a1a1a" : "#141414",
                  border: `1px solid ${activeRole === role.name ? role.color : "#2a2a2a"}`,
                  borderRadius: 10, padding: "16px 20px", cursor: "pointer",
                  transition: "all 0.2s", boxShadow: activeRole === role.name ? `0 0 20px ${role.color}33` : "none",
                }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: role.color, flexShrink: 0 }} />
                  <code style={{ color: role.color, fontSize: 12, fontWeight: 700 }}>{role.name}</code>
                </div>
                <div style={{ color: "#5a5a5a", fontSize: 12 }}>{role.can.length} abilities · {role.cannot.length} restrictions</div>
              </div>
            ))}
          </div>

          {activeRole && (() => {
            const role = ROLES.find(r => r.name === activeRole);
            return (
              <div style={{ background: "#1a1a1a", border: `1px solid ${role.color}`, borderRadius: 12, padding: 28, marginBottom: 32, boxShadow: `0 0 32px ${role.color}22` }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 24 }}>
                  <div style={{ width: 14, height: 14, borderRadius: "50%", background: role.color }} />
                  <h3 style={{ margin: 0, fontSize: 22, fontWeight: 400, color: role.color, fontFamily: "monospace" }}>{role.name}</h3>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
                  <div>
                    <div style={{ color: "#4a7a4a", fontSize: 12, fontFamily: "monospace", letterSpacing: 2, marginBottom: 12, textTransform: "uppercase" }}>✓ Can do</div>
                    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                      {role.can.map((item, i) => (
                        <li key={i} style={{ display: "flex", gap: 10, marginBottom: 8, color: "#9a9a8a", fontSize: 14, lineHeight: 1.5 }}>
                          <span style={{ color: "#4a7a4a", flexShrink: 0 }}>›</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    {role.cannot.length > 0 && (
                      <>
                        <div style={{ color: "#7a4a4a", fontSize: 12, fontFamily: "monospace", letterSpacing: 2, marginBottom: 12, textTransform: "uppercase" }}>✕ Cannot do</div>
                        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                          {role.cannot.map((item, i) => (
                            <li key={i} style={{ display: "flex", gap: 10, marginBottom: 8, color: "#7a7070", fontSize: 14, lineHeight: 1.5 }}>
                              <span style={{ color: "#7a4a4a", flexShrink: 0 }}>›</span>
                              {item}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {role.cannot.length === 0 && (
                      <div style={{ color: "#5a5a5a", fontSize: 13, fontStyle: "italic" }}>No restrictions — full system access.</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Tier change dual sign-off */}
          <div style={{ background: "#111", border: "1px solid #3a2a1a", borderRadius: 12, padding: 24, marginBottom: 20 }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 400, color: "#c8a96e" }}>Manual Tier Change — Dual Sign-Off Required</h3>
            <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              {[
                { label: "Request", who: "Any role", color: "#6b7280" },
                { label: "→", who: "", color: "#3a3a3a" },
                { label: "Approve #1", who: "CONTENT_LEAD (Portfolio Holder)", color: "#dc2626" },
                { label: "→", who: "", color: "#3a3a3a" },
                { label: "Approve #2", who: "FINANCE", color: "#d97706" },
                { label: "→", who: "", color: "#3a3a3a" },
                { label: "Applied", who: "sku_tier_history written", color: "#16a34a" },
              ].map((step, i) => (
                <div key={i} style={{ textAlign: "center" }}>
                  {step.who ? (
                    <div style={{ background: "#1a1a1a", border: `1px solid ${step.color}44`, borderRadius: 8, padding: "10px 16px" }}>
                      <div style={{ color: step.color, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{step.label}</div>
                      <div style={{ color: "#6b6b6b", fontSize: 11, fontFamily: "monospace" }}>{step.who}</div>
                    </div>
                  ) : (
                    <span style={{ color: step.color, fontSize: 24, padding: "0 4px" }}>→</span>
                  )}
                </div>
              ))}
            </div>
            <p style={{ margin: "16px 0 0", color: "#6b6b6b", fontSize: 13, lineHeight: 1.6 }}>
              ERP Sync (automated) bypasses dual sign-off because it derives tiers mathematically from objective commercial data. Manual tier overrides (e.g. Portfolio Holder believes HARVEST should be SUPPORT) always require both CONTENT_LEAD and FINANCE approval to prevent gaming.
            </p>
          </div>

          {/* Key restrictions summary */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {[
              { rule: "Kill SKU Editing", detail: "Once a SKU reaches KILL tier, all content fields become read-only at both API and UI layers. The 403 fires before any field logic runs. No role can edit a Kill SKU's content — not even ADMIN via the normal update flow.", color: "#dc2626" },
              { rule: "Tier Field in API", detail: "The 'tier' field is absent from every role's allowedSkuUpdateFields() return. It cannot be set via PUT /skus/{id}. The only paths are ERP sync or POST /tiers/recalculate (FINANCE/ADMIN only).", color: "#7c3aed" },
              { rule: "Gate Override", detail: "canOverrideGateFailures() returns false for every role including ADMIN. The only way past a blocking gate is to fix the field that failed it. This is a code-level constraint with no configuration bypass.", color: "#ea580c" },
              { rule: "Taxonomy Modification", detail: "The 9-intent taxonomy (Compatibility, Installation, Specification, etc.) can only be modified by ADMIN. SEO_GOVERNOR can propose taxonomy changes but cannot apply them. This prevents uncontrolled intent taxonomy drift.", color: "#0891b2" },
            ].map(r => (
              <div key={r.rule} style={{ background: "#1a1a1a", border: `1px solid ${r.color}33`, borderRadius: 10, padding: 20 }}>
                <div style={{ color: r.color, fontWeight: 700, fontSize: 15, marginBottom: 8 }}>{r.rule}</div>
                <p style={{ margin: 0, color: "#8a8070", fontSize: 13, lineHeight: 1.7 }}>{r.detail}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ borderTop: "1px solid #2a2a2a", padding: "20px 48px", background: "#0a0a0a", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "#3a3a3a", fontSize: 12, fontFamily: "monospace" }}>CIE v2.3.2 — Hardening Addendum: 6 patches applied</span>
        <div style={{ display: "flex", gap: 20 }}>
          {[
            { label: "Patch 1", desc: "Fail-soft vector" },
            { label: "Patch 2", desc: "Audit quorum" },
            { label: "Patch 3", desc: "Readiness scoring" },
            { label: "Patch 4", desc: "FAQ templates" },
            { label: "Patch 5", desc: "Cluster governance" },
            { label: "Patch 6", desc: "Tier UX banners" },
          ].map(p => (
            <span key={p.label} style={{ color: "#4a4a4a", fontSize: 11, fontFamily: "monospace" }} title={p.desc}>{p.label} ✓</span>
          ))}
        </div>
      </div>
    </div>
  );
}
