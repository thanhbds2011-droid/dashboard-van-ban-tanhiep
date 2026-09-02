import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260902.V1_22_0";
export async function renderPlansView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "plans" });
}
