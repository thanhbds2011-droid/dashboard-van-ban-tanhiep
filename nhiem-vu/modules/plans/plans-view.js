import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260810.V1_10_3";
export async function renderPlansView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "plans" });
}
