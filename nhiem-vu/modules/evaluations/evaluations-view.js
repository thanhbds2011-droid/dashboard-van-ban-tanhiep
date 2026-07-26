import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260726.PRODUCTION2_KPI366";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
