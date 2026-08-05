import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260805.V1_9_0";
export async function renderPlansView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "plans" });
}
