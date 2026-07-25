import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260725.COMPLETE1";
export async function renderReportsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "reports", openReport: true });
}
