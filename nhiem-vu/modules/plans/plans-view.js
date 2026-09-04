import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260904.V1_22_6";
export async function renderPlansView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "plans" });
}
