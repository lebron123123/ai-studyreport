import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {onRequestGet,onRequestPost} from "../functions/api/reportorchestration.js";

test("可研编排 API 暴露读写入口",()=>{assert.equal(typeof onRequestGet,"function");assert.equal(typeof onRequestPost,"function");});
test("编排迁移同时覆盖上下文、工作流、查询、反馈评测和发布",()=>{const sql=fs.readFileSync(new URL("../migrations/0019_report_orchestration.sql",import.meta.url),"utf8");for(const table of ["project_context_snapshots","report_workflows","report_query_plans","report_feedback_candidates","report_feedback_evaluations","report_rule_publications"])assert.match(sql,new RegExp("CREATE TABLE IF NOT EXISTS "+table));});
