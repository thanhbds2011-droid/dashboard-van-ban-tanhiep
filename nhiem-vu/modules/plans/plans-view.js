import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260728.V1_1_3";
export async function renderPlansView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "plans" });
}
