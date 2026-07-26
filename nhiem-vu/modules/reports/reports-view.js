import { renderKpiWorkflow } from "../kpi/kpi-workflow.js?v=20260726.PRODUCTION5_STABLE";
export async function renderReportsView(outlet) {
  await renderKpiWorkflow(outlet, { mode: "reports", openReport: true });
}
