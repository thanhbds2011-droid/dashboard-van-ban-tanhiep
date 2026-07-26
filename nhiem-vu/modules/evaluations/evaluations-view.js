import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260726.PRODUCTION4_UI_ADMIN";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
