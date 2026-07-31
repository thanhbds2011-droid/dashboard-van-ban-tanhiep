import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260731.V1_1_16";
export async function renderPlansView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "plans" });
}
