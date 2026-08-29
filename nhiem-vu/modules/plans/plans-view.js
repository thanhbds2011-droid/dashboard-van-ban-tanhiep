import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260829.V1_20_0";
export async function renderPlansView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "plans" });
}
