import { renderKpiWorkflow } from "../kpi/kpi-workflow.js";
export async function renderReportsView(outlet){ await renderKpiWorkflow(outlet,{openReport:true}); }
