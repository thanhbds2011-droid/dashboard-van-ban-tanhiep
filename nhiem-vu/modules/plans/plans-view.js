import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260806.V1_9_4";
export async function renderPlansView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "plans" });
}
