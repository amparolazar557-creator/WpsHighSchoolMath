// Documentation assets only. Uses the same mathematical renderer as the add-in.
const fs = require('fs');
const path = require('path');
require('../../js/plot-config.js');
require('../../js/plot-analysis.js');
const plotter = require('../../js/plotter.js');
const destination = path.join(__dirname, '../images');
fs.mkdirSync(destination, {recursive:true});
const examples = {
  'intersections': {
    expressions:['x^2','2*x+3'], bounds:{xMin:-3,xMax:5,yMin:-3,yMax:12},
    analysis:{intersection:{first:0,second:1},tangent:{curve:0,x:'0.5'}}
  },
  'piecewise': {
    expressions:['x^2','x+1'], bounds:{xMin:-3,xMax:4,yMin:-1,yMax:9},
    curves:[{domain:{max:0,maxClosed:false}},{color:'#059669',domain:{min:0,minClosed:true}}]
  },
  'parameters': {
    expressions:['a*(x-b)^2+c'], bounds:{xMin:-4,xMax:6,yMin:-3,yMax:8},
    parameters:{a:{value:0.5,min:-3,max:3,step:0.1},b:{value:1,min:-3,max:3,step:0.1},c:{value:-1,min:-3,max:3,step:0.1}},
    guides:[{axis:'x',expression:'b'},{axis:'y',expression:'c'}],
    points:[{label:'A',x:1,y:-1}]
  },
  'print': {
    expressions:['sin(x)','cos(x)'], bounds:{xMin:-6.5,xMax:6.5,yMin:-1.5,yMax:1.5},
    options:{monochrome:true,showGrid:false}
  }
};
const plots = {};
for (const [name, config] of Object.entries(examples)) {
  plots[name] = plotter.generateConfigSvg(config);
  fs.writeFileSync(path.join(destination,name+'.svg'), plots[name].svg+'\n');
}
fs.writeFileSync(path.join(__dirname,'gallery.json'),JSON.stringify(examples,null,2)+'\n');
const font = 'font-family="Microsoft YaHei, Noto Sans CJK SC, Arial, sans-serif"';
const text = (x,y,value,size=20,color='#172b4d',weight=400) => '<text x="'+x+'" y="'+y+'" font-size="'+size+'" fill="'+color+'" font-weight="'+weight+'">'+value+'</text>';
const inner = plots.intersections.svg.replace(/^<svg[^>]*>/,'').replace(/<\/svg>$/,'');
const graph = '<svg x="662" y="156" width="480" height="330" viewBox="0 0 '+plots.intersections.width+' '+plots.intersections.height+'">'+inner+'</svg>';
const hero = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="590" viewBox="0 0 1200 590" '+font+' role="img" aria-labelledby="title desc"><title id="title">WPS 高中数学工具</title><desc id="desc">离线备课工具，支持数学符号、函数图像、试卷模板与排版。右侧图像由项目绘图引擎生成。</desc><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#0b1831"/><stop offset="1" stop-color="#16386b"/></linearGradient><pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#bfd5ff" opacity=".12"/></pattern></defs><rect width="1200" height="590" rx="28" fill="url(#bg)"/><rect width="1200" height="590" rx="28" fill="url(#dots)"/><rect x="56" y="52" width="241" height="34" rx="17" fill="#1e477b"/>'+text(72,75,'WPS WRITER + PRESENTATION',12,'#cce1ff',700)+text(56,162,'把数学想法，',48,'#ffffff',700)+text(56,226,'画进试卷与课件。',48,'#ffffff',700)+text(59,279,'WPS 高中数学工具',25,'#a7caff',600)+text(59,325,'写表达式，看图像，插入文档。',20,'#d2def0')+text(59,357,'符号、模板与排版，也在同一个页签。',20,'#d2def0')+
  ['本地绘图','SVG 矢量图','离线运行'].map((label,i)=>'<rect x="'+(58+i*143)+'" y="412" width="130" height="39" rx="9" fill="#25486f"/>'+text(75+i*143,438,label,16,'#ffffff',600)).join('')+
  '<rect x="638" y="90" width="526" height="423" rx="18" fill="#ffffff"/><path d="M638 135h526" stroke="#e3eaf4"/><circle cx="660" cy="112" r="5" fill="#7a99c6"/><circle cx="678" cy="112" r="5" fill="#aec1dd"/><circle cx="696" cy="112" r="5" fill="#d3ddea"/>'+text(724,118,'曲线 · 交点 · 切线',16,'#526780',600)+graph+text(59,538,'v0.8.1  /  Windows  /  JavaScript',14,'#a4bddc')+'</svg>';
fs.writeFileSync(path.join(destination,'hero.svg'),hero+'\n');
const workflow = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="236" viewBox="0 0 1200 236" '+font+' role="img" aria-labelledby="title"><title id="title">从表达式到 WPS 文档的三步流程示意</title><rect width="1200" height="236" rx="18" fill="#eff4fc"/>'+
 [['01','输入表达式','x^2、sin(x)，或组合分段函数'],['02','调整并预览','设置范围、参数、交点和切线'],['03','插入到 WPS','文字文档或当前幻灯片']].map((a,i)=>{
   const x=28+i*395;
   return '<rect x="'+x+'" y="26" width="354" height="184" rx="14" fill="#fff"/>'+text(x+23,68,a[0],23,'#2563eb',700)+text(x+23,111,a[1],26,'#172b4d',700)+text(x+23,157,a[2],16,'#53637c')+(i<2?text(x+363,123,'→',24,'#547ab3'):'');
 }).join('')+'</svg>';
fs.writeFileSync(path.join(destination,'workflow.svg'),workflow+'\n');
console.log('Generated 6 documentation SVGs using the project renderer; saved 4 reusable configurations.');
