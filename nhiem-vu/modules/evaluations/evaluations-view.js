import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260726.PRODUCTION5_STABLE";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
