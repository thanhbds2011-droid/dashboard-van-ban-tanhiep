import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260725.COMPLETE1";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
