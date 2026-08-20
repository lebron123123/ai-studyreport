const test=require("node:test");
const assert=require("node:assert/strict");
const tokens=require("../ppt-design-tokens.js");

test("all four formal templates have complete design tokens",()=>{
  const ids=["anju-blue","gov-clean","data-light","business-blue-160"];
  for(const id of ids){
    const t=tokens.get(id);
    assert.equal(t.id,id);
    assert.ok(t.colors.accent&&t.colors.background&&t.colors.dark);
    assert.ok(t.fonts.title&&t.fonts.body);
    assert.ok(t.chartColors.length>=6);
    assert.ok(t.typography.title&&t.spacing.pageX&&t.shape);
    assert.ok(t.source&&t.sourceType);
  }
});

test("department templates are not merely recolored copies",()=>{
  const ids=["anju-blue","gov-clean","data-light","business-blue-160"],rows=ids.map(id=>tokens.get(id));
  assert.equal(new Set(rows.map(x=>x.fonts.title)).size,4);
  assert.ok(new Set(rows.map(x=>x.spacing.pageX)).size>=3);
  assert.equal(new Set(rows.map(x=>x.shape.radius)).size,4);
  assert.equal(new Set(rows.map(x=>x.motif)).size,4);
  assert.equal(new Set(rows.map(x=>[x.fonts.title,x.spacing.pageX,x.shape.radius,x.motif].join("|"))).size,4);
});
