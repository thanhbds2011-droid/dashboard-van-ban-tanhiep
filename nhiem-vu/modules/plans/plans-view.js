import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260903.V1_22_2";
export async function renderPlansView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "plans" });
}
