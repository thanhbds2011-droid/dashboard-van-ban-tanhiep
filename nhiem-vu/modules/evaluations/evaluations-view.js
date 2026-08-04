import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260804.V1_8_1";
export async function renderEvaluationsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "evaluations" });
}
