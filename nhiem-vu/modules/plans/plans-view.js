import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260901.V1_21_1";
export async function renderPlansView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "plans" });
}
