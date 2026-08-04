import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260804.V1_8_0";
export async function renderPlansView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "plans" });
}
