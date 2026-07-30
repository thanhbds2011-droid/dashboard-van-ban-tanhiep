import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260730.V1_1_9";
export async function renderPlansView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "plans" });
}
