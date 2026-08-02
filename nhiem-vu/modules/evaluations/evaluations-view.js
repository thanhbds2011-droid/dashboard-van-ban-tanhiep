import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260802.V1_6_0";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
