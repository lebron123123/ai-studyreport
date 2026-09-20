const fs=require('node:fs'),path=require('node:path'),D=require('../docx.umd.js'),build=require('../docxgen.js');
(async()=>{
 const directory=path.resolve('outputs/report-output-qa');fs.mkdirSync(directory,{recursive:true});
 const payload={project:{name:'[系统测试]通用报告规则核验'},chapters:[{cn:'一',name:'项目概况',sections:[{title:'房源现状',blocks:[{type:'p',text:'本项目共195套。租金需进一步核实。【待补：周边竞品租金调研数据】（来源：测试调研表。）'},{type:'p',text:'[[TABLE]]\n房型|层高（m）|套数（套）|建筑面积（㎡）|得房率\n2—6F标准层|5.4|75|2274.5|【待补：得房率】\n7—14F标准层|4.5|120|3639.2|【待补：得房率】\n合计|—|195|5973|—\n注：建筑面积需核实。'}]}]}],provenance:{note:'不应导出',rows:[['来源'],['内部记录']]},appendix:{mainRows:[['不应导出附表']]}};
 const output=path.join(directory,'通用报告规则核验.docx');fs.writeFileSync(output,await D.Packer.toBuffer(build(D,payload)));console.log(output);
 const historical=path.resolve('outputs/table-export-verification.json');
 if(fs.existsSync(historical)){const old=JSON.parse(fs.readFileSync(historical,'utf8')).payload;fs.writeFileSync(path.join(directory,'已有报告排版核验.docx'),await D.Packer.toBuffer(build(D,old)));console.log('已从旧核验快照生成，不改写项目');}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
