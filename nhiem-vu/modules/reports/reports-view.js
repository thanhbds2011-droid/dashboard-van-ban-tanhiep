import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260804.V1_8_2";
export async function renderReportsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "reports" });
}
