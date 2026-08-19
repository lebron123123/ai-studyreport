import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const {buildSaleWordWorkbook}=require("../export.js");

function fakeXlsx(){
  return {utils:{
    book_new:()=>({SheetNames:[],Sheets:{}}),
    aoa_to_sheet:rows=>({rows}),
    book_append_sheet:(wb,ws,name)=>{wb.SheetNames.push(name);wb.Sheets[name]=ws;}
  }};
}

test("出售类导出兼容父级投资行没有annual及个别年度对象缺失",()=>{
  const X=fakeXlsx(),R={
    allYears:[2025,2026],saleEstimate:{rows:[],allocationRows:[],allocation:{},housingPrice:{},reconciliation:{totalVsAB:0}},
    saleInvestmentPlan:{years:[2025,2026],rows:[{no:"45.1",name:"小计",amount:100,children:["45.1.1"]},{no:"45.1.1",name:"土地成本",amount:100,annual:{2026:100}}]},
    income:{2026:{sale:100,transfer:0,total:100}},cost:{2026:{saleTax:1,saleFee:2,total:80}},profit:{2026:{total:20,makeup:0,taxable:20,incomeTax:5,net:15}},
    loan:{2026:{begin:0,borrow:0,interest:0,repay:0,total:0,end:0}},cf:{2026:{inflow:100,outflow:80,net:20,cumNet:20,npv:18,cumNpv:18}},capitalCf:{2026:{inflow:100,outflow:80,net:20,cumNet:20}},rental:{}
  };
  const wb=buildSaleWordWorkbook(X,R,{investSchedule:{periods:[],tasks:[]}});
  assert.equal(wb.SheetNames.length,12);
  const investment=wb.Sheets["6投资计划"].rows;
  assert.equal(investment[1][3],0);
  assert.equal(investment[2][4],100);
});
