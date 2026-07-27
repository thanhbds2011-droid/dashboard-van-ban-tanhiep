import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=1.0.0";
export async function renderEvaluationsView(outlet) { await renderKpiWorkflow(outlet, { mode: "plans" }); }
