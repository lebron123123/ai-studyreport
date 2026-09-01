const fs=require("node:fs");
const path=require("node:path");
const docx=require("../docx.umd.js");
const build=require("../docxgen.js");

const root=path.resolve(__dirname,".."),input=process.argv[2]?path.resolve(process.argv[2]):path.join(root,"data","report-table-templates-rent-v1.json"),set=JSON.parse(fs.readFileSync(input,"utf8"));
const sections=list=>list.map(template=>({title:template.title,blocks:[{type:"templateTable",template}]}));
const payload={
  project:{name:(set.name||"可研标准表格模板库")+" v"+(set.version||1),owner:"公司可研生成逻辑库",industry:"可行性研究"},signed:true,docNo:"",
  chapters:[
    {cn:"一",num:1,name:"正文标准表格",sections:sections(set.templates.filter(t=>!t.appendix))},
    {cn:"二",num:2,name:"财务附表",sections:sections(set.templates.filter(t=>t.appendix))}
  ],appendix:null,tableAppendix:[],provenance:null
};
const output=process.argv[3]?path.resolve(process.argv[3]):path.join(root,"outputs",(set.setId||"report-table-catalog")+".docx");
fs.mkdirSync(path.dirname(output),{recursive:true});
docx.Packer.toBuffer(build(docx,payload)).then(buffer=>{fs.writeFileSync(output,buffer);process.stdout.write(JSON.stringify({output,bytes:buffer.length,logicalTemplates:set.templates.length,physicalTables:set.source.physicalTableCount})+"\n");}).catch(error=>{console.error(error);process.exitCode=1;});
